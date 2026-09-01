import {
  csvExportFilename,
  exportFilename,
  storeToCsvBlob,
  storeToZipBlob,
} from "./csv.js";
import { linearKey, ptiKey } from "./merge.js";
import { goatDetailUrl, identityKey } from "./registration.js";
import {
  DEFAULT_SETTINGS,
  isIndividualComplete,
  normalizeSettings,
  scrapeStatus,
} from "./schema.js";
import { rowMatchesQuery } from "./search.js";

const TABS = ["animals", "linear", "pti", "settings"];
const SETTINGS_KEY = "settings";
const STORE_KEY = "store";
const PAUSED_KEY = "paused";
const SEARCH_KEY = "searchQuery";
const UI_KEY = "popupUi";
const docked = new URLSearchParams(location.search).has("docked");
if (docked) document.documentElement.dataset.docked = "true";
const EMPTY_COPY = {
  animals:
    "Visit goat detail pages on genetics.adga.org. Captured animals appear here. Opening Pedigree, Progeny, or Linear History on the same page adds more rows.",
  linear:
    "Open Linear History on a goat you already captured. Appraisal rows appear here.",
  pti: "PTI and ETA from the left pane are captured when you visit a goat detail page.",
  search: "No captured rows match that search.",
};

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const settingsEl = document.getElementById("settings");
const individualsOpt = document.getElementById("opt-individuals");
const ancestryOpt = document.getElementById("opt-ancestry");
const progenyOpt = document.getElementById("opt-progeny");
const ptiOpt = document.getElementById("opt-pti");
const linearOpt = document.getElementById("opt-linear");
const panelEl = document.getElementById("panel");
const downloadCsvBtn = document.getElementById("download-csv");
const downloadBtn = document.getElementById("download");
const clearBtn = document.getElementById("clear");
const searchBar = document.getElementById("search-bar");
const searchInput = document.getElementById("search");
const searchClearBtn = document.getElementById("search-clear");
const tabButtons = [...document.querySelectorAll(".tabs [role='tab']")];

document.getElementById("version").textContent =
  `v${chrome.runtime.getManifest().version}`;

let currentTab = "animals";
let lastStore = { individuals: [], linear: [], pti: [] };
let focusKey = "";
let pendingScroll = 0;
let anchorOffset = null;
let restoredPlace = false;
let persistUiTimer = 0;

function tabKind() {
  if (currentTab === "linear") return "linear";
  if (currentTab === "pti") return "pti";
  return "individuals";
}

function formatCaptured(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function nameLookup(individuals) {
  const byId = new Map();
  const byKey = new Map();
  for (const row of individuals) {
    const reg = row.registration_number ?? "";
    if (!reg) continue;
    const label = row.registered_name || reg;
    byId.set(reg, label);
    byKey.set(identityKey(reg), label);
  }
  return (reg) => byId.get(reg) || byKey.get(identityKey(reg || "")) || reg || "";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function rowFocusKey(tab, row) {
  if (tab === "linear") return `linear:${linearKey(row)}`;
  if (tab === "pti") return `pti:${ptiKey(row)}`;
  return `animal:${identityKey(row.registration_number)}`;
}

function appendItem(parts, key) {
  const li = document.createElement("li");
  if (key) li.dataset.focusKey = key;
  for (const part of parts) {
    if (part) li.append(part);
  }
  listEl.append(li);
}

function persistUi() {
  clearTimeout(persistUiTimer);
  persistUiTimer = setTimeout(() => {
    chrome.storage.local.set({
      [UI_KEY]: {
        tab: currentTab,
        focusKey,
        scroll: panelEl.scrollTop,
        anchorOffset,
      },
    });
  }, 80);
}

function rememberFocus(key) {
  focusKey = key || "";
  const row = findFocusRow();
  anchorOffset = row ? rowOffsetInPanel(row) : null;
  persistUi();
}

function applyTabChrome(tab) {
  currentTab = tab;
  for (const button of tabButtons) {
    const selected = button.dataset.tab === tab;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.tabIndex = selected ? 0 : -1;
  }
  panelEl.setAttribute("aria-labelledby", `tab-${tab}`);
}

function findFocusRow() {
  if (!focusKey) return null;
  return listEl.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
}

function rowOffsetInPanel(row) {
  return row.getBoundingClientRect().top - panelEl.getBoundingClientRect().top;
}

function rowInPanel(row) {
  if (!row) return false;
  const box = row.getBoundingClientRect();
  const pane = panelEl.getBoundingClientRect();
  return box.top < pane.bottom && box.bottom > pane.top;
}

function pinFocusRow(row, offset) {
  if (!row || offset == null || Number.isNaN(Number(offset))) return;
  panelEl.scrollTop += rowOffsetInPanel(row) - Number(offset);
}

function paintFocus() {
  for (const li of listEl.children) {
    li.classList.toggle("is-current", li.dataset.focusKey === focusKey);
  }
}

function restorePlace() {
  paintFocus();
  const row = findFocusRow();
  if (row && anchorOffset != null) {
    pinFocusRow(row, anchorOffset);
    return;
  }
  if (row) {
    row.scrollIntoView({ block: "nearest" });
    return;
  }
  if (pendingScroll) panelEl.scrollTop = pendingScroll;
}

const CHECK_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M3.2 8.4 6.6 11.6 12.8 4.4"/></svg>';

function scrapeMark(label, status, titles, url, onOpen) {
  const mark = url ? el("a", "") : el("span", "");
  mark.className = `complete is-${status}`;
  mark.title = titles[status] ?? titles.missing;
  if (url) {
    mark.href = url;
    mark.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onOpen?.();
      openGoatPage(url, url.includes("#ogr-linear") ? "linear" : "");
    });
  }
  if (status === "found" || status === "empty") {
    mark.innerHTML = CHECK_SVG;
    mark.append(
      el(
        "span",
        "sr-only",
        status === "empty" ? `${label} visited, no data` : `${label} complete`,
      ),
    );
  } else {
    mark.append(el("span", "mark-label", label));
  }
  return mark;
}

