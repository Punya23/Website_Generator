import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      ALLOW_MOCKS: "1",
      OUTPUT_MODE: "html",
      // isQualityPipeline() now defaults to true (see src/llm/pipeline-speed.ts). Pin it off here so
      // the 60+ test files that don't touch PIPELINE_QUALITY keep their existing mock-fallback behavior;
      // tests/pipeline-quality.test.ts explicitly sets PIPELINE_QUALITY=1 within its own cases to test
      // the opposite behavior, which still works since that assignment overrides this default per-test.
      PIPELINE_QUALITY: "0",
    },
  },
});
