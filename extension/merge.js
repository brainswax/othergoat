import {
  INDIVIDUAL_COLUMNS,
  LINEAR_COLUMNS,
  PTI_COLUMNS,
  compareIndividuals,
  emptyIndividual,
  emptyStore,
} from "./schema.js";
import { ptiEvalFromCapturedAt } from "./pti.js";
import { identityKey } from "./registration.js";

export { identityKey };

function filled(value) {
  return value != null && String(value).trim() !== "";
}

function mergeRow(existing, incoming, columns) {
  const next = { ...(existing ?? {}) };
  for (const key of columns) {
    if (key === "registration_number") {
      next[key] = incoming[key] || existing?.[key] || "";
      continue;
    }
    if (filled(incoming[key])) next[key] = String(incoming[key]).trim();
    else if (next[key] == null) next[key] = "";
  }
  return next;
}

export function individualKey(row) {
  return String(row?.registration_number ?? "").trim();
}

export function linearKey(row) {
  const reg = String(row?.registration_number ?? "").trim();
  const date = String(row?.appraisal_date ?? "").trim();
  const age = String(row?.age ?? "").trim();
  if (!reg) return "";
  return `${reg}|${date || age || "_"}`;
}

export function ptiKey(row, now = new Date()) {
  const reg = String(row?.registration_number ?? "").trim();
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

export function mergeIndividual(existing, incoming) {
  const next = mergeRow(existing, incoming, INDIVIDUAL_COLUMNS);
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
      Object.keys(individuals).find((key) => identityKey(key) === identityKey(incomingKey)) ??
      incomingKey;
    const merged = mergeIndividual(individuals[existingKey], row);
    merged.registration_number =
      incomingKey.length >= (existingKey?.length ?? 0) ? incomingKey : existingKey;
    if (existingKey && existingKey !== merged.registration_number) {
      delete individuals[existingKey];
    }
    individuals[merged.registration_number] = merged;
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

  const canon = (reg) => {
    if (!reg) return "";
    const hit = Object.keys(individuals).find((key) => identityKey(key) === identityKey(reg));
    return hit || reg;
  };
  for (const row of Object.values(individuals)) {
    row.sire_registration = canon(row.sire_registration);
    row.dam_registration = canon(row.dam_registration);
  }
  const linearNext = {};
  for (const row of Object.values(linear)) {
    row.registration_number = canon(row.registration_number) || row.registration_number;
    linearNext[linearKey(row)] = row;
  }
  const ptiNext = {};
  for (const row of Object.values(pti)) {
    row.registration_number = canon(row.registration_number) || row.registration_number;
    ptiNext[ptiKey(row)] = row;
  }
  const subject = canon(batch?.subjectRegistration) || batch?.subjectRegistration;
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
  const key =
    Object.keys(individuals).find((item) => identityKey(item) === identityKey(want)) ??
    want;
  if (!individuals[key]) {
    individuals[key] = { ...emptyIndividual(), registration_number: want };
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
  return identityKey(a) === identityKey(b);
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
    clearComplete(next.individuals, row?.registration_number, "linear_complete");
    return next;
  }
  if (kind === "pti") {
    const hit =
      next.pti[want] != null
        ? want
        : (Object.keys(next.pti).find((item) => {
            const row = next.pti[item];
            return (
              sameAnimal(row?.registration_number, want) ||
              sameAnimal(item.split("|")[0], want)
            );
          }) ?? want);
    const row = next.pti[hit];
    delete next.pti[hit];
    const still = Object.values(next.pti).some((item) =>
      sameAnimal(item.registration_number, row?.registration_number ?? want),
    );
    if (!still) {
      clearComplete(next.individuals, row?.registration_number ?? want, "pti_complete");
    }
    return next;
  }

  const hit =
    Object.keys(next.individuals).find((item) => sameAnimal(item, want)) ?? want;
  delete next.individuals[hit];
  return next;
}
