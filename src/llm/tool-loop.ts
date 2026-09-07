/**
 * A small, generic tool-calling loop for local agents — the "MCP-style" interactivity asked for:
 * an agent isn't a single fire-and-parse LLM call, it's given a short menu of tools it can call
 * itself, in a loop, before committing to an answer (e.g. checking its own proposed fix isn't
 * itself broken before submitting it).
 *
 * Deliberately NOT the real MCP wire protocol — a small local Ollama model's native function-
 * calling support is inconsistent at best, so this uses the one channel already hardened for a
 * flaky model: JSON-mode chat + `chatJsonWithRetry` + `parseLlmJson`. Each turn the model must
 * output exactly one JSON object — either `{"tool": "<name>", "args": {...}}` to call a tool, or
 * `{"finish": true, ...}` to end the loop — same shape either way a native tool-calling API would
 * give an agent, just carried over the transport this codebase already trusts.
 */
import { llm, type LLMOptions } from "./client.js";
import { chatJsonWithRetry } from "./json-agent.js";
import { parseLlmJson } from "./parse-json.js";
import { pipelineLog } from "../util/pipeline-log.js";

export interface ToolDef<A = any, R = unknown> {
  name: string;
  /** Shown to the model verbatim — what this tool does and what args it takes. */
  description: string;
  /** Never throws out to the loop — a tool failure becomes a `{"error": "..."}` result the model
   *  sees and can react to, exactly like a real failed tool call would. */
  run: (args: A) => Promise<R> | R;
}

export interface ToolLoopOptions extends LLMOptions {
  /** Hard cap on tool-call turns before the loop gives up and throws — "check thrice" in practice:
   *  default 3 lets an agent call a self-check tool, revise, and check again once before it must
   *  either pass or run out of turns. */
  maxIterations?: number;
  initialTemperature?: number;
}

export interface ToolLoopStep {
  tool: string;
  args: unknown;
  result: unknown;
}

export interface ToolLoopResult<F> {
  /** The `finish` payload the model submitted, with `finish: true` stripped. */
  final: F;
  /** Every tool call this run made, in order — for logging/debugging, not required by callers. */
  steps: ToolLoopStep[];
}

const DEFAULT_MAX_ITERATIONS = 3;

function toolMenu(tools: ToolDef[]): string {
  return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}

/**
 * Runs one agent through a tool-calling loop until it submits `{"finish": true, ...}` or the
 * iteration cap is hit (which throws — a caller that wants a soft fallback should catch this the
 * same way it already catches any other LLM-step failure, see `util/llm-required.ts`).
 */
export async function runToolLoop<F = Record<string, unknown>>(
  agentName: string,
  systemPrompt: string,
  userPrompt: string,
  tools: ToolDef[],
  options: ToolLoopOptions = {}
): Promise<ToolLoopResult<F>> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const fullSystem = `${systemPrompt}

You work in a loop, one JSON object per turn. Available tools:
${toolMenu(tools)}

Each turn, output EXACTLY ONE JSON object, nothing else:
- To call a tool: {"tool": "<name>", "args": { ... }}
- To end the loop with your answer: {"finish": true, ... your final result fields ... }

Call a tool whenever you need to check or verify something before committing to an answer. Only
finish once you're confident the answer is right.`;

  const steps: ToolLoopStep[] = [];
  let turnPrompt = userPrompt;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const isLastIteration = iteration === maxIterations - 1;
    const prompt = isLastIteration
      ? `${turnPrompt}\n\nThis is your LAST turn — you must output {"finish": true, ...} now, not another tool call.`
      : turnPrompt;

    const parsed = await chatJsonWithRetry<{ tool?: string; args?: unknown; finish?: boolean } & Record<string, unknown>>(
      `${agentName} (turn ${iteration + 1}/${maxIterations})`,
      fullSystem,
      (parseError) => {
        const suffix = parseError
          ? `\n\nPRIOR RESPONSE WAS INVALID JSON (${parseError}). Output exactly one valid JSON object.`
          : "";
        return prompt + suffix;
      },
      { ...options, jsonMode: true, initialTemperature: options.initialTemperature ?? options.temperature ?? 0.4 },
      (raw) => parseLlmJson<{ tool?: string; args?: unknown; finish?: boolean } & Record<string, unknown>>(raw)
    );

    if (parsed.finish) {
      const { finish: _finish, ...rest } = parsed;
      return { final: rest as F, steps };
    }

    if (!parsed.tool || typeof parsed.tool !== "string") {
      turnPrompt = `Your response had neither "tool" nor "finish": true. Re-read the tool menu and try again.`;
      continue;
    }

    const tool = toolsByName.get(parsed.tool);
    let result: unknown;
    if (!tool) {
      result = { error: `Unknown tool "${parsed.tool}". Available: ${tools.map((t) => t.name).join(", ")}` };
    } else {
      try {
        result = await tool.run(parsed.args);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    steps.push({ tool: parsed.tool, args: parsed.args, result });
    pipelineLog(`[pipeline] ${agentName}: called ${parsed.tool} → ${JSON.stringify(result).slice(0, 200)}`);
    turnPrompt = `TOOL RESULT for "${parsed.tool}":\n${JSON.stringify(result)}\n\nContinue — call another tool, or finish.`;
  }

  throw new Error(
    `${agentName}: exceeded ${maxIterations} tool-call turns without finishing`
  );
}
