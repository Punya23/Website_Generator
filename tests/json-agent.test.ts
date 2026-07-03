import { describe, it, expect, vi, beforeEach } from "vitest";

const validNav = {
  pageTone: "light",
  navTreatment: "glass-dark",
  surfaces: { default: "none", elevated: "panels", none: "typography-first" },
  colors: {
    navBg: "rgba(10,12,18,0.72)",
    navText: "#f5f5f5",
    navMuted: "#a3a3a3",
    navActiveBg: "#c45c26",
    navActiveText: "#ffffff",
  },
};

vi.mock("../src/llm/client.js", () => ({
  llm: {
    isAvailable: true,
    chat: vi.fn(),
  },
}));

import { llm } from "../src/llm/client.js";
import { chatJsonWithRetry } from "../src/llm/json-agent.js";
import { parseLlmJson } from "../src/llm/parse-json.js";
import { generateNavSurface } from "../src/agents/nav-surface-agent.js";

describe("chatJsonWithRetry", () => {
  beforeEach(() => {
    vi.mocked(llm.chat).mockReset();
  });

  it("retries on invalid JSON then succeeds", async () => {
    vi.mocked(llm.chat)
      .mockResolvedValueOnce('{ "pageTone')
      .mockResolvedValueOnce(JSON.stringify(validNav));

    const result = await chatJsonWithRetry(
      "test agent",
      "system",
      () => "user",
      { tokenRole: "design", initialTemperature: 0.55 },
      (raw) => parseLlmJson<typeof validNav>(raw)
    );

    expect(result.pageTone).toBe("light");
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it("throws after max attempts on persistent invalid JSON", async () => {
    vi.mocked(llm.chat).mockResolvedValue('{ "broken');

    await expect(
      chatJsonWithRetry(
        "test agent",
        "system",
        () => "user",
        { tokenRole: "design", maxAttempts: 2 },
        (raw) => parseLlmJson(raw)
      )
    ).rejects.toThrow(/Invalid JSON/i);
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });
});

describe("generateNavSurface", () => {
  beforeEach(() => {
    vi.mocked(llm.chat).mockReset();
    vi.stubEnv("ALLOW_MOCKS", "0");
    vi.stubEnv("PIPELINE_QUALITY", "1");
  });

  it("retries malformed JSON in quality mode", async () => {
    vi.mocked(llm.chat)
      .mockResolvedValueOnce('{ "pageTone')
      .mockResolvedValueOnce(JSON.stringify(validNav));

    const nav = await generateNavSurface("Acme Corp", "Corporate consulting firm");
    expect(nav.pageTone).toBe("light");
    expect(nav.navTreatment).toBe("glass-dark");
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });
});
