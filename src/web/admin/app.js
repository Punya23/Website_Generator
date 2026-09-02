const TITLES = {
  overview: "Overview",
  templates: "Templates",
  sources: "Sources",
  queue: "Review queue",
  skins: "Live skins",
  runs: "Agent runs",
};

const PAGE_ORDER = ["home", "about", "services", "contact"];
const PHASES = ["discover", "scrape", "map", "approve"];

const QUEUE_FILTERS = [
  { id: "needs_review", label: "Needs review" },
  { id: "all", label: "All" },
  { id: "approved", label: "Approved" },
  { id: "blocked", label: "Blocked" },
  { id: "rejected", label: "Rejected" },
];

let view = "overview";
let selectedId = null;
let queueFilter = "needs_review";
const QUEUE_PAGE_SIZE = 200;
let queueRows = [];
let queueTotal = 0;
let searchQuery = "";
let cache = { sources: [], candidates: [], skins: { authored: [], approved: [] }, runs: [], templates: [] };
let trayPhase = null;

const $ = (id) => document.getElementById(id);

/** Images cannot carry an Authorization header, so a token given in the page URL is forwarded on
 *  the query string — the admin guard accepts either form. */
function withAdminToken(url) {
  const token = new URLSearchParams(location.search).get("token");
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

async function api(path, options = {}) {
  const res = await fetch(`/api/admin${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

function pill(status) {
  return `<span class="pill ${status}">${String(status).replace(/_/g, " ")}</span>`;
}

function showBanner(text, isError = false) {
  const el = $("banner");
  el.hidden = !text;
  el.textContent = text ?? "";
  el.classList.toggle("error", Boolean(isError));
}

function matchesSearch(...values) {
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  return values.some((value) => String(value ?? "").toLowerCase().includes(q));
}

function setView(next) {
  view = next;
  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === next);
  });
  $("page-title").textContent = TITLES[next];
  document.querySelectorAll(".view").forEach((section) => {
    section.hidden = section.id !== `view-${next}`;
  });
  refresh();
}

async function refresh() {
  try {
    await loadTray();
    if (view === "overview") await renderOverview();
    if (view === "templates") await renderTemplates();
    if (view === "sources") await renderSources();
    if (view === "queue") await renderQueue();
    if (view === "skins") await renderSkins();
    if (view === "runs") await renderRuns();
  } catch (err) {
    showBanner(err.message, true);
  }
}

function setProviderBadge(label) {
  const badge = $("llm-badge");
  const value = label || "none";
  badge.textContent = value;
  badge.classList.toggle("heuristic", value === "heuristic" || value === "none");
  badge.classList.toggle("none", value === "none");
}

function applyStats(stats = {}, phase, llmProvider) {
  const metrics = $("run-metrics");
  if (metrics) {
    for (const el of metrics.querySelectorAll("[data-k]")) {
      const key = el.dataset.k;
      const n = stats[key] ?? 0;
      const labels = {
        discovered: "discovered",
        scraped: "scraped",
        mapped: "mapped",
        autoApproved: "auto-approved",
        needsReview: "review",
        blocked: "blocked",
        skippedDup: "dupes",
      };
      el.textContent = `${n} ${labels[key] ?? key}`;
    }
  }
  if (llmProvider) setProviderBadge(llmProvider);
  if (phase) {
    trayPhase = phase;
    const idx = PHASES.indexOf(phase);
    $("run-phases")?.querySelectorAll("[data-phase]").forEach((chip) => {
      const i = PHASES.indexOf(chip.dataset.phase);
      chip.classList.toggle("active", chip.dataset.phase === phase);
      chip.classList.toggle("done", idx >= 0 && i >= 0 && i < idx);
    });
  }
}

async function loadTray() {
  try {
    const status = await api("/status");
    setProviderBadge(status.llmLabel ?? status.llm?.provider ?? "none");
    const last = (await api("/runs")).runs?.[0];
    if (last?.stats) applyStats(last.stats, last.status === "running" ? trayPhase : null, status.llmLabel);
  } catch {
    /* tray is best-effort */
  }
}

async function renderOverview() {
  const [data, queue, runs] = await Promise.all([
    api("/overview"),
    api("/candidates?status=needs_review&limit=50"),
    api("/runs"),
  ]);
  const by = data.byStatus ?? {};
  const inbox = queue.candidates ?? [];
  cache.candidates = queue.candidates ?? [];
  cache.runs = runs.runs ?? [];
  const last = (runs.runs ?? [])[0];
  const llm = data.llm ?? {};
  const keys = data.keys ?? {};
  const fallbacks = (llm.fallbacks ?? []).join(" → ") || "heuristic";
  $("view-overview").innerHTML = `
    <p class="muted">${escapeHtml(data.policy)}</p>
    <p class="muted">Auto-approve ${data.ingest?.autoApprove ?? data.autoApprove ? "on" : "off"} at confidence ≥ ${data.ingest?.minConfidence ?? data.minConfidence ?? 0.7}, max ${data.ingest?.maxPerRun ?? 250}/run. GitHub token ${data.githubToken ? "set" : "missing — discovery rate-limited"}.</p>
    <div class="cards">
      <div class="card clickable" data-jump="templates"><b>${data.templateCount ?? 0}</b><span>Section templates</span></div>
      <div class="card clickable" data-jump="skins"><b>${data.liveSkins ?? (data.authoredSkins + data.approvedSkins)}</b><span>Live skins</span></div>
      <div class="card clickable" data-jump="queue"><b>${by.needs_review ?? 0}</b><span>Review inbox</span></div>
      <div class="card clickable" data-jump="runs"><b>${last?.stats?.autoApproved ?? last?.stats?.ingested ?? 0}</b><span>Last run ${last ? `${last.status} · ${new Date(last.startedAt).toLocaleString()}` : "none"}</span></div>
      <div class="card">
        <b>${escapeHtml(data.llmLabel ?? llm.provider ?? "none")}</b>
        <span>LLM ${escapeHtml(llm.model ?? "—")}</span>
        ${llm.lastError ? `<span class="card-llm-error">${escapeHtml(llm.lastError)}</span>` : ""}
      </div>
      <div class="card"><b>${data.uniqueSignatures ?? 0}</b><span>Unique signatures</span></div>
    </div>
    <p class="muted">Fallbacks ${escapeHtml(fallbacks)}. Keys: Groq ${keys.groq ? "yes" : "no"} · Ollama ${keys.ollama ? "yes" : "no"} · Mistral ${keys.mistral ? "yes" : "no"} · OpenRouter ${keys.openrouter ? "yes" : "no"} · OpenAI ${keys.openai ? "yes" : "no"} · GitHub ${keys.github ? "yes" : "no"}.</p>
    <div class="panel">
      <h3 style="margin-top:0">Review inbox</h3>
      ${
        inbox.length
          ? `<div class="inbox">${inbox
              .slice(0, 8)
              .map(
                (c) => `<div class="inbox-row" data-id="${c.id}">
                  <strong>${escapeHtml(c.title)}</strong>
                  <div class="meta">${pill(c.status)} · ${escapeHtml(c.licenseDetected ?? "license unknown")} · ${new Date(c.updatedAt).toLocaleString()}</div>
                </div>`
              )
              .join("")}</div>`
          : `<p class="empty">Nothing waiting. Discover GitHub templates or run ingest on a source.</p>`
      }
    </div>
    <h3>Latest agent runs</h3>
    ${runTable((runs.runs ?? []).slice(0, 5))}
  `;
  $("view-overview").querySelectorAll("[data-jump]").forEach((card) => {
    card.addEventListener("click", () => setView(card.dataset.jump));
  });
  $("view-overview").querySelectorAll("[data-id]").forEach((row) => {
    row.addEventListener("click", () => {
      setView("queue");
      openCandidate(row.dataset.id);
    });
  });
}

async function renderTemplates() {
  const data = await api("/templates");
  cache.templates = data.templates ?? [];
  const rows = cache.templates.filter((t) =>
    matchesSearch(t.id, t.name, t.description, t.landmark, (t.pages ?? []).join(" "))
  );
  $("view-templates").innerHTML = `
    <p class="muted">${data.count ?? rows.length} React section templates. Skins compose these blocks — we never clone source HTML.</p>
    <div class="template-grid">
      ${
        rows.length
          ? rows
              .map(
                (t) => `<article class="template-card">
                  <h3>${escapeHtml(t.name)}</h3>
                  <p class="meta"><code>${escapeHtml(t.id)}</code> · ${escapeHtml(t.landmark)}</p>
                  <p class="meta">${escapeHtml(t.description)}</p>
                  <p class="meta">Used in ${t.usedInSkins} skins · ${(t.pages ?? []).map(escapeHtml).join(", ")}</p>
                </article>`
              )
              .join("")
          : `<p class="empty">No templates match that filter.</p>`
      }
    </div>
  `;
}

async function renderSources() {
  const { sources } = await api("/sources");
  cache.sources = sources;
  const filtered = sources.filter((s) =>
    matchesSearch(s.name, s.originUrl, s.kind, s.expectedLicense, s.status)
  );
  $("view-sources").innerHTML = `
    <form class="form" id="source-form">
      <label>Name <input name="name" required placeholder="HyperUI" /></label>
      <label>Kind
        <select name="kind">
          <option value="github">GitHub</option>
          <option value="demo">Public demo</option>
          <option value="moodboard">Moodboard (no HTML ingest)</option>
        </select>
      </label>
      <label class="span-2">Origin URL <input name="originUrl" required placeholder="https://github.com/org/repo" /></label>
      <label class="span-2">Demo URL <input name="demoUrl" placeholder="https://example.github.io/demo/" /></label>
      <label>Default category
        <select name="defaultCategory">
          <option value="creative">creative</option>
          <option value="local-service">local-service</option>
          <option value="hospitality">hospitality</option>
          <option value="professional">professional</option>
        </select>
      </label>
      <label>Expected license
        <select name="expectedLicense">
          <option value="MIT">MIT</option>
          <option value="Apache-2.0">Apache-2.0</option>
          <option value="BSD-3-Clause">BSD-3-Clause</option>
          <option value="CC0-1.0">CC0-1.0</option>
        </select>
      </label>
      <div class="span-2"><button class="btn" type="submit">Add source</button></div>
    </form>
    <div class="source-grid">
      ${
        filtered.length
          ? filtered
              .map(
                (s) => `<article class="source-card">
                  <h3>${escapeHtml(s.name)} ${pill(s.status)}</h3>
                  <p class="meta">${escapeHtml(s.kind)} · ${escapeHtml(s.expectedLicense)} · ${escapeHtml(s.defaultCategory)}</p>
                  <p class="meta"><code>${escapeHtml(s.originUrl)}</code></p>
                  ${s.lastError ? `<p class="meta">${escapeHtml(s.lastError)}</p>` : ""}
                  <div class="card-actions">
                    <button class="btn-ghost" data-run="${s.id}">Run</button>
                    <button class="btn-ghost" data-toggle="${s.id}" data-status="${s.status}">${s.status === "paused" ? "Activate" : "Pause"}</button>
                  </div>
                </article>`
              )
              .join("")
          : `<p class="empty">No sources match that filter.</p>`
      }
    </div>
  `;
  $("view-sources").querySelector("#source-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const body = Object.fromEntries(form.entries());
    if (!body.demoUrl) delete body.demoUrl;
    try {
      await api("/sources", { method: "POST", body: JSON.stringify(body) });
      showBanner("Source added");
      renderSources();
    } catch (err) {
      showBanner(err.message, true);
    }
  });
  $("view-sources").querySelectorAll("[data-run]").forEach((btn) => {
    btn.addEventListener("click", () => runAgent({ sourceId: btn.dataset.run }));
  });
  $("view-sources").querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.dataset.status === "paused" ? "active" : "paused";
      await api(`/sources/${btn.dataset.toggle}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      showBanner(next === "paused" ? "Source paused" : "Source active");
      renderSources();
    });
  });
}

