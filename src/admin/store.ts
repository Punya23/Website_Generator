import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getSupabaseClient } from "../hosting/supabase-client.js";
import {
  IngestCandidateSchema,
  IngestRunSchema,
  IngestSourceSchema,
  type IngestCandidate,
  type IngestRun,
  type IngestSource,
  type IngestStoreData,
} from "./types.js";
import { SEED_SOURCES } from "./seed.js";

export function defaultIngestStorePath(): string {
  return path.resolve(process.cwd(), "data", "admin-ingest.json");
}

/** Candidates live in an append-only sibling log so a run over thousands of repos does not
 *  rewrite the whole corpus once per candidate. */
export function candidateLogPath(storePath: string): string {
  const dir = path.dirname(storePath);
  const base = path.basename(storePath).replace(/\.json$/i, "");
  return path.join(dir, `${base}-candidates.ndjson`);
}

const MAX_RUNS = 50;
const COMPACT_MIN_APPENDS = 500;

interface Loaded {
  sources: Map<string, IngestSource>;
  runs: IngestRun[];
  candidates: Map<string, IngestCandidate>;
  byOrigin: Map<string, string>;
}

export interface CandidateFilter {
  status?: string;
  sourceId?: string;
  limit?: number;
  offset?: number;
}

export class IngestStore {
  private loaded: Loaded | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  /** Lines appended to the candidate log since it was last fully rewritten. */
  private appends = 0;

  constructor(private readonly filePath = defaultIngestStorePath()) {}

  private get logPath(): string {
    return candidateLogPath(this.filePath);
  }

  async snapshot(): Promise<IngestStoreData> {
    const data = await this.load();
    return structuredClone({
      sources: [...data.sources.values()],
      candidates: [...data.candidates.values()],
      runs: [...data.runs],
    });
  }

