import { generateSite, summarizeGeneration, waitForVisionPolish } from "./orchestrator/orchestrator.js";
import { writeSiteOutput, startPreviewServer } from "./server/preview-server.js";
import { detectVertical } from "./agents/theme-agent.js";
import path from "path";

function extractBusinessName(brief: string): string {
  const quoted = brief.match(/(?:called|named)\s+["']([^"']+)["']/i);
  if (quoted?.[1]) return quoted[1];

  const beforeDash = brief.match(/^([A-Za-z0-9][A-Za-z0-9\s.'&]{1,40}?)\s*[-—:]/);
  if (beforeDash?.[1]) return beforeDash[1].trim();

  const patterns = [
    /^([A-Z][A-Za-z0-9&'\s]{2,30}?)\s+(?:is|—|-|:)/,
    /^([A-Z][A-Za-z0-9&'\s]{2,28})$/,
  ];
  for (const p of patterns) {
    const m = brief.match(p);
    if (m?.[1]) return m[1].trim();
  }

  const vertical = detectVertical(brief);
  const labels: Record<string, string> = {
    salon: "Studio",
    finserv: "Capital",
    restaurant: "Kitchen",
    fitness: "Fitness",
    default: "Co",
  };
  const words = brief.split(/\s+/).filter((w) => w.length > 3).slice(0, 2);
  const base = words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  return base ? `${base} ${labels[vertical] ?? "Co"}` : "My Business";
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const cmd = command ?? "generate";

  if (cmd === "generate" || cmd === "dev") {
    const brief = args.join(" ").trim() || process.env.BUSINESS_BRIEF?.trim() || "";
    if (!brief) {
      console.error("Usage: npm run dev -- \"Your business in 1-2 lines\"");
      console.error("Example: npm run dev -- \"Glow Salon — luxury hair salon in Austin, balayage & booking\"");
      process.exit(1);
    }

    const name = process.env.BUSINESS_NAME?.trim() || extractBusinessName(brief);

    console.log("Website Generator — production pipeline\n");
    console.log(`Business: ${name}`);
    console.log(`Brief: ${brief}\n`);

    const { llm } = await import("./llm/client.js");
    if (llm.isAvailable) {
      console.log(`LLM: ${llm.provider} (${llm.getChatModel()})`);
    } else {
      console.log("LLM: mock mode (set GROQ_API_KEY for live copy + layout)");
    }
    console.log("Media: Unsplash stock photos (curated, no API key needed)");
    console.log();

    const outputDir = path.resolve("output", name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));

    let previewShown = false;
    const result = await generateSite({
      businessName: name,
      businessBrief: brief,
      enableVisionPolish: process.env.SKIP_VISION !== "1",
      onPreviewReady: async (partial) => {
        if (previewShown || !partial.htmlPages) return;
        previewShown = true;
        await writeSiteOutput(outputDir, partial.htmlPages);
        console.log(`\nPreview ready in ${((partial.timingMs ?? 0) / 1000).toFixed(1)}s → ${outputDir}`);
      },
    });

    await writeSiteOutput(outputDir, result.htmlPages);
    const finalDir = path.resolve("output", result.site.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    if (finalDir !== outputDir) await writeSiteOutput(finalDir, result.htmlPages);
    console.log("\n" + summarizeGeneration(result));

    if (cmd === "dev") {
      const { url, close } = await startPreviewServer(outputDir);
      console.log(`\nLive preview: ${url}`);
      console.log("Press Ctrl+C to stop.\n");

      if (result.visionPolish?.status === "pending") {
        console.log("Vision polish running in background...");
        await waitForVisionPolish(result, 90_000);
        if (result.visionPolish?.appliedFixes.length) {
          console.log("Vision polish notes:");
          for (const note of result.visionPolish.appliedFixes) {
            console.log(`  • ${note}`);
          }
        }
      }

      process.on("SIGINT", () => {
        close();
        process.exit(0);
      });
    } else {
      console.log(`\nOutput: ${outputDir}`);
      console.log(`Open: ${path.join(outputDir, "index.html")}`);
    }
    return;
  }

  if (cmd === "preview") {
    const dir = args[0] ? path.resolve(args[0]) : path.resolve("output");
    const { url } = await startPreviewServer(dir);
    console.log(`Serving ${dir} at ${url}`);
    return;
  }

  console.log(`Usage:
  npm run dev -- "Glow Salon — luxury hair salon in Austin, balayage & online booking"
  npm run generate -- "Meridian Wealth — finserv firm, retirement planning"

  Just 1-2 lines about your business. Name is auto-detected (override with BUSINESS_NAME).

Environment:
  GROQ_API_KEY / OPENAI_API_KEY   Live LLM copy + layout (mock works offline)
  BUSINESS_NAME                   Optional override
  SKIP_VISION=1                   Skip background vision polish
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