async function fetchQueuePage(offset) {
  // Status filtering happens server-side: the corpus can hold thousands of candidates, so the
  // client must never rely on receiving all of them and filtering locally.
  const query = new URLSearchParams({ limit: String(QUEUE_PAGE_SIZE), offset: String(offset) });
  if (queueFilter !== "all") query.set("status", queueFilter);
  return api(`/candidates?${query.toString()}`);
}

async function renderQueue(options = {}) {
  // `append` walks the offset forward and grows the accumulated row list — the earlier version
  // instead grew `limit` toward the server's CANDIDATE_PAGE_MAX (1000) and never sent `offset`,
  // so a filter holding more than 1000 rows had no way to reach anything past the first 1000: the
  // button kept re-requesting the same capped page forever. A reset (any filter change, or any
  // action that can change what matches the filter) starts over from offset 0.
  if (options.append) {
    const { candidates, total } = await fetchQueuePage(queueRows.length);
    queueRows = queueRows.concat(candidates);
    if (typeof total === "number") queueTotal = total;
  } else {
    const { candidates, total } = await fetchQueuePage(0);
    queueRows = candidates;
    queueTotal = typeof total === "number" ? total : candidates.length;
  }

  cache.candidates = queueRows;
  const rows = queueRows.filter((c) =>
    matchesSearch(c.title, c.originUrl, c.status, c.licenseDetected)
  );
  const truncated = queueRows.length < queueTotal;
  $("view-queue").innerHTML = `
    <div class="filters">
      ${QUEUE_FILTERS.map(
        (f) =>
          `<button type="button" data-filter="${f.id}" class="${queueFilter === f.id ? "active" : ""}">${f.label}</button>`
      ).join("")}
    </div>
    <div class="card-actions" style="margin:0 0 0.8rem">
      <button type="button" class="btn" id="bulk-approve">Approve selected</button>
      <button type="button" class="btn-ghost" id="bulk-reject">Reject selected</button>
      ${truncated ? `<button type="button" class="btn-ghost" id="queue-more">Load more (${queueRows.length} of ${queueTotal})</button>` : ""}
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th></th><th>Title</th><th>Origin</th><th>License</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (c) => `<tr data-id="${c.id}">
                      <td><input type="checkbox" data-select="${c.id}" ${c.status === "needs_review" ? "checked" : ""} /></td>
                      <td>${escapeHtml(c.title)}</td>
                      <td><code>${escapeHtml(c.originUrl)}</code></td>
                      <td>${escapeHtml(c.licenseDetected ?? "—")} ${c.licenseOk ? "✓" : ""}</td>
                      <td>${pill(c.status)}</td>
                      <td>${new Date(c.updatedAt).toLocaleString()}</td>
                    </tr>`
                  )
                  .join("")
              : `<tr><td colspan="6" class="empty">Queue is empty for this filter.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
  $("view-queue").querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      queueFilter = btn.dataset.filter;
      renderQueue();
    });
  });
  $("queue-more")?.addEventListener("click", () => {
    renderQueue({ append: true });
  });
  $("view-queue").querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("input")) return;
      openCandidate(row.dataset.id);
    });
  });
  $("bulk-approve")?.addEventListener("click", async () => {
    const ids = selectedQueueIds();
    if (!ids.length) return;
    try {
      const result = await api("/candidates/bulk-approve", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      showBanner(`Approved ${result.approved}${result.errors?.length ? ` · ${result.errors.length} skipped` : ""}`);
      renderQueue();
    } catch (err) {
      showBanner(err.message, true);
    }
  });
  $("bulk-reject")?.addEventListener("click", async () => {
    const ids = selectedQueueIds();
    if (!ids.length) return;
    const reason = prompt("Reject reason?") || "Bulk rejected";
    await api("/candidates/bulk-reject", {
      method: "POST",
      body: JSON.stringify({ ids, reason }),
    });
    showBanner("Rejected selected");
    renderQueue();
  });
}

