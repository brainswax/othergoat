import {
  INDIVIDUAL_COLUMNS,
  LINEAR_COLUMNS,
  PTI_COLUMNS,
  compareIndividuals,
  emptyIndividual,
  emptyStore,
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
    if (key === "registration_number") {
      next[key] = incoming[key] || existing?.[key] || "";
      continue;
    }
    if (
      lockParents &&
      (key === "sire_registration" ||
        key === "dam_registration" ||
        key === "sire_reg_number" ||
        key === "dam_reg_number" ||
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
    toGeneticsRegNumber(row?.reg_number || row?.registration_number) ||
    toAdgaSerial(row?.goat_id || row?.reg_number || row?.registration_number) ||
    String(row?.reg_number || row?.registration_number || row?.goat_id || "").trim()
  );
}

function geneticsOf(value) {
  return toGeneticsRegNumber(value) || String(value ?? "").trim();
}

export function linearKey(row) {
  const reg = geneticsOf(row?.reg_number || row?.registration_number);
  const date = String(row?.appraisal_date ?? "").trim();
  const age = String(row?.age ?? "").trim();
  if (!reg) return "";
  return `${reg}|${date || age || "_"}`;
}

export function ptiKey(row, now = new Date()) {
  const reg = geneticsOf(row?.reg_number || row?.registration_number);
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
  const individuals = { ...(next.individuals ?? {}) };
  const linear = { ...(next.linear ?? {}) };
  const pti = { ...(next.pti ?? {}) };

  for (const row of batch?.individuals ?? []) {
    const incomingKey = individualKey(row);
    if (!incomingKey) continue;
    const existingKey =
      Object.keys(individuals).find(
        (key) =>
          geneticsOf(key) === incomingKey ||
          identityKey(key) === identityKey(incomingKey) ||
          geneticsOf(individuals[key]?.reg_number) === incomingKey,
      ) ?? incomingKey;
    const incomingIsSubject =
      Boolean(batch?.subjectRegistration) &&
      identityKey(incomingKey) === identityKey(batch.subjectRegistration);
    const merged = mergeIndividual(individuals[existingKey], row, {
      lockParents: !incomingIsSubject,
    });
    merged.reg_number = incomingKey;
    if (existingKey && existingKey !== incomingKey) {
      delete individuals[existingKey];
    }
    individuals[incomingKey] = merged;
  }
  for (const row of batch?.linear ?? []) {
    const key = linearKey(row);
    if (!key) continue;
    linear[key] = mergeLinear(linear[key], row);
  }
  for (const row of batch?.pti ?? []) {
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
        identityKey(row?.registration_number) === identityKey(reg) ||
        geneticsOf(row?.reg_number) === g ||
        (serial && toAdgaSerial(row?.goat_id || row?.reg_number) === serial)
      );
    });
    return key ? individuals[key] : null;
  };
  const canonPaper = (reg) => {
    if (!reg) return "";
    const hit = findAnimal(reg);
    const built = hit
      ? hit.registration_number ||
        paperIdFromGenetics(hit.reg_number, hit.herdbook)
      : "";
    if (isPaperRegistration(built)) return toAdgaRegistration(built);
    if (isPaperRegistration(reg)) return toAdgaRegistration(reg);
    return "";
  };
  const canonGenetics = (reg) => {
    if (!reg) return "";
    const hit = findAnimal(reg);
    return hit?.reg_number || toGeneticsRegNumber(reg) || reg;
  };
  for (const row of Object.values(individuals)) {
    row.sire_reg_number = canonGenetics(row.sire_reg_number || row.sire_registration);
    row.dam_reg_number = canonGenetics(row.dam_reg_number || row.dam_registration);
    row.sire_registration = canonPaper(row.sire_registration || row.sire_reg_number);
    row.dam_registration = canonPaper(row.dam_registration || row.dam_reg_number);
    row.goat_id = toAdgaSerial(row.goat_id || row.reg_number || row.registration_number);
    row.sire_goat_id = toAdgaSerial(row.sire_goat_id || row.sire_reg_number);
    row.dam_goat_id = toAdgaSerial(row.dam_goat_id || row.dam_reg_number);
  }
  const linearNext = {};
  for (const row of Object.values(linear)) {
    const hit = findAnimal(row.reg_number || row.registration_number || row.goat_id);
    if (hit) {
      row.reg_number = hit.reg_number;
      row.registration_number = hit.registration_number || row.registration_number;
      row.goat_id = hit.goat_id || toAdgaSerial(row.reg_number);
    } else {
      row.goat_id = toAdgaSerial(row.goat_id || row.reg_number || row.registration_number);
    }
    linearNext[linearKey(row)] = row;
  }
  const ptiNext = {};
  for (const row of Object.values(pti)) {
    const hit = findAnimal(row.reg_number || row.registration_number || row.goat_id);
    if (hit) {
      row.reg_number = hit.reg_number;
      row.registration_number = hit.registration_number || row.registration_number;
      row.goat_id = hit.goat_id || toAdgaSerial(row.reg_number);
    } else {
      row.goat_id = toAdgaSerial(row.goat_id || row.reg_number || row.registration_number);
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
        identityKey(individuals[item]?.registration_number) === identityKey(want),
    ) ?? genetics;
  if (!individuals[key]) {
    individuals[key] = {
      ...emptyIndividual(),
      reg_number: genetics,
      registration_number: isPaperRegistration(want)
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
      row?.reg_number || row?.registration_number,
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
              sameAnimal(row?.reg_number || row?.registration_number, want) ||
              sameAnimal(item.split("|")[0], want)
            );
          }) ?? want);
    const row = next.pti[hit];
    delete next.pti[hit];
    const still = Object.values(next.pti).some((item) =>
      sameAnimal(
        item.reg_number || item.registration_number,
        row?.reg_number || row?.registration_number || want,
      ),
    );
    if (!still) {
      clearComplete(
        next.individuals,
        row?.reg_number || row?.registration_number || want,
        "pti_complete",
      );
    }
    return next;
  }

  const hit =
    Object.keys(next.individuals).find(
      (item) =>
        sameAnimal(item, want) ||
        sameAnimal(next.individuals[item]?.reg_number, want) ||
        sameAnimal(next.individuals[item]?.registration_number, want),
    ) ?? want;
  delete next.individuals[hit];
  return next;
}
