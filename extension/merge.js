import {
  INDIVIDUAL_COLUMNS,
  LINEAR_COLUMNS,
  PTI_COLUMNS,
  compareIndividuals,
  emptyIndividual,
  emptyStore,
  normalizeIdentityRow,
} from "./schema.js";
import { ptiEvalFromCapturedAt } from "./pti.js";
import {
  identityKey,
  isPaperRegistration,
  paperIdFromGenetics,
  toAdgaRegistration,
  toAdgaSerial,
  toGeneticsRegNumber,
} from "./registration.js";

export { identityKey };

function filled(value) {
  return value != null && String(value).trim() !== "";
}

function mergeRow(existing, incoming, columns, opts = {}) {
  const next = { ...(existing ?? {}) };
  const lockParents = Boolean(opts.lockParents);
  for (const key of columns) {
    if (key === "adga_reg") {
      next[key] = incoming[key] || existing?.[key] || "";
      continue;
    }
    if (
      lockParents &&
      (key === "sire_adga_reg" ||
        key === "dam_adga_reg" ||
        key === "sire_adga_genetics_id" ||
        key === "dam_adga_genetics_id" ||
        key === "sire_goat_id" ||
        key === "dam_goat_id") &&
      filled(existing?.[key])
    ) {
      next[key] = existing[key];
      continue;
    }
    if (filled(incoming[key])) next[key] = String(incoming[key]).trim();
    else if (next[key] == null) next[key] = "";
  }
  return next;
}

export function individualKey(row) {
  return (
    toGeneticsRegNumber(row?.adga_genetics_id || row?.adga_reg) ||
    toAdgaSerial(row?.goat_id || row?.adga_genetics_id || row?.adga_reg) ||
    String(row?.adga_genetics_id || row?.adga_reg || row?.goat_id || "").trim()
  );
}

function geneticsOf(value) {
  return toGeneticsRegNumber(value) || String(value ?? "").trim();
}

export function linearKey(row) {
  const reg = geneticsOf(row?.adga_genetics_id || row?.adga_reg);
  const date = String(row?.appraisal_date ?? "").trim();
  const age = String(row?.age ?? "").trim();
  if (!reg) return "";
  return `${reg}|${date || age || "_"}`;
}

export function ptiKey(row, now = new Date()) {
  const reg = geneticsOf(row?.adga_genetics_id || row?.adga_reg);
  if (!reg) return "";
  const { evalYear, evalMonth } = ptiEvalFromCapturedAt(row?.captured_at, now);
  return `${reg}|${evalYear}|${evalMonth}`;
}

/** Identity page beats progeny table; both beat pedigree name colors. */
const FLAG_SOURCE_RANK = { identity: 3, progeny: 2, pedigree: 1 };

function mergeCoatFlags(existing, incoming, next) {
  for (const key of ["polled", "black"]) {
    const fromKey = `${key}_from`;
    const inFrom = String(incoming?.[fromKey] ?? "").trim();
    const exFrom = String(existing?.[fromKey] ?? "").trim();
    const inRank = FLAG_SOURCE_RANK[inFrom] ?? 0;
    const exRank = FLAG_SOURCE_RANK[exFrom] ?? 0;
    if (exRank > inRank) {
      next[key] = existing?.[key] ?? "";
      next[fromKey] = exFrom;
    } else if (inFrom) {
      next[fromKey] = inFrom;
    } else if (exFrom) {
      next[fromKey] = exFrom;
    }
  }
}

export function mergeIndividual(existing, incoming, opts = {}) {
  const next = mergeRow(existing, incoming, INDIVIDUAL_COLUMNS, opts);
  mergeCoatFlags(existing, incoming, next);
  return next;
}

export function mergeLinear(existing, incoming) {
  return mergeRow(existing, incoming, LINEAR_COLUMNS);
}

export function mergePti(existing, incoming) {
  return mergeRow(existing, incoming, PTI_COLUMNS);
}

/**
 * Merge a capture batch into the store. Empty incoming fields never clobber
 * filled values. Later non-empty values replace earlier ones.
 */
