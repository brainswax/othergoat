import {
  INDIVIDUAL_COLUMNS,
  LINEAR_COLUMNS,
  PTI_COLUMNS,
  STORE_FILES,
} from "./schema.js";
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

export function storeToZipFiles(lists) {
  return [
    {
      name: STORE_FILES.individuals,
      text: recordsToCsv(lists.individuals ?? [], INDIVIDUAL_COLUMNS),
    },
    {
      name: STORE_FILES.linear,
      text: recordsToCsv(lists.linear ?? [], LINEAR_COLUMNS),
    },
    {
      name: STORE_FILES.pti,
      text: recordsToCsv(lists.pti ?? [], PTI_COLUMNS),
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
  const text =
    kind === "linear"
      ? recordsToCsv(lists.linear ?? [], LINEAR_COLUMNS)
      : kind === "pti"
        ? recordsToCsv(lists.pti ?? [], PTI_COLUMNS)
        : recordsToCsv(lists.individuals ?? [], INDIVIDUAL_COLUMNS);
  return new Blob([text], { type: "text/csv;charset=utf-8" });
}

export function storeToZipBlob(lists) {
  return zipStore(storeToZipFiles(lists));
}

export function exportFilename(when = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `adga-genetics-export-${stamp}.zip`;
}
