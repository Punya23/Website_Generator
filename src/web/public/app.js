const EXAMPLES = [
  {
    title: "Fitness studio",
    text: "2n Fitness — premium gym in Austin with cardio, yoga, zumba, and 24/7 access",
  },
  {
    title: "Law firm",
    text: "Hartwell & Associates — boutique litigation firm serving startups and founders",
  },
  {
    title: "Bakery",
    text: "Moonrise Bakery — artisan sourdough and pastries, organic ingredients, Brooklyn",
  },
  {
    title: "Dental clinic",
    text: "ClearSmile Dental — family dentistry, cosmetic whitening, same-week appointments",
  },
  {
    title: "Pet grooming",
    text: "Paws & Co — mobile dog grooming, spa packages, gentle care for anxious pets",
  },
  {
    title: "Architecture",
    text: "Linea Studio — sustainable residential architecture, passive house certified",
  },
];

const PIPELINE_STEPS = [
  { id: "brief", match: /expanding brief|starting generation/i },
  { id: "plan", match: /planning site|site plan/i },
  { id: "design", match: /design system|skin:/i },
  { id: "content", match: /copy|props \(|section fill|unified section/i },
  { id: "media", match: /image providers|openverse|pexels|media curator|uploading images/i },
  { id: "build", match: /output mode|next\.js|static export|preview:/i },
  { id: "ready", match: /^complete|completed with warnings/i },
];

const RECENT_KEY = "wg-recent-briefs";

const briefEl = document.getElementById("brief");
const seedEl = document.getElementById("variation-seed");
const consumerEl = document.getElementById("consumer-id");
const logoFileEl = document.getElementById("logo-file");
const photoFilesEl = document.getElementById("photo-files");
const mediaStatusEl = document.getElementById("media-status");
const terminalEl = document.getElementById("terminal");
const generateBtn = document.getElementById("generate");
const revisePanel = document.getElementById("revise-panel");
const reviseThread = document.getElementById("revise-thread");
const reviseInput = document.getElementById("revise-input");
const reviseBtn = document.getElementById("revise-btn");
const spinnerEl = document.querySelector(".btn-spinner");
const previewPanel = document.getElementById("preview-panel");
const editorPanel = document.getElementById("editor-panel");
const logPanel = document.getElementById("log-panel");
const previewFrame = document.getElementById("preview");
const previewTitle = document.getElementById("preview-title");
const openTab = document.getElementById("open-tab");
const examplesEl = document.getElementById("examples");
const clearLogBtn = document.getElementById("clear-log");
const sectionList = document.getElementById("section-list");
const editorPageLabel = document.getElementById("editor-page-label");
const themeAccent = document.getElementById("theme-accent");
const themeBg = document.getElementById("theme-bg");
const themeHeadingFont = document.getElementById("theme-heading-font");
const themeMotion = document.getElementById("theme-motion");
const applyThemeBtn = document.getElementById("apply-theme");
const useLastSeedBtn = document.getElementById("use-last-seed");
const copySeedBtn = document.getElementById("copy-seed");
const statusChip = document.getElementById("status-chip");
const emptyPreview = document.getElementById("empty-preview");
const stageFrame = document.getElementById("stage-frame");
const pageTabs = document.getElementById("page-tabs");
const recentWrap = document.getElementById("recent-wrap");
const recentBriefsEl = document.getElementById("recent-briefs");
const publishBtn = document.getElementById("publish-btn");
const logoThumbs = document.getElementById("logo-thumbs");
const photoThumbs = document.getElementById("photo-thumbs");

let abortController = null;
let editorState = null;
let activePageSlug = "home";
let lastVariationSeed = null;
let lastSiteSlug = null;
let lastPreviewBase = "/preview/";

function consumerId() {
  const typed = consumerEl?.value?.trim();
  if (typed) {
    try {
      localStorage.setItem("wg-consumer-id", typed);
    } catch {
      /* ignore */
    }
    return typed;
  }
  try {
    const stored = localStorage.getItem("wg-consumer-id");
    if (stored) {
      if (consumerEl && !consumerEl.value) consumerEl.placeholder = stored;
      return stored;
    }
    const created =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `c-${Date.now()}`;
    localStorage.setItem("wg-consumer-id", created);
    if (consumerEl) consumerEl.placeholder = created;
    return created;
  } catch {
    return undefined;
  }
}

if (consumerEl) {
  try {
    const stored = localStorage.getItem("wg-consumer-id");
    if (stored) consumerEl.placeholder = stored;
  } catch {
    /* ignore */
  }
}

function setStatus(text, kind = "") {
  if (!statusChip) return;
  statusChip.textContent = text;
  statusChip.className = `status-chip ${kind}`.trim();
}

function setStep(id, error = false) {
  const items = [...document.querySelectorAll("#pipeline-steps [data-step]")];
  const index = items.findIndex((el) => el.dataset.step === id);
  items.forEach((el, i) => {
    el.classList.remove("active", "done", "error");
    if (error && i === index) el.classList.add("error");
    else if (i < index) el.classList.add("done");
    else if (i === index) el.classList.add("active");
  });
}

function resetSteps() {
  document.querySelectorAll("#pipeline-steps [data-step]").forEach((el) => {
    el.classList.remove("active", "done", "error");
  });
}

function advanceStepFromLog(line) {
  const hit = [...PIPELINE_STEPS].reverse().find((step) => step.match.test(line));
  if (hit) setStep(hit.id);
}

function setWorkspace(name) {
  document.querySelectorAll("[data-workspace]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.workspace === name);
  });
  previewPanel.hidden = name !== "preview";
  editorPanel.hidden = name !== "editor";
  if (logPanel) logPanel.hidden = name !== "log";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}`));
    };
    img.src = url;
  });
}

async function fileToPayload(file, { logo = false } = {}) {
  const maxEdge = logo ? 800 : 1600;
  const img = await loadImage(file);
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const buffer = await file.arrayBuffer();
    return { name: file.name, mime: file.type, data: arrayBufferToBase64(buffer) };
  }
  ctx.drawImage(img, 0, 0, width, height);
  const mime = logo && file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, logo ? 0.92 : 0.82));
  const buffer = await (blob ?? file).arrayBuffer();
  return {
    name: file.name,
    mime: blob ? mime : file.type,
    data: arrayBufferToBase64(buffer),
  };
}

function renderThumbs(container, files) {
  if (!container) return;
  container.innerHTML = "";
  [...files].slice(0, 8).forEach((file) => {
    const img = document.createElement("img");
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    container.appendChild(img);
  });
}

function updateMediaStatus() {
  if (!mediaStatusEl) return;
  const logo = logoFileEl?.files?.[0];
  const photos = [...(photoFilesEl?.files ?? [])].slice(0, 8);
  renderThumbs(logoThumbs, logo ? [logo] : []);
  renderThumbs(photoThumbs, photos);
  if (!logo && photos.length === 0) {
    mediaStatusEl.textContent =
      "Your files go on the site first. Empty slots use Openverse (CC0).";
    return;
  }
  const bits = [];
  if (logo) bits.push("1 logo");
  if (photos.length) bits.push(`${photos.length} photo${photos.length === 1 ? "" : "s"}`);
  mediaStatusEl.textContent = `${bits.join(" + ")} will be used first; stock fills the rest.`;
}

function bindDrop(dropEl, inputEl) {
  if (!dropEl || !inputEl) return;
  dropEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropEl.classList.add("active");
  });
  dropEl.addEventListener("dragleave", () => dropEl.classList.remove("active"));
  dropEl.addEventListener("drop", (e) => {
    e.preventDefault();
    dropEl.classList.remove("active");
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const transfer = new DataTransfer();
    const multiple = inputEl.multiple;
    [...files].slice(0, multiple ? 8 : 1).forEach((file) => transfer.items.add(file));
    inputEl.files = transfer.files;
    updateMediaStatus();
  });
}

logoFileEl?.addEventListener("change", updateMediaStatus);
photoFilesEl?.addEventListener("change", updateMediaStatus);
bindDrop(document.getElementById("logo-drop"), logoFileEl);
bindDrop(document.getElementById("photo-drop"), photoFilesEl);

async function uploadSelectedMedia() {
  const logoFile = logoFileEl?.files?.[0];
  const photoFiles = [...(photoFilesEl?.files ?? [])].slice(0, 8);
  if (!logoFile && photoFiles.length === 0) return undefined;
  appendLog("Uploading images…");
  const body = {
    logo: logoFile ? await fileToPayload(logoFile, { logo: true }) : undefined,
    photos: [],
  };
  for (const file of photoFiles) {
    body.photos.push(await fileToPayload(file));
  }
  const res = await fetch("/api/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error ?? "Image upload failed");
  appendLog(`Saved ${payload.logo ? "logo + " : ""}${payload.photos} photo(s)`);
  return payload.mediaId;
}

function appendLog(line, isError = false) {
  const idle = terminalEl.querySelector(".terminal-idle");
  if (idle) idle.remove();
  const span = document.createElement("span");
  span.className = isError ? "err" : "";
  span.textContent = line + "\n";
  terminalEl.appendChild(span);
  terminalEl.scrollTop = terminalEl.scrollHeight;
  if (isError) setStep("build", true);
  else advanceStepFromLog(line);
}

function setLoading(on) {
  generateBtn.disabled = on;
  spinnerEl.hidden = !on;
}

function renderExamples() {
  EXAMPLES.forEach((ex) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "example-chip";
    btn.textContent = ex.title;
    btn.title = ex.text;
    btn.addEventListener("click", () => {
      briefEl.value = ex.text;
      briefEl.focus();
    });
    examplesEl.appendChild(btn);
  });
}

function loadRecentBriefs() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function rememberBrief(text) {
  const next = [text, ...loadRecentBriefs().filter((item) => item !== text)].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  renderRecentBriefs();
}

function renderRecentBriefs() {
  const items = loadRecentBriefs();
  if (!recentWrap || !recentBriefsEl) return;
  recentWrap.hidden = items.length === 0;
  recentBriefsEl.innerHTML = "";
  items.forEach((text) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text.slice(0, 42) + (text.length > 42 ? "…" : "");
    btn.title = text;
    btn.addEventListener("click", () => {
      briefEl.value = text;
      briefEl.focus();
    });
    recentBriefsEl.appendChild(btn);
  });
}

function showLastSeedButton(seed) {
  if (seed == null) return;
  lastVariationSeed = seed;
  if (useLastSeedBtn) {
    useLastSeedBtn.hidden = false;
    useLastSeedBtn.textContent = String(seed);
  }
  if (copySeedBtn) copySeedBtn.hidden = false;
}

function previewUrlForPage(slug) {
  if (/^https?:/i.test(lastPreviewBase)) {
    const base = lastPreviewBase.replace(/\/$/, "");
    return slug === "home" ? `${lastPreviewBase}` : `${base}/${slug}`;
  }
  if (slug === "home") return "/preview/index.html";
  return `/preview/${slug}`;
}

function refreshPreview(url) {
  const sep = url.includes("?") ? "&" : "?";
  if (emptyPreview) emptyPreview.hidden = true;
  if (stageFrame) stageFrame.hidden = false;
  previewFrame.src = url + sep + "t=" + Date.now();
  openTab.href = url;
}

function renderPageTabs(pages = []) {
  if (!pageTabs) return;
  const slugs = pages.length ? pages : ["home"];
  pageTabs.hidden = pages.length === 0;
  pageTabs.innerHTML = "";
  slugs.forEach((slug) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = slug;
    btn.classList.toggle("active", slug === activePageSlug);
    btn.addEventListener("click", () => {
      activePageSlug = slug;
      pageTabs.querySelectorAll("button").forEach((el) => el.classList.toggle("active", el === btn));
      refreshPreview(previewUrlForPage(slug));
      if (editorState) {
        editorPageLabel.textContent = `(${activePageSlug})`;
        renderSectionList();
      }
    });
    pageTabs.appendChild(btn);
  });
}

async function loadEditorSession() {
  const res = await fetch("/api/session");
  if (!res.ok) return;
  editorState = await res.json();
  editorPageLabel.textContent = `(${activePageSlug})`;
  populateThemeControls();
  renderSectionList();
}

function populateThemeControls() {
  if (!editorState?.designSystem) return;
  const ds = editorState.designSystem;
  themeAccent.value = ds.colors?.accent ?? "#000000";
  themeBg.value = ds.colors?.bg ?? "#ffffff";
  themeHeadingFont.value = ds.fontHeading ?? "Inter";
  themeMotion.value = ds.motionPreset ?? "stagger";
}

function renderSectionList() {
  sectionList.innerHTML = "";
  const page = editorState?.pages?.find((p) => p.slug === activePageSlug);
  if (!page) return;

  page.sections.forEach((section, index) => {
    const li = document.createElement("li");
    li.draggable = true;
    li.dataset.sectionId = section.id;
    li.innerHTML = `
      <div class="section-meta">
        <strong>${section.id}</strong>
        <small>${section.archetype ?? section.intent} · ${section.blockCount} blocks</small>
      </div>
      <div class="section-actions">
        <button type="button" data-action="up" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-action="down" ${index === page.sections.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" data-action="regen">Regen</button>
      </div>`;

    li.addEventListener("dragstart", () => li.classList.add("dragging"));
    li.addEventListener("dragend", () => li.classList.remove("dragging"));
    li.querySelector('[data-action="regen"]')?.addEventListener("click", () =>
      regenerateSection(section.id)
    );
    li.querySelector('[data-action="up"]')?.addEventListener("click", () =>
      reorderSection(index, index - 1)
    );
    li.querySelector('[data-action="down"]')?.addEventListener("click", () =>
      reorderSection(index, index + 1)
    );

    sectionList.appendChild(li);
  });

  enableDragReorder(page);
}

function enableDragReorder(page) {
  let dragId = null;
  sectionList.querySelectorAll("li").forEach((li) => {
    li.addEventListener("dragstart", () => {
      dragId = li.dataset.sectionId;
    });
    li.addEventListener("dragover", (e) => e.preventDefault());
    li.addEventListener("drop", async (e) => {
      e.preventDefault();
      const targetId = li.dataset.sectionId;
      if (!dragId || dragId === targetId) return;
      const ids = page.sections.map((s) => s.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return;
      ids.splice(from, 1);
      ids.splice(to, 0, dragId);
      await persistSectionOrder(ids);
    });
  });
}

async function persistSectionOrder(sectionIds) {
  const res = await fetch("/api/sections/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageSlug: activePageSlug, sectionIds }),
  });
  if (!res.ok) {
    appendLog(await res.text(), true);
    return;
  }
  await loadEditorSession();
  refreshPreview(previewUrlForPage(activePageSlug));
  appendLog(`Reordered sections on ${activePageSlug}`);
}

async function reorderSection(from, to) {
  const page = editorState?.pages?.find((p) => p.slug === activePageSlug);
  if (!page || to < 0 || to >= page.sections.length) return;
  const ids = page.sections.map((s) => s.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  await persistSectionOrder(ids);
}

async function regenerateSection(sectionId) {
  appendLog(`Regenerating ${activePageSlug}/${sectionId}…`);
  const res = await fetch(`/api/sections/${sectionId}/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageSlug: activePageSlug }),
  });
  if (!res.ok) {
    appendLog((await res.json()).error ?? "Regenerate failed", true);
    return;
  }
  await loadEditorSession();
  refreshPreview(previewUrlForPage(activePageSlug));
  appendLog(`Regenerated ${sectionId}`);
}

