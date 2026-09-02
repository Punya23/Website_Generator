import fs from "node:fs";
import path from "node:path";
import type { SiteSkin } from "../skins/schema.js";
import { SiteSkinSchema } from "../skins/schema.js";

export function approvedSkinsPath(): string {
  return path.resolve(process.cwd(), "data", "approved-skins.json");
}

let cache: { mtimeMs: number; skins: SiteSkin[] } | null = null;

export function invalidateApprovedSkinsCache(): void {
  cache = null;
}

export function loadApprovedSkins(): SiteSkin[] {
  try {
    const filePath = approvedSkinsPath();
    const mtimeMs = fs.statSync(filePath).mtimeMs;
    if (cache && cache.mtimeMs === mtimeMs) return cache.skins;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      cache = { mtimeMs, skins: [] };
      return [];
    }
    const skins = parsed
      .map((row) => SiteSkinSchema.safeParse(row))
      .filter((row) => row.success)
      .map((row) => row.data);
    cache = { mtimeMs, skins };
    return skins;
  } catch {
    cache = null;
    return [];
  }
}

export function saveApprovedSkin(skin: SiteSkin): SiteSkin {
  const existing = loadApprovedSkins().filter((row) => row.id !== skin.id);
  const next = [...existing, skin];
  fs.mkdirSync(path.dirname(approvedSkinsPath()), { recursive: true });
  fs.writeFileSync(approvedSkinsPath(), JSON.stringify(next, null, 2), "utf8");
  invalidateApprovedSkinsCache();
  return skin;
}

export function saveApprovedSkins(skins: SiteSkin[]): void {
  fs.mkdirSync(path.dirname(approvedSkinsPath()), { recursive: true });
  fs.writeFileSync(approvedSkinsPath(), JSON.stringify(skins, null, 2), "utf8");
  invalidateApprovedSkinsCache();
}

export function removeApprovedSkin(id: string): void {
  const next = loadApprovedSkins().filter((row) => row.id !== id);
  saveApprovedSkins(next);
}

export function skinLayoutSignature(skin: SiteSkin): string {
  return skin.pages.home.map((section) => section.templateId).join(">");
}

export function skinSignature(skin: SiteSkin): string {
  return [
    skinLayoutSignature(skin),
    skin.visualFamily,
    skin.chrome.navShape,
    skin.chrome.footerLayout,
  ].join("|");
}

export interface DedupeVerdict {
  ok: boolean;
  reason?: string;
  /** How many live skins already share this skin's home template order. */
  clusterSize: number;
}

/**
 * Dedupe for a large corpus. An exact signature repeat (same layout AND same visual family, nav
 * and footer) is a true duplicate and always rejected. A repeated *layout* is not: with 34
 * templates and 3–8 home slots, thousands of real templates collapse onto a few hundred distinct
 * orders, so hard-rejecting every repeat throws most of an ingest run away. Allow up to `cap` per
 * layout cluster as long as each entry differs in visual family / chrome.
 */
export function checkSkinDedupe(
  skin: SiteSkin,
  live: readonly SiteSkin[],
  cap: number
): DedupeVerdict {
  const signature = skinSignature(skin);
  const layout = skinLayoutSignature(skin);
  let clusterSize = 0;
  for (const row of live) {
    if (skinSignature(row) === signature) {
      return {
        ok: false,
        clusterSize,
        reason: "Duplicate composition signature — another live skin already uses this layout, family, and chrome",
      };
    }
    if (skinLayoutSignature(row) === layout) clusterSize += 1;
  }
  if (clusterSize >= cap) {
    return {
      ok: false,
      clusterSize,
      reason: `Layout cluster full — ${clusterSize} live skins already use this template order (cap ${cap})`,
    };
  }
  return { ok: true, clusterSize };
}
