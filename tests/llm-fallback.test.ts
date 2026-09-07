import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type OpenAI from "openai";
import {
  LLMClient,
  resolveProvider,
  resolveProviderChain,
  shouldFailoverToNextProvider,
} from "../src/llm/client.js";
import { inspectIngestUrl } from "../src/admin/policy.js";

function statusError(status: number, message: string): Error {
  const err = new Error(message);
  Object.assign(err, { status });
  return err;
}

function fakeClient(handler: () => Promise<unknown>): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => handler(),
      },
    },
  } as unknown as OpenAI;
}

function okResponse(content = "ok") {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

describe("free-first LLM fallback", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.GROQ_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.LLM_PROVIDER;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("orders configured providers groq → ollama → mistral → openrouter → openai", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.OLLAMA_API_KEY = "ollama_test";
    process.env.MISTRAL_API_KEY = "mistral_test";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(resolveProviderChain()).toEqual([
      "groq",
      "ollama",
      "mistral",
      "openrouter",
      "openai",
    ]);
    expect(resolveProvider()).toBe("groq");
  });

  it("puts LLM_PROVIDER first then the remaining free-first list", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.MISTRAL_API_KEY = "mistral_test";
    process.env.LLM_PROVIDER = "mistral";
    expect(resolveProviderChain()).toEqual(["mistral", "groq"]);
    expect(resolveProvider()).toBe("mistral");
  });

  it("includes ollama after groq when an Ollama Cloud key is present", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.OLLAMA_API_KEY = "ollama_cloud";
    process.env.OLLAMA_BASE_URL = "https://ollama.com/v1";
    expect(resolveProviderChain()).toEqual(["groq", "ollama"]);
  });

  it("does not auto-pick local ollama unless LLM_PROVIDER=ollama", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
    expect(resolveProviderChain()).toEqual(["openai"]);
  });

  it("failsover on 401 and credit 402, not OpenRouter max_tokens caps", () => {
    expect(shouldFailoverToNextProvider(statusError(401, "Unauthorized"))).toBe(true);
    expect(shouldFailoverToNextProvider(statusError(402, "requires more credits"))).toBe(true);
    expect(
      shouldFailoverToNextProvider(statusError(402, "can only afford 200 fewer max_tokens"))
    ).toBe(false);
  });

  it("switches groq → ollama after a 401 and does not retry the same key", async () => {
    const calls: string[] = [];
    const groq = fakeClient(async () => {
      calls.push("groq");
      throw statusError(401, "Invalid API key");
    });
    const ollama = fakeClient(async () => {
      calls.push("ollama");
      return okResponse("second-provider");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = new LLMClient({
      chain: ["groq", "ollama"],
      clients: new Map([
        ["groq", groq],
        ["ollama", ollama],
      ]),
    });
    const text = await client.chat("sys", "user");
    expect(text).toBe("second-provider");
    expect(client.provider).toBe("ollama");
    expect(calls).toEqual(["groq", "ollama"]);
    // The triggering error rides along now — a cross-provider cascade used to lose the FIRST
    // failure's reason entirely, surfacing only whichever provider failed last (confirmed live).
    expect(warn).toHaveBeenCalledWith("[llm] falling back groq → ollama (groq failed: Invalid API key)");
    warn.mockRestore();
  });

  it("still blocks Framer ingest URLs", () => {
    expect(inspectIngestUrl("https://framer.com/projects/foo").ok).toBe(false);
    expect(inspectIngestUrl("https://themeforest.net/item/x").ok).toBe(false);
  });
});
