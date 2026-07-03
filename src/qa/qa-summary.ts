import type { QAResult } from "../types.js";

export interface QaSummary {
  passed: boolean;
  hardCount: number;
  softCount: number;
  failedChecks: string[];
}

const META_KEYS = new Set([
  "__design__",
  "__motion__",
  "__chrome__",
  "__layout__",
  "__blueprint__",
]);

/** Vision QA results are keyed per page: __vision_<slug>__ / __vision_retry_<slug>__. */
const VISION_KEY_PATTERN = /^__vision(_retry)?_[\w-]+__$/;

export function summarizeQaResults(qaResults: Record<string, QAResult>): QaSummary {
  const failedChecks: string[] = [];
  let hardCount = 0;
  let softCount = 0;

  for (const [key, qa] of Object.entries(qaResults)) {
    if (!qa) continue;
    const hard = qa.issues.filter((i) => i.severity === "hard");
    const soft = qa.issues.filter((i) => i.severity === "soft");
    hardCount += hard.length;
    softCount += soft.length;
    if (!qa.passed || hard.length > 0) {
      failedChecks.push(key);
    }
  }

  return {
    passed: hardCount === 0 && failedChecks.length === 0,
    hardCount,
    softCount,
    failedChecks,
  };
}

export function hasHardQaFailures(qaResults: Record<string, QAResult>): boolean {
  return summarizeQaResults(qaResults).hardCount > 0;
}

export function isPipelineQaKey(key: string): boolean {
  return META_KEYS.has(key) || VISION_KEY_PATTERN.test(key) || !key.startsWith("__");
}
