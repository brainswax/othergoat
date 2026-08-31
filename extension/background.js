import { emptyStore } from "./schema.js";
import { mergeBatch, removeRow, storeAsLists } from "./merge.js";

const STORE_KEY = "store";

async function loadStore() {
  const data = await chrome.storage.local.get(STORE_KEY);
  const store = data[STORE_KEY];
  if (!store || typeof store !== "object") return emptyStore();
  return {
    individuals: store.individuals ?? {},
    linear: store.linear ?? {},
    pti: store.pti ?? {},
  };
}

function badgeText(count) {
  if (!count) return "";
  if (count > 999) return "999+";
  return String(count);
}

async function updateBadge(store) {
  const count = Object.keys(store?.individuals ?? {}).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#2e5a3c" });
  await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  await chrome.action.setBadgeText({ text: badgeText(count) });
}

async function saveStore(store) {
  await chrome.storage.local.set({ [STORE_KEY]: store });
  await updateBadge(store);
}

async function syncBadge() {
  await updateBadge(await loadStore());
}

chrome.runtime.onInstalled.addListener(() => {
  void syncBadge();
});
chrome.runtime.onStartup.addListener(() => {
  void syncBadge();
});
void syncBadge();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    if (message?.type === "CAPTURE_BATCH" && message.batch) {
      const store = mergeBatch(await loadStore(), message.batch);
      await saveStore(store);
      return { ok: true, counts: storeAsLists(store) };
    }
    if (message?.type === "GET_STORE") {
      return { ok: true, ...storeAsLists(await loadStore()) };
    }
    if (message?.type === "CLEAR_STORE") {
      await saveStore(emptyStore());
      return { ok: true };
    }
    if (message?.type === "REMOVE_ROW") {
      const store = removeRow(await loadStore(), message.kind, message.key);
      await saveStore(store);
      return { ok: true, ...storeAsLists(store) };
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
