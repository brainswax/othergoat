import { emptyStore } from "./schema.js";
import { mergeBatch, storeAsLists } from "./merge.js";

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

async function saveStore(store) {
  await chrome.storage.local.set({ [STORE_KEY]: store });
}

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
    return { ok: false, error: "unknown_message" };
  };
  run()
    .then(sendResponse)
    .catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });
  return true;
});
