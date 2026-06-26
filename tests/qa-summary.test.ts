import { describe, it, expect } from "vitest";
import { summarizeQaResults, hasHardQaFailures } from "../src/qa/qa-summary.js";
import type { QAResult } from "../src/types.js";

describe("qa-summary", () => {
  it("summarizes hard failures across pipeline QA keys", () => {
    const qaResults: Record<string, QAResult> = {
      home: { passed: true, issues: [] },
      __blueprint__: {
        passed: false,
        issues: [{ severity: "hard", code: "HOME_MISSING_HERO", message: "no hero" }],
      },
    };

    const summary = summarizeQaResults(qaResults);
    expect(summary.passed).toBe(false);
    expect(summary.hardCount).toBe(1);
    expect(summary.failedChecks).toContain("__blueprint__");
    expect(hasHardQaFailures(qaResults)).toBe(true);
  });
});
