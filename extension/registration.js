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

/** Breed + digits, so PD2237546 and D2237546 match. */
export function identityKey(reg) {
  const adga = toAdgaRegistration(reg);
  const cert = adga.match(/^([PAGR])([A-Z])(\d+)$/);
  if (cert) return `${cert[2]}${cert[3]}`;
  return adga;
}
