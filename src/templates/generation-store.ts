/**
 * Persisted record of each verbatim-pipeline site generation: which source template filled every
 * section on every page, and the exact before/after text for everything that changed in it.
 *
 * Append-only NDJSON, same shape as the rest of this app's local stores (`data/admin-ingest-candidates.ndjson`)
 * — one write per generation, no read-modify-write race, and a corrupt trailing line costs that
 * line, not the history. Not meant to scale past admin-review volumes; there is no compaction or
 * indexing here, just a bounded read-all-and-filter for a list this small.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { generationHistoryPath } from "./config.js";
import type { ComposedSite } from "./compose.js";

const CopyChangeSchema = z.object({
  kind: z.string(),
  selector: z.string(),
  before: z.string(),
  after: z.string(),
});

const SectionProvenanceSchema = z.object({
  templateId: z.string(),
  templateName: z.string(),
  sectionId: z.string(),
  role: z.string(),
  changes: z.array(CopyChangeSchema).default([]),
  photosApplied: z.number().default(0),
  photosSkipped: z.number().default(0),
});

export const GenerationRecordSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  consumerId: z.string().optional(),
  businessName: z.string(),
  rawBrief: z.string(),
  theme: z.enum(["light", "dark"]).optional(),
  /** "confirmed": every placed section's own origin theme matched `theme`. "partial-fallback": at
   *  least one role had no on-theme candidate and fell back to a themeless (not yet backfilled)
   *  section — see `select.ts`'s `themedPoolFor`. Lets the admin Generations tab show "confirmed
   *  light" differently from "locked light, one or more sections theme-unknown" instead of one
   *  label for both — previously indistinguishable from the record alone. */
  themeConfidence: z.enum(["confirmed", "partial-fallback"]).optional(),
  /** The taxonomy gate this site was built under — what the brief classified as, how tightly the
   *  corpus was locked to it, and whether the lock had to be broken because the corpus had nothing
   *  in that vertical. Stored so a mis-fitting site is diagnosable after the fact from the record
   *  alone, without re-running selection. See `src/templates/taxonomy-scope.ts`. */
  taxonomy: z
    .object({
      industry: z.string(),
      category: z.string(),
      archetype: z.string(),
      tier: z.enum(["industry", "related", "category", "any"]),
      strict: z.boolean(),
      widened: z.boolean(),
    })
    .optional(),
  templateIds: z.array(z.string()).default([]),
  pages: z.record(z.string(), z.array(SectionProvenanceSchema)).default({}),
  stats: z.object({
    sectionsPlaced: z.number(),
    slotsApplied: z.number(),
    slotsSkipped: z.number(),
    /** Of `slotsSkipped`, a selector that no longer resolves — ingest-time markup drift, not "the
     *  brief had nothing to say". `.default(0)` for records written before this field existed. */
    selectorErrors: z.number().default(0),
    fillerRewritten: z.number(),
    photosApplied: z.number(),
    photosSkipped: z.number(),
    templatesUsed: z.number(),
    /** Text runs the compulsory LLM copy-polish pass actually rewrote (`copy-polish-agent.ts`).
     *  `.default(0)` for records written before that stage existed. */
    editsApplied: z.number().default(0),
  }),
});
export type GenerationRecord = z.infer<typeof GenerationRecordSchema>;

function newId(): string {
  return `gen_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

export interface RecordGenerationInput {
  businessName: string;
  rawBrief: string;
  consumerId?: string;
  theme?: "light" | "dark";
  themeConfidence?: "confirmed" | "partial-fallback";
  taxonomy?: GenerationRecord["taxonomy"];
  composed: Pick<ComposedSite, "provenance" | "stats">;
}

/** Appends one line — never rewrites the file, so a generation mid-write elsewhere is never
 *  corrupted by this one. */
export async function recordGeneration(input: RecordGenerationInput): Promise<GenerationRecord> {
  const templateIds = [
    ...new Set(Object.values(input.composed.provenance).flatMap((rows) => rows.map((row) => row.templateId))),
  ];
  const record = GenerationRecordSchema.parse({
    id: newId(),
    createdAt: Date.now(),
    ...(input.consumerId ? { consumerId: input.consumerId } : {}),
    businessName: input.businessName,
    rawBrief: input.rawBrief,
    ...(input.theme ? { theme: input.theme } : {}),
    ...(input.themeConfidence ? { themeConfidence: input.themeConfidence } : {}),
    ...(input.taxonomy ? { taxonomy: input.taxonomy } : {}),
    templateIds,
    pages: input.composed.provenance,
    stats: input.composed.stats,
  });
  const file = generationHistoryPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

async function readAll(): Promise<GenerationRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(generationHistoryPath(), "utf8");
  } catch {
    return [];
  }
  const records: GenerationRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = GenerationRecordSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) records.push(parsed.data);
    } catch {
      // One corrupt line (a truncated write) costs that line, not the history.
    }
  }
  return records;
}

export interface ListGenerationsOptions {
  limit?: number;
  consumerId?: string;
}

/** Most-recent-first. `readAll` returns append order, so ties on `createdAt` (two generations in
 *  the same millisecond — routine under test, and not impossible in real traffic) break to
 *  whichever was appended later rather than an arbitrary sort-stability accident. */
export async function listGenerations(options: ListGenerationsOptions = {}): Promise<GenerationRecord[]> {
  const all = await readAll();
  const filtered = options.consumerId ? all.filter((row) => row.consumerId === options.consumerId) : all;
  const sorted = filtered
    .map((row, appendIndex) => ({ row, appendIndex }))
    .sort((a, b) => b.row.createdAt - a.row.createdAt || b.appendIndex - a.appendIndex)
    .map(({ row }) => row);
  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

export async function getGeneration(id: string): Promise<GenerationRecord | null> {
  const all = await readAll();
  return all.find((row) => row.id === id) ?? null;
}
