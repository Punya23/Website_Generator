/**
 * The editable state of the site currently in the playground, on disk.
 *
 * The editor session is a module singleton (`src/editor/session.ts`) and dies with the process —
 * every dev restart, every crash. That is survivable for a generated preview (the HTML is still on
 * disk) but not for edits: without the state there is no way to recompose, so the first edit after
 * a restart used to be impossible rather than merely stale. This keeps the last generated site's
 * state next to the rest of the app's local data so an edit still lands.
 *
 * One slot per key (default "playground") — this is single-tenant authoring state, not history;
 * `data/generation-history.ndjson` is the append-only record.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { siteStateDir } from "./config.js";
import type { VerbatimSiteState } from "./revise.js";

export interface StoredSiteState {
  savedAt: number;
  /** Which page the preview was last showing — restored so an edit after a restart still resolves
   *  section targets against the page the user is looking at. */
  state: VerbatimSiteState;
}

function fileFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_") || "playground";
  return path.join(siteStateDir(), `${safe}.json`);
}

export async function saveSiteState(state: VerbatimSiteState, key = "playground"): Promise<void> {
  const file = fileFor(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const payload: StoredSiteState = { savedAt: Date.now(), state };
  // Atomic: a half-written state file would strand the site with no way to edit it.
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload), "utf8");
  await fs.rename(tmp, file);
}

export async function loadSiteState(key = "playground"): Promise<VerbatimSiteState | null> {
  try {
    const raw = await fs.readFile(fileFor(key), "utf8");
    const parsed = JSON.parse(raw) as StoredSiteState;
    return parsed?.state?.pages ? parsed.state : null;
  } catch {
    return null;
  }
}

export async function clearSiteState(key = "playground"): Promise<void> {
  await fs.rm(fileFor(key), { force: true });
}
