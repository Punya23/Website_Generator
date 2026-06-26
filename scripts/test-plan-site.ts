import "../src/load-env.js";
import { expandBrief } from "../src/agents/expand-brief-agent.js";
import { planSite } from "../src/agents/site-planner-agent.js";

async function main() {
  console.log("expand...");
  const expanded = await expandBrief(
    "Clear Smile Dental — family dentist in Austin",
    "Clear Smile Dental"
  );
  console.log("expand done:", expanded.businessName);
  console.log("planSite...");
  const plan = await planSite(expanded);
  console.log("plan done:", plan.pages.length, "pages");
}

main().catch((e) => {
  console.error("ERR:", e instanceof Error ? e.message : e);
  if (e instanceof Error && e.cause) console.error("cause:", e.cause);
  process.exit(1);
});
