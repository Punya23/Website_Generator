/**
 * CLI wrapper around `fillRealEstateTemplate` (`src/templates/placements/fill-real-estate-template.ts`
 * — that module has the real logic and doc comment; this file only handles argv, console output,
 * and writing `<page>.generated.html` files for manual inspection. The same fill function backs
 * the real generation path — see `src/orchestrator/placements-pipeline.ts`.
 *
 *   npx tsx scripts/generate-real-site.ts [templateId] ["<raw business brief>"]
 *
 * `templateId` is one of the four folders under `real-estate/` (default: real-estate-agency). The
 * brief is free text, same shape this project's own `expandBrief` already accepts elsewhere in the
 * pipeline — a line or two is enough ("Golden Gate Realty, a family-run agency in San Francisco
 * specializing in first-time buyers..."). Omit it to run the built-in demo business.
 *
 * Dev/QA tool, not itself part of the shipped pipeline.
 */
import "../src/load-env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { llm } from "../src/llm/client.js";
import { fillRealEstateTemplate } from "../src/templates/placements/fill-real-estate-template.js";

const templateId = process.argv[2] ?? "real-estate-agency";
const templateDir = path.resolve(process.cwd(), "real-estate", templateId);
const rawBrief = process.argv[3]?.trim();

const DEMO_BRIEF = `Bay Breeze Realty is a boutique residential brokerage covering Alameda, Oakland, and the East Bay
waterfront communities. Founded by two former teachers who got tired of watching first-time buyers
get outbid and confused, the team focuses on patient, plain-English guidance rather than
high-pressure sales. Known locally for weekend "open house crawl" tours and a free first-time-buyer
class held monthly at the Alameda library. Tone: warm, direct, a little informal — never corporate.
Phone (510) 555-0199, hello@baybreezerealty.com, 220 Harbor View Blvd, Alameda, CA.`;

async function main(): Promise<void> {
  if (!llm.isAvailable) {
    throw new Error("No LLM configured — set OPENROUTER_API_KEY (or another provider key) in .env");
  }
  console.log(`[real-fill] provider=${llm.provider} model=${llm.getCompositionModel()}`);

  const effectiveRawBrief = rawBrief && rawBrief.length > 0 ? rawBrief : DEMO_BRIEF;
  const result = await fillRealEstateTemplate(templateDir, effectiveRawBrief, {
    onProgress: (line) => console.log(`[real-fill] ${line}`),
  });
  console.log(
    `\n[real-fill] ${result.llmFieldCount} copy + ${result.exampleFieldCount} example values — writing pages...\n`
  );

  for (const [pageFile, filled] of Object.entries(result.pages)) {
    const outFile = pageFile.replace(/\.html$/, ".generated.html");
    await fs.writeFile(path.join(templateDir, outFile), filled.html, "utf8");
    console.log(
      `[real-fill] ${pageFile.padEnd(22)} text=${filled.appliedText} images=${filled.appliedImages} ` +
        `clamped=${filled.clamped.length} -> ${outFile}`
    );
    for (const note of filled.clamped) console.log(`               - ${note.id}: ${note.reason}`);
  }

  console.log(`\n[real-fill] cost estimate: $${result.costUsd.toFixed(4)}`);
  console.log(`\nOpen real-estate/${templateId}/index.generated.html in a browser.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
