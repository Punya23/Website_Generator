import type { QAIssue, SiteTheme, VisionPolishResult } from "../types.js";
import type { BlockManifestEntry } from "../qa/code-qa.js";
import { llm } from "../llm/client.js";

const VISION_SYSTEM = `Visual QA reviewer. You receive desktop (1280px) and mobile (390px) screenshots plus a block manifest (id, type, bounds, sectionId).
Flag only real layout problems: misaligned columns, stretched empty cards, cramped gaps, unreadable nav, repeated hero imagery, headline beside full image in same row, mobile overflow.

Use these structured codes when applicable:
- VISUAL_NAV_CONTRAST — unreadable nav links, white-on-white glass, poor nav contrast
- VISUAL_MOTION_MONOTONY — identical static sections, no scroll rhythm, lifeless page
- VISUAL_COPY_WEAK — weak headlines, placeholder copy, illegible text in sections
- VISUAL_SPACING — cramped gaps, overflow, misalignment (set sectionId when known)
- VISUAL_CHROME — footer/nav chrome issues, missing CTA, broken link grouping

Output JSON: { "issues": [{ "severity": "hard"|"soft", "code": "VISUAL_*", "message": "...", "targetId": "...", "sectionId": "...", "suggestion": "..." }], "summary": "one line" }
Empty issues if page looks good. Always set sectionId when you can identify the section.`;

export async function runVisionQa(
  desktopScreenshot: string,
  pageSlug: string,
  manifest: BlockManifestEntry[],
  designSystem: SiteTheme,
  mobileScreenshot?: string
): Promise<VisionPolishResult> {
  if (!llm.isAvailable || !llm.supportsVision) {
    return { status: "skipped", issues: [], appliedFixes: [] };
  }

  try {
    const userText = `Page: ${pageSlug}
Viewport: desktop 1280px${mobileScreenshot ? " + mobile 390px (second image)" : ""}
Mood: ${designSystem.mood}
Motion: ${designSystem.motionPreset ?? designSystem.motionStyle ?? "default"}
Manifest: ${JSON.stringify(manifest.slice(0, 50))}`;

    const raw = mobileScreenshot
      ? await llm.chatWithVisionDual(
          VISION_SYSTEM,
          userText,
          desktopScreenshot,
          mobileScreenshot,
          { temperature: 0.2, model: llm.getVisionModel() ?? undefined }
        )
      : await llm.chatWithVision(
          VISION_SYSTEM,
          userText,
          desktopScreenshot,
          { temperature: 0.2, model: llm.getVisionModel() ?? undefined }
        );

    const parsed = JSON.parse(raw) as { issues?: QAIssue[]; summary?: string };
    const issues = (parsed.issues ?? []).map((issue) => ({
      ...issue,
      sectionId:
        issue.sectionId ??
        manifest.find((m) => m.id === issue.targetId)?.sectionId,
    }));

    return {
      status: "complete",
      issues,
      appliedFixes: parsed.summary ? [parsed.summary] : [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "complete",
      issues: [
        {
          severity: "hard",
          code: "VISION_QA_ERROR",
          message: `Vision QA failed: ${message}`,
        },
      ],
      appliedFixes: [],
    };
  }
}

/** @deprecated background scheduling replaced by inline vision in orchestrator */
export async function runVisionPolish(
  screenshotBase64: string,
  pageSlug: string
): Promise<VisionPolishResult> {
  return runVisionQa(screenshotBase64, pageSlug, [], {
    vertical: "default",
    mood: "default",
    fontHeading: "Inter",
    fontBody: "Inter",
    colors: {
      bg: "#fff",
      surface: "#fff",
      text: "#000",
      muted: "#666",
      accent: "#000",
      accentSoft: "#eee",
      gradientFrom: "#000",
      gradientTo: "#333",
      navBg: "#fff",
    },
  });
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
          appliedFixes: [`Vision failed: ${err instanceof Error ? err.message : String(err)}`],
        },
      });
    }
  });
}
