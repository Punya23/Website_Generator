import type { LayoutChild, LayoutNode } from "../types.js";

const LAYOUT_TYPES = new Set<LayoutNode["type"]>(["Stack", "Row", "Grid", "Section", "Bento"]);

const TYPE_ALIASES: Record<string, LayoutNode["type"]> = {
  stack: "Stack",
  row: "Row",
  grid: "Grid",
  section: "Section",
  flex: "Row",
  flexrow: "Row",
  flexcolumn: "Stack",
  column: "Stack",
  columns: "Grid",
  bento: "Bento",
  masonry: "Bento",
  container: "Section",
  wrapper: "Section",
  div: "Stack",
};

const CONTENT_BLOCK_TYPES = new Set([
  "headline",
  "text",
  "image",
  "gallery",
  "feature",
  "stat",
  "testimonial",
  "cta",
  "contact",
  "bento",
  "pricing",
  "logo",
]);

function resolveLayoutType(raw: unknown): LayoutNode["type"] | null {
  if (typeof raw !== "string") return null;
  if (LAYOUT_TYPES.has(raw as LayoutNode["type"])) return raw as LayoutNode["type"];
  return TYPE_ALIASES[raw.toLowerCase()] ?? null;
}

function extractBlockId(obj: Record<string, unknown>): string | null {
  if (typeof obj.id === "string") return obj.id;
  if (typeof obj.blockId === "string") return obj.blockId;
  if (typeof obj.block === "string") return obj.block;
  if (typeof obj.ref === "string") return obj.ref;
  return null;
}

function looksLikeContentBlock(obj: Record<string, unknown>, validIds: Set<string>): boolean {
  const id = extractBlockId(obj);
  if (!id) return false;
  if (validIds.has(id)) return true;
  if (typeof obj.type === "string" && CONTENT_BLOCK_TYPES.has(obj.type.toLowerCase())) return true;
  return false;
}

function flattenChildren(children: LayoutChild[]): LayoutChild[] {
  const out: LayoutChild[] = [];
  for (const child of children) {
    if (typeof child === "string") {
      out.push(child);
      continue;
    }
    if (child.type === "Stack" && child.children.every((c) => typeof c === "string")) {
      out.push(...(child.children as string[]));
      continue;
    }
    out.push(child);
  }
  return out;
}

function normalizeChildren(raw: unknown, validIds: Set<string>): LayoutChild[] {
  if (!Array.isArray(raw)) return [];

  const children: LayoutChild[] = [];
  for (const item of raw) {
    const normalized = normalizeChild(item, validIds);
    if (normalized === null) continue;
    if (Array.isArray(normalized)) children.push(...normalized);
    else children.push(normalized);
  }
  return children;
}

function normalizeChild(raw: unknown, validIds: Set<string>): LayoutChild | LayoutChild[] | null {
  if (typeof raw === "string") return raw;

  if (!raw || typeof raw !== "object") return null;

  const obj = raw as Record<string, unknown>;

  if (obj.layout && typeof obj.layout === "object") {
    return normalizeNode(obj.layout, validIds);
  }

  if (looksLikeContentBlock(obj, validIds)) {
    return extractBlockId(obj)!;
  }

  const layoutType = resolveLayoutType(obj.type);
  if (!layoutType) {
    const id = extractBlockId(obj);
    if (id && validIds.has(id)) return id;
    return null;
  }

  const node: LayoutNode = {
    type: layoutType,
    children: normalizeChildren(obj.children, validIds),
  };

  if (layoutType === "Grid" && typeof obj.minColumnWidth === "number") {
    node.minColumnWidth = obj.minColumnWidth;
  }
  if ((layoutType === "Grid" || layoutType === "Row" || layoutType === "Bento") && typeof obj.columns === "number") {
    node.columns = obj.columns;
  }
  if (layoutType === "Section") {
    if (typeof obj.fullBleed === "boolean") node.fullBleed = obj.fullBleed;
    else if (typeof obj.fullbleed === "boolean") node.fullBleed = obj.fullbleed;
    if (typeof obj.id === "string") node.id = obj.id;
  }

  return node;
}

export function normalizeLayoutNode(raw: unknown, validIds: string[]): LayoutNode | null {
  const idSet = new Set(validIds);
  const normalized = normalizeNode(raw, idSet);
  if (!normalized) return null;
  return {
    ...normalized,
    children: flattenChildren(normalized.children),
  };
}

function normalizeNode(raw: unknown, validIds: Set<string>): LayoutNode | null {
  if (!raw || typeof raw !== "object") return null;

  const obj = raw as Record<string, unknown>;

  if (obj.layout && typeof obj.layout === "object") {
    return normalizeNode(obj.layout, validIds);
  }

  const layoutType = resolveLayoutType(obj.type);
  if (!layoutType) return null;

  return {
    type: layoutType,
    children: normalizeChildren(obj.children, validIds),
    ...(layoutType === "Grid" && typeof obj.minColumnWidth === "number"
      ? { minColumnWidth: obj.minColumnWidth }
      : {}),
    ...((layoutType === "Grid" || layoutType === "Row" || layoutType === "Bento") && typeof obj.columns === "number"
      ? { columns: obj.columns }
      : {}),
    ...(layoutType === "Section"
      ? {
          fullBleed:
            typeof obj.fullBleed === "boolean"
              ? obj.fullBleed
              : typeof obj.fullbleed === "boolean"
                ? obj.fullbleed
                : undefined,
          ...(typeof obj.id === "string" ? { id: obj.id } : {}),
        }
      : {}),
  };
}

export function repairLayoutCoverage(layout: LayoutNode, expectedIds: string[]): LayoutNode {
  const missing = findMissingBlockIds(layout, expectedIds);
  if (missing.length > 0) {
    throw new Error(`Layout missing block ids: ${missing.join(", ")}`);
  }
  return layout;
}

export function findMissingBlockIds(layout: LayoutNode, expectedIds: string[]): string[] {
  const used = new Set(collectIds(layout));
  return expectedIds.filter((id) => !used.has(id));
}

export function collectIds(node: LayoutNode): string[] {
  const ids: string[] = [];
  for (const child of node.children) {
    if (typeof child === "string") ids.push(child);
    else ids.push(...collectIds(child));
  }
  return ids;
}
