import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isQualityPipeline,
  isFastPipeline,
  creativeDirectorPoolOnly,
  useBespokeSectionCodegen,
  usePageCodegenPipeline,
  homeSectionBudget,
  visionQaHomeOnly,
} from "../src/llm/pipeline-speed.js";
import { openRouterDefaults, OPENROUTER_BALANCED_MODELS, OPENROUTER_PREMIUM_MODELS } from "../src/llm/openrouter-models.js";
import { estimateCostUsd, pipelineCostCapUsd } from "../src/llm/cost-telemetry.js";
import { allowMocks, strictLlmRequired } from "../src/util/llm-required.js";

describe("pipeline quality mode", () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.PIPELINE_QUALITY;
    delete process.env.PIPELINE_FAST;
    delete process.env.BESPOKE_SECTION_CODEGEN;
    delete process.env.VISION_QA_HOME_ONLY;
    delete process.env.OPENROUTER_MODEL_TIER;
    delete process.env.PIPELINE_COST_CAP_USD;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("quality mode disables fast pipeline", () => {
    process.env.PIPELINE_QUALITY = "1";
    process.env.PIPELINE_FAST = "1";
    expect(isQualityPipeline()).toBe(true);
    expect(isFastPipeline()).toBe(false);
    expect(creativeDirectorPoolOnly()).toBe(false);
    expect(useBespokeSectionCodegen()).toBe(false);
    process.env.BESPOKE_SECTION_CODEGEN = "1";
    expect(useBespokeSectionCodegen()).toBe(true);
    expect(homeSectionBudget().max).toBe(7);
  });

  it("is the zero-flag default (opt out via PIPELINE_FAST=1 or PIPELINE_QUALITY=0)", () => {
    expect(isQualityPipeline()).toBe(true);
    expect(useBespokeSectionCodegen()).toBe(false);
    expect(usePageCodegenPipeline()).toBe(true);

    process.env.PIPELINE_FAST = "1";
    expect(isQualityPipeline()).toBe(false);
    delete process.env.PIPELINE_FAST;

    process.env.PIPELINE_QUALITY = "0";
    expect(isQualityPipeline()).toBe(false);
    expect(usePageCodegenPipeline()).toBe(false);
  });

  it("vision QA checks every page by default; VISION_QA_HOME_ONLY=1 restricts to home", () => {
    expect(visionQaHomeOnly()).toBe(false);
    process.env.VISION_QA_HOME_ONLY = "1";
    expect(visionQaHomeOnly()).toBe(true);
  });

  it("balanced tier uses GLM architect and Gemini section", () => {
    process.env.OPENROUTER_MODEL_TIER = "balanced";
    const models = openRouterDefaults();
    expect(models).toEqual(OPENROUTER_BALANCED_MODELS);
    expect(models.architect).toBe("z-ai/glm-4.6");
    expect(models.section).toBe("google/gemini-2.5-flash");
  });

  it("premium tier uses GLM architect and Gemini Flash section copy", () => {
    process.env.OPENROUTER_MODEL_TIER = "premium";
    const models = openRouterDefaults();
    expect(models).toEqual(OPENROUTER_PREMIUM_MODELS);
    expect(models.architect).toBe("z-ai/glm-4.6");
    expect(models.section).toBe("google/gemini-2.5-flash");
  });

  it("strict mode disallows mocks", () => {
    process.env.PIPELINE_QUALITY = "1";
    expect(allowMocks()).toBe(false);
    expect(strictLlmRequired()).toBe(true);
  });

  it("estimates blended cost from per-model usage", () => {
    const usage = new Map([
      ["z-ai/glm-4.6", { prompt: 10_000, completion: 4_000 }],
      ["google/gemini-2.5-flash", { prompt: 30_000, completion: 8_000 }],
    ]);
    const cost = estimateCostUsd(usage);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0.5);
  });

  it("parses cost cap from env", () => {
    process.env.PIPELINE_COST_CAP_USD = "0.40";
    expect(pipelineCostCapUsd()).toBe(0.4);
  });
});