function scrapeMarks(flags = {}, registration = "", sourceUrl = "", onOpen) {
  const pedigree = goatDetailUrl(registration, sourceUrl);
  const linear = goatDetailUrl(registration, sourceUrl, "linear");
  const wrap = el("span", "marks");
  wrap.append(
    scrapeMark(
      "ID",
      flags.identity,
      {
        found: "Has full identity from this animal’s Genetics page",
        missing: "Visit this animal’s Genetics page for identity",
      },
      pedigree,
      onOpen,
    ),
    scrapeMark(
      "LA",
      flags.linear,
      {
        found: "Linear History captured",
        empty: "Linear History visited; no appraisals",
        missing: "Open Linear History on this animal",
      },
      linear,
      onOpen,
    ),
    scrapeMark(
      "PTI",
      flags.pti,
      {
        found: "PTI captured",
        empty: "Visited; no PTI scores",
        missing: "Visit this animal’s Genetics page for PTI",
      },
      pedigree,
      onOpen,
    ),
  );
  return wrap;
}

function hasRows(list, registration) {
  return (list ?? []).some(
    (item) =>
      identityKey(item.registration_number) === identityKey(registration || ""),
  );
}

function flagsOf(registration, individuals, linear, pti) {
  const row = (individuals ?? []).find(
    (item) => identityKey(item.registration_number) === identityKey(registration || ""),
  );
  return {
    identity: isIndividualComplete(row) ? "found" : "missing",
    linear: scrapeStatus(row?.linear_complete, hasRows(linear, registration)),
    pti: scrapeStatus(
      row?.pti_complete === false
        ? false
        : Boolean(row?.pti_complete) || isIndividualComplete(row),
      hasRows(pti, registration),
    ),
  };
}

function sameGoatDetail(tabUrl, destUrl) {
  try {
    const tab = new URL(tabUrl);
    const dest = new URL(destUrl);
    const a = identityKey(tab.searchParams.get("RegNumber") ?? "");
    const b = identityKey(dest.searchParams.get("RegNumber") ?? "");
    return (
      tab.hostname === "genetics.adga.org" &&
      /GoatDetail\.aspx/i.test(tab.pathname) &&
      a !== "" &&
      a === b
    );
  } catch {
    return false;
  }
}

function openGoatPage(url, view = "") {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab?.id == null) {
      chrome.tabs.create({ url });
      if (!docked) window.close();
      return;
    }
    if (view === "linear" && sameGoatDetail(tab.url ?? "", url)) {
      chrome.tabs.sendMessage(tab.id, { type: "OPEN_VIEW", view: "linear" }, () => {
        if (chrome.runtime.lastError) chrome.tabs.update(tab.id, { url });
      });
    } else {
      chrome.tabs.update(tab.id, { url });
    }
    if (!docked) window.close();
  });
}

