/** Locked export columns. Join tables on registration_number. */

export const FORMAT_ID = "adga-genetics-export";
export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE = "manifest.json";
export const EXPORTER_NAME = "other-goats-records";

export const INDIVIDUAL_COLUMNS = [
  "registration_number",
  "registered_name",
  "title",
  "breed",
  "breed_percent",
  "herdbook",
  "polled",
  "black",
  "sex",
  "date_of_birth",
  "linear_final_score",
  "linear_majors",
  "linear_age",
  "sire_registration",
  "dam_registration",
  "owner_id",
  "owner_name",
  "breeder_id",
  "breeder_name",
  "tattoo_re",
  "tattoo_le",
  "tattoo_comment",
  "eid",
  "eid_location",
  "ears",
  "horns",
  "conforms",
  "description",
  "status",
  "breeding_method",
  "application_id",
  "file_app_id",
  "format_1",
  "goat_id",
  "source_url",
  "captured_at",
  "notes",
];

/**
 * GoatDetail identity pane — filled by visiting that animal, not by a
 * pedigree/progeny stub. Polled, black, title, FS, majors, age, sire/dam, PTI, and LA are optional.
 */
export const INDIVIDUAL_IDENTITY_FIELDS = [
  "registered_name",
  "sex",
  "herdbook",
  "date_of_birth",
  "breed",
  "breed_percent",
];

export function isIndividualComplete(row) {
  return INDIVIDUAL_IDENTITY_FIELDS.every(
    (key) => String(row?.[key] ?? "").trim() !== "",
  );
}

export function isLinearComplete(row) {
  return Boolean(row?.linear_complete);
}

export function isPtiComplete(row) {
  return Boolean(row?.pti_complete);
}

/** found = have data, empty = visited with none, missing = not visited. */
export function scrapeStatus(visited, hasData) {
  if (hasData && visited !== false) return "found";
  if (visited === true && !hasData) return "empty";
  return "missing";
}

/** Complete animals first (ID check), then registered name, then registration. */
export function compareIndividuals(a, b) {
  const complete =
    Number(isIndividualComplete(b)) - Number(isIndividualComplete(a));
  if (complete !== 0) return complete;
  const name = String(a.registered_name ?? "").localeCompare(
    String(b.registered_name ?? ""),
  );
  if (name !== 0) return name;
  return String(a.registration_number ?? "").localeCompare(
    String(b.registration_number ?? ""),
  );
}

/** Same groups as Genetics Linear History / LA reports. */
export const LINEAR_COLUMNS = [
  "registration_number",
  "registered_name",
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
  "head",
  "shoulder",
  "front_legs",
  "rear_legs",
  "feet",
  "back",
  "rump",
  "udder_texture",
  "ga",
  "ds",
  "bc",
  "ms",
  "final_score",
  "misc1",
  "misc2",
  "misc3",
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
  "registered_name",
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

/** Bump only the table whose meaning changed. Extra columns do not bump. */
export const FILE_VERSIONS = {
  individuals: 1,
  linear: 1,
  pti: 1,
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
  return {
    view: "",
    eventArgument: "",
    eventTarget: "",
    individuals: [],
    linear: [],
    pti: [],
    subjectRegistration: "",
    linearComplete: false,
    ptiComplete: false,
  };
}

/** Capture toggles. All on until the user opts out. */
export const DEFAULT_SETTINGS = {
  recordIndividuals: true,
  captureAncestry: true,
  recordProgeny: true,
  recordPti: true,
  recordLinear: true,
};

export function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    recordIndividuals: src.recordIndividuals !== false,
    captureAncestry: src.captureAncestry !== false,
    recordProgeny: src.recordProgeny !== false,
    recordPti: src.recordPti !== false,
    recordLinear: src.recordLinear !== false,
  };
}
