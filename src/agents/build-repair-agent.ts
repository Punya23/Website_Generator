/** Repairs a bespoke section's TSX using the REAL compiler/build error from `next build`,
 *  looping the LLM (not a multi-step agent) with the error text fed back until it resolves or the
 *  bounded attempt budget runs out. This runs before react-pipeline.ts's mechanical fallback
 *  (drop the section back to its fixed template), so a build failure gets a real fix attempt
 *  instead of an automatic quality downgrade. */
import type { ReactPage, SectionInstance } from "../types.js";
import { llm } from "../llm/client.js";
import { pipelineLog } from "../util/pipeline-log.js";
import { recordFallback } from "../util/fallback-tracker.js";
import {
  sanitizeBespokeSource,
  validateBespokeSource,
  checkBespokeSyntax,
  inferPropsType,
} from "./section-codegen-agent.js";

const BUILD_REPAIR_PROMPT = `You are fixing a React/TypeScript section component that failed to compile in a Next.js static export build. You will be shown its current source and the real compiler/build error. Output ONLY the corrected full TSX source — no markdown fences, no explanation.

Rules:
- First line MUST be exactly: "use client";
- Keep the same component name, type name, and prop shape given below — do not rename or restructure them
- Import ONLY from "react", "framer-motion", and "@/components/primitives"
- Fix exactly what the build error points to; do not rewrite unrelated parts of the component
- Every prop in the type is optional — use optional chaining (props.cta?.label) or a fallback (??) for every nested access
- Keep under 140 lines`;

function buildRepairUserPrompt(
  componentName: string,
  typeName: string,
  typeBlock: string,
  source: string,
  buildError: string,
  attempt: number,
  maxAttempts: number
): string {
  return `Component name: ${componentName}
Type name: ${typeName}
Props type (keep exactly, do not add or remove fields):
${typeBlock}

Current source:
${source}

Build error — revise until this error class no longer appears (attempt ${attempt} of ${maxAttempts}):
${buildError.slice(0, 2000)}

Return the corrected TSX now.`;
}

function findSectionByFileName(
  reactPages: Record<string, ReactPage>,
  fileName: string
): SectionInstance | null {
  for (const page of Object.values(reactPages)) {
    const section = page.sections.find((s) => s.customCodegen?.fileName === fileName);
    if (section) return section;
  }
  return null;
}

/** Returns true if a repaired source was written back into the section in place. */
export async function repairBespokeSectionWithBuildError(
  reactPages: Record<string, ReactPage>,
  fileName: string,
  buildError: string,
  attempt: number,
  maxAttempts: number
): Promise<boolean> {
  if (!llm.isAvailable) return false;

  const instance = findSectionByFileName(reactPages, fileName);
  const current = instance?.customCodegen;
  if (!instance || !current) return false;

  const { componentName } = current;
  const typeName = `${componentName}Props`;
  const typeBlock = inferPropsType(instance.props, typeName);

  try {
    const raw = await llm.chat(
      BUILD_REPAIR_PROMPT,
      buildRepairUserPrompt(componentName, typeName, typeBlock, current.source, buildError, attempt, maxAttempts),
      { temperature: 0.3, tokenRole: "composition", model: llm.getBespokeCodegenModel(), queue: "codegen" }
    );
    const source = sanitizeBespokeSource(raw, typeName, typeBlock);
    const validationError = validateBespokeSource(source, typeName) ?? checkBespokeSyntax(source);
    if (validationError) {
      pipelineLog(
        `[pipeline] Build-error repair produced invalid source for ${fileName} (attempt ${attempt}/${maxAttempts}): ${validationError}`
      );
      recordFallback("build_repair");
      return false;
    }

    const renamed = source.replace(/export default function \w+/, `export default function ${componentName}`);
    instance.customCodegen = { componentName, fileName: current.fileName, source: renamed };
    pipelineLog(`[pipeline] Build-error repair applied to ${fileName} (attempt ${attempt}/${maxAttempts})`);
    return true;
  } catch (err) {
    recordFallback("build_repair");
    pipelineLog(
      `[pipeline] Build-error repair LLM call failed for ${fileName} (attempt ${attempt}/${maxAttempts}): ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}
