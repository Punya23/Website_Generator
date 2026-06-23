import type { QAIssue, VisionPolishResult } from "../types.js";
import { llm } from "../llm/client.js";

const VISION_SYSTEM = `You are a visual QA agent for generated websites. Analyze the screenshot.

Check for:
- Cramped or unbalanced sections
- Excessive whitespace
- Poor visual hierarchy
- Text that looks cut off or too dense

Output valid JSON:
{
  "issues": [
    { "severity": "soft", "code": "VISUAL_CRAMPED", "message": "...", "targetId": "block-id-if-known", "suggestion": "..." }
  ],
  "overallScore": 1-10,
  "summary": "one sentence"
}

Only flag genuine visual problems. Empty issues array if the page looks good.`;

export async function runVisionPolish(
  screenshotBase64: string,
  pageSlug: string
): Promise<VisionPolishResult> {
  if (!llm.isAvailable) {
    return {
      status: "skipped",
      issues: [],
      appliedFixes: ["Vision QA skipped — no LLM API key configured"],
    };
  }

  if (!llm.supportsVision) {
    return {
      status: "skipped",
      issues: [],
      appliedFixes: [
        `Vision QA skipped — ${llm.provider ?? "current"} provider has no vision model (Groq/Llama 3.3 70B is text-only)`,
      ],
    };
  }

  try {
    const raw = await llm.chatWithVision(
      VISION_SYSTEM,
      `Review the rendered page: ${pageSlug}.html`,
      screenshotBase64,
      { temperature: 0.2 }
    );

    const parsed = JSON.parse(raw) as {
      issues?: QAIssue[];
      summary?: string;
    };

    return {
      status: "complete",
      issues: parsed.issues ?? [],
      appliedFixes: parsed.summary ? [parsed.summary] : [],
    };
  } catch (err) {
    return {
      status: "complete",
      issues: [],
      appliedFixes: [`Vision QA error: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

export function scheduleVisionPolish(
  screenshotFn: () => Promise<{ slug: string; base64: string }[]>,
  onComplete: (results: Record<string, VisionPolishResult>) => void
): void {
  setImmediate(async () => {
    try {
      const shots = await screenshotFn();
      const results: Record<string, VisionPolishResult> = {};
      for (const { slug, base64 } of shots) {
        results[slug] = await runVisionPolish(base64, slug);
      }
      onComplete(results);
    } catch (err) {
      onComplete({
        _error: {
          status: "complete",
          issues: [],
          appliedFixes: [`Background vision polish failed: ${err instanceof Error ? err.message : String(err)}`],
        },
      });
    }
  });
}
