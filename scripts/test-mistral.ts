import "../src/load-env.js";
import { llm } from "../src/llm/client.js";

async function main() {
  if (!llm.isAvailable) {
    console.error("Set MISTRAL_API_KEY and LLM_PROVIDER=mistral in .env");
    process.exit(1);
  }

  console.log(`Provider: ${llm.provider}`);
  console.log(`Model: ${llm.getChatModel()}`);
  console.log("Sending test prompt…\n");

  const started = Date.now();
  const reply = await llm.chat(
    "You reply with valid JSON only.",
    'Return {"ok":true,"provider":"mistral","message":"hello from website generator"}',
    { jsonMode: true, temperature: 0, maxTokens: 128 }
  );
  const ms = Date.now() - started;

  console.log(`Response (${(ms / 1000).toFixed(1)}s):`);
  console.log(reply);
  console.log("\nMistral connection OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
