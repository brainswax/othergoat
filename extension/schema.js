/** Locked export columns. Join on `goat_id` (ADGA serial). Paper is `adga_reg`; Genetics is `adga_genetics_id`. */

export const FORMAT_ID = "adga-genetics-export";
/** Condensed semver `major.patch`. Same major is compatible. */
export const MANIFEST_VERSION = "1.0";
export const MANIFEST_FILE = "manifest.json";
export const EXPORTER_NAME = "other-goats-records";

export function parseFileVersion(value) {
  const [major, patch] = String(value ?? "0.0").split(".");
  return { major: Number(major) || 0, patch: Number(patch) || 0 };
}

export const INDIVIDUAL_COLUMNS = [
  "adga_reg",
  "adga_genetics_id",
  "goat_id",
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
  "sire_adga_reg",
  "sire_adga_genetics_id",
  "sire_goat_id",
  "dam_adga_reg",
  "dam_adga_genetics_id",
  "dam_goat_id",
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
  return String(a.adga_reg ?? "").localeCompare(String(b.adga_reg ?? ""));
}

/** Same groups as Genetics Linear History / LA reports. */
export const LINEAR_COLUMNS = [
  "adga_reg",
  "adga_genetics_id",
  "goat_id",
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
  "adga_reg",
  "adga_genetics_id",
  "goat_id",
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

/** `major.patch`. Patch = additive. Major = breaking. Same major is compatible. */
export const FILE_VERSIONS = {
  individuals: "2.0",
  linear: "2.0",
  pti: "2.0",
};

/** Older CSV / store keys → current identity columns. */
const IDENTITY_ALIASES = {
  adga_reg: ["registration_number"],
  adga_genetics_id: ["adga_genetics_reg", "reg_number"],
  sire_adga_reg: ["sire_registration"],
  sire_adga_genetics_id: ["sire_adga_genetics_reg", "sire_reg_number"],
  dam_adga_reg: ["dam_registration"],
  dam_adga_genetics_id: ["dam_adga_genetics_reg", "dam_reg_number"],
};

export function normalizeIdentityRow(row) {
  if (!row || typeof row !== "object") return row;
  const next = { ...row };
  for (const [canonical, aliases] of Object.entries(IDENTITY_ALIASES)) {
    if (!String(next[canonical] ?? "").trim()) {
      for (const alias of aliases) {
        if (String(next[alias] ?? "").trim()) {
          next[canonical] = next[alias];
          break;
        }
      }
    }
    for (const alias of aliases) delete next[alias];
  }
  return next;
}

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
  omitEmptyColumns: false,
  omitWithoutPaperId: true,
};

export function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    recordIndividuals: src.recordIndividuals !== false,
    captureAncestry: src.captureAncestry !== false,
    recordProgeny: src.recordProgeny !== false,
    recordPti: src.recordPti !== false,
    recordLinear: src.recordLinear !== false,
    omitEmptyColumns: src.omitEmptyColumns === true,
    omitWithoutPaperId: src.omitWithoutPaperId !== false,
  };
}