function selectedQueueIds() {
  return [...document.querySelectorAll("#view-queue [data-select]:checked")].map((el) => el.dataset.select);
}

async function renderSkins() {
  const data = await api("/skins");
  cache.skins = data;
  $("view-skins").innerHTML = `
    <p class="muted">Authored skins ship with the generator. Approved ingest recipes become live skins the picker can choose.</p>
    <h3>Authored</h3>
    ${skinGrid(data.authored)}
    <h3>Approved from ingest</h3>
    ${skinGrid(data.approved)}
  `;
}

function wireframe(pages, chrome, family) {
  if (!pages) return "";
  const chromeLine =
    chrome || family
      ? `<p class="meta">${chrome ? `nav ${escapeHtml(chrome.navShape)} · footer ${escapeHtml(chrome.footerLayout)}` : ""}${family ? `${chrome ? " · " : ""}${escapeHtml(family)}` : ""}</p>`
      : "";
  const slugs = PAGE_ORDER.filter((slug) => pages[slug]?.length);
  const extra = Object.keys(pages).filter((slug) => !PAGE_ORDER.includes(slug) && pages[slug]?.length);
  const blocks = [...slugs, ...extra]
    .map((slug) => {
      const sections = pages[slug] ?? [];
      return `<div class="wire-page">
        <div class="wire-page-label">${escapeHtml(slug)}</div>
        ${sections
          .map(
            (s) =>
              `<div class="wire-block ${String(s.templateId).startsWith("hero") ? "hero" : ""}"><code>${escapeHtml(s.templateId)}</code> ${escapeHtml(s.intent ?? "")}</div>`
          )
          .join("")}
      </div>`;
    })
    .join("");
  return `${chromeLine}<div class="wire">${blocks}</div>`;
}

