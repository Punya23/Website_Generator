import "../src/load-env.js";
import { llm } from "../src/llm/client.js";

async function main() {
  console.log("provider:", llm.provider);
  console.log("chat model:", llm.getChatModel());
  console.log("composition model:", llm.getCompositionModel());
  console.log("tier:", process.env.OPENROUTER_MODEL_TIER ?? "(budget default)");

  const t0 = Date.now();
  const r = await llm.chat("You are a test bot", "Reply with exactly: OK", {
    maxTokens: 10,
    temperature: 0,
  });
  console.log("llm.chat:", JSON.stringify(r), "in", Date.now() - t0, "ms");

  const t1 = Date.now();
  const r2 = await llm.chat("You are a test bot", "Reply with exactly: OK", {
    maxTokens: 10,
    temperature: 0,
    model: llm.getCompositionModel(),
  });
  console.log("composition model:", JSON.stringify(r2), "in", Date.now() - t1, "ms");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
