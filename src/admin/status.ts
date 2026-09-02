import { llm, type LLMStatus } from "../llm/client.js";
import { SECTION_TEMPLATES, TEMPLATE_IDS } from "../section-templates/registry.js";
import { SITE_SKINS } from "../skins/catalog.js";
import type { SiteSkin } from "../skins/schema.js";
import { loadApprovedSkins, skinSignature } from "./approved-skins.js";
import {
  githubToken,
  ingestAutoApprove,
  ingestMaxPerRun,
  ingestMinConfidence,
  ingestUseLlm,
} from "./config.js";
import type { IngestStore } from "./store.js";

export const INGEST_POLICY =
  "Ingest MIT/Apache/BSD/CC0 templates as composition recipes. Framer, paid kits, and closed sources are blocked. HTML/CSS is never vendored.";

export interface KeyPresence {
  groq: boolean;
  ollama: boolean;
  mistral: boolean;
  openrouter: boolean;
  openai: boolean;
  github: boolean;
}

export interface SkinPageBlock {
  templateId: string;
  intent: string;
}

export interface PublicSkin {
  id: string;
  name: string;
  categories: string[];
  inspiredBy?: string;
  description: string;
  visualFamily: string;
  chrome: SiteSkin["chrome"];
  pages: Record<string, SkinPageBlock[]>;
}

export function keysPresent(): KeyPresence {
  return {
    groq: Boolean(process.env.GROQ_API_KEY?.trim()),
    ollama: Boolean(
      process.env.OLLAMA_API_KEY?.trim() ||
        process.env.LLM_PROVIDER?.toLowerCase() === "ollama" ||
        /ollama\.com/i.test(process.env.OLLAMA_BASE_URL ?? "")
    ),
    mistral: Boolean(process.env.MISTRAL_API_KEY?.trim()),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
    github: Boolean(githubToken()),
  };
}

export function summarizeSkinPages(skin: SiteSkin): Record<string, SkinPageBlock[]> {
  const pages: Record<string, SkinPageBlock[]> = {};
  for (const [slug, sections] of Object.entries(skin.pages)) {
    pages[slug] = sections.map((section) => ({
      templateId: section.templateId,
      intent: section.intent,
    }));
  }
  return pages;
}

export function publicSkin(skin: SiteSkin): PublicSkin {
  return {
    id: skin.id,
    name: skin.name,
    categories: [...skin.categories],
    inspiredBy: skin.inspiredBy,
    description: skin.description,
    visualFamily: skin.visualFamily,
    chrome: skin.chrome,
    pages: summarizeSkinPages(skin),
  };
}

export function landmarkForTemplate(id: string): string {
  if (id.startsWith("hero_")) return "hero";
  if (id.startsWith("cta") || id.includes("footer_cta") || id.includes("newsletter")) return "cta";
  if (id.includes("testimonial")) return "testimonials";
  if (id.includes("faq")) return "faq";
  if (id.includes("team")) return "team";
  if (id.includes("stat")) return "stats";
  if (id.includes("contact") || id.includes("hours")) return "contact";
  if (id.includes("story") || id.includes("intro")) return "story";
  if (id.includes("gallery") || id.includes("portfolio") || id.includes("before")) return "gallery";
  if (id.includes("pric") || id.includes("menu") || id.includes("offer") || id.includes("service")) {
    return "features";
  }
  return "other";
}

export function liveSkins(): SiteSkin[] {
  return [...SITE_SKINS, ...loadApprovedSkins()];
}

export function templateLibrary(skins: SiteSkin[] = liveSkins()) {
  const used = new Map<string, number>();
  for (const skin of skins) {
    const ids = new Set<string>();
    for (const sections of Object.values(skin.pages)) {
      for (const section of sections) ids.add(section.templateId);
    }
    for (const id of ids) used.set(id, (used.get(id) ?? 0) + 1);
  }
  return {
    count: TEMPLATE_IDS.length,
    templates: SECTION_TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      pages: template.pages,
      landmark: landmarkForTemplate(template.id),
      usedInSkins: used.get(template.id) ?? 0,
    })),
  };
}

export function currentLlmLabel(): string {
  if (!ingestUseLlm() || !llm.isAvailable) return "heuristic";
  return llm.provider ?? "none";
}

export interface AdminStatus {
  sources: number;
  activeSources: number;
  candidates: number;
  byStatus: Record<string, number>;
  runs: number;
  templateCount: number;
  authoredSkins: number;
  approvedSkins: number;
  liveSkins: number;
  uniqueSignatures: number;
  llm: LLMStatus;
  llmLabel: string;
  keys: KeyPresence;
  ingest: {
    autoApprove: boolean;
    minConfidence: number;
    maxPerRun: number;
  };
  autoApprove: boolean;
  minConfidence: number;
  githubToken: boolean;
}

export async function buildAdminStatus(store: IngestStore): Promise<AdminStatus> {
  const stats = await store.stats();
  const authored = SITE_SKINS;
  const ingested = loadApprovedSkins();
  const signatures = new Set([...authored, ...ingested].map((skin) => skinSignature(skin)));
  return {
    ...stats,
    templateCount: TEMPLATE_IDS.length,
    authoredSkins: authored.length,
    approvedSkins: ingested.length,
    liveSkins: authored.length + ingested.length,
    uniqueSignatures: signatures.size,
    llm: llm.getStatus(),
    llmLabel: currentLlmLabel(),
    keys: keysPresent(),
    ingest: {
      autoApprove: ingestAutoApprove(),
      minConfidence: ingestMinConfidence(),
      maxPerRun: ingestMaxPerRun(),
    },
    autoApprove: ingestAutoApprove(),
    minConfidence: ingestMinConfidence(),
    githubToken: Boolean(githubToken()),
  };
}