applyThemeBtn?.addEventListener("click", async () => {
  const res = await fetch("/api/theme", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fontHeading: themeHeadingFont.value,
      motionPreset: themeMotion.value,
      colors: {
        accent: themeAccent.value,
        bg: themeBg.value,
      },
    }),
  });
  if (!res.ok) {
    appendLog("Theme update failed", true);
    return;
  }
  await loadEditorSession();
  refreshPreview(previewUrlForPage(activePageSlug));
  appendLog("Theme updated");
});

async function generate() {
  const brief = briefEl.value.trim();
  if (!brief) {
    appendLog("Enter a short description of your business.", true);
    setWorkspace("log");
    return;
  }

  if (abortController) abortController.abort();
  abortController = new AbortController();

  setLoading(true);
  setWorkspace("preview");
  rememberBrief(brief);
  resetSteps();
  setStep("brief");
  setStatus("Generating", "running");
  if (emptyPreview) {
    emptyPreview.hidden = false;
    emptyPreview.querySelector(".empty-title").textContent = "Generating…";
    emptyPreview.querySelector(".empty-copy").textContent =
      "Brief, structure, design, copy, images, then build. Activity is in the log tab.";
  }
  if (stageFrame) stageFrame.hidden = true;
  editorPanel.hidden = true;
  if (publishBtn) publishBtn.hidden = true;
  if (revisePanel) revisePanel.hidden = true;
  if (reviseThread) reviseThread.innerHTML = "";
  appendLog("—".repeat(48));
  appendLog(`Starting generation…`);

  try {
    const seedRaw = seedEl?.value?.trim();
    const body = { brief, consumerId: consumerId() };
    if (seedRaw) {
      const parsed = Number(seedRaw);
      if (!Number.isFinite(parsed)) {
        appendLog("Style code must be a number, or leave the field empty.", true);
        setLoading(false);
        setStatus("Idle");
        return;
      }
      body.variationSeed = parsed;
    }

    const mediaId = await uploadSelectedMedia();
    if (mediaId) body.mediaId = mediaId;

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const json = JSON.parse(line.slice(5).trim());
        if (json.type === "log") appendLog(json.line);
        if (json.type === "error") {
          appendLog(json.message, true);
          setStatus("Failed", "error");
          setWorkspace("log");
          if (emptyPreview) {
            emptyPreview.hidden = false;
            emptyPreview.querySelector(".empty-title").textContent = "Generation failed";
            emptyPreview.querySelector(".empty-copy").textContent =
              "Open the Activity tab for the error, then try again.";
          }
        }
        if (json.type === "done" || json.type === "degraded") {
          const degraded = json.type === "degraded" || json.degraded;
          if (json.variationSeed != null) {
            showLastSeedButton(json.variationSeed);
            if (seedEl && !seedEl.value.trim()) {
              seedEl.placeholder = String(json.variationSeed);
            }
          }
          appendLog(
            `${degraded ? "Completed with warnings" : "Complete"} · ${(json.timingMs / 1000).toFixed(1)}s · ${json.pages?.length ?? 0} pages`,
            degraded
          );
          if (json.skinId) {
            appendLog(`Skin: ${json.skinName ? `${json.skinName} (${json.skinId})` : json.skinId}`);
          }
          if (json.variationSeed != null) {
            appendLog(`Style code ${json.variationSeed} — retain to reproduce this composition`);
          }
          if (json.siteSlug) {
            lastSiteSlug = json.siteSlug;
            appendLog(`Site slug: ${json.siteSlug}`);
            if (publishBtn) publishBtn.hidden = false;
          }
          if (json.outBytes != null) {
            const kb = (json.outBytes / 1024).toFixed(1);
            appendLog(`Static export: ${kb} KB`);
          }
          if (json.publishedUrl) {
            appendLog(`Published: ${json.publishedUrl}`);
          }
          if (json.previewSource === "live-server") {
            appendLog(`Preview: ${json.previewUrl} (built Next.js app)`);
          } else if (json.previewSource === "html-fallback") {
            appendLog("Preview: HTML fallback (Next build unavailable)");
            if (json.outputMode === "react" && json.buildSucceeded === false) {
              appendLog(
                "Debug: output/_playground-react — run npm run build there to inspect errors",
                true
              );
            }
          }
          previewTitle.textContent = json.businessName ?? "Preview";
          lastPreviewBase = json.previewUrl ?? "/preview/";
          activePageSlug = "home";
          renderPageTabs(json.pages ?? []);
          refreshPreview(previewUrlForPage("home"));
          setStep("ready");
          setStatus(degraded ? "Ready (warnings)" : "Ready", degraded ? "error" : "done");
          setWorkspace("preview");
          if (json.editorReady) await loadEditorSession();
          if (revisePanel) revisePanel.hidden = false;
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      const msg = err.message ?? String(err);
      setStatus("Failed", "error");
      setWorkspace("log");
      if (emptyPreview) {
        emptyPreview.hidden = false;
        emptyPreview.querySelector(".empty-title").textContent = "Generation failed";
        emptyPreview.querySelector(".empty-copy").textContent =
          "Open the Activity tab for the error, then try again.";
      }
      if (/network|failed to fetch/i.test(msg)) {
        appendLog(
          "Lost connection to the playground server. Keep `npm run playground` running in your terminal and try again.",
          true
        );
      } else {
        appendLog(msg, true);
      }
    }
  } finally {
    setLoading(false);
  }
}

