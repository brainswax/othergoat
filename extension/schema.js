/** Locked first-round export columns. Join tables on registration_number. */

export const INDIVIDUAL_COLUMNS = [
  "registration_number",
  "registered_name",
  "breed",
  "breed_percent",
  "herdbook",
  "polled",
  "sex",
  "date_of_birth",
  "linear_final_score",
  "sire_registration",
  "dam_registration",
  "source_url",
  "captured_at",
  "notes",
];

/** Same left-to-right order as ADGA Genetics Linear History. */
export const LINEAR_COLUMNS = [
  "registration_number",
  "appraisal_date",
  "age",
  "stat",
  "st",
  "dy",
  "ra",
  "rw",
  "rls",
  "fua",
  "ruh",
  "rua",
  "msl",
  "ud",
  "tp",
  "td",
  "tl",
  "bd",
  "rusv",
  "final_score",
  "majors",
  "source_url",
  "captured_at",
  "notes",
];

export const LA_TRAIT_KEYS = [
  "stat",
  "st",
  "dy",
  "ra",
  "rw",
  "rls",
  "fua",
  "ruh",
  "rua",
  "msl",
  "ud",
  "tp",
  "td",
  "tl",
  "bd",
  "rusv",
];

export const PTI_COLUMNS = [
  "registration_number",
  "pti21",
  "pti12",
  "eta21",
  "eta12",
  "source_url",
  "captured_at",
];

export const STORE_FILES = {
  individuals: "individuals.csv",
  linear: "linear_appraisals.csv",
  pti: "pti.csv",
};

export function emptyIndividual() {
  return Object.fromEntries(INDIVIDUAL_COLUMNS.map((key) => [key, ""]));
}

export function emptyLinear() {
  return Object.fromEntries(LINEAR_COLUMNS.map((key) => [key, ""]));
}

export function emptyPti() {
  return Object.fromEntries(PTI_COLUMNS.map((key) => [key, ""]));
}

export function emptyStore() {
  return { individuals: {}, linear: {}, pti: {} };
}

export function emptyBatch() {
  return { view: "", eventArgument: "", eventTarget: "", individuals: [], linear: [], pti: [] };
}

/** Capture toggles. All on until the user opts out. */
export const DEFAULT_SETTINGS = {
  recordIndividuals: true,
  captureAncestry: true,
  recordPti: true,
  recordLinear: true,
};

export function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    recordIndividuals: src.recordIndividuals !== false,
    captureAncestry: src.captureAncestry !== false,
    recordPti: src.recordPti !== false,
    recordLinear: src.recordLinear !== false,
  };
}
