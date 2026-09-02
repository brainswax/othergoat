import { emptyStore } from "./schema.js";
import { mergeBatch, normalizeStore, removeRow, storeAsLists } from "./merge.js";

const STORE_KEY = "store";
const PAUSED_KEY = "paused";
const MINIMIZED_KEY = "pinnedMinimized";
const POPUP_PATH = "popup.html";

function isGeneticsUrl(url) {
  try {
    return new URL(url).hostname === "genetics.adga.org";
  } catch {
    return false;
  }
}

async function syncActionPopup() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const onGenetics = isGeneticsUrl(tabs[0]?.url ?? "");
  await chrome.action.setPopup({
    popup: onGenetics ? "" : POPUP_PATH,
  });
}

async function loadStore() {
  const data = await chrome.storage.local.get(STORE_KEY);
  const store = data[STORE_KEY];
  if (!store || typeof store !== "object") return emptyStore();
  return normalizeStore(store);
}

function badgeText(count) {
  if (!count) return "";
  if (count > 999) return "999+";
  return String(count);
}

async function updateBadge(store) {
  const count =
    Object.keys(store?.individuals ?? {}).length +
    Object.keys(store?.linear ?? {}).length +
    Object.keys(store?.pti ?? {}).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#2e5a3c" });
  await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  await chrome.action.setBadgeText({ text: badgeText(count) });
}

async function saveStore(store) {
  await chrome.storage.local.set({ [STORE_KEY]: store });
  await updateBadge(store);
}

async function isPaused() {
  const data = await chrome.storage.local.get(PAUSED_KEY);
  return Boolean(data[PAUSED_KEY]);
}

async function syncBadge() {
  await updateBadge(await loadStore());
}

chrome.runtime.onInstalled.addListener(() => {
  void syncBadge();
  void syncActionPopup();
});
chrome.runtime.onStartup.addListener(() => {
  void syncBadge();
  void syncActionPopup();
});
void syncBadge();
void syncActionPopup();

chrome.tabs.onActivated.addListener(() => {
  void syncActionPopup();
});
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.url != null || change.status === "complete") void syncActionPopup();
});
chrome.windows.onFocusChanged.addListener(() => {
  void syncActionPopup();
});
chrome.action.onClicked.addListener(async (tab) => {
  if (!isGeneticsUrl(tab?.url ?? "")) return;
  const data = await chrome.storage.local.get(MINIMIZED_KEY);
  await chrome.storage.local.set({
    [MINIMIZED_KEY]: !data[MINIMIZED_KEY],
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    if (message?.type === "CAPTURE_BATCH" && message.batch) {
      if (await isPaused()) return { ok: true, paused: true };
      const store = mergeBatch(await loadStore(), message.batch);
      await saveStore(store);
      return { ok: true, counts: storeAsLists(store) };
    }
    if (message?.type === "GET_STORE") {
      return {
        ok: true,
        paused: await isPaused(),
        ...storeAsLists(await loadStore()),
      };
    }
    if (message?.type === "CLEAR_STORE") {
      await saveStore(emptyStore());
      return { ok: true };
    }
    if (message?.type === "REMOVE_ROW") {
      const store = removeRow(await loadStore(), message.kind, message.key);
      await saveStore(store);
      return { ok: true, paused: await isPaused(), ...storeAsLists(store) };
    }
    return { ok: false, error: "unknown_message" };
  };
  run()
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });
  return true;
});
