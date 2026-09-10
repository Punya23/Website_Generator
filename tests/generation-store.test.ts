import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "gen-store-"));
  process.env.TEMPLATE_GENERATION_HISTORY_PATH = path.join(dir, "generation-history.ndjson");
});

afterEach(async () => {
  delete process.env.TEMPLATE_GENERATION_HISTORY_PATH;
  await fs.rm(dir, { recursive: true, force: true });
});

function composedFixture(templateId: string, before: string, after: string) {
  return {
    provenance: {
      home: [
        {
          templateId,
          templateName: "Fixture Template",
          sectionId: "sec_hero",
          role: "hero",
          changes: [{ kind: "primaryCta", selector: "a", before, after }],
          photosApplied: 1,
          photosSkipped: 0,
        },
      ],
    },
    stats: {
      sectionsPlaced: 1,
      slotsApplied: 1,
      slotsSkipped: 0,
      fillerRewritten: 0,
      photosApplied: 1,
      photosSkipped: 0,
      templatesUsed: 1,
    },
  };
}

describe("generation-store", () => {
  it("records a generation and reads it back with full provenance and diff", async () => {
    const { recordGeneration, getGeneration } = await import("../src/templates/generation-store.js");
    const record = await recordGeneration({
      businessName: "Acme Bakery",
      rawBrief: "Acme Bakery — sourdough in Leeds.",
      theme: "dark",
      composed: composedFixture("tpl_aaaa", "Click here", "Get in touch"),
    });
    expect(record.id).toMatch(/^gen_/);
    expect(record.templateIds).toEqual(["tpl_aaaa"]);

    const fetched = await getGeneration(record.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.businessName).toBe("Acme Bakery");
    expect(fetched!.theme).toBe("dark");
    expect(fetched!.pages.home![0]!.changes[0]).toEqual({
      kind: "primaryCta",
      selector: "a",
      before: "Click here",
      after: "Get in touch",
    });
  });

  it("lists most-recent-first and honors a limit", async () => {
    const { recordGeneration, listGenerations } = await import("../src/templates/generation-store.js");
    for (const id of ["tpl_1", "tpl_2", "tpl_3"]) {
      await recordGeneration({
        businessName: `Business ${id}`,
        rawBrief: "brief",
        composed: composedFixture(id, "before", "after"),
      });
    }
    const all = await listGenerations();
    expect(all).toHaveLength(3);
    expect(all[0]!.businessName).toBe("Business tpl_3");
    expect(all[2]!.businessName).toBe("Business tpl_1");

    const limited = await listGenerations({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("filters by consumerId", async () => {
    const { recordGeneration, listGenerations } = await import("../src/templates/generation-store.js");
    await recordGeneration({
      businessName: "A",
      rawBrief: "brief",
      consumerId: "user-1",
      composed: composedFixture("tpl_a", "b", "a"),
    });
    await recordGeneration({
      businessName: "B",
      rawBrief: "brief",
      consumerId: "user-2",
      composed: composedFixture("tpl_b", "b", "a"),
    });
    const rows = await listGenerations({ consumerId: "user-1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.businessName).toBe("A");
  });

  it("skips a corrupt trailing line instead of losing the whole history", async () => {
    const { recordGeneration, listGenerations } = await import("../src/templates/generation-store.js");
    await recordGeneration({
      businessName: "Good Row",
      rawBrief: "brief",
      composed: composedFixture("tpl_x", "b", "a"),
    });
    await fs.appendFile(process.env.TEMPLATE_GENERATION_HISTORY_PATH!, "{not valid json\n", "utf8");
    const rows = await listGenerations();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.businessName).toBe("Good Row");
  });

  it("returns null for an unknown id", async () => {
    const { getGeneration } = await import("../src/templates/generation-store.js");
    expect(await getGeneration("gen_does_not_exist")).toBeNull();
  });
});
