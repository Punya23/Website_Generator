const BLOCKED_HOSTS = [
  "framer.com",
  "framer.website",
  "framercanvas.com",
  "themeforest.net",
  "envato.com",
  "cruip.com",
  "tailwindui.com",
  "tailwindplus.com",
  "webflow.com",
  "webflow.io",
  "figma.com",
  "ui8.net",
  "creative-tim.com",
  "htmlcodex.com",
  "themewagon.com",
];

const FORGE_HOSTS = [
  "github.com",
  "raw.githubusercontent.com",
  "api.github.com",
  "gitlab.com",
  "codeberg.org",
];

const ALLOWED_HOSTS = [
  ...FORGE_HOSTS,
  "startbootstrap.com",
  "startbootstrap.github.io",
  "hyperui.dev",
  "www.hyperui.dev",
  "tailgrids.com",
  "play-tailwind.tailgrids.com",
  "astro.build",
  "astrowind.vercel.app",
  "astroship.vercel.app",
];

const OSS_DEMO_SUFFIXES = [".github.io", ".gitlab.io", ".vercel.app", ".netlify.app", ".pages.dev"];

export interface UrlPolicyOptions {
  role?: "origin" | "demo";
  licenseVerified?: boolean;
  originUrl?: string;
}

export interface UrlPolicyResult {
  ok: boolean;
  host: string;
  reason?: string;
  kind?: "blocked" | "not-allowlisted";
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostMatches(host: string, listed: string): boolean {
  const needle = listed.replace(/^www\./, "");
  return host === needle || host.endsWith(`.${needle}`);
}

export function isBlockedHost(urlOrHost: string): boolean {
  const host = urlOrHost.includes("://") ? hostnameOf(urlOrHost) : urlOrHost.toLowerCase();
  return BLOCKED_HOSTS.some((blocked) => hostMatches(host, blocked));
}

export function isCodeForgeHost(urlOrHost: string): boolean {
  const host = urlOrHost.includes("://") ? hostnameOf(urlOrHost) : urlOrHost.toLowerCase();
  return FORGE_HOSTS.some((forge) => hostMatches(host, forge));
}

export function isStaticDemoHost(host: string): boolean {
  if (host.endsWith(".github.io") || host.endsWith(".gitlab.io")) return true;
  return ALLOWED_HOSTS.some((allowed) => hostMatches(host, allowed));
}

export function isOssDemoHost(host: string): boolean {
  return OSS_DEMO_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function inspectIngestUrl(url: string, options: UrlPolicyOptions = {}): UrlPolicyResult {
  const host = hostnameOf(url);
  if (!host) return { ok: false, host: "", reason: "Invalid URL", kind: "blocked" };

  if (BLOCKED_HOSTS.some((blocked) => hostMatches(host, blocked))) {
    return {
      ok: false,
      host,
      kind: "blocked",
      reason: `${host} is not an allowed ingest source. We do not scrape or vendor Framer, paid kits, or closed templates — only MIT/Apache/BSD/CC0 composition recipes.`,
    };
  }

  const role = options.role ?? "origin";

  if (role === "origin") {
    if (isStaticDemoHost(host) || isCodeForgeHost(host)) {
      return { ok: true, host };
    }
    return {
      ok: false,
      host,
      kind: "not-allowlisted",
      reason: `${host} is not a GitHub/GitLab/Codeberg origin or known open-source demo host.`,
    };
  }

  if (isStaticDemoHost(host)) {
    return { ok: true, host };
  }

  if (isOssDemoHost(host)) {
    if (options.licenseVerified) return { ok: true, host };
    if (options.originUrl && isCodeForgeHost(options.originUrl) && !isBlockedHost(options.originUrl)) {
      return { ok: true, host };
    }
    return {
      ok: false,
      host,
      kind: "not-allowlisted",
      reason: `${host} can be scraped only after a permissive license is verified on the GitHub/GitLab origin.`,
    };
  }

  return {
    ok: false,
    host,
    kind: "not-allowlisted",
    reason: `${host} is not on the ingest allowlist. Add a GitHub MIT/Apache/BSD/CC0 repo or a known open-source demo host.`,
  };
}

export function assertAllowedUrl(url: string, options?: UrlPolicyOptions): void {
  const result = inspectIngestUrl(url, options);
  if (!result.ok) throw new Error(result.reason);
}

const LICENSE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "MIT", re: /\bmit license\b/i },
  { id: "Apache-2.0", re: /apache license,?\s+version 2/i },
  { id: "BSD-2-Clause", re: /\bbsd 2-clause\b/i },
  { id: "BSD-3-Clause", re: /\bbsd 3-clause\b/i },
  { id: "ISC", re: /\bisc license\b/i },
  { id: "CC0-1.0", re: /\bcc0\b/i },
  { id: "Unlicense", re: /\bunlicense\b/i },
];

const SPDX_ALIASES: Record<string, string> = {
  MIT: "MIT",
  "Apache-2.0": "Apache-2.0",
  "BSD-2-Clause": "BSD-2-Clause",
  "BSD-3-Clause": "BSD-3-Clause",
  ISC: "ISC",
  "CC0-1.0": "CC0-1.0",
  Unlicense: "Unlicense",
  Apache: "Apache-2.0",
};

export function detectLicense(text: string): string | undefined {
  const trimmed = text.slice(0, 4000);
  if (/\ball rights reserved\b/i.test(trimmed) && !/\bpermission is hereby granted\b/i.test(trimmed)) {
    return undefined;
  }
  for (const row of LICENSE_PATTERNS) {
    if (row.re.test(trimmed) || (row.id === "MIT" && /permission is hereby granted, free of charge/i.test(trimmed))) {
      return row.id;
    }
  }
  return undefined;
}

export function normalizeSpdx(id: string | undefined): string | undefined {
  if (!id || id === "NOASSERTION" || id === "OTHER" || id === "NONE") return undefined;
  return SPDX_ALIASES[id] ?? (LICENSE_PATTERNS.some((row) => row.id === id) ? id : undefined);
}

export function isPermissiveLicense(id: string | undefined): boolean {
  return Boolean(normalizeSpdx(id));
}

export { BLOCKED_HOSTS, ALLOWED_HOSTS, FORGE_HOSTS, OSS_DEMO_SUFFIXES };
