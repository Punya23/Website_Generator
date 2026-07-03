import "./load-env.js";
import { activeImageProviders } from "./media/image-providers.js";
import { generateSite, summarizeGeneration, waitForVisionPolish } from "./orchestrator/orchestrator.js";
import { writeSiteOutput, startPreviewServer } from "./server/preview-server.js";
import { startPlaygroundServer } from "./web/playground-server.js";
import { extractBusinessName } from "./util/extract-name.js";
import { ensurePlaywrightBrowsers } from "./util/ensure-playwright.js";
import path from "path";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const cmd = command ?? "generate";

  if (cmd === "playground" || cmd === "ui") {
    if (process.env.SKIP_VISION !== "1") {
      await ensurePlaywrightBrowsers();
    }
    const { url, close } = await startPlaygroundServer();
    console.log(`Playground UI → ${url}`);
    console.log("Pipeline logs stream in the browser terminal panel.");
    console.log("Press Ctrl+C to stop.\n");
    process.on("SIGINT", () => {
      close();
      process.exit(0);
    });
    return;
  }

  if (cmd === "generate" || cmd === "dev") {
    if (process.env.SKIP_VISION !== "1") {
      await ensurePlaywrightBrowsers();
    }
    const brief = args.join(" ").trim() || process.env.BUSINESS_BRIEF?.trim() || "";
    if (!brief) {
      console.error("Usage: npm run dev -- \"Your business in 1-2 lines\"");
      console.error("Example: npm run dev -- \"Your business name — what you do, where\"");
      process.exit(1);
    }

    const name = process.env.BUSINESS_NAME?.trim() || extractBusinessName(brief);

    console.log("Website Generator — production pipeline\n");
    console.log(`Business: ${name}`);
    console.log(`Brief: ${brief}\n`);

    const { llm } = await import("./llm/client.js");
    if (llm.isAvailable) {
      console.log(`LLM: ${llm.provider} (${llm.getChatModel()})`);
      if (process.env.SKIP_VISION !== "1") {
        console.log(
          llm.supportsVision
            ? `Vision: enabled (${llm.getVisionModel()})`
            : "Vision: disabled — set GROQ_VISION_MODEL, MISTRAL_API_KEY, or OPENAI_API_KEY"
        );
      } else {
        console.log("Vision: skipped (SKIP_VISION=1)");
      }
    } else {
      console.log("LLM: mock mode (set OPENROUTER_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY, or OPENAI_API_KEY)");
    }
    console.log(`Media: ${activeImageProviders().join(" → ")}`);
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
  npm run playground              Minimal web UI with live pipeline logs
  npm run dev -- "Your business — what you do"
  npm run generate -- "Brief here"

Environment (set in .env — see .env.example):
  OPENROUTER_API_KEY / GROQ_API_KEY / MISTRAL_API_KEY / OPENAI_API_KEY   Live LLM (mock works offline)
  LLM_PROVIDER=mistral|groq|openai                  Force a provider when multiple keys set
  PEXELS_API_KEY / PIXABAY_API_KEY  Optional extra image sources
  BUSINESS_NAME                   Optional override
  PIPELINE_FAST=1              Cheaper/faster tier (quality pipeline is the default)
  BESPOKE_SECTION_CODEGEN=0    Disable bespoke per-section TSX codegen (on by default)
  VISION_QA_HOME_ONLY=1        Restrict vision QA to the home page only, for cost
  SKIP_VISION=1                Skip vision QA + retry
  SKIP_PLAYWRIGHT_SETUP=1      Skip auto Chromium install on startup
  GROQ_VISION_MODEL=...        Vision model (default: llama-4-scout on Groq)
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