function pagesFromRecipe(recipe, draftSkin) {
  if (draftSkin?.pages) return draftSkin.pages;
  if (!recipe) return null;
  return { home: recipe.home ?? [] };
}

function skinGrid(rows) {
  const filtered = (rows ?? []).filter((s) =>
    matchesSearch(s.id, s.name, (s.categories ?? []).join(" "), s.inspiredBy, s.description)
  );
  if (!filtered.length) return `<p class="empty">None yet</p>`;
  return `<div class="skin-grid">${filtered
    .map(
      (s) => `<article class="skin-card">
        <h3>${escapeHtml(s.name)}</h3>
        <p class="meta"><code>${escapeHtml(s.id)}</code>${s.visualFamily ? ` · ${escapeHtml(s.visualFamily)}` : ""}</p>
        <p class="meta">${escapeHtml((s.categories ?? []).join(", "))}</p>
        ${s.description ? `<p class="meta">${escapeHtml(s.description)}</p>` : ""}
        <p class="meta">Inspired by ${escapeHtml(s.inspiredBy ?? "—")}</p>
        ${wireframe(s.pages, s.chrome, s.visualFamily)}
      </article>`
    )
    .join("")}</div>`;
}

async function renderRuns() {
  const { runs } = await api("/runs");
  cache.runs = runs;
  $("view-runs").innerHTML = runTable(
    runs.filter((r) => matchesSearch(r.status, r.error, r.sourceId))
  );
}

