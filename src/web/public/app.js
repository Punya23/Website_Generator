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

const briefEl = document.getElementById("brief");
const seedEl = document.getElementById("variation-seed");
const terminalEl = document.getElementById("terminal");
const generateBtn = document.getElementById("generate");
const spinnerEl = document.querySelector(".btn-spinner");
const previewPanel = document.getElementById("preview-panel");
const editorPanel = document.getElementById("editor-panel");
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

let abortController = null;
let editorState = null;
let activePageSlug = "home";
let lastVariationSeed = null;

function appendLog(line, isError = false) {
  const idle = terminalEl.querySelector(".terminal-idle");
  if (idle) idle.remove();
  const span = document.createElement("span");
  span.className = isError ? "err" : "";
  span.textContent = line + "\n";
  terminalEl.appendChild(span);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

function setLoading(on) {
  generateBtn.disabled = on;
  spinnerEl.hidden = !on;
}

function renderExamples() {
  for (const ex of EXAMPLES) {
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
  }
}

function refreshPreview(url) {
  const sep = url.includes("?") ? "&" : "?";
  previewFrame.src = url + sep + "t=" + Date.now();
  openTab.href = url;
}

async function loadEditorSession() {
  const res = await fetch("/api/session");
  if (!res.ok) return;
  editorState = await res.json();
  editorPanel.hidden = false;
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
  refreshPreview("/preview/index.html");
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
  refreshPreview("/preview/index.html");
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
  refreshPreview("/preview/index.html");
  appendLog("Theme updated");
});

async function generate() {
  const brief = briefEl.value.trim();
  if (!brief) {
    appendLog("Enter a short description of your business.", true);
    return;
  }

  if (abortController) abortController.abort();
  abortController = new AbortController();

  setLoading(true);
  previewPanel.hidden = true;
  editorPanel.hidden = true;
  appendLog("—".repeat(48));
  appendLog(`Starting generation…`);

  try {
    const seedRaw = seedEl?.value?.trim();
    const body = { brief };
    if (seedRaw) {
      const parsed = Number(seedRaw);
      if (!Number.isFinite(parsed)) {
        appendLog("Variation seed must be a number.", true);
        setLoading(false);
        return;
      }
      body.variationSeed = parsed;
    }

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
        if (json.type === "error") appendLog(json.message, true);
        if (json.type === "done" || json.type === "degraded") {
          const degraded = json.type === "degraded" || json.degraded;
          if (json.variationSeed != null) {
            lastVariationSeed = json.variationSeed;
            if (seedEl && !seedEl.value) seedEl.placeholder = String(json.variationSeed);
          }
          appendLog(
            `${degraded ? "Degraded" : "Done"} in ${(json.timingMs / 1000).toFixed(1)}s — ${json.pages?.length ?? 0} pages`,
            degraded
          );
          if (json.verticalProfileId || json.variationSeed != null) {
            appendLog(
              `Profile: ${json.verticalProfileId ?? "—"} · seed: ${json.variationSeed ?? "—"}`
            );
          }
          if (json.siteSlug) {
            appendLog(`Site slug: ${json.siteSlug}`);
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
          const url = (json.previewUrl ?? "/preview/index.html") + "?t=" + Date.now();
          refreshPreview(url);
          previewPanel.hidden = false;
          previewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
          if (json.editorReady) await loadEditorSession();
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      const msg = err.message ?? String(err);
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

generateBtn.addEventListener("click", generate);
clearLogBtn.addEventListener("click", () => {
  terminalEl.innerHTML = '<span class="terminal-idle">Waiting for your brief…</span>';
});
briefEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generate();
});

renderExamples();
