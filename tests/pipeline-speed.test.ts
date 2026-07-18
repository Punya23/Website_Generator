import { afterEach, describe, expect, it } from "vitest";
import {
  creativeDirectorPoolOnly,
  isFastPipeline,
  sectionFillConcurrency,
  skipDirectorRetries,
  useUnifiedSectionLlm,
} from "../src/llm/pipeline-speed.js";

const env = { ...process.env };

afterEach(() => {
  process.env = { ...env };
});

describe("pipeline-speed", () => {
  it("enables fast defaults when PIPELINE_FAST=1", () => {
    process.env.PIPELINE_FAST = "1";
    expect(isFastPipeline()).toBe(true);
    expect(useUnifiedSectionLlm()).toBe(true);
    expect(sectionFillConcurrency()).toBe(6);
    expect(skipDirectorRetries()).toBe(true);
    expect(creativeDirectorPoolOnly()).toBe(true);
  });

  it("respects SECTION_FILL_CONCURRENCY override", () => {
    process.env.SECTION_FILL_CONCURRENCY = "8";
    expect(sectionFillConcurrency()).toBe(8);
  });

  it("quality mode overrides fast pipeline", () => {
    process.env.PIPELINE_QUALITY = "1";
    process.env.PIPELINE_FAST = "1";
    expect(isFastPipeline()).toBe(false);
    expect(creativeDirectorPoolOnly()).toBe(false);
    expect(skipDirectorRetries()).toBe(false);
  });

  it("page codegen is always on (legacy architect path removed)", async () => {
    const { usePageCodegenPipeline } = await import("../src/llm/pipeline-speed.js");
    delete process.env.PIPELINE_PAGE_CODEGEN;
    delete process.env.PIPELINE_FAST;
    delete process.env.PIPELINE_QUALITY;
    expect(usePageCodegenPipeline()).toBe(true);
    process.env.PIPELINE_PAGE_CODEGEN = "0";
    expect(usePageCodegenPipeline()).toBe(true);
    process.env.PIPELINE_PAGE_CODEGEN = "1";
    expect(usePageCodegenPipeline()).toBe(true);
  });
});
