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
} from "./schema.js";

const TABS = ["animals", "linear", "pti", "settings"];
const SETTINGS_KEY = "settings";
const STORE_KEY = "store";
const PAUSED_KEY = "paused";
const docked = new URLSearchParams(location.search).has("docked");
if (docked) document.documentElement.dataset.docked = "true";
const EMPTY_COPY = {
  animals:
    "Visit goat detail pages on genetics.adga.org. Captured animals appear here. Opening Pedigree, Progeny, or Linear History on the same page adds more rows.",
  linear:
    "Open Linear History on a goat you already captured. Appraisal rows appear here.",
  pti: "PTI and ETA from the left pane are captured when you visit a goat detail page.",
};

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const settingsEl = document.getElementById("settings");
const individualsOpt = document.getElementById("opt-individuals");
const ancestryOpt = document.getElementById("opt-ancestry");
const ptiOpt = document.getElementById("opt-pti");
const linearOpt = document.getElementById("opt-linear");
const panelEl = document.getElementById("panel");
const downloadCsvBtn = document.getElementById("download-csv");
const downloadBtn = document.getElementById("download");
const clearBtn = document.getElementById("clear");
const tabButtons = [...document.querySelectorAll(".tabs [role='tab']")];

document.getElementById("version").textContent =
  `v${chrome.runtime.getManifest().version}`;

let currentTab = "animals";
let lastStore = { individuals: [], linear: [], pti: [] };

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

function appendItem(parts) {
  const li = document.createElement("li");
  for (const part of parts) {
    if (part) li.append(part);
  }
  listEl.append(li);
}

const CHECK_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M3.2 8.4 6.6 11.6 12.8 4.4"/></svg>';

function scrapeMark(label, done, doneTitle, needTitle) {
  const mark = document.createElement("span");
  mark.className = done ? "complete" : "complete is-pending";
  mark.title = done ? doneTitle : needTitle;
  if (done) {
    mark.innerHTML = CHECK_SVG;
    mark.append(el("span", "sr-only", `${label} complete`));
  } else {
    mark.append(el("span", "mark-label", label));
  }
  return mark;
}

function scrapeMarks(flags = {}) {
  const wrap = el("span", "marks");
  wrap.append(
    scrapeMark(
      "ID",
      flags.identity,
      "Has full identity from this animal’s Genetics page",
      "Visit this animal’s Genetics page for identity",
    ),
    scrapeMark(
      "LA",
      flags.linear,
      "Linear History captured",
      "Open Linear History on this animal",
    ),
    scrapeMark(
      "PTI",
      flags.pti,
      "PTI captured",
      "Visit this animal’s Genetics page for PTI",
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
    identity: isIndividualComplete(row),
    linear:
      row?.linear_complete === false
        ? false
        : Boolean(row?.linear_complete) || hasRows(linear, registration),
    pti:
      row?.pti_complete === false
        ? false
        : Boolean(row?.pti_complete) || hasRows(pti, registration),
  };
}

function openGoatPage(url) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const id = tabs[0]?.id;
    if (id != null) chrome.tabs.update(id, { url });
    else chrome.tabs.create({ url });
    if (!docked) window.close();
  });
}

function nameLink(name, registration, sourceUrl) {
  const url = goatDetailUrl(registration, sourceUrl);
  if (!url) return el("div", "name", name);
  const a = el("a", "name", name);
  a.href = url;
  a.title = "Open on ADGA Genetics";
  a.addEventListener("click", (event) => {
    event.preventDefault();
    openGoatPage(url);
  });
  return a;
}

