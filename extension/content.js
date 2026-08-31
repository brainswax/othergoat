/**
 * Classic content script (not an ES module). Chrome often fails to inject
 * `"type": "module"` content scripts that statically import siblings; load
 * extract.js via dynamic import + web_accessible_resources instead.
 */

const DEBOUNCE_MS = 800;
const PAUSED_KEY = "paused";
const SETTINGS_KEY = "settings";
const PANEL_ID = "ogr-page-host";
const MINIMIZED_KEY = "pinnedMinimized";

const ICON_PAUSE =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="0.5" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="0.5" fill="currentColor"/></svg>';
const ICON_PLAY =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5 2.7v10.6L13.2 8z"/></svg>';

const ICON_MIN =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M3.5 8h9"/></svg>';
const ICON_MAX =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.25"/></svg>';

function createPagePanel() {
  const existing = document.getElementById(PANEL_ID);
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = PANEL_ID;
  host.style.cssText = [
    "all: initial",
    "position: fixed",
    "top: 38px",
    "right: 12px",
    "z-index: 2147483647",
  ].join(";");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      @media print { .card { display: none !important; } }
      .card {
        width: 400px;
        max-width: calc(100vw - 24px);
        background: Canvas;
        color: CanvasText;
        border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
        border-radius: 10px;
        box-shadow: 0 2px 14px color-mix(in srgb, CanvasText 22%, transparent);
        font: 12px/1.2 system-ui, sans-serif;
        color-scheme: light dark;
        overflow: hidden;
      }
      .card[data-minimized="true"] {
        width: auto;
        border-radius: 999px;
      }
      .chrome {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px 6px 12px;
        border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
        cursor: default;
      }
      .card[data-minimized="true"] .chrome { border-bottom: 0; }
      .title { flex: 1; font-weight: 600; white-space: nowrap; }
      .label { white-space: nowrap; }
      .card[data-paused="true"] .label { opacity: 0.75; }
      .chrome button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: color-mix(in srgb, CanvasText 8%, transparent);
        color: inherit;
        cursor: pointer;
      }
      .chrome button:hover, .chrome button:focus-visible {
        background: color-mix(in srgb, CanvasText 16%, transparent);
      }
      .card[data-minimized="true"] iframe { display: none; }
      iframe {
        display: block;
        width: 400px;
        height: 520px;
        max-width: 100%;
        border: 0;
        background: Canvas;
      }
    </style>
    <div class="card" data-minimized="false" data-paused="true">
      <div class="chrome">
        <span class="title">Other Goats Records</span>
        <button type="button" class="min" aria-label="Minimize">${ICON_MIN}</button>
        <span class="label">Paused</span>
        <button type="button" class="pause" aria-label="Resume capture">${ICON_PLAY}</button>
      </div>
      <iframe title="Other Goats Records"></iframe>
    </div>
  `;
  const card = shadow.querySelector(".card");
  const minBtn = shadow.querySelector(".min");
  const pauseBtn = shadow.querySelector(".pause");
  const label = shadow.querySelector(".label");
  const frame = shadow.querySelector("iframe");
  frame.src = `${chrome.runtime.getURL("popup.html")}?docked=1`;
  minBtn.addEventListener("click", () => {
    const next = card.dataset.minimized !== "true";
    chrome.storage.local.set({ [MINIMIZED_KEY]: next });
  });
  shadow.querySelector(".title").addEventListener("click", () => {
    if (card.dataset.minimized === "true") {
      chrome.storage.local.set({ [MINIMIZED_KEY]: false });
    }
  });
  pauseBtn.addEventListener("click", () => {
    chrome.storage.local.set({
      [PAUSED_KEY]: card.dataset.paused !== "true",
    });
  });

  const mount = () => {
    if (!host.isConnected) document.documentElement.appendChild(host);
  };

  return {
    host,
    mount,
    render({ minimized, paused }) {
      mount();
      card.dataset.minimized = minimized ? "true" : "false";
      card.dataset.paused = paused ? "true" : "false";
      label.textContent = paused ? "Paused" : "Capturing";
      pauseBtn.setAttribute(
        "aria-label",
        paused ? "Resume capture" : "Pause capture",
      );
      pauseBtn.innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
      minBtn.setAttribute("aria-label", minimized ? "Expand" : "Minimize");
      minBtn.innerHTML = minimized ? ICON_MAX : ICON_MIN;
    },
  };
}

function startPagePanel() {
  const panel = createPagePanel();
  let minimized = false;
  let paused = true;
  const apply = () => panel.render({ minimized, paused });
  chrome.storage.local.get([MINIMIZED_KEY, PAUSED_KEY], (data) => {
    minimized = Boolean(data[MINIMIZED_KEY]);
    paused = Boolean(data[PAUSED_KEY]);
    apply();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[MINIMIZED_KEY]) {
      minimized = Boolean(changes[MINIMIZED_KEY].newValue);
    }
    if (changes[PAUSED_KEY]) paused = Boolean(changes[PAUSED_KEY].newValue);
    if (changes[MINIMIZED_KEY] || changes[PAUSED_KEY]) apply();
  });
  apply();
  return panel;
}

function nowIso() {
  return new Date().toISOString();
}

function batchKey(batch) {
  if (!batch) return "";
  const subject =
    batch.individuals?.[0]?.registration_number ||
    batch.pti?.[0]?.registration_number ||
    batch.linear?.[0]?.registration_number ||
    "";
  return [
    location.href,
    subject,
    batch.view,
    batch.individuals?.length ?? 0,
    batch.linear?.length ?? 0,
    batch.pti?.length ?? 0,
    batch.eventArgument,
  ].join("|");
}

function sendBatch(batch, remaining = 3) {
  try {
    chrome.runtime.sendMessage({ type: "CAPTURE_BATCH", batch }, () => {
      const err = chrome.runtime.lastError?.message ?? "";
      if (
        remaining > 0 &&
        /Receiving end does not exist|message port closed/i.test(err)
      ) {
        window.setTimeout(() => sendBatch(batch, remaining - 1), 250);
      }
    });
  } catch {
    if (remaining > 0) {
      window.setTimeout(() => sendBatch(batch, remaining - 1), 250);
    }
  }
}

function startCapture(extractFromDocument, normalizeSettings, pagePanel) {
  let lastKey = "";
  let lastAt = 0;
  let timer = 0;
  let attempts = 0;
  let paused = true;
  let settings = normalizeSettings({});
  let observer = null;

  const run = (fromRetry) => {
    if (paused) return;
    pagePanel.mount();
    let batch = null;
    try {
      batch = extractFromDocument(document, location.href, nowIso(), settings);
    } catch {
      batch = null;
    }
    if (!batch) {
      if (attempts < 12) {
        attempts += 1;
        window.setTimeout(() => run(true), 400);
      }
      return;
    }
    const hasData =
      (batch.individuals?.length ?? 0) +
        (batch.linear?.length ?? 0) +
        (batch.pti?.length ?? 0) >
      0;
    if (!hasData) {
      if (attempts < 12) {
        attempts += 1;
        window.setTimeout(() => run(true), 400);
      }
      return;
    }
    attempts = 0;
    const key = batchKey(batch);
    const t = Date.now();
    if (key === lastKey && t - lastAt < DEBOUNCE_MS) return;
    lastKey = key;
    lastAt = t;
    sendBatch(batch);
  };

  const schedule = (records) => {
    if (paused) return;
    if (
      records &&
      records.length > 0 &&
      records.every(
        (record) =>
          pagePanel.host.contains(record.target),
      )
    ) {
      return;
    }
    pagePanel.mount();
    attempts = 0;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => run(true), DEBOUNCE_MS);
  };

  const setPaused = (next) => {
    const wasPaused = paused;
    paused = next;
    if (paused) {
      window.clearTimeout(timer);
      attempts = 12;
      return;
    }
    if (wasPaused) {
      lastKey = "";
      attempts = 0;
      run(true);
    }
  };

  const recapture = (nextSettings) => {
    if (nextSettings) settings = normalizeSettings(nextSettings);
    lastKey = "";
    attempts = 0;
    if (!paused) run(true);
  };

  chrome.storage.local.get([PAUSED_KEY, SETTINGS_KEY], (data) => {
    settings = normalizeSettings(data[SETTINGS_KEY]);
    setPaused(Boolean(data[PAUSED_KEY]));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[SETTINGS_KEY]) {
      recapture(changes[SETTINGS_KEY].newValue);
    }
    if (changes[PAUSED_KEY]) {
      setPaused(Boolean(changes[PAUSED_KEY].newValue));
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "RECAPTURE") return;
    chrome.storage.local.get(SETTINGS_KEY, (data) => {
      recapture(data[SETTINGS_KEY]);
      sendResponse({ ok: true });
    });
    return true;
  });

  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

const pagePanel = startPagePanel();

function boot(remaining) {
  import(chrome.runtime.getURL("extract.js"))
    .then((mod) =>
      startCapture(mod.extractFromDocument, mod.normalizeSettings, pagePanel),
    )
    .catch(() => {
      if (remaining <= 0) return;
      window.setTimeout(() => boot(remaining - 1), 400);
    });
}

boot(8);
