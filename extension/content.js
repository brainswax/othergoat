/**
 * Classic content script (not an ES module). Chrome often fails to inject
 * `"type": "module"` content scripts that statically import siblings; load
 * extract.js via dynamic import + web_accessible_resources instead.
 */

const DEBOUNCE_MS = 800;

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

function startCapture(extractFromDocument) {
  let lastKey = "";
  let lastAt = 0;
  let timer = 0;
  let attempts = 0;

  const run = (fromRetry) => {
    let batch = null;
    try {
      batch = extractFromDocument(document, location.href, nowIso());
    } catch {
      batch = null;
    }
    if (!batch?.individuals?.length) {
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

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => run(false), DEBOUNCE_MS);
  };

  run(true);
  if (!document.body) return;
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function loadExtract() {
  return import(chrome.runtime.getURL("extract.js")).then(
    (mod) => mod.extractFromDocument,
  );
}

function boot(remaining) {
  loadExtract()
    .then(startCapture)
    .catch(() => {
      if (remaining <= 0) return;
      window.setTimeout(() => boot(remaining - 1), 400);
    });
}

boot(8);