function nameLink(name, registration, sourceUrl, onOpen) {
  const url = goatDetailUrl(registration, sourceUrl);
  if (!url) return el("div", "name", name);
  const a = el("a", "name", name);
  a.href = url;
  a.title = "Open on ADGA Genetics";
  a.addEventListener("click", (event) => {
    event.preventDefault();
    onOpen?.();
    openGoatPage(url);
  });
  return a;
}

function titleRow(name, capturedAt, opts = {}) {
  const top = el("div", "row");
  const left = el("div", "title");
  const onOpen = () => rememberFocus(opts.focusKey);
  if (opts.marks) {
    left.append(
      scrapeMarks(opts.marks, opts.registration, opts.sourceUrl, onOpen),
    );
  }
  left.append(
    opts.registration
      ? nameLink(name, opts.registration, opts.sourceUrl, onOpen)
      : el("div", "name", name),
  );
  top.append(left);
  const when = formatCaptured(capturedAt);
  if (when) top.append(el("div", "when", when));
  return top;
}

function removeButton(kind, key) {
  const btn = el("button", "remove");
  btn.type = "button";
  btn.setAttribute("aria-label", "Remove");
  btn.innerHTML =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8h5.6l.7-8M7 6.5v4.5M9 6.5v4.5"/></svg>';
  btn.addEventListener("click", () => {
    void removeItem(kind, key);
  });
  return btn;
}

function genderMark(sex) {
  const kind = String(sex ?? "").trim().toUpperCase();
  if (kind !== "DOE" && kind !== "BUCK") return null;
  const mark = el("span", `sex is-${kind.toLowerCase()}`);
  mark.textContent = kind === "DOE" ? "♀" : "♂";
  mark.title = kind === "DOE" ? "Doe" : "Buck";
  mark.setAttribute("aria-label", kind === "DOE" ? "Doe" : "Buck");
  return mark;
}

function animalSummary(row) {
  const meta = el("div", "meta");
  const id = (row.registration_number ?? "").trim();
  if (id) meta.append(el("span", "reg", id));
  const sex = genderMark(row.sex);
  if (sex) {
    if (id) meta.append(document.createTextNode(" · "));
    meta.append(sex);
  }
  const rest = [row.date_of_birth, (row.herdbook ?? "").trim().toUpperCase()]
    .filter(Boolean)
    .join(" · ");
  if (rest) {
    meta.append(document.createTextNode(id || sex ? ` · ${rest}` : rest));
  }
  return meta;
}

function metaRow(summary, kind, key) {
  const row = el("div", "meta-row");
  if (typeof summary === "string") {
    row.append(el("div", "meta", summary));
  } else if (summary) {
    row.append(summary);
  }
  row.append(removeButton(kind, key));
  return row;
}

function searchQuery() {
  return searchInput.value;
}

function persistSearch() {
  chrome.storage.local.set({ [SEARCH_KEY]: searchInput.value });
}

function paintSearchClear() {
  searchClearBtn.hidden = searchQuery().trim() === "";
}

function animalSearchParts(row) {
  return [
    row.registered_name,
    row.registration_number,
    row.date_of_birth,
    row.herdbook,
  ];
}

function linearSearchParts(row, nameOf) {
  return [
    nameOf(row.registration_number),
    row.registration_number,
    row.appraisal_date,
    row.age,
    row.final_score,
    row.majors,
    row.head,
    row.misc1,
    row.misc2,
    row.misc3,
  ];
}

function ptiSearchParts(row, nameOf) {
  return [
    nameOf(row.registration_number),
    row.registration_number,
    row.pti21,
    row.pti12,
    row.eta21,
    row.eta12,
  ];
}

function renderAnimals(individuals, linear, pti) {
  for (const row of individuals) {
    const key = rowFocusKey("animals", row);
    appendItem([
      titleRow(row.registered_name || row.registration_number, row.captured_at, {
        marks: flagsOf(row.registration_number, individuals, linear, pti),
        registration: row.registration_number,
        sourceUrl: row.source_url,
        focusKey: key,
      }),
      metaRow(animalSummary(row), "individuals", row.registration_number),
    ], key);
  }
}

