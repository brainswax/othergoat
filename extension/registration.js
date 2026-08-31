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

/**
 * GoatDetail URL for a registration. Prefer source_url when it already
 * points at this animal; otherwise rebuild from the paper / Genetics ID.
 */
export function goatDetailUrl(registration, sourceUrl = "") {
  try {
    if (sourceUrl) {
      const parsed = new URL(sourceUrl);
      if (
        /genetics\.adga\.org$/i.test(parsed.hostname) &&
        /GoatDetail\.aspx/i.test(parsed.pathname)
      ) {
        const fromPage = (parsed.searchParams.get("RegNumber") ?? "").trim();
        if (fromPage && identityKey(fromPage) === identityKey(registration)) {
          return sourceUrl;
        }
      }
    }
  } catch {
    /* rebuild below */
  }
  const genetics = toGeneticsRegNumber(registration);
  return genetics
    ? `https://genetics.adga.org/GoatDetail.aspx?RegNumber=${genetics}`
    : "";
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