export function mergeBatch(store, batch) {
  const next = store ?? emptyStore();
  const individuals = Object.fromEntries(
    Object.entries(next.individuals ?? {}).map(([key, row]) => [
      key,
      normalizeIdentityRow(row),
    ]),
  );
  const linear = Object.fromEntries(
    Object.entries(next.linear ?? {}).map(([key, row]) => [
      key,
      normalizeIdentityRow(row),
    ]),
  );
  const pti = Object.fromEntries(
    Object.entries(next.pti ?? {}).map(([key, row]) => [
      key,
      normalizeIdentityRow(row),
    ]),
  );

  for (const raw of batch?.individuals ?? []) {
    const row = normalizeIdentityRow(raw);
    const incomingKey = individualKey(row);
    if (!incomingKey) continue;
    const existingKey =
      Object.keys(individuals).find(
        (key) =>
          geneticsOf(key) === incomingKey ||
          identityKey(key) === identityKey(incomingKey) ||
          geneticsOf(individuals[key]?.adga_genetics_id) === incomingKey,
      ) ?? incomingKey;
    const incomingIsSubject =
      Boolean(batch?.subjectRegistration) &&
      identityKey(incomingKey) === identityKey(batch.subjectRegistration);
    const merged = mergeIndividual(individuals[existingKey], row, {
      lockParents: !incomingIsSubject,
    });
    merged.adga_genetics_id = incomingKey;
    if (existingKey && existingKey !== incomingKey) {
      delete individuals[existingKey];
    }
    individuals[incomingKey] = merged;
  }
  for (const raw of batch?.linear ?? []) {
    const row = normalizeIdentityRow(raw);
    const key = linearKey(row);
    if (!key) continue;
    linear[key] = mergeLinear(linear[key], row);
  }
  for (const raw of batch?.pti ?? []) {
    const row = normalizeIdentityRow(raw);
    const key = ptiKey(row);
    if (!key) continue;
    pti[key] = mergePti(pti[key], row);
  }

  const findAnimal = (reg) => {
    if (!reg) return null;
    const g = geneticsOf(reg);
    if (individuals[g]) return individuals[g];
    const serial = toAdgaSerial(reg);
    const key = Object.keys(individuals).find((item) => {
      const row = individuals[item];
      return (
        identityKey(item) === identityKey(reg) ||
        identityKey(row?.adga_reg) === identityKey(reg) ||
        geneticsOf(row?.adga_genetics_id) === g ||
        (serial && toAdgaSerial(row?.goat_id || row?.adga_genetics_id) === serial)
      );
    });
    return key ? individuals[key] : null;
  };
  const canonPaper = (reg) => {
    if (!reg) return "";
    const hit = findAnimal(reg);
    const built = hit
      ? hit.adga_reg ||
        paperIdFromGenetics(hit.adga_genetics_id, hit.herdbook)
      : "";
    if (isPaperRegistration(built)) return toAdgaRegistration(built);
    if (isPaperRegistration(reg)) return toAdgaRegistration(reg);
    return "";
  };
  const canonGenetics = (reg) => {
    if (!reg) return "";
    const hit = findAnimal(reg);
    return hit?.adga_genetics_id || toGeneticsRegNumber(reg) || reg;
  };
  for (const row of Object.values(individuals)) {
    row.sire_adga_genetics_id = canonGenetics(row.sire_adga_genetics_id || row.sire_adga_reg);
    row.dam_adga_genetics_id = canonGenetics(row.dam_adga_genetics_id || row.dam_adga_reg);
    row.sire_adga_reg = canonPaper(row.sire_adga_reg || row.sire_adga_genetics_id);
    row.dam_adga_reg = canonPaper(row.dam_adga_reg || row.dam_adga_genetics_id);
    row.goat_id = toAdgaSerial(row.goat_id || row.adga_genetics_id || row.adga_reg);
    row.sire_goat_id = toAdgaSerial(row.sire_goat_id || row.sire_adga_genetics_id);
    row.dam_goat_id = toAdgaSerial(row.dam_goat_id || row.dam_adga_genetics_id);
  }
  const linearNext = {};
  for (const row of Object.values(linear)) {
    const hit = findAnimal(row.adga_genetics_id || row.adga_reg || row.goat_id);
    if (hit) {
      row.adga_genetics_id = hit.adga_genetics_id;
      row.adga_reg = hit.adga_reg || row.adga_reg;
      row.goat_id = hit.goat_id || toAdgaSerial(row.adga_genetics_id);
    } else {
      row.goat_id = toAdgaSerial(row.goat_id || row.adga_genetics_id || row.adga_reg);
    }
    linearNext[linearKey(row)] = row;
  }
  const ptiNext = {};
  for (const row of Object.values(pti)) {
    const hit = findAnimal(row.adga_genetics_id || row.adga_reg || row.goat_id);
    if (hit) {
      row.adga_genetics_id = hit.adga_genetics_id;
      row.adga_reg = hit.adga_reg || row.adga_reg;
      row.goat_id = hit.goat_id || toAdgaSerial(row.adga_genetics_id);
    } else {
      row.goat_id = toAdgaSerial(row.goat_id || row.adga_genetics_id || row.adga_reg);
    }
    ptiNext[ptiKey(row)] = row;
  }
  const subject = batch?.subjectRegistration || "";
  if (batch?.linearComplete) setComplete(individuals, subject, "linear_complete");
  if (batch?.ptiComplete) setComplete(individuals, subject, "pti_complete");
  return { individuals, linear: linearNext, pti: ptiNext };
}

