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
 *   DEMO_LISTINGS=1 npx tsx scripts/generate-real-site.ts ...
 *
 * Opt-in only (Phase 3, docs/PLACEMENTS_ORCHESTRATION_PLAN.md) — fills every property-card/detail
 * listing field from `fixtures/demo-listings.json` instead of an LLM-invented illustrative example.
 * Off by default: a real business generation should get a locale/brief-consistent LLM example, not a
 * canned fixture unrelated to its actual city or specialty — this is for a demo that wants the SAME
 * presentable listings every run, or a script that wants to sanity-check `resolveData` wiring without
 * spending an LLM call on the example fields it would otherwise need. Also runs `checkBrandLeak` on
 * every generated page and prints anything found — should always be empty; a hit means
 * `swapTemplateBrandName` missed a spot.
 *
 * Dev/QA tool, not itself part of the shipped pipeline.
 */
import "../src/load-env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { llm } from "../src/llm/client.js";
import { fillRealEstateTemplate, resolveLocale } from "../src/templates/placements/fill-real-estate-template.js";
import { demoListingsResolver } from "../src/templates/placements/demo-data.js";
import { checkBrandLeak } from "../src/templates/placements/brand-leak.js";

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
  const useDemoListings = process.env.DEMO_LISTINGS === "1";
  const result = await fillRealEstateTemplate(templateDir, effectiveRawBrief, {
    onProgress: (line) => console.log(`[real-fill] ${line}`),
    resolveData: useDemoListings ? demoListingsResolver(resolveLocale(effectiveRawBrief)) : undefined,
  });
  if (useDemoListings) console.log(`[real-fill] DEMO_LISTINGS=1 — listing fields from fixtures/demo-listings.json`);
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

    const leaks = checkBrandLeak(filled.html, result.brief.businessName ?? "");
    for (const leak of leaks) console.log(`               ! brand leak: "${leak.brand}" appears ${leak.count}x`);
  }

  console.log(`\n[real-fill] cost estimate: $${result.costUsd.toFixed(4)}`);
  console.log(`\nOpen real-estate/${templateId}/index.generated.html in a browser.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
