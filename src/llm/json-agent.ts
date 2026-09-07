import { llm, type LLMOptions } from "./client.js";
import { isJsonParseError } from "./parse-json.js";
import { ZodError } from "zod";
import { pipelineLog } from "../util/pipeline-log.js";

function isRetryableOutputError(err: unknown): boolean {
  return isJsonParseError(err) || err instanceof ZodError;
}
// A lightweight local model (Ollama) is flakier at strict JSON than a hosted frontier model —
// 2 attempts left real generations one bad response away from throwing. 3 gives room for one
// syntax-repair retry AND one real re-ask before giving up.
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_TEMPERATURE = 0.35;

export interface ChatJsonWithRetryOptions extends LLMOptions {
  maxAttempts?: number;
  /** Temperature on first attempt (default from options.temperature or 0.55) */
  initialTemperature?: number;
}

/**
 * Call LLM in jsonMode with parse repair and retry on JSON syntax errors.
 * Non-JSON errors (network, schema validation) are not retried.
 */
export async function chatJsonWithRetry<T>(
  agentName: string,
  system: string,
  buildUser: (parseError?: string) => string,
  options: ChatJsonWithRetryOptions,
  parse: (raw: string) => T
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialTemperature = options.initialTemperature ?? options.temperature ?? 0.55;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const parseError =
      attempt > 0 && lastErr instanceof Error ? lastErr.message : undefined;

    try {
      const { maxAttempts: _ma, initialTemperature: _it, ...llmOptions } = options;
      const raw = await llm.chat(system, buildUser(parseError), {
        ...llmOptions,
        jsonMode: true,
        temperature: attempt === 0 ? initialTemperature : RETRY_TEMPERATURE,
      });
      return parse(raw);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1 && isRetryableOutputError(err)) {
        pipelineLog(
          `[pipeline] ${agentName} output validation failed (attempt ${attempt + 1}/${maxAttempts}): ${err instanceof Error ? err.message : String(err)} — retrying…`
        );
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
