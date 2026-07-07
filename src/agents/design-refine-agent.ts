import type { SiteTheme } from "../types.js";
import { SiteThemeSchema } from "../types.js";
import { llm } from "../llm/client.js";
import { ensureReadableTheme, runDesignTokenQA } from "../theme/contrast.js";
import {
  enforceProfileCoherence,
  type ProfileCoherenceInput,
} from "../theme/profile-coherence.js";
import { allowMocks, requireLlm, handleLlmFailure } from "../util/llm-required.js";
import { parseLlmJson } from "../llm/parse-json.js";
import { recordFallback } from "../util/fallback-tracker.js";
import { pipelineLog } from "../util/pipeline-log.js";

const REFINE_PROMPT = `You are a senior UI contrast reviewer for premium marketing sites.

You receive a draft design system and a locked vertical profile. Fix illegible navigation and contrast only.
FORBIDDEN: Do not change profileId semantics — luxury-dark stays dark bg; clinical/corporate stay light bg.
Preserve brand mood, fonts, and vertical — only adjust colors and semantic tokens when contrast fails.

Rules:
- Fix illegible navigation and body contrast only — do not impose glass, grain, or template chrome
- Preserve the LLM-chosen navTreatment unless contrast truly fails
- navText/navMuted must contrast against effective nav
- gradientFrom/gradientTo must work with white text on CTA bands
- Do not flip a dark luxury palette to light or a clinical palette to charcoal

Output the full corrected SiteTheme JSON only — same schema as input.`;

function mockRefine(theme: SiteTheme): SiteTheme {
  return theme;
}

export async function refineDesignSystem(
  businessName: string,
  businessBrief: string,
  draft: SiteTheme,
  verticalProfile?: ProfileCoherenceInput
): Promise<SiteTheme> {
  let theme = ensureReadableTheme(draft);
  if (verticalProfile) {
    theme = enforceProfileCoherence(theme, verticalProfile, businessName);
  }

  let qa = runDesignTokenQA(theme);

  if (llm.isAvailable) {
    try {
      const profileBlock = verticalProfile
        ? `\nLocked vertical profile: ${verticalProfile.profileId} (pageTone: ${verticalProfile.pageTone}, nav: ${verticalProfile.navTreatment})`
        : "";
      const raw = await llm.chat(
        REFINE_PROMPT,
        `Business: ${businessName}\nBrief: ${businessBrief}${profileBlock}\n\nDraft theme:\n${JSON.stringify(theme, null, 2)}\n\nQA issues:\n${qa.issues.map((i) => i.message).join("; ") || "none"}`,
        { jsonMode: true, temperature: 0.35, tokenRole: "refine" }
      );
      theme = ensureReadableTheme(SiteThemeSchema.parse(parseLlmJson(raw)));
      if (verticalProfile) {
        theme = enforceProfileCoherence(theme, verticalProfile, businessName);
      }
      qa = runDesignTokenQA(theme);
      pipelineLog(`[pipeline] Design refine: ${qa.passed ? "pass" : qa.issues.length + " issues"}`);
    } catch (err) {
      if (!allowMocks()) handleLlmFailure("design refinement", err);
      recordFallback("design_refine");
      theme = mockRefine(theme);
      if (verticalProfile) {
        theme = enforceProfileCoherence(theme, verticalProfile, businessName);
      }
    }
  } else {
    if (!allowMocks()) requireLlm("design refinement");
    theme = mockRefine(theme);
    if (verticalProfile) {
      theme = enforceProfileCoherence(theme, verticalProfile, businessName);
    }
  }

  return ensureReadableTheme(theme);
}