function pushReviseMessage(role, text, extraClass = "") {
  if (!reviseThread || !text) return;
  const el = document.createElement("div");
  el.className = `revise-msg ${role} ${extraClass}`.trim();
  el.textContent = text;
  reviseThread.appendChild(el);
  reviseThread.scrollTop = reviseThread.scrollHeight;
}

async function reviseSite() {
  const message = reviseInput?.value?.trim();
  if (!message) {
    appendLog("Describe a revision first.", true);
    return;
  }
  if (abortController) abortController.abort();
  abortController = new AbortController();
  reviseInput.value = "";
  pushReviseMessage("user", message);
  if (reviseBtn) reviseBtn.disabled = true;
  setStatus("Revising", "running");
  appendLog(`Revision: ${message}`);

  try {
    const res = await fetch("/api/revise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal: abortController.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const json = JSON.parse(line.slice(5).trim());
        if (json.type === "log") appendLog(json.line);
        if (json.type === "status") appendLog(`Revision ${json.message}`);
        if (json.type === "error") {
          pushReviseMessage("assistant", json.message, "refuse");
          appendLog(json.message, true);
          setStatus("Ready", "done");
        }
        if (json.type === "done") {
          const reply = json.refused
            ? json.reason ?? json.summary
            : json.summary;
          pushReviseMessage("assistant", reply, json.refused ? "refuse" : "");
          if (json.previewUrl) lastPreviewBase = json.previewUrl;
          if (json.pages?.length) renderPageTabs(json.pages);
          refreshPreview(previewUrlForPage(activePageSlug));
          await loadEditorSession();
          setStatus(json.refused ? "Ready" : "Ready", json.refused ? "error" : "done");
          appendLog(json.refused ? `Refused: ${reply}` : `Revised: ${json.summary}`);
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      pushReviseMessage("assistant", err.message ?? String(err), "refuse");
      appendLog(err.message ?? String(err), true);
      setStatus("Ready", "done");
    }
  } finally {
    if (reviseBtn) reviseBtn.disabled = false;
  }
}

generateBtn.addEventListener("click", generate);
reviseBtn?.addEventListener("click", () => reviseSite());
reviseInput?.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    reviseSite();
  }
});
clearLogBtn.addEventListener("click", () => {
  terminalEl.innerHTML = '<span class="terminal-idle">Awaiting your brief.</span>';
});

