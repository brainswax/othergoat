import {
  EXPORTER_NAME,
  FORMAT_ID,
  FORMAT_VERSION,
  INDIVIDUAL_COLUMNS,
  LINEAR_COLUMNS,
  MANIFEST_FILE,
  PTI_COLUMNS,
  STORE_FILES,
} from "./schema.js";
import { identityKey } from "./registration.js";
import { zipStore } from "./zip.js";

export { INDIVIDUAL_COLUMNS, LINEAR_COLUMNS, PTI_COLUMNS };

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function recordsToCsv(records, columns) {
  const lines = [columns.join(",")];
  for (const record of records) {
    lines.push(columns.map((key) => csvCell(record[key] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function nameByRegistration(individuals) {
  const names = new Map();
  for (const row of individuals ?? []) {
    const reg = String(row?.registration_number ?? "").trim();
    const name = String(row?.registered_name ?? "").trim();
    if (!reg || !name) continue;
    names.set(identityKey(reg), name);
  }
  return names;
}

function withRegisteredNames(lists) {
  const names = nameByRegistration(lists?.individuals);
  const fill = (row) => {
    const fromId = names.get(identityKey(row?.registration_number));
    if (!fromId) return row;
    return { ...row, registered_name: fromId };
  };
  return {
    ...lists,
    linear: (lists?.linear ?? []).map(fill),
    pti: (lists?.pti ?? []).map(fill),
  };
}

export function buildExportManifest(lists, meta = {}) {
  return {
    format: FORMAT_ID,
    formatVersion: FORMAT_VERSION,
    exportedAt: meta.exportedAt || new Date().toISOString(),
    exporter: {
      name: EXPORTER_NAME,
      version: String(meta.exporterVersion ?? ""),
    },
    files: [
      {
        name: STORE_FILES.individuals,
        kind: "individuals",
        rows: (lists?.individuals ?? []).length,
      },
      {
        name: STORE_FILES.linear,
        kind: "linear_appraisals",
        rows: (lists?.linear ?? []).length,
      },
      {
        name: STORE_FILES.pti,
        kind: "pti",
        rows: (lists?.pti ?? []).length,
      },
    ],
  };
}

export function storeToZipFiles(lists, meta = {}) {
  const named = withRegisteredNames(lists);
  return [
    {
      name: MANIFEST_FILE,
      text: `${JSON.stringify(buildExportManifest(named, meta), null, 2)}\n`,
    },
    {
      name: STORE_FILES.individuals,
      text: recordsToCsv(named.individuals ?? [], INDIVIDUAL_COLUMNS),
    },
    {
      name: STORE_FILES.linear,
      text: recordsToCsv(named.linear ?? [], LINEAR_COLUMNS),
    },
    {
      name: STORE_FILES.pti,
      text: recordsToCsv(named.pti ?? [], PTI_COLUMNS),
    },
  ];
}

export function csvExportFilename(kind, when = new Date()) {
  const file =
    kind === "linear"
      ? STORE_FILES.linear
      : kind === "pti"
        ? STORE_FILES.pti
        : STORE_FILES.individuals;
  const base = file.replace(/\.csv$/i, "");
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `adga-genetics-${base}-${stamp}.csv`;
}

export function storeToCsvBlob(lists, kind) {
  const named = withRegisteredNames(lists);
  const text =
    kind === "linear"
      ? recordsToCsv(named.linear ?? [], LINEAR_COLUMNS)
      : kind === "pti"
        ? recordsToCsv(named.pti ?? [], PTI_COLUMNS)
        : recordsToCsv(named.individuals ?? [], INDIVIDUAL_COLUMNS);
  return new Blob([text], { type: "text/csv;charset=utf-8" });
}

export function storeToZipBlob(lists, meta = {}) {
  return zipStore(storeToZipFiles(lists, meta));
}

export function exportFilename(when = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `adga-genetics-export-${stamp}.zip`;
}