/** Re-key stored PTI rows (registration-only keys → registration|year|month). */
export function normalizeStore(store) {
  const src = store && typeof store === "object" ? store : emptyStore();
  return mergeBatch(
    {
      individuals: src.individuals ?? {},
      linear: src.linear ?? {},
      pti: {},
    },
    { pti: Object.values(src.pti ?? {}) },
  );
}

function setComplete(individuals, registration, field) {
  const row = ensureIndividual(individuals, registration);
  if (row) row[field] = true;
}

function ensureIndividual(individuals, registration) {
  const want = String(registration ?? "").trim();
  if (!want) return null;
  const genetics = geneticsOf(want);
  const key =
    Object.keys(individuals).find(
      (item) =>
        geneticsOf(item) === genetics ||
        identityKey(item) === identityKey(want) ||
        identityKey(individuals[item]?.adga_reg) === identityKey(want),
    ) ?? genetics;
  if (!individuals[key]) {
    individuals[key] = {
      ...emptyIndividual(),
      adga_genetics_id: genetics,
      adga_reg: isPaperRegistration(want)
        ? toAdgaRegistration(want)
        : "",
    };
  }
  return individuals[key];
}

function clearComplete(individuals, registration, field) {
  const want = String(registration ?? "").trim();
  if (!want) return;
  const key = Object.keys(individuals).find(
    (item) => identityKey(item) === identityKey(want),
  );
  if (!key) return;
  individuals[key] = { ...individuals[key], [field]: false };
}

export function storeAsLists(store) {
  const src = store ?? emptyStore();
  return {
    individuals: Object.values(src.individuals ?? {}).sort(compareIndividuals),
    linear: Object.values(src.linear ?? {}).sort((a, b) =>
      linearKey(a).localeCompare(linearKey(b)),
    ),
    pti: Object.values(src.pti ?? {}).sort((a, b) =>
      ptiKey(a).localeCompare(ptiKey(b)),
    ),
  };
}

function sameAnimal(a, b) {
  const ga = toGeneticsRegNumber(a);
  const gb = toGeneticsRegNumber(b);
  if (ga && gb) return ga === gb;
  return Boolean(a) && identityKey(a) === identityKey(b);
}

/**
 * Drop one captured row. Other tables are left alone.
 */
export function removeRow(store, kind, key) {
  const next = {
    individuals: { ...(store?.individuals ?? {}) },
    linear: { ...(store?.linear ?? {}) },
    pti: { ...(store?.pti ?? {}) },
  };
  const want = String(key ?? "").trim();
  if (!want) return next;

  if (kind === "linear") {
    const row = next.linear[want];
    delete next.linear[want];
    clearComplete(
      next.individuals,
      row?.adga_genetics_id || row?.adga_reg,
      "linear_complete",
    );
    return next;
  }
  if (kind === "pti") {
    const hit =
      next.pti[want] != null
        ? want
        : (Object.keys(next.pti).find((item) => {
            const row = next.pti[item];
            return (
              sameAnimal(row?.adga_genetics_id || row?.adga_reg, want) ||
              sameAnimal(item.split("|")[0], want)
            );
          }) ?? want);
    const row = next.pti[hit];
    delete next.pti[hit];
    const still = Object.values(next.pti).some((item) =>
      sameAnimal(
        item.adga_genetics_id || item.adga_reg,
        row?.adga_genetics_id || row?.adga_reg || want,
      ),
    );
    if (!still) {
      clearComplete(
        next.individuals,
        row?.adga_genetics_id || row?.adga_reg || want,
        "pti_complete",
      );
    }
    return next;
  }

  const hit =
    Object.keys(next.individuals).find(
      (item) =>
        sameAnimal(item, want) ||
        sameAnimal(next.individuals[item]?.adga_genetics_id, want) ||
        sameAnimal(next.individuals[item]?.adga_reg, want),
    ) ?? want;
  delete next.individuals[hit];
  return next;
}
