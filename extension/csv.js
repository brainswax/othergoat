import {
  EXPORTER_NAME,
  FILE_VERSIONS,
  FORMAT_ID,
  INDIVIDUAL_COLUMNS,
  LINEAR_COLUMNS,
  MANIFEST_FILE,
  MANIFEST_VERSION,
  PTI_COLUMNS,
  STORE_FILES,
  normalizeIdentityRow,
} from "./schema.js";
import { hasReliablePaperId, identityKey, toAdgaSerial, toGeneticsRegNumber } from "./registration.js";
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

function filled(value) {
  return value != null && String(value).trim() !== "";
}

/** Columns that have a value on at least one row. Empty tables keep the full header. */
export function exportColumns(records, columns, omitEmpty = false) {
  if (!omitEmpty || !(records ?? []).length) return columns;
  const used = columns.filter((key) =>
    records.some((row) => filled(row?.[key])),
  );
  return used.length ? used : columns;
}

function nameByRegistration(individuals) {
  const names = new Map();
  for (const row of individuals ?? []) {
    const name = String(row?.registered_name ?? "").trim();
    if (!name) continue;
    for (const value of [row?.adga_genetics_id, row?.adga_reg]) {
      const key = identityKey(value) || toGeneticsRegNumber(value);
      if (key) names.set(key, name);
    }
  }
  return names;
}

function withSerials(row) {
  return {
    ...row,
    goat_id: toAdgaSerial(row?.goat_id || row?.adga_genetics_id || row?.adga_reg),
    ...(row?.sire_adga_genetics_id != null || row?.sire_adga_reg != null || row?.sire_goat_id != null
      ? {
          sire_goat_id: toAdgaSerial(
            row?.sire_goat_id || row?.sire_adga_genetics_id || row?.sire_adga_reg,
          ),
        }
      : {}),
    ...(row?.dam_adga_genetics_id != null || row?.dam_adga_reg != null || row?.dam_goat_id != null
      ? {
          dam_goat_id: toAdgaSerial(
            row?.dam_goat_id || row?.dam_adga_genetics_id || row?.dam_adga_reg,
          ),
        }
      : {}),
  };
}

function withRegisteredNames(lists) {
  const names = nameByRegistration(lists?.individuals);
  const fill = (row) => {
    const fromId =
      names.get(identityKey(row?.adga_genetics_id)) ||
      names.get(identityKey(row?.adga_reg)) ||
      names.get(toGeneticsRegNumber(row?.adga_genetics_id || row?.adga_reg));
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
    manifestVersion: MANIFEST_VERSION,
    exportedAt: meta.exportedAt || new Date().toISOString(),
    exporter: {
      name: EXPORTER_NAME,
      version: String(meta.exporterVersion ?? ""),
      ...(meta.omitEmptyColumns ? { omitEmptyColumns: true } : {}),
      ...(meta.omitWithoutPaperId === false ? { omitWithoutPaperId: false } : {}),
    },
    files: [
      {
        name: STORE_FILES.individuals,
        kind: "individuals",
        version: FILE_VERSIONS.individuals,
        rows: (lists?.individuals ?? []).length,
      },
      {
        name: STORE_FILES.linear,
        kind: "linear_appraisals",
        version: FILE_VERSIONS.linear,
        rows: (lists?.linear ?? []).length,
      },
      {
        name: STORE_FILES.pti,
        kind: "pti",
        version: FILE_VERSIONS.pti,
        rows: (lists?.pti ?? []).length,
      },
    ],
  };
}

function filterReliablePaperIds(lists, omitWithoutPaperId) {
  if (omitWithoutPaperId === false) return lists;
  const individuals = (lists?.individuals ?? []).filter((row) =>
    hasReliablePaperId(row),
  );
  const keep = new Set(
    individuals
      .map((row) => toGeneticsRegNumber(row.adga_genetics_id || row.adga_reg))
      .filter(Boolean),
  );
  const onKept = (row) =>
    keep.has(toGeneticsRegNumber(row?.adga_genetics_id || row?.adga_reg));
  return {
    ...lists,
    individuals,
    linear: (lists?.linear ?? []).filter(onKept),
    pti: (lists?.pti ?? []).filter(onKept),
  };
}

export function storeToZipFiles(lists, meta = {}) {
  const canonical = {
    ...lists,
    individuals: (lists?.individuals ?? []).map(normalizeIdentityRow),
    linear: (lists?.linear ?? []).map(normalizeIdentityRow),
    pti: (lists?.pti ?? []).map(normalizeIdentityRow),
  };
  const named = filterReliablePaperIds(
    withRegisteredNames(canonical),
    meta.omitWithoutPaperId,
  );
  const serials = {
    ...named,
    individuals: (named.individuals ?? []).map(withSerials),
    linear: (named.linear ?? []).map(withSerials),
    pti: (named.pti ?? []).map(withSerials),
  };
  const omit = Boolean(meta.omitEmptyColumns);
  return [
    {
      name: MANIFEST_FILE,
      text: `${JSON.stringify(buildExportManifest(named, meta), null, 2)}\n`,
    },
    {
      name: STORE_FILES.individuals,
      text: recordsToCsv(
        serials.individuals,
        exportColumns(serials.individuals, INDIVIDUAL_COLUMNS, omit),
      ),
    },
    {
      name: STORE_FILES.linear,
      text: recordsToCsv(
        serials.linear,
        exportColumns(serials.linear, LINEAR_COLUMNS, omit),
      ),
    },
    {
      name: STORE_FILES.pti,
      text: recordsToCsv(
        serials.pti,
        exportColumns(serials.pti, PTI_COLUMNS, omit),
      ),
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

export function storeToCsvBlob(lists, kind, meta = {}) {
  const named = filterReliablePaperIds(
    withRegisteredNames(lists),
    meta.omitWithoutPaperId,
  );
  const omit = Boolean(meta.omitEmptyColumns);
  const text =
    kind === "linear"
      ? recordsToCsv(
          named.linear ?? [],
          exportColumns(named.linear, LINEAR_COLUMNS, omit),
        )
      : kind === "pti"
        ? recordsToCsv(
            named.pti ?? [],
            exportColumns(named.pti, PTI_COLUMNS, omit),
          )
        : recordsToCsv(
            named.individuals ?? [],
            exportColumns(named.individuals, INDIVIDUAL_COLUMNS, omit),
          );
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
