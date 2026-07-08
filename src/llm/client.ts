import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llmQueue, bespokeCodegenQueue, sleep } from "./request-queue.js";
import {
  groqFallbackModel,
  isOverCapacityError,
  isConnectionError,
  isNonRetryableLLMError,
  isOpenRouterMaxTokensCapError,
  isTransientLLMError,
  parseAffordableMaxTokens,
  parseRetryAfterMs,
  DEFAULT_GROQ_FALLBACK_MODEL,
} from "./rate-limit.js";
import { llmMaxRetries, resolveRequestMaxTokens, type TokenRole } from "./token-budget.js";
import { normalizeLlmJsonContent } from "./parse-json.js";
import { openRouterDefaults, OPENROUTER_COST_DOWNGRADE_MODEL } from "./openrouter-models.js";
import {
  estimateCostUsd,
  isOverCostCap,
  pipelineCostCapUsd,
} from "./cost-telemetry.js";

export type LLMProvider = "groq" | "openai" | "mistral" | "openrouter" | "ollama";

export interface LLMOptions {
  model?: string;
  temperature?: number;
  jsonMode?: boolean;
  /** Enforce a JSON Schema via the provider's native structured-output mode instead of prompt-
   *  engineered "return JSON" text. Falls back to jsonMode's loose json_object mode on providers
   *  that don't support it (see supportsJsonSchema) or if the provider rejects the schema. */
  responseSchema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
  maxTokens?: number;
  /** Token budget role when maxTokens omitted */
  tokenRole?: TokenRole;
  /** Route through the higher-concurrency bespoke-codegen queue instead of the shared one. */
  queue?: "default" | "codegen";
}

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1";

