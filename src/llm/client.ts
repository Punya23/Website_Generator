import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llmQueue, sleep } from "./request-queue.js";
import { isRateLimitError, parseRetryAfterMs } from "./rate-limit.js";

export type LLMProvider = "groq" | "openai";

export interface LLMOptions {
  model?: string;
  temperature?: number;
  jsonMode?: boolean;
  maxTokens?: number;
}

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/** Groq-decommissioned IDs → current replacements (see console.groq.com/docs/deprecations) */
export const GROQ_MODEL_MIGRATIONS: Record<string, string> = {
  "llama-3.1-70b-versatile": "llama-3.3-70b-versatile",
  "llama-3.1-70b-specdec": "llama-3.3-70b-specdec",
  "mixtral-8x7b-32768": "llama-3.3-70b-versatile",
  "llama3-70b-8192": "llama-3.3-70b-versatile",
};

const DEFAULT_MODELS: Record<LLMProvider, { chat: string; composition: string; vision: string | null }> = {
  groq: {
    chat: "llama-3.3-70b-versatile",
    composition: "llama-3.3-70b-versatile",
    vision: null,
  },
  openai: {
    chat: "gpt-4o-mini",
    composition: "gpt-4o-mini",
    vision: "gpt-4o-mini",
  },
};

function resolveProvider(): LLMProvider | null {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();

  if (explicit === "groq") {
    return process.env.GROQ_API_KEY ? "groq" : null;
  }
  if (explicit === "openai") {
    return process.env.OPENAI_API_KEY ? "openai" : null;
  }

  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

function createClient(provider: LLMProvider): OpenAI {
  const timeoutMs = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? "120000", 10);
  if (provider === "groq") {
    return new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: GROQ_BASE_URL,
      timeout: timeoutMs,
      maxRetries: 0,
    });
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: timeoutMs,
    maxRetries: 0,
  });
}

function resolveGroqModel(model: string): string {
  return GROQ_MODEL_MIGRATIONS[model] ?? model;
}

function resolveModel(provider: LLMProvider | null, model: string): string {
  if (provider === "groq") return resolveGroqModel(model);
  return model;
}

export class LLMClient {
  readonly provider: LLMProvider | null;
  private client: OpenAI | null;
  private models: (typeof DEFAULT_MODELS)[LLMProvider];

  constructor() {
    this.provider = resolveProvider();
    this.client = this.provider ? createClient(this.provider) : null;
    this.models = this.provider ? DEFAULT_MODELS[this.provider] : DEFAULT_MODELS.groq;
  }

  get isAvailable(): boolean {
    return this.client !== null;
  }

  get supportsVision(): boolean {
    if (!this.provider) return false;
    const visionModel =
      process.env.LLM_VISION_MODEL ??
      process.env.GROQ_VISION_MODEL ??
      process.env.OPENAI_VISION_MODEL ??
      this.models.vision;
    return visionModel !== null;
  }

  getChatModel(): string {
    const raw =
      process.env.LLM_MODEL ??
      process.env.GROQ_MODEL ??
      process.env.OPENAI_MODEL ??
      this.models.chat;
    return resolveModel(this.provider, raw);
  }

  getCompositionModel(): string {
    const raw =
      process.env.LLM_COMPOSITION_MODEL ??
      process.env.GROQ_COMPOSITION_MODEL ??
      process.env.OPENAI_COMPOSITION_MODEL ??
      this.models.composition;
    return resolveModel(this.provider, raw);
  }

  getVisionModel(): string | null {
    return (
      process.env.LLM_VISION_MODEL ??
      process.env.GROQ_VISION_MODEL ??
      process.env.OPENAI_VISION_MODEL ??
      this.models.vision
    );
  }

  async chat(
    system: string,
    user: string,
    options: LLMOptions = {}
  ): Promise<string> {
    if (!this.client) {
      throw new Error(
        "No LLM configured — set GROQ_API_KEY or OPENAI_API_KEY (mock mode works without either)"
      );
    }

    return llmQueue.run(() => this.chatWithRetry(system, user, options));
  }

  private async chatWithRetry(
    system: string,
    user: string,
    options: LLMOptions,
    attempt = 0
  ): Promise<string> {
    const MAX_RETRIES = 8;

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    const model = resolveModel(this.provider, options.model ?? this.getChatModel());

    try {
      const response = await this.client!.chat.completions.create({
        model,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? defaultMaxTokens(this.provider),
        messages,
        response_format: options.jsonMode ? { type: "json_object" } : undefined,
      });

      return response.choices[0]?.message?.content ?? "";
    } catch (err: unknown) {
      if (isRateLimitError(err) && attempt < MAX_RETRIES) {
        const waitMs = parseRetryAfterMs(err, attempt);
        console.warn(
          `[llm] Groq rate limit — waiting ${(waitMs / 1000).toFixed(1)}s (retry ${attempt + 1}/${MAX_RETRIES})`
        );
        await sleep(waitMs);
        return this.chatWithRetry(system, user, options, attempt + 1);
      }
      throw enhanceGroqModelError(err, model);
    }
  }

  async chatWithVision(
    system: string,
    userText: string,
    imageBase64: string,
    options: LLMOptions = {}
  ): Promise<string> {
    if (!this.client) {
      throw new Error("No LLM configured — vision QA requires an API key");
    }

    const visionModel = options.model ?? this.getVisionModel();
    if (!visionModel) {
      throw new Error(
        `Vision QA is not supported on provider "${this.provider}" — use OpenAI or set GROQ_VISION_MODEL if available`
      );
    }

    const response = await this.client.chat.completions.create({
      model: visionModel,
      temperature: options.temperature ?? 0.3,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${imageBase64}` },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    return response.choices[0]?.message?.content ?? "";
  }
}

export const llm = new LLMClient();

export { resolveProvider, DEFAULT_MODELS, resolveGroqModel };

function defaultMaxTokens(provider: LLMProvider | null): number {
  return provider === "groq" ? 6144 : 8192;
}

function enhanceGroqModelError(err: unknown, model: string): Error {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    err.code === "model_decommissioned"
  ) {
    const replacement = GROQ_MODEL_MIGRATIONS[model];
    const hint = replacement
      ? ` Set GROQ_MODEL=${replacement} (or unset GROQ_MODEL to use the new default).`
      : " See https://console.groq.com/docs/deprecations";
    return new Error(
      `Groq model "${model}" is decommissioned.${hint}`,
      { cause: err }
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}