document.querySelectorAll("[data-workspace]").forEach((btn) => {
  btn.addEventListener("click", () => setWorkspace(btn.dataset.workspace));
});

document.querySelectorAll(".device-toggle [data-device]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".device-toggle [data-device]").forEach((el) => {
      el.classList.toggle("active", el === btn);
    });
    if (stageFrame) stageFrame.dataset.device = btn.dataset.device;
  });
});

copySeedBtn?.addEventListener("click", async () => {
  const value = seedEl?.value?.trim() || lastVariationSeed;
  if (value == null) return;
  try {
    await navigator.clipboard.writeText(String(value));
    copySeedBtn.textContent = "Copied";
    setTimeout(() => {
      copySeedBtn.textContent = "Copy";
    }, 1200);
  } catch {
    /* ignore */
  }
});

publishBtn?.addEventListener("click", async () => {
  if (!lastSiteSlug) return;
  publishBtn.disabled = true;
  appendLog(`Publishing ${lastSiteSlug}…`);
  setWorkspace("log");
  try {
    const res = await fetch(`/api/sites/${encodeURIComponent(lastSiteSlug)}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error ?? "Publish failed");
    appendLog(payload.publishedUrl ? `Published: ${payload.publishedUrl}` : "Published");
  } catch (err) {
    appendLog(err.message ?? String(err), true);
  } finally {
    publishBtn.disabled = false;
  }
});

useLastSeedBtn?.addEventListener("click", () => {
  if (lastVariationSeed != null && seedEl) {
    seedEl.value = String(lastVariationSeed);
    document.getElementById("seed-panel")?.setAttribute("open", "");
    seedEl.focus();
  }
});
briefEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
});

renderExamples();
renderRecentBriefs();
setWorkspace("preview");
