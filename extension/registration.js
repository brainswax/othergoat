/**
 * Genetics RegNumber is breed + zero-padded digits (D002237546).
 * ADGA papers use status + breed + digits (PD2237546).
 */

const STATUS_LETTERS = new Set(["P", "A", "G", "R"]);
const BREED_LETTERS = new Set([
  "A",
  "B",
  "C",
  "D",
  "E",
  "L",
  "N",
  "S",
  "T",
  "X",
  "R",
]);

/** Pedigree link title: ` PB D001822638 born 4/16/2016 `. */
export function parsePedigreeLinkTitle(title) {
  const text = String(title ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const herdbook = (text.match(
    /\b(PB|AM|GR|RE|Purebred|American|Grade|Recorded)\b/i,
  ) ?? [])[1];
  const reg = (text.match(/\b([A-Z]\d{8,12})\b/i) ?? [])[1];
  const dob = (text.match(/\bborn\s+(\d{1,2}\/\d{1,2}\/\d{4})/i) ?? [])[1];
  return {
    herdbook: herdbook ? herdbook.toUpperCase() : "",
    reg_number: reg ? reg.toUpperCase() : "",
    date_of_birth: dob ?? "",
  };
}

/** Paper id only when Genetics id and herdbook are both known. */
export function paperIdFromGenetics(regNumber, herdbook) {
  const genetics = toGeneticsRegNumber(regNumber);
  if (!genetics || !herdbookToStatus(herdbook)) return "";
  return toAdgaRegistration(genetics, herdbook);
}

/** True when the value is already a paper id (P/A/G/R + breed + digits). */
export function isPaperRegistration(value) {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
  const cert = raw.match(/^([PAGR])([A-Z])0*(\d+)$/);
  return Boolean(
    cert && STATUS_LETTERS.has(cert[1]) && BREED_LETTERS.has(cert[2]),
  );
}

export function hasReliablePaperId(row) {
  if (isPaperRegistration(row?.registration_number)) return true;
  return Boolean(
    paperIdFromGenetics(
      row?.reg_number || row?.registration_number,
      row?.herdbook,
    ),
  );
}

export function herdbookToStatus(herdbook) {
  const h = String(herdbook ?? "")
    .trim()
    .toUpperCase();
  if (!h) return "";
  if (/^P(B)?$/.test(h) || h.includes("PURE")) return "P";
  if (/^A(M)?$/.test(h) || h.includes("AMERICAN")) return "A";
  if (/^G(R)?$/.test(h) || h.includes("GRADE")) return "G";
  if (/^R(E)?$/.test(h) || h.includes("RECORD")) return "R";
  return "";
}

/**
 * @param {string} value Genetics RegNumber or certificate-style ID
 * @param {string} [herdbook] PB / American / Grade / …
 */
export function toAdgaRegistration(value, herdbook = "") {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
  if (!raw) return "";

  const cert = raw.match(/^([PAGR])([A-Z])0*(\d+)$/);
  if (cert && STATUS_LETTERS.has(cert[1]) && BREED_LETTERS.has(cert[2])) {
    return `${cert[1]}${cert[2]}${cert[3]}`;
  }

  const genetics = raw.match(/^([A-Z])0*(\d+)$/);
  if (genetics && BREED_LETTERS.has(genetics[1])) {
    const status = herdbookToStatus(herdbook);
    return status ? `${status}${genetics[1]}${genetics[2]}` : `${genetics[1]}${genetics[2]}`;
  }
  return raw;
}

export const BREED_NAMES = {
  A: "Alpine",
  B: "Oberhasli",
  C: "Sable",
  D: "Nigerian Dwarf",
  E: "Experimental",
  L: "LaMancha",
  N: "Nubian",
  S: "Saanen",
  T: "Toggenburg",
  R: "Guernsey",
  X: "Unknown",
};

/** Breed + digits, so PD2237546 and D2237546 match. */
export function identityKey(reg) {
  const adga = toAdgaRegistration(reg);
  const cert = adga.match(/^([PAGR])([A-Z])(\d+)$/);
  if (cert) return `${cert[2]}${cert[3]}`;
  return adga;
}

/** Genetics query value: breed + zero-padded digits (D002237546). */
export function toGeneticsRegNumber(value) {
  const key = identityKey(value);
  const match = key.match(/^([A-Z])(\d+)$/);
  if (!match || !BREED_NAMES[match[1]]) return "";
  return `${match[1]}${match[2].padStart(9, "0")}`;
}

/** ADGA Goat Id / paper digits. `D002434405`, `PD2434405`, and `2434405` are the same. */
export function toAdgaSerial(value) {
  const genetics = toGeneticsRegNumber(value);
  if (genetics) return genetics.slice(1).replace(/^0+/, "");
  const raw = String(value ?? "")
    .trim()
    .replace(/[\s-]+/g, "");
  if (/^\d+$/.test(raw)) return raw.replace(/^0+/, "");
  return "";
}

/**
 * GoatDetail URL for a registration. Prefer source_url when it already
 * points at this animal; otherwise rebuild from the paper / Genetics ID.
 */
export function goatDetailUrl(registration, sourceUrl = "", view = "") {
  let href = "";
  try {
    if (sourceUrl) {
      const parsed = new URL(sourceUrl);
      if (
        /genetics\.adga\.org$/i.test(parsed.hostname) &&
        /GoatDetail\.aspx/i.test(parsed.pathname)
      ) {
        const fromPage = (parsed.searchParams.get("RegNumber") ?? "").trim();
        if (fromPage && identityKey(fromPage) === identityKey(registration)) {
          href = sourceUrl;
        }
      }
    }
  } catch {
    /* rebuild below */
  }
  if (!href) {
    const genetics = toGeneticsRegNumber(registration);
    href = genetics
      ? `https://genetics.adga.org/GoatDetail.aspx?RegNumber=${genetics}`
      : "";
  }
  return withGeneticsView(href, view);
}

function withGeneticsView(href, view) {
  if (!href) return "";
  if (view !== "linear" && !href.includes("#ogr-linear")) return href;
  try {
    const url = new URL(href);
    url.hash = view === "linear" ? "ogr-linear" : "";
    return url.toString();
  } catch {
    return href;
  }
}

/** Genetics / certificate letter, e.g. D from PD2237546 or D002237546. */
export function breedLetter(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (BREED_NAMES[raw]) return raw;
  const key = identityKey(raw);
  const match = key.match(/^([A-Z])/);
  return match && BREED_NAMES[match[1]] ? match[1] : "";
}

export function breedName(value) {
  const letter = breedLetter(value);
  return letter ? BREED_NAMES[letter] : "";
}