function renderLinear(linear, nameOf, individuals, pti) {
  for (const row of linear) {
    const title = nameOf(row.registration_number);
    const key = rowFocusKey("linear", row);
    appendItem([
      titleRow(title || row.registration_number, row.captured_at, {
        marks: flagsOf(row.registration_number, individuals, linear, pti),
        registration: row.registration_number,
        sourceUrl: row.source_url,
        focusKey: key,
      }),
      metaRow(
        [
          row.registration_number,
          row.appraisal_date,
          row.age,
          row.final_score ? `FS ${row.final_score}` : "",
          row.majors,
        ]
          .filter(Boolean)
          .join(" · "),
        "linear",
        linearKey(row),
      ),
    ], key);
  }
}

function renderPti(pti, nameOf, individuals, linear) {
  for (const row of pti) {
    const title = nameOf(row.registration_number);
    const key = rowFocusKey("pti", row);
    const scores = [
      row.pti21 ? `PTI21 ${row.pti21}` : "",
      row.pti12 ? `PTI12 ${row.pti12}` : "",
      row.eta21 ? `ETA21 ${row.eta21}` : "",
      row.eta12 ? `ETA12 ${row.eta12}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    appendItem(
      [
        titleRow(title || row.registration_number, row.captured_at, {
          marks: flagsOf(row.registration_number, individuals, linear, pti),
          registration: row.registration_number,
          sourceUrl: row.source_url,
          focusKey: key,
        }),
        metaRow(row.registration_number || "", "pti", ptiKey(row)),
        scores ? el("div", "scores", scores) : null,
      ],
      key,
    );
  }
}

function setTab(tab) {
  applyTabChrome(tab);
  panelEl.scrollTop = 0;
  persistUi();
  render(lastStore);
  void refresh();
}

function paintSettings(settings) {
  const opts = normalizeSettings(settings);
  individualsOpt.checked = opts.recordIndividuals;
  ancestryOpt.checked = opts.captureAncestry;
  progenyOpt.checked = opts.recordProgeny;
  ptiOpt.checked = opts.recordPti;
  linearOpt.checked = opts.recordLinear;
  ancestryOpt.disabled = !opts.recordIndividuals;
  progenyOpt.disabled = !opts.recordIndividuals;
}

function readSettingsForm() {
  return {
    recordIndividuals: individualsOpt.checked,
    captureAncestry: ancestryOpt.checked,
    recordProgeny: progenyOpt.checked,
    recordPti: ptiOpt.checked,
    recordLinear: linearOpt.checked,
  };
}

function saveSettings() {
  ancestryOpt.disabled = !individualsOpt.checked;
  progenyOpt.disabled = !individualsOpt.checked;
  chrome.storage.local.set({ [SETTINGS_KEY]: readSettingsForm() }, () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const id = tabs[0]?.id;
      if (id == null) return;
      chrome.tabs.sendMessage(id, { type: "RECAPTURE" }, () => {
        void chrome.runtime.lastError;
      });
    });
  });
}

function render(store) {
  const keepScroll = restoredPlace ? panelEl.scrollTop : null;
  const focused = restoredPlace ? findFocusRow() : null;
  const pinOffset =
    focused && rowInPanel(focused) ? rowOffsetInPanel(focused) : null;
  lastStore = store;
  const individuals = store.individuals ?? [];
  const linear = store.linear ?? [];
  const pti = store.pti ?? [];
  const count = individuals.length;
  const onSettings = currentTab === "settings";
  const tabRows =
    currentTab === "linear" ? linear : currentTab === "pti" ? pti : individuals;
  const anyRows = count + linear.length + pti.length > 0;
  const nameOf = nameLookup(individuals);
  const query = searchQuery();
  const shownIndividuals = individuals.filter((row) =>
    rowMatchesQuery(animalSearchParts(row), query),
  );
  const shownLinear = linear.filter((row) =>
    rowMatchesQuery(linearSearchParts(row, nameOf), query),
  );
  const shownPti = pti.filter((row) =>
    rowMatchesQuery(ptiSearchParts(row, nameOf), query),
  );
  const shown =
    currentTab === "linear"
      ? shownLinear
      : currentTab === "pti"
        ? shownPti
        : shownIndividuals;

  const labels = {
    animals: count ? `Animals (${count})` : "Animals",
    linear: linear.length ? `LA (${linear.length})` : "LA",
    pti: pti.length ? `PTI (${pti.length})` : "PTI",
  };
  for (const button of tabButtons) {
    if (button.dataset.tab === "settings") continue;
    button.textContent = labels[button.dataset.tab] ?? button.dataset.tab;
  }

  searchBar.hidden = onSettings;
  paintSearchClear();
  settingsEl.hidden = !onSettings;
  listEl.hidden = onSettings;
  listEl.replaceChildren();
  emptyEl.hidden = onSettings || shown.length > 0;
  emptyEl.textContent =
    tabRows.length === 0 ? (EMPTY_COPY[currentTab] ?? "") : EMPTY_COPY.search;
  downloadCsvBtn.disabled = onSettings || tabRows.length === 0;
  downloadBtn.disabled = !anyRows;
  clearBtn.disabled = !anyRows;

  if (!onSettings && shown.length > 0) {
    if (currentTab === "linear") {
      renderLinear(shownLinear, nameOf, individuals, pti);
    } else if (currentTab === "pti") {
      renderPti(shownPti, nameOf, individuals, linear);
    } else {
      renderAnimals(shownIndividuals, linear, pti);
    }
  }

  if (!restoredPlace) {
    restorePlace();
    restoredPlace = true;
    return;
  }
  paintFocus();
  if (keepScroll != null) panelEl.scrollTop = keepScroll;
  const next = findFocusRow();
  if (next && pinOffset != null) {
    pinFocusRow(next, pinOffset);
  }
}

function send(message) {
  const payload = typeof message === "string" ? { type: message } : message;
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function refresh() {
  const response = await send("GET_STORE");
  render(response);
  return response;
}

async function removeItem(kind, key) {
  const response = await send({ type: "REMOVE_ROW", kind, key });
  render(response);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

for (const button of tabButtons) {
  button.addEventListener("click", () => setTab(button.dataset.tab));
}

document.querySelector(".tabs").addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const i = TABS.indexOf(currentTab);
  const next =
    event.key === "ArrowRight"
      ? TABS[(i + 1) % TABS.length]
      : TABS[(i - 1 + TABS.length) % TABS.length];
  setTab(next);
  document.getElementById(`tab-${next}`)?.focus();
});

downloadCsvBtn.addEventListener("click", async () => {
  if (currentTab === "settings") return;
  const store = await refresh();
  const kind = tabKind();
  const rows =
    kind === "linear"
      ? store.linear
      : kind === "pti"
        ? store.pti
        : store.individuals;
  if ((rows ?? []).length === 0) return;
  downloadBlob(storeToCsvBlob(store, kind), csvExportFilename(kind));
});

downloadBtn.addEventListener("click", async () => {
  const store = await refresh();
  if (
    (store.individuals ?? []).length +
      (store.linear ?? []).length +
      (store.pti ?? []).length ===
    0
  ) {
    return;
  }
  downloadBlob(storeToZipBlob(store), exportFilename());
});

clearBtn.addEventListener("click", async () => {
  if (!window.confirm("Remove all captured animals from this computer?")) return;
  await send("CLEAR_STORE");
  await refresh();
});

individualsOpt.addEventListener("change", saveSettings);
ancestryOpt.addEventListener("change", saveSettings);
progenyOpt.addEventListener("change", saveSettings);
ptiOpt.addEventListener("change", saveSettings);
linearOpt.addEventListener("change", saveSettings);

panelEl.addEventListener("scroll", persistUi, { passive: true });

searchInput.addEventListener("input", () => {
  persistSearch();
  paintSearchClear();
  render(lastStore);
});
searchClearBtn.addEventListener("click", () => {
  searchInput.value = "";
  persistSearch();
  searchInput.focus();
  paintSearchClear();
  render(lastStore);
});

chrome.storage.local.get([SETTINGS_KEY, SEARCH_KEY, UI_KEY], (data) => {
  paintSettings(data[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
  const saved = data[SEARCH_KEY];
  if (typeof saved === "string") searchInput.value = saved;
  const ui = data[UI_KEY];
  if (ui && TABS.includes(ui.tab)) applyTabChrome(ui.tab);
  if (typeof ui?.focusKey === "string") focusKey = ui.focusKey;
  pendingScroll = Number(ui?.scroll) || 0;
  if (typeof ui?.anchorOffset === "number") anchorOffset = ui.anchorOffset;
  paintSearchClear();
  refresh().catch((err) => {
    statusEl.hidden = false;
    statusEl.textContent = `Could not load queue: ${err.message}`;
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORE_KEY] || changes[PAUSED_KEY]) {
    void refresh();
  }
  if (changes[SEARCH_KEY] && typeof changes[SEARCH_KEY].newValue === "string") {
    if (searchInput.value !== changes[SEARCH_KEY].newValue) {
      searchInput.value = changes[SEARCH_KEY].newValue;
      paintSearchClear();
      render(lastStore);
    }
  }
});
