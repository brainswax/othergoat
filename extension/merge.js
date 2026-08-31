import {
  INDIVIDUAL_COLUMNS,
  LINEAR_COLUMNS,
  PTI_COLUMNS,
  emptyStore,
} from "./schema.js";
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

export function ptiKey(row) {
  return String(row?.registration_number ?? "").trim();
}

export function mergeIndividual(existing, incoming) {
  return mergeRow(existing, incoming, INDIVIDUAL_COLUMNS);
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
  return { individuals, linear: linearNext, pti: ptiNext };
}

function sortByNameThenReg(a, b) {
  const name = String(a.registered_name ?? "").localeCompare(
    String(b.registered_name ?? ""),
  );
  if (name !== 0) return name;
  return String(a.registration_number ?? "").localeCompare(
    String(b.registration_number ?? ""),
  );
}

export function storeAsLists(store) {
  const src = store ?? emptyStore();
  return {
    individuals: Object.values(src.individuals ?? {}).sort(sortByNameThenReg),
    linear: Object.values(src.linear ?? {}).sort((a, b) =>
      linearKey(a).localeCompare(linearKey(b)),
    ),
    pti: Object.values(src.pti ?? {}).sort((a, b) =>
      ptiKey(a).localeCompare(ptiKey(b)),
    ),
  };
}
