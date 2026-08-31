import {
  csvExportFilename,
  exportFilename,
  storeToCsvBlob,
  storeToZipBlob,
} from "./csv.js";
import { linearKey, ptiKey } from "./merge.js";
import { identityKey } from "./registration.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "./schema.js";

const TABS = ["animals", "linear", "pti", "settings"];
const SETTINGS_KEY = "settings";
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
const ancestryOpt = document.getElementById("opt-ancestry");
const ptiOpt = document.getElementById("opt-pti");
const linearOpt = document.getElementById("opt-linear");
const panelEl = document.getElementById("panel");
const downloadCsvBtn = document.getElementById("download-csv");
const downloadBtn = document.getElementById("download");
const clearBtn = document.getElementById("clear");
const tabButtons = [...document.querySelectorAll(".tabs [role='tab']")];

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

function titleRow(name, capturedAt) {
  const top = el("div", "row");
  top.append(el("div", "name", name));
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

function renderAnimals(individuals) {
  for (const row of individuals) {
    appendItem([
      titleRow(
        row.registered_name || row.registration_number,
        row.captured_at,
      ),
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

function renderLinear(linear, nameOf) {
  for (const row of linear) {
    const title = nameOf(row.registration_number);
    appendItem([
      titleRow(title || row.registration_number, row.captured_at),
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

function renderPti(pti, nameOf) {
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
      titleRow(title || row.registration_number, row.captured_at),
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
}

function paintSettings(settings) {
  const opts = normalizeSettings(settings);
  ancestryOpt.checked = opts.captureAncestry;
  ptiOpt.checked = opts.recordPti;
  linearOpt.checked = opts.recordLinear;
}

function readSettingsForm() {
  return {
    captureAncestry: ancestryOpt.checked,
    recordPti: ptiOpt.checked,
    recordLinear: linearOpt.checked,
  };
}

function saveSettings() {
  chrome.storage.local.set({ [SETTINGS_KEY]: readSettingsForm() });
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
  statusEl.textContent =
    (store.paused ? "Paused. " : "") +
    (onSettings
      ? "These apply to pages you open next. The queue is unchanged."
      : count === 0 && !anyRows
        ? "No animals captured yet."
        : `${count} animal${count === 1 ? "" : "s"} · ${linear.length} LA · ${pti.length} PTI`);

  const labels = {
    animals: count ? `Animals (${count})` : "Animals",
    linear: linear.length ? `LA (${linear.length})` : "LA",
    pti: pti.length ? `PTI (${pti.length})` : "PTI",
    settings: "Settings",
  };
  for (const button of tabButtons) {
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
  if (currentTab === "linear") renderLinear(linear, nameOf);
  else if (currentTab === "pti") renderPti(pti, nameOf);
  else renderAnimals(individuals);
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

ancestryOpt.addEventListener("change", saveSettings);
ptiOpt.addEventListener("change", saveSettings);
linearOpt.addEventListener("change", saveSettings);

chrome.storage.local.get(SETTINGS_KEY, (data) => {
  paintSettings(data[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
});

refresh().catch((err) => {
  statusEl.textContent = `Could not load queue: ${err.message}`;
});