  async listSources(): Promise<IngestSource[]> {
    const data = await this.load();
    return [...data.sources.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getSource(id: string): Promise<IngestSource | undefined> {
    return (await this.load()).sources.get(id);
  }

  async upsertSource(
    input: Partial<IngestSource> & Pick<IngestSource, "name" | "kind" | "originUrl">
  ): Promise<IngestSource> {
    return this.mutate((data) => {
      const now = Date.now();
      const existing = input.id ? data.sources.get(input.id) : undefined;
      const parsed = IngestSourceSchema.parse({
        id: existing?.id ?? input.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        expectedLicense: "MIT",
        defaultCategory: "creative",
        status: "active",
        ...existing,
        ...input,
      });
      data.sources.set(parsed.id, parsed);
      void this.mirrorSupabase("ingest_sources", parsed);
      return parsed;
    });
  }

  /** O(1) origin lookup — the ingest loop asks this once per source. */
  async getCandidateByOrigin(originUrl: string): Promise<IngestCandidate | undefined> {
    const data = await this.load();
    const id = data.byOrigin.get(originUrl);
    return id ? data.candidates.get(id) : undefined;
  }

  async listCandidates(filter?: CandidateFilter): Promise<IngestCandidate[]> {
    const data = await this.load();
    let rows = [...data.candidates.values()];
    if (filter?.status) rows = rows.filter((row) => row.status === filter.status);
    if (filter?.sourceId) rows = rows.filter((row) => row.sourceId === filter.sourceId);
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = Math.max(0, filter?.offset ?? 0);
    if (offset === 0 && filter?.limit === undefined) return rows;
    return rows.slice(offset, filter?.limit === undefined ? undefined : offset + filter.limit);
  }

  async countCandidates(filter?: { status?: string; sourceId?: string }): Promise<number> {
    const data = await this.load();
    if (!filter?.status && !filter?.sourceId) return data.candidates.size;
    let n = 0;
    for (const row of data.candidates.values()) {
      if (filter.status && row.status !== filter.status) continue;
      if (filter.sourceId && row.sourceId !== filter.sourceId) continue;
      n += 1;
    }
    return n;
  }

  async getCandidate(id: string): Promise<IngestCandidate | undefined> {
    return (await this.load()).candidates.get(id);
  }

  async upsertCandidate(input: IngestCandidate): Promise<IngestCandidate> {
    const parsed = IngestCandidateSchema.parse({ ...input, updatedAt: Date.now() });
    return this.serialize(async () => {
      const data = await this.loadUnlocked();
      data.candidates.set(parsed.id, parsed);
      data.byOrigin.set(parsed.originUrl, parsed.id);
      await fs.mkdir(path.dirname(this.logPath), { recursive: true });
      if (this.shouldCompact(data)) {
        await this.rewriteLogUnlocked(data);
      } else {
        await fs.appendFile(this.logPath, `${JSON.stringify(parsed)}\n`, "utf8");
        this.appends += 1;
      }
      void this.mirrorSupabase("ingest_candidates", parsed);
      return parsed;
    });
  }

  async listRuns(): Promise<IngestRun[]> {
    const data = await this.load();
    return [...data.runs].sort((a, b) => b.startedAt - a.startedAt).slice(0, 40);
  }

  async upsertRun(input: IngestRun): Promise<IngestRun> {
    return this.mutate((data) => {
      const parsed = IngestRunSchema.parse(input);
      data.runs = [...data.runs.filter((row) => row.id !== parsed.id), parsed].slice(-MAX_RUNS);
      void this.mirrorSupabase("ingest_runs", parsed);
      return parsed;
    });
  }

  async stats() {
    const data = await this.load();
    const byStatus: Record<string, number> = {};
    for (const row of data.candidates.values()) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    }
    const sources = [...data.sources.values()];
    return {
      sources: sources.length,
      activeSources: sources.filter((row) => row.status === "active").length,
      candidates: data.candidates.size,
      byStatus,
      runs: data.runs.length,
    };
  }

  /** Drop the candidate log entirely — used by admin "reset queue" and by tests. */
  async clearCandidates(): Promise<void> {
    await this.serialize(async () => {
      const data = await this.loadUnlocked();
      data.candidates.clear();
      data.byOrigin.clear();
      await fs.rm(this.logPath, { force: true });
      this.appends = 0;
    });
  }

  private shouldCompact(data: Loaded): boolean {
    return this.appends >= COMPACT_MIN_APPENDS && this.appends >= data.candidates.size * 2;
  }

  private async rewriteLogUnlocked(data: Loaded): Promise<void> {
    const body = [...data.candidates.values()].map((row) => JSON.stringify(row)).join("\n");
    await fs.writeFile(this.logPath, body ? `${body}\n` : "", "utf8");
    this.appends = 0;
  }

  private async serialize<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.writeChain;
    let release!: () => void;
    this.writeChain = new Promise((resolve) => {
      release = resolve;
    });
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async mutate<T>(fn: (data: Loaded) => T): Promise<T> {
    return this.serialize(async () => {
      const data = await this.loadUnlocked();
      const result = fn(data);
      await this.writeIndexUnlocked(data);
      return result;
    });
  }

  private async load(): Promise<Loaded> {
    return this.loadUnlocked();
  }

  /**
   * Move an index file that failed to parse aside instead of silently discarding it. Every
   * `mutate()` call (including a plain `upsertRun` during a long discovery run) ends by
   * rewriting this file, so a process killed mid-write (Ctrl-C, OOM, a deploy restart) can leave
   * it truncated. The old behavior treated "doesn't parse" identically to "doesn't exist yet" —
   * reseed with SEED_SOURCES, `runs = []` — and then immediately overwrote the file with that,
   * permanently destroying every operator-added source and the run history with no log line.
   */
  private async quarantineCorruptIndex(raw: string, cause: unknown): Promise<never> {
    const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
    try {
      await fs.writeFile(backupPath, raw, "utf8");
    } catch {
      // Best effort — surfacing the parse error below matters more than the backup succeeding.
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Ingest store index at ${this.filePath} is not valid JSON and was NOT reseeded or overwritten. ` +
        `A copy of the unreadable file was saved to ${backupPath} for inspection — restore it from a ` +
        `backup or delete it manually before retrying. Parse error: ${reason}`
    );
  }

  private async loadUnlocked(): Promise<Loaded> {
    if (this.loaded) return this.loaded;

    let legacyCandidates: IngestCandidate[] = [];
    let sources: IngestSource[] = [];
    let runs: IngestRun[] = [];
    let isFreshInstall = false;

    let raw: string | undefined;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        isFreshInstall = true;
      } else {
        // Not "the file doesn't exist yet" — a permissions or I/O error must not be treated as a
        // fresh install, or the next write silently reseeds over a file we simply couldn't read.
        throw err;
      }
    }

    if (raw !== undefined) {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch (err) {
        await this.quarantineCorruptIndex(raw, err);
      }
      const obj = (parsedJson ?? {}) as Record<string, unknown>;
      // Row-by-row with safeParse, matching the hardening the NDJSON candidate log already has
      // (tests/ingest-scale.test.ts: "survives a truncated tail line") — one row that fails
      // schema validation is dropped, not a reason to discard every other row in the file.
      for (const row of Array.isArray(obj.sources) ? obj.sources : []) {
        const parsed = IngestSourceSchema.safeParse(row);
        if (parsed.success) sources.push(parsed.data);
      }
      for (const row of Array.isArray(obj.runs) ? obj.runs : []) {
        const parsed = IngestRunSchema.safeParse(row);
        if (parsed.success) runs.push(parsed.data);
      }
      for (const row of Array.isArray(obj.candidates) ? obj.candidates : []) {
        const parsed = IngestCandidateSchema.safeParse(row);
        if (parsed.success) legacyCandidates.push(parsed.data);
      }
    }

    if (isFreshInstall) sources = SEED_SOURCES;

    const candidates = new Map<string, IngestCandidate>();
    const byOrigin = new Map<string, string>();
    const remember = (row: IngestCandidate) => {
      candidates.set(row.id, row);
      byOrigin.set(row.originUrl, row.id);
    };
    for (const row of legacyCandidates) remember(row);

    let lines = 0;
    try {
      const log = await fs.readFile(this.logPath, "utf8");
      for (const line of log.split("\n")) {
        if (!line.trim()) continue;
        lines += 1;
        try {
          remember(IngestCandidateSchema.parse(JSON.parse(line)));
        } catch {
          // A truncated tail line (crash mid-append) is skipped, not fatal.
        }
      }
    } catch {
      // No log yet.
    }
    this.appends = Math.max(0, lines - candidates.size);

    const data: Loaded = { sources: new Map(sources.map((row) => [row.id, row])), runs, candidates, byOrigin };
    this.loaded = data;

    // Migrate a legacy single-file store: candidates move to the log, index keeps sources/runs.
    if (legacyCandidates.length > 0) {
      await this.rewriteLogUnlocked(data);
    }
    await this.writeIndexUnlocked(data);
    return data;
  }

  private async writeIndexUnlocked(data: Loaded): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const body = JSON.stringify(
      { sources: [...data.sources.values()], candidates: [], runs: data.runs },
      null,
      2
    );
    // Write-then-rename rather than a direct write: a process killed mid-write (Ctrl-C, OOM, a
    // deploy restart) leaves the direct-write target half-written and unparseable on next boot,
    // which is exactly the corruption quarantineCorruptIndex exists to catch. A rename within the
    // same directory is atomic on POSIX filesystems, so a reader never observes a partial file.
    const tmpPath = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.tmp-${process.pid}-${Date.now()}`
    );
    await fs.writeFile(tmpPath, body, "utf8");
    await fs.rename(tmpPath, this.filePath);
  }

  private async mirrorSupabase(table: string, row: unknown): Promise<void> {
    const client = getSupabaseClient();
    if (!client) return;
    try {
      await client.from(table).upsert({
        id: (row as { id: string }).id,
        doc: row,
        updated_at: new Date().toISOString(),
      });
    } catch {
      // File store remains source of truth when Supabase schema is not applied.
    }
  }
}