function runTable(runs) {
  if (!runs.length) return `<p class="empty">No agent runs yet.</p>`;
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>When</th><th>Status</th><th>Discovered</th><th>Scraped</th><th>Mapped</th><th>Auto</th><th>Review</th><th>Blocked</th></tr></thead>
    <tbody>
      ${runs
        .map(
          (r) => `<tr>
            <td>${new Date(r.startedAt).toLocaleString()}</td>
            <td>${pill(r.status)}</td>
            <td>${r.stats?.discovered ?? 0}</td>
            <td>${r.stats?.scraped ?? r.stats?.ingested ?? 0}</td>
            <td>${r.stats?.mapped ?? r.stats?.verified ?? 0}</td>
            <td>${r.stats?.autoApproved ?? 0}</td>
            <td>${r.stats?.needsReview ?? 0}</td>
            <td>${r.stats?.blocked ?? 0}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table></div>`;
}

function thumbnailName(featurePath) {
  const parts = String(featurePath ?? "").split("/");
  return parts[parts.length - 1] ?? "";
}

function themeFeaturesBlock(candidate) {
  const f = candidate.features;
  if (!f) {
    return `<h3>Theme render</h3><p class="muted">Not rendered — ${escapeHtml(candidate.featuresSkipped ?? "not needed")}</p>`;
  }
  // Only a literal hex ever reaches a style attribute — escaping alone would still let a stored
  // value smuggle extra CSS declarations in through a semicolon.
  const swatch = (label, hex) =>
    /^#[0-9a-f]{6}$/i.test(String(hex ?? ""))
      ? `<span class="meta"><span style="display:inline-block;width:.8rem;height:.8rem;border-radius:3px;border:1px solid rgba(128,128,128,.4);background:${hex};vertical-align:-1px"></span> ${label} ${hex}</span>`
      : "";
  const name = thumbnailName(f.thumbnailPath);
  return `
    <h3>Theme render</h3>
    ${
      name
        ? `<img class="theme-thumb" src="${escapeHtml(withAdminToken(`/api/admin/thumbs/${name}`))}" alt="Rendered demo of ${escapeHtml(candidate.title)}" loading="lazy" />
           <p class="muted">Internal review artifact — a demo page can contain third-party photos the template license does not cover. Never shipped in a generated site.</p>`
        : ""
    }
    <p class="meta">
      ${escapeHtml(f.visualFamily)} · ${escapeHtml(f.navShape)} · ${escapeHtml(f.footerLayout)} · ${escapeHtml(f.density)}
      · ${f.serifHeadings ? "serif" : "sans"} headings${f.headingFont ? ` (${escapeHtml(f.headingFont)})` : ""}
    </p>
    <p>${swatch("bg", f.backgroundHex)} ${swatch("accent", f.accentHex)}</p>
    <p class="muted">Mapped with <b>${escapeHtml(candidate.mappedWith ?? "heuristic")}</b>${f.conclusive ? " — measured, no mapping LLM call" : ""}</p>
  `;
}

async function openCandidate(id) {
  selectedId = id;
  const { candidate } = await api(`/candidates/${id}`);
  $("drawer").hidden = false;
  $("drawer-title").textContent = candidate.title;
  const events = candidate.events ?? [];
  const pages = pagesFromRecipe(candidate.recipe, candidate.draftSkin);
  $("drawer-body").innerHTML = `
    <p>${pill(candidate.status)} · license ${escapeHtml(candidate.licenseDetected ?? "unknown")} ${candidate.licenseOk ? "(verified)" : "(unverified)"}</p>
    <p class="muted">${escapeHtml(candidate.originUrl)}</p>
    ${candidate.blockedReason ? `<p class="muted">${escapeHtml(candidate.blockedReason)}</p>` : ""}
    <div class="actions">
      <button class="btn-ghost" id="do-verify">Re-verify</button>
      <button class="btn" id="do-approve">Approve as skin</button>
      <button class="btn-ghost" id="do-reject">Reject</button>
    </div>
    ${themeFeaturesBlock(candidate)}
    <h3>Recipe wireframe</h3>
    ${
      pages
        ? wireframe(pages, candidate.draftSkin?.chrome, candidate.draftSkin?.visualFamily)
        : `<p class="muted">No mapping yet</p>`
    }
    <h3>Agent log</h3>
    <pre>${escapeHtml(events.map((e) => `${e.level}: ${e.message}`).join("\n") || "—")}</pre>
    ${
      candidate.draftSkin
        ? `<h3>Draft skin</h3><p class="meta"><code>${escapeHtml(candidate.draftSkin.id)}</code> · ${escapeHtml(candidate.draftSkin.name)}</p>`
        : ""
    }
  `;
  $("do-verify").onclick = async () => {
    try {
      await api(`/candidates/${id}/verify`, { method: "POST", body: "{}" });
      openCandidate(id);
      refresh();
    } catch (err) {
      showBanner(err.message, true);
    }
  };
  $("do-approve").onclick = async () => {
    try {
      const result = await api(`/candidates/${id}/approve`, { method: "POST", body: "{}" });
      showBanner(`Approved ${result.skinId}. It is now a live generator skin.`);
      openCandidate(id);
      refresh();
    } catch (err) {
      showBanner(err.message, true);
    }
  };
  $("do-reject").onclick = async () => {
    const reason = prompt("Reject reason?") || "Rejected in dashboard";
    await api(`/candidates/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
    openCandidate(id);
    refresh();
  };
}

async function runAgent(options = {}) {
  const log = $("agent-log");
  log.hidden = false;
  log.textContent = options.discover ? "Discovering GitHub templates…\n" : "Starting agent…\n";
  applyStats({}, options.discover ? "discover" : "scrape");
  const res = await fetch("/api/admin/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceId: options.sourceId,
      discover: Boolean(options.discover),
    }),
  });
  if (!res.ok || !res.body) {
    showBanner("Agent failed to start", true);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.replace(/^data:\s*/, "");
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "stats") {
          applyStats(event.stats ?? {}, event.phase, event.llmProvider);
        }
        if (event.line) log.textContent += event.line + "\n";
        log.scrollTop = log.scrollHeight;
      } catch {
        /* ignore */
      }
    }
  }
  showBanner("Agent finished");
  refresh();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});
$("run-agent").addEventListener("click", () => runAgent());
$("discover-agent").addEventListener("click", () => runAgent({ discover: true }));
$("drawer-close").addEventListener("click", () => {
  $("drawer").hidden = true;
});
$("search").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  refresh();
});

refresh();
