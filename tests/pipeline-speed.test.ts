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
});
