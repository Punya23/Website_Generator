import { readFileSync, readdirSync } from "fs";
import path from "path";
import { runCodeQA, closeQABrowser } from "../src/qa/code-qa.js";

const dir = process.argv[2] ?? "output/glow-salon";

async function main() {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(path.join(dir, file), "utf8");
    const qa = await runCodeQA(html, file.replace(".html", ""));
    console.log(`\n=== ${file} ===`);
    console.log(JSON.stringify(qa, null, 2));
  }
  await closeQABrowser();
}

main();
