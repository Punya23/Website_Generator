import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/client.js", () => ({
  llm: {
    isAvailable: true,
    chat: vi.fn(),
    getSectionModel: vi.fn(() => "test-model"),
  },
}));

import { llm } from "../src/llm/client.js";
import { runToolLoop, type ToolDef } from "../src/llm/tool-loop.js";

describe("runToolLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls a tool then finishes, returning the finish payload and the tool-call transcript", async () => {
    const echoTool: ToolDef = {
      name: "check",
      description: "echoes back whatever it's given",
      run: (args) => ({ ok: true, echoed: args }),
    };
    vi.mocked(llm.chat)
      .mockResolvedValueOnce(JSON.stringify({ tool: "check", args: { text: "hello" } }))
      .mockResolvedValueOnce(JSON.stringify({ finish: true, text: "hello, verified" }));

    const result = await runToolLoop<{ text: string }>(
      "test-agent",
      "You are a test agent.",
      "Do the thing.",
      [echoTool],
      { model: "test-model" }
    );

    expect(result.final.text).toBe("hello, verified");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.tool).toBe("check");
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it("finishes immediately when the first turn already finishes", async () => {
    vi.mocked(llm.chat).mockResolvedValueOnce(JSON.stringify({ finish: true, text: "done" }));
    const result = await runToolLoop("test-agent", "sys", "user", [], {});
    expect(result.final).toEqual({ text: "done" });
    expect(result.steps).toHaveLength(0);
  });

  it("surfaces a tool's thrown error as a {error} result instead of crashing the loop", async () => {
    const failingTool: ToolDef = {
      name: "boom",
      description: "always throws",
      run: () => {
        throw new Error("kaboom");
      },
    };
    vi.mocked(llm.chat)
      .mockResolvedValueOnce(JSON.stringify({ tool: "boom", args: {} }))
      .mockResolvedValueOnce(JSON.stringify({ finish: true, ok: false }));

    const result = await runToolLoop("test-agent", "sys", "user", [failingTool], {});
    expect(result.steps[0]?.result).toEqual({ error: "kaboom" });
  });

  it("reports an unknown tool name as an error result instead of throwing", async () => {
    vi.mocked(llm.chat)
      .mockResolvedValueOnce(JSON.stringify({ tool: "nonexistent", args: {} }))
      .mockResolvedValueOnce(JSON.stringify({ finish: true }));

    const result = await runToolLoop("test-agent", "sys", "user", [], {});
    expect(result.steps[0]?.result).toMatchObject({ error: expect.stringContaining("Unknown tool") });
  });

  it("throws once the iteration cap is exceeded without a finish", async () => {
    const noopTool: ToolDef = { name: "noop", description: "does nothing", run: () => ({}) };
    vi.mocked(llm.chat).mockResolvedValue(JSON.stringify({ tool: "noop", args: {} }));

    await expect(
      runToolLoop("test-agent", "sys", "user", [noopTool], { maxIterations: 2 })
    ).rejects.toThrow(/exceeded 2 tool-call turns/);
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it("forces a finish attempt on the last allowed turn via the prompt (still requires the model to comply)", async () => {
    const noopTool: ToolDef = { name: "noop", description: "does nothing", run: () => ({}) };
    vi.mocked(llm.chat)
      .mockResolvedValueOnce(JSON.stringify({ tool: "noop", args: {} }))
      .mockResolvedValueOnce(JSON.stringify({ finish: true, text: "wrapped up" }));

    const result = await runToolLoop<{ text: string }>("test-agent", "sys", "user", [noopTool], {
      maxIterations: 2,
    });
    expect(result.final.text).toBe("wrapped up");
  });
});
