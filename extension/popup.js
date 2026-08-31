import { exportFilename, storeToZipBlob } from "./csv.js";

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const downloadBtn = document.getElementById("download");
const clearBtn = document.getElementById("clear");

function formatCaptured(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function render(store) {
  const individuals = store.individuals ?? [];
  const linear = store.linear ?? [];
  const pti = store.pti ?? [];
  const count = individuals.length;
  statusEl.textContent =
    count === 0
      ? "No animals captured yet."
      : `${count} animal${count === 1 ? "" : "s"} · ${linear.length} LA · ${pti.length} PTI`;
  listEl.replaceChildren();
  emptyEl.hidden = count > 0;
  downloadBtn.disabled = count === 0;
  clearBtn.disabled = count === 0;

  for (const row of individuals) {
    const li = document.createElement("li");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = row.registered_name || row.registration_number;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [row.registration_number, formatCaptured(row.captured_at)]
      .filter(Boolean)
      .join(" · ");
    li.append(name, meta);
    listEl.append(li);
  }
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