const OR_DEFAULTS = openRouterDefaults();

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
    vision: "meta-llama/llama-4-scout-17b-16e-instruct",
  },
  openai: {
    chat: "gpt-4o-mini",
    composition: "gpt-4o-mini",
    vision: "gpt-4o-mini",
  },
  mistral: {
    chat: "mistral-medium-latest",
    composition: "mistral-medium-latest",
    vision: "mistral-medium-latest",
  },
  openrouter: {
    chat: OR_DEFAULTS.chat,
    composition: OR_DEFAULTS.composition,
    vision: OR_DEFAULTS.vision,
  },
  ollama: {
    chat: "llama3.1:8b",
    composition: "llama3.1:8b",
    vision: null,
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
  if (explicit === "mistral") {
    return process.env.MISTRAL_API_KEY ? "mistral" : null;
  }
  if (explicit === "openrouter") {
    return process.env.OPENROUTER_API_KEY ? "openrouter" : null;
  }
  if (explicit === "ollama") {
    return "ollama";
  }

  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.MISTRAL_API_KEY) return "mistral";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
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
  if (provider === "mistral") {
    return new OpenAI({
      apiKey: process.env.MISTRAL_API_KEY,
      baseURL: MISTRAL_BASE_URL,
      timeout: timeoutMs,
      maxRetries: 0,
    });
  }
  if (provider === "openrouter") {
    return new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      timeout: timeoutMs,
      maxRetries: 0,
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "http://localhost:3847",
        "X-Title": process.env.OPENROUTER_APP_NAME ?? "website-generator",
      },
    });
  }
  if (provider === "ollama") {
    return new OpenAI({
      apiKey: process.env.OLLAMA_API_KEY ?? "ollama",
      baseURL: OLLAMA_BASE_URL,
      timeout: Number.parseInt(process.env.OLLAMA_TIMEOUT_MS ?? "300000", 10),
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
  private tokenUsage = { prompt: 0, completion: 0, total: 0 };
  private usageByModel = new Map<string, { prompt: number; completion: number }>();
  private costCapDowngrade = false;

  constructor() {
    this.provider = resolveProvider();
    this.client = this.provider ? createClient(this.provider) : null;
    this.models = this.provider ? DEFAULT_MODELS[this.provider] : DEFAULT_MODELS.groq;
  }

  get isAvailable(): boolean {
    return this.client !== null;
  }

  /** OpenRouter and OpenAI reliably support response_format: json_schema across the models this
   *  project targets; other providers (Groq/Mistral/Ollama) fall back to the looser json_object
   *  mode even when a responseSchema is requested. */
  get supportsJsonSchema(): boolean {
    return this.provider === "openrouter" || this.provider === "openai";
  }

  get supportsVision(): boolean {
    if (!this.provider) return false;
    const visionModel =
      process.env.LLM_VISION_MODEL ??
      process.env.MISTRAL_VISION_MODEL ??
      process.env.GROQ_VISION_MODEL ??
      process.env.OPENAI_VISION_MODEL ??
      this.models.vision;
    return visionModel !== null;
  }

  getChatModel(): string {
    const raw =
      this.provider === "ollama"
        ? (process.env.LLM_MODEL ?? process.env.OLLAMA_MODEL ?? this.models.chat)
        : this.provider === "openrouter"
          ? (process.env.LLM_MODEL ?? process.env.OPENROUTER_MODEL ?? openRouterDefaults().chat)
          : this.provider === "mistral"
            ? (process.env.LLM_MODEL ?? process.env.MISTRAL_MODEL ?? this.models.chat)
            : this.provider === "groq"
              ? (process.env.LLM_MODEL ?? process.env.GROQ_MODEL ?? this.models.chat)
              : (process.env.LLM_MODEL ?? process.env.OPENAI_MODEL ?? this.models.chat);
    return resolveModel(this.provider, raw);
  }

  getCompositionModel(): string {
    const raw =
      this.provider === "ollama"
        ? (process.env.LLM_COMPOSITION_MODEL ??
          process.env.OLLAMA_COMPOSITION_MODEL ??
          process.env.OLLAMA_MODEL ??
          this.models.composition)
        : this.provider === "openrouter"
        ? (process.env.LLM_COMPOSITION_MODEL ??
          process.env.OPENROUTER_COMPOSITION_MODEL ??
          openRouterDefaults().composition)
        : this.provider === "mistral"
          ? (process.env.LLM_COMPOSITION_MODEL ??
            process.env.MISTRAL_COMPOSITION_MODEL ??
            this.models.composition)
          : this.provider === "groq"
            ? (process.env.LLM_COMPOSITION_MODEL ??
              process.env.GROQ_COMPOSITION_MODEL ??
              this.models.composition)
            : (process.env.LLM_COMPOSITION_MODEL ??
              process.env.OPENAI_COMPOSITION_MODEL ??
              this.models.composition);
    return resolveModel(this.provider, raw);
  }

  getVisionModel(): string | null {
    if (this.provider === "ollama") {
      return process.env.OLLAMA_VISION_MODEL ?? process.env.LLM_VISION_MODEL ?? null;
    }
    return (
      process.env.LLM_VISION_MODEL ??
      (this.provider === "openrouter" ? process.env.OPENROUTER_VISION_MODEL : undefined) ??
      (this.provider === "mistral" ? process.env.MISTRAL_VISION_MODEL : undefined) ??
      process.env.GROQ_VISION_MODEL ??
      process.env.OPENAI_VISION_MODEL ??
      this.models.vision
    );
  }

  getSectionModel(): string {
    const explicit =
      process.env.LLM_SECTION_MODEL ??
      (this.provider === "ollama"
        ? process.env.OLLAMA_SECTION_MODEL
        : this.provider === "openrouter"
          ? process.env.OPENROUTER_SECTION_MODEL
          : this.provider === "groq"
            ? process.env.GROQ_SECTION_MODEL
            : this.provider === "mistral"
              ? process.env.MISTRAL_SECTION_MODEL
              : process.env.OPENAI_SECTION_MODEL);
    if (explicit) {
      return resolveModel(this.provider, explicit);
    }
    if (this.provider === "openrouter") {
      return openRouterDefaults().section;
    }
    const openai =
      process.env.OPENAI_SECTION_MODEL ??
      (process.env.OPENAI_API_KEY ? process.env.OPENAI_MODEL ?? "gpt-4o-mini" : undefined);
    if (openai && (process.env.LLM_PROVIDER === "openai" || process.env.OPENAI_API_KEY)) {
      return openai;
    }
    if (this.provider === "groq") {
      return resolveModel(this.provider, DEFAULT_GROQ_FALLBACK_MODEL);
    }
    return resolveModel(this.provider, this.getCompositionModel());
  }

  getFixModel(): string {
    const openaiFix =
      process.env.LLM_FIX_MODEL ??
      process.env.OPENAI_FIX_MODEL ??
      (process.env.OPENAI_API_KEY ? process.env.OPENAI_MODEL ?? "gpt-4o-mini" : undefined);
    if (openaiFix) return openaiFix;
    return resolveModel(this.provider, this.getCompositionModel());
  }

  getArchitectModel(): string {
    const explicit =
      process.env.LLM_ARCHITECT_MODEL ??
      (this.provider === "openrouter" ? process.env.OPENROUTER_ARCHITECT_MODEL : undefined);
    if (explicit) return resolveModel(this.provider, explicit);
    if (this.provider === "openrouter") {
      return openRouterDefaults().architect;
    }
    return resolveModel(this.provider, this.getCompositionModel());
  }

  getHeroCodegenModel(): string {
    const explicit =
      process.env.LLM_HERO_CODEGEN_MODEL ??
      (this.provider === "openrouter" ? process.env.OPENROUTER_HERO_CODEGEN_MODEL : undefined);
    if (explicit) return resolveModel(this.provider, explicit);
    if (this.provider === "openrouter") {
      return openRouterDefaults().heroCodegen;
    }
    return resolveModel(this.provider, this.getCompositionModel());
  }

  /** Per-section bespoke TSX codegen runs 10-20x per site — a constrained "compose documented
   *  primitives" task that does NOT need the architect/hero-codegen reasoning model. On the
   *  premium/balanced tiers heroCodegen is GLM-4.6 (~60-150s/call), which dominates runtime when
   *  called per section. Default to the fast section model (Gemini Flash on OpenRouter, ~3-8s);
   *  set LLM_BESPOKE_CODEGEN_MODEL / OPENROUTER_BESPOKE_CODEGEN_MODEL to override (e.g. back to
   *  GLM-4.6 for maximum fidelity at the cost of speed). */
  getBespokeCodegenModel(): string {
    const explicit =
      process.env.LLM_BESPOKE_CODEGEN_MODEL ??
      (this.provider === "openrouter" ? process.env.OPENROUTER_BESPOKE_CODEGEN_MODEL : undefined);
    if (explicit) return resolveModel(this.provider, explicit);
    return this.getSectionModel();
  }

  getPageCodegenModel(): string {
    const explicit =
      process.env.LLM_PAGE_CODEGEN_MODEL ??
      (this.provider === "openrouter" ? process.env.OPENROUTER_PAGE_CODEGEN_MODEL : undefined);
    if (explicit) return resolveModel(this.provider, explicit);
    if (this.provider === "openrouter") {
      return openRouterDefaults().page;
    }
    return resolveModel(this.provider, this.getCompositionModel());
  }

  getTokenUsage(): { prompt: number; completion: number; total: number } {
    return { ...this.tokenUsage };
  }

  resetTokenUsage(): void {
    this.tokenUsage = { prompt: 0, completion: 0, total: 0 };
    this.usageByModel.clear();
    this.costCapDowngrade = false;
  }

  getEstimatedCostUsd(): number {
    return estimateCostUsd(this.usageByModel);
  }

  getCostCapUsd(): number | null {
    return pipelineCostCapUsd();
  }

  private recordUsage(
    model: string,
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  ): void {
    if (!usage) return;
    const prompt = usage.prompt_tokens ?? 0;
    const completion = usage.completion_tokens ?? 0;
    this.tokenUsage.prompt += prompt;
    this.tokenUsage.completion += completion;
    this.tokenUsage.total += usage.total_tokens ?? prompt + completion;
    const prev = this.usageByModel.get(model) ?? { prompt: 0, completion: 0 };
    this.usageByModel.set(model, {
      prompt: prev.prompt + prompt,
      completion: prev.completion + completion,
    });
    if (!this.costCapDowngrade && isOverCostCap(this.getEstimatedCostUsd())) {
      this.costCapDowngrade = true;
      console.warn(
        `[llm] Cost cap $${pipelineCostCapUsd()} reached — downgrading remaining calls to ${OPENROUTER_COST_DOWNGRADE_MODEL}`
      );
    }
  }

  private resolveModelForRequest(requested: string): string {
    if (this.costCapDowngrade && this.provider === "openrouter") {
      return OPENROUTER_COST_DOWNGRADE_MODEL;
    }
    return resolveModel(this.provider, requested);
  }

  async chat(
    system: string,
    user: string,
    options: LLMOptions = {}
  ): Promise<string> {
    if (!this.client) {
      throw new Error(
        "No LLM configured — set LLM_PROVIDER=ollama, OPENROUTER_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY, or OPENAI_API_KEY"
      );
    }

    const queue = options.queue === "codegen" ? bespokeCodegenQueue : llmQueue;
    return queue.run(() => this.chatWithRetry(system, user, options));
  }

  private async chatWithRetry(
    system: string,
    user: string,
    options: LLMOptions,
    attempt = 0,
    modelOverride?: string,
    schemaFallback = false
  ): Promise<string> {
    const MAX_RETRIES = llmMaxRetries();

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    const model = this.resolveModelForRequest(
      modelOverride ?? options.model ?? this.getChatModel()
    );

    const maxTokens = resolveRequestMaxTokens(options, this.provider);
    const useJsonSchema = Boolean(options.responseSchema) && this.supportsJsonSchema && !schemaFallback;

    try {
      const response = await this.client!.chat.completions.create({
        model,
        temperature: options.temperature ?? 0.7,
        max_tokens: maxTokens,
        messages,
        response_format: useJsonSchema
          ? {
              type: "json_schema",
              json_schema: {
                name: options.responseSchema!.name,
                schema: options.responseSchema!.schema,
                strict: options.responseSchema!.strict ?? true,
              },
            }
          : options.jsonMode || options.responseSchema
            ? { type: "json_object" }
            : undefined,
      });

      this.recordUsage(model, response.usage);
      const content = response.choices[0]?.message?.content ?? "";
      if (!content.trim()) {
        if (attempt < MAX_RETRIES) {
          const waitMs = 800 * (attempt + 1);
          console.warn(
            `[llm] Empty response (${this.provider}, ${model}) — retrying in ${(waitMs / 1000).toFixed(1)}s (${attempt + 1}/${MAX_RETRIES})`
          );
          await sleep(waitMs);
          return this.chatWithRetry(system, user, options, attempt + 1, modelOverride, schemaFallback);
        }
        throw new Error("Empty response from LLM");
      }
      return options.jsonMode || options.responseSchema ? normalizeLlmJsonContent(content) : content;
    } catch (err: unknown) {
      if (useJsonSchema && isUnsupportedResponseFormatError(err)) {
        console.warn(
          `[llm] Provider rejected json_schema response_format (${this.provider}, ${model}) — retrying with json_object`
        );
        return this.chatWithRetry(system, user, options, attempt, modelOverride, true);
      }
      const affordable = parseAffordableMaxTokens(err);
      if (isOpenRouterMaxTokensCapError(err) && affordable && attempt < MAX_RETRIES) {
        const reduced = Math.min(maxTokens, Math.max(256, affordable - 64));
        if (reduced < maxTokens) {
          console.warn(
            `[llm] OpenRouter max_tokens cap — retrying with ${reduced} (was ${maxTokens})`
          );
          return this.chatWithRetry(
            system,
            user,
            { ...options, maxTokens: reduced },
            attempt + 1,
            modelOverride,
            schemaFallback
          );
        }
      }
      if (isNonRetryableLLMError(err)) {
        throw enhanceGroqModelError(err, model);
      }
      if (isTransientLLMError(err) && attempt < MAX_RETRIES) {
        if (
          this.provider === "groq" &&
          isOverCapacityError(err) &&
          !modelOverride
        ) {
          const fallback = groqFallbackModel(model);
          if (fallback) {
            console.warn(
              `[llm] Groq model "${model}" over capacity — trying fallback "${fallback}"`
            );
            return this.chatWithRetry(system, user, options, attempt, fallback, schemaFallback);
          }
        }

        const waitMs = parseRetryAfterMs(err, attempt);
        const reason = isOverCapacityError(err)
          ? "Over capacity"
          : isConnectionError(err)
            ? "Connection error"
            : "Rate limit";
        console.warn(
          `[llm] ${reason} (${this.provider}, ${model}) — waiting ${(waitMs / 1000).toFixed(1)}s (retry ${attempt + 1}/${MAX_RETRIES})`
        );
        await sleep(waitMs);
        return this.chatWithRetry(system, user, options, attempt + 1, modelOverride, schemaFallback);
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

    return llmQueue.run(() =>
      this.chatWithVisionRetry(system, userText, imageBase64, options)
    );
  }

  private async chatWithVisionRetry(
    system: string,
    userText: string,
    imageBase64: string,
    options: LLMOptions = {},
    attempt = 0
  ): Promise<string> {
    const MAX_RETRIES = llmMaxRetries();
    const visionModel = this.resolveModelForRequest(options.model ?? this.getVisionModel()!);
    if (!visionModel) {
      throw new Error(
        `Vision QA is not supported on provider "${this.provider}" — use OpenAI or set GROQ_VISION_MODEL if available`
      );
    }

    try {
      const response = await this.client!.chat.completions.create({
        model: visionModel,
        temperature: options.temperature ?? 0.3,
        max_tokens: resolveRequestMaxTokens({ ...options, tokenRole: "vision" }, this.provider),
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

      this.recordUsage(visionModel, response.usage);
      return normalizeLlmJsonContent(response.choices[0]?.message?.content ?? "");
    } catch (err: unknown) {
      if (isNonRetryableLLMError(err)) {
        throw enhanceGroqModelError(err, visionModel);
      }
      if (isTransientLLMError(err) && attempt < MAX_RETRIES) {
        const waitMs = parseRetryAfterMs(err, attempt);
        await sleep(waitMs);
        return this.chatWithVisionRetry(system, userText, imageBase64, options, attempt + 1);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async chatWithVisionDual(
    system: string,
    userText: string,
    desktopBase64: string,
    mobileBase64: string,
    options: LLMOptions = {}
  ): Promise<string> {
    if (!this.client) {
      throw new Error("No LLM configured — vision QA requires an API key");
    }

    return llmQueue.run(() =>
      this.chatWithVisionDualRetry(system, userText, desktopBase64, mobileBase64, options)
    );
  }

  private async chatWithVisionDualRetry(
    system: string,
    userText: string,
    desktopBase64: string,
    mobileBase64: string,
    options: LLMOptions = {},
    attempt = 0
  ): Promise<string> {
    const MAX_RETRIES = llmMaxRetries();
    const visionModel = this.resolveModelForRequest(options.model ?? this.getVisionModel()!);
    if (!visionModel) {
      throw new Error(`Vision QA is not supported on provider "${this.provider}"`);
    }

    try {
      const response = await this.client!.chat.completions.create({
        model: visionModel,
        temperature: options.temperature ?? 0.3,
        max_tokens: resolveRequestMaxTokens({ ...options, tokenRole: "vision" }, this.provider),
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: `${userText}\n\n[Desktop 1280px]` },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${desktopBase64}` },
              },
              { type: "text", text: "[Mobile 390px]" },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${mobileBase64}` },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });

      this.recordUsage(visionModel, response.usage);
      return normalizeLlmJsonContent(response.choices[0]?.message?.content ?? "");
    } catch (err: unknown) {
      if (isNonRetryableLLMError(err)) {
        throw enhanceGroqModelError(err, visionModel);
      }
      if (isTransientLLMError(err) && attempt < MAX_RETRIES) {
        const waitMs = parseRetryAfterMs(err, attempt);
        await sleep(waitMs);
        return this.chatWithVisionDualRetry(
          system,
          userText,
          desktopBase64,
          mobileBase64,
          options,
          attempt + 1
        );
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}

export const llm = new LLMClient();

export { resolveProvider, DEFAULT_MODELS, resolveGroqModel };

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
  if (isOverCapacityError(err)) {
    const fallback = groqFallbackModel(model);
    const hint = fallback
      ? ` Groq is overloaded — retries were exhausted. Set GROQ_MODEL=${fallback} or wait and try again. Status: https://groqstatus.com`
      : " Groq is overloaded — wait and try again. Status: https://groqstatus.com";
    const message = extractErrorMessage(err);
    return new Error(`${message}.${hint}`, { cause: err });
  }
  return err instanceof Error ? err : new Error(String(err));
}

function isUnsupportedResponseFormatError(err: unknown): boolean {
  const message = extractErrorMessage(err).toLowerCase();
  return message.includes("response_format") || message.includes("json_schema");
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String(err.message);
  }
  return String(err);
}
