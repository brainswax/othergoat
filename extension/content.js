/**
 * Classic content script (not an ES module). Chrome often fails to inject
 * `"type": "module"` content scripts that statically import siblings; load
 * extract.js via dynamic import + web_accessible_resources instead.
 */

const DEBOUNCE_MS = 800;
const PAUSED_KEY = "paused";
const SETTINGS_KEY = "settings";
const HOST_ID = "ogr-capture-host";

const ICON_PAUSE =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="0.5" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="0.5" fill="currentColor"/></svg>';
const ICON_PLAY =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5 2.7v10.6L13.2 8z"/></svg>';

function nowIso() {
  return new Date().toISOString();
}

function batchKey(batch) {
  if (!batch) return "";
  const subject = batch.individuals?.[0]?.registration_number ?? "";
  return [
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

function mountOverlay(onToggle) {
  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = [
    "all: initial",
    "position: fixed",
    "right: 12px",
    "bottom: 12px",
    "z-index: 2147483647",
  ].join(";");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      @media print { .bar { display: none !important; } }
      .bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px 6px 10px;
        border-radius: 999px;
        background: Canvas;
        color: CanvasText;
        border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
        box-shadow: 0 1px 6px color-mix(in srgb, CanvasText 18%, transparent);
        font: 12px/1.2 system-ui, sans-serif;
        color-scheme: light dark;
      }
      .label { white-space: nowrap; }
      .bar[data-paused="true"] .label { opacity: 0.75; }
      button {
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
      button:hover, button:focus-visible {
        background: color-mix(in srgb, CanvasText 16%, transparent);
      }
    </style>
    <div class="bar" data-paused="false">
      <span class="label">Capturing</span>
      <button type="button" aria-label="Pause capture">${ICON_PAUSE}</button>
    </div>
  `;
  const bar = shadow.querySelector(".bar");
  const label = shadow.querySelector(".label");
  const button = shadow.querySelector("button");
  button.addEventListener("click", () => onToggle());

  const mount = () => {
    if (!host.isConnected) document.documentElement.appendChild(host);
  };
  mount();

  return {
    host,
    mount,
    render(paused) {
      bar.dataset.paused = paused ? "true" : "false";
      label.textContent = paused ? "Paused" : "Capturing";
      button.setAttribute("aria-label", paused ? "Resume capture" : "Pause capture");
      button.innerHTML = paused ? ICON_PLAY : ICON_PAUSE;
    },
  };
}

function startCapture(extractFromDocument, normalizeSettings) {
  let lastKey = "";
  let lastAt = 0;
  let timer = 0;
  let attempts = 0;
  let paused = true;
  let settings = normalizeSettings({});
  let observer = null;

  const overlay = mountOverlay(() => {
    chrome.storage.local.set({ [PAUSED_KEY]: !paused });
  });
  overlay.render(true);

  const run = (fromRetry) => {
    if (paused) return;
    overlay.mount();
    let batch = null;
    try {
      batch = extractFromDocument(document, location.href, nowIso(), settings);
    } catch {
      batch = null;
    }
    if (!batch) {
      if (fromRetry && attempts < 12) {
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
      if (fromRetry && attempts < 12) {
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
      records.every((record) => overlay.host.contains(record.target))
    ) {
      return;
    }
    overlay.mount();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => run(false), DEBOUNCE_MS);
  };

  const setPaused = (next) => {
    const wasPaused = paused;
    paused = next;
    overlay.render(paused);
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

  chrome.storage.local.get([PAUSED_KEY, SETTINGS_KEY], (data) => {
    settings = normalizeSettings(data[SETTINGS_KEY]);
    setPaused(Boolean(data[PAUSED_KEY]));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[SETTINGS_KEY]) {
      settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
      lastKey = "";
      if (!paused) run(true);
    }
    if (changes[PAUSED_KEY]) {
      setPaused(Boolean(changes[PAUSED_KEY].newValue));
    }
  });

  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function boot(remaining) {
  import(chrome.runtime.getURL("extract.js"))
    .then((mod) => startCapture(mod.extractFromDocument, mod.normalizeSettings))
    .catch(() => {
      if (remaining <= 0) return;
      window.setTimeout(() => boot(remaining - 1), 400);
    });
}

boot(8);