function titleRow(name, capturedAt, opts = {}) {
  const top = el("div", "row");
  const left = el("div", "title");
  if (opts.marks) left.append(scrapeMarks(opts.marks));
  left.append(
    opts.registration
      ? nameLink(name, opts.registration, opts.sourceUrl)
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

function metaRow(text, kind, key) {
  const row = el("div", "meta-row");
  row.append(el("div", "meta", text));
  row.append(removeButton(kind, key));
  return row;
}

function renderAnimals(individuals, linear, pti) {
  for (const row of individuals) {
    appendItem([
      titleRow(row.registered_name || row.registration_number, row.captured_at, {
        marks: flagsOf(row.registration_number, individuals, linear, pti),
        registration: row.registration_number,
        sourceUrl: row.source_url,
      }),
      metaRow(
        [
          row.registration_number,
          row.date_of_birth,
          (row.herdbook ?? "").trim().toUpperCase(),
        ]
          .filter(Boolean)
          .join(" · "),
        "individuals",
        row.registration_number,
      ),
    ]);
  }
}

function renderLinear(linear, nameOf, individuals, pti) {
  for (const row of linear) {
    const title = nameOf(row.registration_number);
    appendItem([
      titleRow(title || row.registration_number, row.captured_at, {
        marks: flagsOf(row.registration_number, individuals, linear, pti),
        registration: row.registration_number,
        sourceUrl: row.source_url,
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
    ]);
  }
}

function renderPti(pti, nameOf, individuals, linear) {
  for (const row of pti) {
    const title = nameOf(row.registration_number);
    const scores = [
      row.pti21 ? `PTI21 ${row.pti21}` : "",
      row.pti12 ? `PTI12 ${row.pti12}` : "",
      row.eta21 ? `ETA21 ${row.eta21}` : "",
      row.eta12 ? `ETA12 ${row.eta12}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    appendItem([
      titleRow(title || row.registration_number, row.captured_at, {
        marks: flagsOf(row.registration_number, individuals, linear, pti),
        registration: row.registration_number,
        sourceUrl: row.source_url,
      }),
      metaRow(row.registration_number || "", "pti", ptiKey(row)),
      scores ? el("div", "scores", scores) : null,
    ]);
  }
}

function setTab(tab) {
  currentTab = tab;
  for (const button of tabButtons) {
    const selected = button.dataset.tab === tab;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.tabIndex = selected ? 0 : -1;
  }
  panelEl.setAttribute("aria-labelledby", `tab-${tab}`);
  render(lastStore);
  void refresh();
}

function paintSettings(settings) {
  const opts = normalizeSettings(settings);
  individualsOpt.checked = opts.recordIndividuals;
  ancestryOpt.checked = opts.captureAncestry;
  ptiOpt.checked = opts.recordPti;
  linearOpt.checked = opts.recordLinear;
  ancestryOpt.disabled = !opts.recordIndividuals;
}

function readSettingsForm() {
  return {
    recordIndividuals: individualsOpt.checked,
    captureAncestry: ancestryOpt.checked,
    recordPti: ptiOpt.checked,
    recordLinear: linearOpt.checked,
  };
}

function saveSettings() {
  ancestryOpt.disabled = !individualsOpt.checked;
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
  lastStore = store;
  const individuals = store.individuals ?? [];
  const linear = store.linear ?? [];
  const pti = store.pti ?? [];
  const count = individuals.length;
  const onSettings = currentTab === "settings";
  const tabRows =
    currentTab === "linear" ? linear : currentTab === "pti" ? pti : individuals;
  const anyRows = count + linear.length + pti.length > 0;

  const labels = {
    animals: count ? `Animals (${count})` : "Animals",
    linear: linear.length ? `LA (${linear.length})` : "LA",
    pti: pti.length ? `PTI (${pti.length})` : "PTI",
  };
  for (const button of tabButtons) {
    if (button.dataset.tab === "settings") continue;
    button.textContent = labels[button.dataset.tab] ?? button.dataset.tab;
  }

  settingsEl.hidden = !onSettings;
  listEl.hidden = onSettings;
  listEl.replaceChildren();
  emptyEl.hidden = onSettings || tabRows.length > 0;
  emptyEl.textContent = EMPTY_COPY[currentTab] ?? "";
  downloadCsvBtn.disabled = onSettings || tabRows.length === 0;
  downloadBtn.disabled = !anyRows;
  clearBtn.disabled = !anyRows;

  if (onSettings || tabRows.length === 0) return;
  const nameOf = nameLookup(individuals);
  if (currentTab === "linear") renderLinear(linear, nameOf, individuals, pti);
  else if (currentTab === "pti") renderPti(pti, nameOf, individuals, linear);
  else renderAnimals(individuals, linear, pti);
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
ptiOpt.addEventListener("change", saveSettings);
linearOpt.addEventListener("change", saveSettings);

chrome.storage.local.get(SETTINGS_KEY, (data) => {
  paintSettings(data[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORE_KEY] || changes[PAUSED_KEY]) {
    void refresh();
  }
});

refresh().catch((err) => {
  statusEl.hidden = false;
  statusEl.textContent = `Could not load queue: ${err.message}`;
});
