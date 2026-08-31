import { exportFilename, storeToZipBlob } from "./csv.js";
import { identityKey } from "./registration.js";

const TABS = ["animals", "linear", "pti"];
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
const panelEl = document.getElementById("panel");
const downloadBtn = document.getElementById("download");
const clearBtn = document.getElementById("clear");
const tabButtons = [...document.querySelectorAll(".tabs [role='tab']")];

let currentTab = "animals";
let lastStore = { individuals: [], linear: [], pti: [] };

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

function renderAnimals(individuals) {
  for (const row of individuals) {
    appendItem([
      titleRow(
        row.registered_name || row.registration_number,
        row.captured_at,
      ),
      el(
        "div",
        "meta",
        [
          row.registration_number,
          row.date_of_birth,
          (row.herdbook ?? "").trim().toUpperCase(),
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    ]);
  }
}

function renderLinear(linear, nameOf) {
  for (const row of linear) {
    const title = nameOf(row.registration_number);
    appendItem([
      titleRow(title || row.registration_number, row.captured_at),
      el(
        "div",
        "meta",
        [
          row.registration_number,
          row.appraisal_date,
          row.age,
          row.final_score ? `FS ${row.final_score}` : "",
          row.majors,
        ]
          .filter(Boolean)
          .join(" · "),
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
      el("div", "meta", row.registration_number || ""),
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

function render(store) {
  lastStore = store;
  const individuals = store.individuals ?? [];
  const linear = store.linear ?? [];
  const pti = store.pti ?? [];
  const count = individuals.length;
  statusEl.textContent =
    count === 0
      ? "No animals captured yet."
      : `${count} animal${count === 1 ? "" : "s"} · ${linear.length} LA · ${pti.length} PTI`;

  const labels = {
    animals: count ? `Animals (${count})` : "Animals",
    linear: linear.length ? `LA (${linear.length})` : "LA",
    pti: pti.length ? `PTI (${pti.length})` : "PTI",
  };
  for (const button of tabButtons) {
    button.textContent = labels[button.dataset.tab] ?? button.dataset.tab;
  }

  const rows =
    currentTab === "linear" ? linear : currentTab === "pti" ? pti : individuals;
  listEl.replaceChildren();
  emptyEl.hidden = rows.length > 0;
  emptyEl.textContent = EMPTY_COPY[currentTab];
  downloadBtn.disabled = count === 0;
  clearBtn.disabled = count === 0;

  if (rows.length === 0) return;
  const nameOf = nameLookup(individuals);
  if (currentTab === "linear") renderLinear(linear, nameOf);
  else if (currentTab === "pti") renderPti(pti, nameOf);
  else renderAnimals(individuals);
}

function send(type) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type }, (response) => {
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

downloadBtn.addEventListener("click", async () => {
  const store = await refresh();
  if ((store.individuals ?? []).length === 0) return;
  const url = URL.createObjectURL(storeToZipBlob(store));
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFilename();
  a.click();
  URL.revokeObjectURL(url);
});

clearBtn.addEventListener("click", async () => {
  if (!window.confirm("Remove all captured animals from this computer?")) return;
  await send("CLEAR_STORE");
  await refresh();
});

refresh().catch((err) => {
  statusEl.textContent = `Could not load queue: ${err.message}`;
});
