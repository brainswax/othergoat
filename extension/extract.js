/**
 * Parse an ADGA Genetics GoatDetail view the user already opened.
 * Returns a batch of individuals + LA + PTI. Missing fields stay empty.
 */

import {
  emptyBatch,
  emptyIndividual,
  emptyLinear,
  emptyPti,
  normalizeSettings,
} from "./schema.js";
import { identityKey, toAdgaRegistration } from "./registration.js";

export { normalizeSettings } from "./schema.js";

const REG_IN_TEXT = /[A-Z]\d{8,12}/i;
const MENU_CELLS = new Set([
  "pedigree",
  "inbreeding",
  "line breeding",
  "progeny",
  "linear history",
  "cdcb data",
  "production eval",
  "type eval",
  "pti/eta",
  "format page for printing",
]);

/** Genetics Linear History column order after LAYear + Age. */
const GENETICS_LINEAR_ORDER = [
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

const TRAIT_HEADER_ALIASES = {
  stat: ["stat", "stature"],
  bd: ["bd", "body depth"],
  st: ["st", "strength"],
  dy: ["dy", "dairyness", "dairy"],
  ra: ["ra", "rump angle"],
  rw: ["rw", "rump width"],
  rls: ["rls", "rear legs", "rear leg side view", "rear leg"],
  fua: ["fua", "fore udder attachment", "fore udder"],
  ruh: ["ruh", "rear udder height"],
  rua: ["rua", "rear udder arch"],
  msl: ["msl", "medial", "medial suspensory ligament"],
  ud: ["ud", "udder depth"],
  tp: ["tp", "teat placement"],
  td: ["td", "teat diameter"],
  tl: ["tl", "teat length"],
  rusv: ["rusv", "rear udder side view"],
};

/** Genetics Structural Traits table, then the four major categories. */
const STRUCTURAL_HEADER_ALIASES = {
  head: ["head"],
  shoulder: ["shoulder", "shoulder assembly"],
  front_legs: ["front legs", "legs front"],
  rear_legs: ["rear legs", "legs rear", "back legs"],
  feet: ["feet"],
  back: ["back"],
  rump: ["rump"],
  udder_texture: ["udder texture"],
  ga: ["ga", "general appearance"],
  ds: ["ds", "dairy strength"],
  bc: ["bc", "body capacity"],
  ms: ["ms", "mammary", "mammary system"],
};

const MISC_HEADER_ALIASES = {
  misc1: ["misc1", "misc 1", "code1", "code 1", "remark1", "remark 1"],
  misc2: ["misc2", "misc 2", "code2", "code 2", "remark2", "remark 2"],
  misc3: ["misc3", "misc 3", "code3", "code 3", "remark3", "remark 3"],
};

const GENETICS_STRUCTURAL_ORDER = [
  "head",
  "shoulder",
  "front_legs",
  "rear_legs",
  "feet",
  "back",
  "rump",
  "udder_texture",
];

const GENETICS_MAJOR_ORDER = ["ga", "ds", "bc", "ms"];

export function registrationFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/genetics\.adga\.org$/i.test(parsed.hostname)) return "";
    if (!/GoatDetail\.aspx/i.test(parsed.pathname)) return "";
    return (parsed.searchParams.get("RegNumber") ?? "").trim();
  } catch {
    return "";
  }
}

export function registrationFromHref(href) {
  try {
    const parsed = new URL(href, "https://genetics.adga.org/");
    return (parsed.searchParams.get("RegNumber") ?? "").trim();
  } catch {
    const match = String(href).match(/RegNumber=([A-Z]\d{8,12})/i);
    return match ? match[1].toUpperCase() : "";
  }
}

export function collapse(text) {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pedigree UI prefixes like "SS :" are not part of the registered name. */
export function stripPedigreeLabel(name) {
  return collapse(name).replace(/^(?:[SD]{1,8})\s*:\s*/i, "");
}

function headerKey(cell) {
  return collapse(cell).toLowerCase().replace(/[.]+$/g, "");
}

function headerIndex(headers, ...aliases) {
  const want = aliases.map((alias) => alias.toLowerCase());
  return headers.findIndex((cell) => want.includes(headerKey(cell)));
}

export function parseHeading(heading, registration) {
  if (!registration) {
    return { registered_name: "", sex: "", herdbook: "", notes: "" };
  }
  const escaped = registration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `^(.+?)\\s*-\\s*${escaped}\\s*(?:\\(([^)]*)\\))?`,
    "i",
  );
  const lines = String(heading ?? "").split(/\n/);
  for (const line of lines) {
    const text = collapse(line);
    if (!text || text.length > 160) continue;
    const match = text.match(re);
    if (!match) continue;
    const name = collapse(match[1])
      .replace(/^(?:goat detail:|appraisal history for:|type evaluation for:)\s*/i, "")
      .trim();
    if (!name || name.length > 80) continue;
    const paren = match[2] ?? "";
    let sex = "";
    if (/\bDoe\b/i.test(paren)) sex = "DOE";
    else if (/\bBuck\b/i.test(paren)) sex = "BUCK";
    const herdbook = collapse((paren.match(/\b(PB|AM|GR|RE)\b/i) ?? [])[1] ?? "");
    return {
      registered_name: name,
      sex,
      herdbook: herdbook.toUpperCase(),
      notes: collapse(paren),
    };
  }
  return { registered_name: "", sex: "", herdbook: "", notes: "" };
}

export function parseDobAndAppraisal(text) {
  const blob = collapse(text);
  const dob = blob.match(/DOB:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const fs = blob.match(/\bFS\s*(\d{2,3})\b/i);
  const majors = blob.match(/\(([+\-EVGPevgp\s]{2,})\)/);
  const age = blob.match(/@\s*(\d{2}-\d{2})/);
  const notes = [];
  if (majors) notes.push(collapse(majors[1]));
  if (age) notes.push(`age ${age[1]}`);
  return {
    date_of_birth: dob?.[1] ?? "",
    linear_final_score: fs?.[1] ?? "",
    notes: notes.join(" · "),
  };
}

export function parseBreedPercent(text) {
  const match = collapse(text).match(
    /Breed Percent:\s*([\d.]+)\s*%\s*([A-Z]+)/i,
  );
  if (!match) return { breed: "", breed_percent: "" };
  return { breed: match[2].toUpperCase(), breed_percent: match[1] };
}

export function parsePolled(text) {
  const blob = collapse(text);
  if (/\bpolled\b/i.test(blob) && !/\bispolled\b/i.test(blob)) return "Y";
  return "";
}

export function parseBlack(text) {
  const blob = collapse(text);
  if (/\bblack\b/i.test(blob) && !/\bisblack\b/i.test(blob)) return "Y";
  return "";
}

function parseCssColor(value) {
  const s = collapse(value).toLowerCase();
  if (!s || s === "transparent" || s === "inherit" || s === "currentcolor") {
    return null;
  }
  const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) {
      h = [...h].map((ch) => ch + ch).join("");
    }
    return {
      r: Number.parseInt(h.slice(0, 2), 16),
      g: Number.parseInt(h.slice(2, 4), 16),
      b: Number.parseInt(h.slice(4, 6), 16),
    };
  }
  const named = {
    red: { r: 255, g: 0, b: 0 },
    maroon: { r: 128, g: 0, b: 0 },
    green: { r: 0, g: 128, b: 0 },
    lime: { r: 0, g: 255, b: 0 },
    darkgreen: { r: 0, g: 100, b: 0 },
    black: { r: 0, g: 0, b: 0 },
    blue: { r: 0, g: 0, b: 255 },
    navy: { r: 0, g: 0, b: 128 },
  };
  return named[s] ?? null;
}

function colorKind(rgb) {
  if (!rgb) return "";
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 30 && max <= 50) return "black";
  if (r >= 150 && r > g + 40 && r > b + 40) return "red";
  if (g >= 100 && g > r + 25 && g >= b) return "green";
  if (b >= 100 && b >= r && b >= g) return "blue";
  return "other";
}

function ignoreBlackCoatColor(links) {
  const kinds = (links ?? [])
    .map((link) => colorKind(parseCssColor(link.color)))
    .filter(Boolean);
  if (kinds.length === 0) return true;
  const blacks = kinds.filter((kind) => kind === "black").length;
  return blacks * 2 >= kinds.length;
}

function flagsFromLinkStyle(link, skipBlackColor = false) {
  let polled = "";
  let black = "";
  const cls = collapse(link?.className).toLowerCase();
  if (/\bpolled\b/.test(cls)) polled = "Y";
  if (/\bblack\b/.test(cls)) black = "Y";
  const colorKindValue = colorKind(parseCssColor(link?.color));
  const bgKind = colorKind(parseCssColor(link?.backgroundColor));
  for (const kind of [colorKindValue, bgKind]) {
    if (kind === "green") polled = "Y";
    if (kind === "red") {
      polled = "Y";
      black = "Y";
    }
  }
  if (colorKindValue === "black" && !skipBlackColor) black = "Y";
  return { polled, black };
}

function pedigreeFlags(link, skipBlackColor = false) {
  const marks = flagsFromLinkStyle(link, skipBlackColor);
  return {
    polled: marks.polled === "Y" ? "Y" : "N",
    black: marks.black === "Y" ? "Y" : "N",
  };
}

export function parseIndexes(text) {
  const blob = collapse(text);
  const grab = (label) =>
    blob.match(
      new RegExp(`\\b${label}\\s*:?\\s*(-?\\d+(?:\\.\\d+)?)`, "i"),
    )?.[1] ?? "";
  return {
    pti21: grab("PTI\\s*21"),
    pti12: grab("PTI\\s*12"),
    eta21: grab("ETA\\s*21"),
    eta12: grab("ETA\\s*12"),
  };
}

function isMenuCell(value) {
  return MENU_CELLS.has(collapse(value).toLowerCase());
}

function looksLikeTypeEvalTable(table) {
  const blob = (table?.rows ?? []).flat().join(" ").toLowerCase();
  return (
    blob.includes("type evaluation") ||
    blob.includes("traitavg") ||
    (blob.includes("pta") && blob.includes("rel"))
  );
}

function looksLikeProgenyTable(table) {
  const rows = table?.rows ?? [];
  if (rows.length < 2) return false;
  const headers = rows[0].map((cell) => collapse(cell));
  if (headers.length < 5) return false;
  if (headers.some((cell) => cell.length > 40 || isMenuCell(cell))) return false;
  const nameI = headerIndex(headers, "name");
  const regI = headerIndex(headers, "reg #", "reg#", "reg no", "reg no.", "reg number");
  if (nameI < 0 || regI < 0 || nameI === regI) return false;
  return rows.slice(1).some((cells) => {
    const name = collapse(cells[nameI]);
    const registration = collapse(cells[regI]);
    return name.length > 0 && name.length <= 80 && REG_IN_TEXT.test(registration);
  });
}

function looksLikeLinearTraitTable(table) {
  if (looksLikeTypeEvalTable(table)) return false;
  const headers = (table?.rows?.[0] ?? []).map((cell) => headerKey(cell));
  if (headers.length < 8) return false;
  if (headers.some((cell) => cell.length > 40)) return false;
  const hasYear = headers.some((h) => h === "layear" || h === "year");
  const hasAge = headers.includes("age");
  const hasStat = headers.some((h) => h === "stature" || h === "stat");
  return hasYear && hasAge && hasStat;
}

function looksLikeStructuralTable(table) {
  const headers = (table?.rows?.[0] ?? []).map((cell) => headerKey(cell));
  const hasYear = headers.some((h) => h === "layear" || h === "year");
  const hasAge = headers.includes("age");
  const hasStructural =
    headers.includes("head") ||
    headers.includes("shoulder assembly") ||
    headers.includes("udder texture") ||
    headers.includes("fs") ||
    headers.some((h) => h.includes("general appearance") || h === "ga");
  return hasYear && hasAge && hasStructural && !looksLikeLinearTraitTable(table);
}

function looksLikeMiscTable(table) {
  if (looksLikeLinearTraitTable(table) || looksLikeStructuralTable(table)) {
    return false;
  }
  const headers = (table?.rows?.[0] ?? []).map((cell) => headerKey(cell));
  const hasYear = headers.some((h) => h === "layear" || h === "year");
  const hasAge = headers.includes("age");
  if (!hasYear || !hasAge) return false;
  return headers.some(
    (h) =>
      /^(misc|code|remark|defect)/.test(h) ||
      /^misc\s*\d$/.test(h) ||
      /^code\s*\d$/.test(h) ||
      h === "codes",
  );
}

function linkLooksLikeLinearHistory(link) {
  const text = collapse(link?.text ?? "").toLowerCase();
  const title = collapse(link?.title ?? "").toLowerCase();
  return text === "linear history" || title === "linear history";
}

function linkHasPostBack(link) {
  const blob = `${link?.href ?? ""} ${link?.onclick ?? ""}`;
  return /__doPostBack/i.test(blob) || /linearhistory/i.test(blob);
}

/** Menu shows Linear History but it is not a postback (nothing to open). */
export function linearHistoryUnavailable(page) {
  const listed = /\blinear history\b/i.test(page?.text ?? "");
  if (!listed) return false;
  return !(page?.links ?? []).some(
    (link) => linkLooksLikeLinearHistory(link) && linkHasPostBack(link),
  );
}

export function detectView(page) {
  const hinted = collapse(
    [page.eventArgument, page.eventTarget, page.selectedMenu].filter(Boolean).join(" "),
  );
  if (/linear/i.test(hinted)) return "linear";
  if (/progeny/i.test(hinted)) return "progeny";
  if (/type\s*eval/i.test(hinted)) return "type_eval";
  if (/production\s*eval/i.test(hinted)) return "production_eval";
  const text = page.text ?? "";
  if (/Appraisal History For:/i.test(text) && /Linear Traits/i.test(text)) {
    return "linear";
  }
  if (/Type Evaluation For:/i.test(text)) return "type_eval";
  for (const table of page.tables ?? []) {
    if (looksLikeLinearTraitTable(table)) return "linear";
    if (looksLikeProgenyTable(table)) return "progeny";
  }
  return "pedigree";
}

function goatLinks(links) {
  return (links ?? [])
    .map((link) => ({
      href: link.href ?? "",
      text: stripPedigreeLabel(link.text),
      title: collapse(link.title),
      registration: registrationFromHref(link.href ?? ""),
      color: link.color ?? "",
      backgroundColor: link.backgroundColor ?? "",
      className: link.className ?? "",
    }))
    .filter((link) => link.registration && collapse(link.text).length <= 80);
}

function matchLink(segment, links) {
  const nearby = collapse(segment);
  if (nearby.length > 160) return null;
  for (const link of links) {
    if (!link.text) continue;
    if (nearby.includes(link.text) || nearby.includes(link.registration)) {
      return link;
    }
  }
  const fallback = nearby.match(REG_IN_TEXT);
  if (fallback) {
    const registration = fallback[0].toUpperCase();
    const named = links.find((link) => link.registration === registration);
    return named ?? { text: "", registration, href: "" };
  }
  return null;
}

export function parsePedigreeNodes(text, links, tables = []) {
  const goat = goatLinks(links);
  const skipBlackColor = ignoreBlackCoatColor(goat);
  const nodes = [];
  const seen = new Set();
  const add = (label, link) => {
    if (!link?.registration || !label) return;
    const key = `${label}|${link.registration}`;
    if (seen.has(key)) return;
    seen.add(key);
    const marks = pedigreeFlags(link, skipBlackColor);
    nodes.push({
      label,
      registration: link.registration,
      name: stripPedigreeLabel(link.text),
      herdbook: herdbookFromTitle(link.title),
      polled: marks.polled,
      black: marks.black,
    });
  };

  const blob = String(text ?? "").replace(/\u00a0/g, " ");
  const re = /(?<![A-Z])([SD]{1,8})\s*:\s*/gi;
  const marks = [];
  let match;
  while ((match = re.exec(blob))) {
    marks.push({ label: match[1].toUpperCase(), start: match.index, end: re.lastIndex });
  }
  for (let i = 0; i < marks.length; i += 1) {
    const next = marks[i + 1];
    const segment = blob.slice(marks[i].end, next ? next.start : marks[i].end + 160);
    add(marks[i].label, matchLink(segment, goat));
  }

  for (const table of tables ?? []) {
    for (const cells of table.rows ?? []) {
      for (const cell of cells) {
        const labeled = collapse(cell).match(/^([SD]{1,8})\s*:?\s+(.+)/i);
        if (!labeled) continue;
        add(labeled[1].toUpperCase(), matchLink(labeled[2], goat));
      }
    }
  }
  return nodes;
}

function herdbookFromTitle(title) {
  const text = collapse(title);
  const hit = text.match(/\b(PB|AM|GR|RE|Purebred|American|Grade|Recorded)\b/i);
  return hit ? hit[1] : "";
}

function stubsFromGoatLinks(links, capturedAt, sourceUrl) {
  const skipBlackColor = ignoreBlackCoatColor(goatLinks(links));
  return goatLinks(links).map((link) => {
    const marks = pedigreeFlags(link, skipBlackColor);
    const row = emptyIndividual();
    row.registration_number = link.registration;
    row.registered_name = stripPedigreeLabel(link.text);
    row.herdbook = herdbookFromTitle(link.title);
    row.polled = marks.polled;
    row.black = marks.black;
    row.polled_from = "pedigree";
    row.black_from = "pedigree";
    row.source_url = sourceUrl;
    row.captured_at = capturedAt;
    return row;
  });
}

function sexFromPedigreeLabel(label) {
  const tag = String(label ?? "").trim().toUpperCase();
  if (/S$/.test(tag)) return "BUCK";
  if (/D$/.test(tag)) return "DOE";
  return "";
}

function applyParentEdge(byReg, childReg, role, parentReg) {
  if (!childReg || !parentReg) return;
  if (!byReg.has(childReg)) {
    const row = emptyIndividual();
    row.registration_number = childReg;
    byReg.set(childReg, row);
  }
  const child = byReg.get(childReg);
  if (role === "sire") child.sire_registration = parentReg;
  if (role === "dam") child.dam_registration = parentReg;
}

function individualsFromPedigree(subjectReg, nodes, capturedAt, sourceUrl) {
  const byReg = new Map();
  for (const node of nodes) {
    if (!byReg.has(node.registration)) {
      const row = emptyIndividual();
      row.registration_number = node.registration;
      row.registered_name = node.name;
      row.sex = sexFromPedigreeLabel(node.label);
      row.herdbook = node.herdbook ?? "";
      row.polled = node.polled ?? "";
      row.black = node.black ?? "";
      row.polled_from = "pedigree";
      row.black_from = "pedigree";
      row.source_url = sourceUrl;
      row.captured_at = capturedAt;
      byReg.set(node.registration, row);
    } else {
      const existing = byReg.get(node.registration);
      if (node.name && !existing.registered_name) {
        existing.registered_name = node.name;
      }
      if (!existing.sex) existing.sex = sexFromPedigreeLabel(node.label);
      if (node.polled === "Y" || !existing.polled) existing.polled = node.polled;
      if (node.black === "Y" || !existing.black) existing.black = node.black;
      existing.polled_from = "pedigree";
      existing.black_from = "pedigree";
    }
  }
  for (const node of nodes) {
    const childLabel = node.label.length === 1 ? "" : node.label.slice(0, -1);
    const role = node.label.endsWith("S") ? "sire" : node.label.endsWith("D") ? "dam" : "";
    const childReg =
      childLabel === ""
        ? subjectReg
        : nodes.find((n) => n.label === childLabel)?.registration;
    applyParentEdge(byReg, childReg, role, node.registration);
  }
  return [...byReg.values()];
}

function mapHeaderAliases(headers, aliases) {
  const map = {};
  headers.forEach((cell, index) => {
    const h = headerKey(cell);
    for (const [key, names] of Object.entries(aliases)) {
      if (map[key] != null) continue;
      if (names.some((alias) => h === alias)) map[key] = index;
    }
  });
  return map;
}

function mapTraitHeaders(headers) {
  return mapHeaderAliases(headers, TRAIT_HEADER_ALIASES);
}

function sexFromCell(value) {
  const v = collapse(value);
  if (/^(F|Doe)$/i.test(v)) return "DOE";
  if (/^(M|Buck)$/i.test(v)) return "BUCK";
  return "";
}

function polledFromCell(value) {
  const v = collapse(value);
  if (/^(Y|Yes|True|1)$/i.test(v)) return "Y";
  if (/^(N|No|False|0)$/i.test(v)) return "N";
  return "";
}

function isScore(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 50;
}

export function extractProgenyRows(tables, current, capturedAt, sourceUrl) {
  const individuals = [];
  for (const table of tables ?? []) {
    const rows = table.rows ?? [];
    if (!looksLikeProgenyTable(table)) continue;
    const headers = rows[0].map((cell) => collapse(cell));
    const nameI = headerIndex(headers, "name");
    const regI = headerIndex(headers, "reg #", "reg#", "reg no", "reg no.", "reg number");
    const bookI = headerIndex(headers, "herdbook");
    const breedI = headerIndex(headers, "breed");
    const sexI = headerIndex(headers, "sex");
    const dobI = headerIndex(headers, "dob");
    const polledI = headerIndex(headers, "ispolled", "polled");
    const blackI = headerIndex(headers, "isblack", "black");
    for (const cells of rows.slice(1)) {
      const name = collapse(cells[nameI]);
      const registration = collapse(cells[regI]);
      if (!REG_IN_TEXT.test(registration) || name.length === 0 || name.length > 80) {
        continue;
      }
      const row = emptyIndividual();
      row.registration_number = registration;
      row.registered_name = name;
      row.herdbook = bookI >= 0 ? collapse(cells[bookI]) : "";
      row.breed = breedI >= 0 ? collapse(cells[breedI]) : "";
      row.sex = sexI >= 0 ? sexFromCell(cells[sexI]) : "";
      row.date_of_birth = dobI >= 0 ? collapse(cells[dobI]) : "";
      row.polled = polledI >= 0 ? polledFromCell(cells[polledI]) || "N" : "";
      row.black = blackI >= 0 ? polledFromCell(cells[blackI]) || "N" : "";
      if (polledI >= 0) row.polled_from = "progeny";
      if (blackI >= 0) row.black_from = "progeny";
      if (current.sex === "BUCK") row.sire_registration = current.registration_number;
      if (current.sex === "DOE") row.dam_registration = current.registration_number;
      row.source_url = sourceUrl;
      row.captured_at = capturedAt;
      individuals.push(row);
    }
  }
  return individuals;
}

function linearFromScoreRow(registration, year, age, scores, extras, capturedAt, sourceUrl) {
  const row = emptyLinear();
  row.registration_number = registration;
  row.appraisal_date = year;
  row.age = age;
  GENETICS_LINEAR_ORDER.forEach((key, index) => {
    if (scores[index] != null) row[key] = String(scores[index]);
  });
  row.notes = extras.filter((item) => !item.startsWith("rusv=")).join("; ");
  const rusvNote = extras.find((item) => item.startsWith("rusv="));
  if (!row.rusv && rusvNote) row.rusv = rusvNote.slice(5);
  row.source_url = sourceUrl;
  row.captured_at = capturedAt;
  return row;
}

function linearRowKey(year, age) {
  return `${year}|${age}`;
}

function ensureLinearRow(byKey, registration, year, age, capturedAt, sourceUrl) {
  const key = linearRowKey(year, age);
  if (!byKey.has(key)) {
    const row = emptyLinear();
    row.registration_number = registration;
    row.appraisal_date = year;
    row.age = age;
    row.source_url = sourceUrl;
    row.captured_at = capturedAt;
    byKey.set(key, row);
  }
  return byKey.get(key);
}

function paintMajors(row) {
  if (!row.majors) {
    row.majors = GENETICS_MAJOR_ORDER.map((key) => row[key])
      .filter(Boolean)
      .join("");
    return;
  }
  if (row.ga || row.ds || row.bc || row.ms) return;
  const letters = String(row.majors).replace(/\s+/g, "");
  GENETICS_MAJOR_ORDER.forEach((key, index) => {
    row[key] = letters[index] ?? "";
  });
}

function applyCategoryLetters(row, letters) {
  GENETICS_STRUCTURAL_ORDER.forEach((key, index) => {
    if (letters[index]) row[key] = letters[index];
  });
  GENETICS_MAJOR_ORDER.forEach((key, index) => {
    if (letters[8 + index]) row[key] = letters[8 + index];
  });
  paintMajors(row);
}

function applyMappedCells(row, cells, map) {
  for (const [key, index] of Object.entries(map)) {
    const value = collapse(cells[index]);
    if (value) row[key] = value;
  }
}

function parseMiscCodes(value) {
  return (collapse(value).match(/\b\d{1,2}\b/g) ?? []).slice(0, 3);
}

function applyMiscCodes(row, codes) {
  ["misc1", "misc2", "misc3"].forEach((key, index) => {
    if (codes[index]) row[key] = codes[index];
  });
}

function extractLinearFromTables(tables, registration, capturedAt, sourceUrl) {
  const byKey = new Map();
  for (const table of tables ?? []) {
    const rows = table.rows ?? [];
    if (rows.length < 2) continue;
    const headers = rows[0].map((cell) => collapse(cell));
    const yearI = headerIndex(headers, "layear", "year");
    const ageI = headerIndex(headers, "age");
    if (yearI < 0 || ageI < 0) continue;

    if (looksLikeLinearTraitTable(table)) {
      const traits = mapTraitHeaders(headers);
      const rusvI = headerIndex(headers, "rear udder side view");
      for (const cells of rows.slice(1)) {
        const year = collapse(cells[yearI]);
        const age = collapse(cells[ageI]);
        if (!/^\d{4}$/.test(year) || !/^\d{2}-\d{2}$/.test(age)) continue;
        const scores = GENETICS_LINEAR_ORDER.map((key) =>
          traits[key] != null ? collapse(cells[traits[key]]) : "",
        );
        if (scores.filter(isScore).length < 8) continue;
        const extras = [];
        if (rusvI >= 0) extras.push(`rusv=${collapse(cells[rusvI])}`);
        const row = linearFromScoreRow(
          registration,
          year,
          age,
          scores,
          extras,
          capturedAt,
          sourceUrl,
        );
        const existing = byKey.get(linearRowKey(year, age));
        if (existing) {
          GENETICS_LINEAR_ORDER.forEach((key) => {
            if (row[key]) existing[key] = row[key];
          });
          if (row.rusv) existing.rusv = row.rusv;
        } else {
          byKey.set(linearRowKey(year, age), row);
        }
      }
      continue;
    }

    if (looksLikeStructuralTable(table)) {
      const mapped = mapHeaderAliases(headers, STRUCTURAL_HEADER_ALIASES);
      const fsI = headerIndex(headers, "fs");
      for (const cells of rows.slice(1)) {
        const year = collapse(cells[yearI]);
        const age = collapse(cells[ageI]);
        if (!/^\d{4}$/.test(year)) continue;
        const row = ensureLinearRow(
          byKey,
          registration,
          year,
          age,
          capturedAt,
          sourceUrl,
        );
        applyMappedCells(row, cells, mapped);
        if (fsI >= 0) {
          const fs = collapse(cells[fsI]);
          if (fs) row.final_score = fs;
        }
        paintMajors(row);
      }
      continue;
    }

    if (looksLikeMiscTable(table)) {
      const mapped = mapHeaderAliases(headers, MISC_HEADER_ALIASES);
      const codesI = headerIndex(headers, "codes", "code", "misc", "remarks");
      for (const cells of rows.slice(1)) {
        const year = collapse(cells[yearI]);
        const age = collapse(cells[ageI]);
        if (!/^\d{4}$/.test(year)) continue;
        const row = ensureLinearRow(
          byKey,
          registration,
          year,
          age,
          capturedAt,
          sourceUrl,
        );
        applyMappedCells(row, cells, mapped);
        if (!row.misc1 && codesI >= 0) {
          applyMiscCodes(row, parseMiscCodes(cells[codesI]));
        }
        if (!row.misc1) {
          const leftover = cells
            .map((cell, index) => (index === yearI || index === ageI ? "" : collapse(cell)))
            .filter(Boolean)
            .join(" ");
          applyMiscCodes(row, parseMiscCodes(leftover));
        }
      }
    }
  }
  return [...byKey.values()];
}

export function extractLinearFromText(text, registration, capturedAt, sourceUrl) {
  const blob = String(text ?? "").replace(/\u00a0/g, " ");
  const block = blob.match(
    /Linear Traits[\s\S]*?LAYear\s+Age\s+Stature[\s\S]*?(?=Structural Traits|Miscellaneous|The data listed|$)/i,
  );
  const byKey = new Map();
  if (block) {
    const rowRe = /(\d{4})\s+(\d{2}-\d{2})\s+((?:\d+\s+){14}\d+(?:\s+\d+)?)/g;
    let match;
    while ((match = rowRe.exec(block[0]))) {
      const scores = collapse(match[3]).split(" ").filter(Boolean);
      if (scores.filter(isScore).length < 8) continue;
      const row = linearFromScoreRow(
        registration,
        match[1],
        match[2],
        scores,
        [],
        capturedAt,
        sourceUrl,
      );
      byKey.set(linearRowKey(match[1], match[2]), row);
    }
  }
  const structural = blob.match(
    /Structural Traits[\s\S]*?LAYear\s+Age[\s\S]*?(?=Miscellaneous|Pedigree|PTI21|$)/i,
  );
  if (structural) {
    const structRe = /(\d{4})\s+(\d{2}-\d{2})\s+((?:[A-Z]\s+)+)(\d{2,3})?/g;
    let sm;
    while ((sm = structRe.exec(structural[0]))) {
      const letters = collapse(sm[3]).split(/\s+/).filter((item) => /^[A-Z]$/i.test(item));
      if (letters.length < 4) continue;
      const row = ensureLinearRow(
        byKey,
        registration,
        sm[1],
        sm[2],
        capturedAt,
        sourceUrl,
      );
      applyCategoryLetters(row, letters);
      if (sm[4]) row.final_score = sm[4];
    }
  }
  const misc = blob.match(
    /Miscellaneous(?:\s+Codes)?[\s\S]*?(?=Pedigree|PTI21|Linear Traits|Structural Traits|$)/i,
  );
  if (misc) {
    const miscRe = /(\d{4})\s+(\d{2}-\d{2})\s+((?:\d{1,2}\b\s*){1,3})/g;
    let mm;
    while ((mm = miscRe.exec(misc[0]))) {
      const row = ensureLinearRow(
        byKey,
        registration,
        mm[1],
        mm[2],
        capturedAt,
        sourceUrl,
      );
      applyMiscCodes(row, parseMiscCodes(mm[3]));
    }
  }
  return [...byKey.values()];
}

export function extractLinearRows(tables, registration, capturedAt, sourceUrl, text = "") {
  const fromTables = extractLinearFromTables(tables, registration, capturedAt, sourceUrl);
  if (fromTables.length > 0) return fromTables;
  return extractLinearFromText(text, registration, capturedAt, sourceUrl);
}

function ptiRow(text, registration, capturedAt, sourceUrl) {
  const values = parseIndexes(text);
  if (!values.pti21 && !values.pti12 && !values.eta21 && !values.eta12) return null;
  const row = emptyPti();
  row.registration_number = registration;
  row.pti21 = values.pti21;
  row.pti12 = values.pti12;
  row.eta21 = values.eta21;
  row.eta12 = values.eta12;
  row.source_url = sourceUrl;
  row.captured_at = capturedAt;
  return row;
}

function subjectFromPage(page, registration, capturedAt) {
  const fromTitle = parseHeading(page.title, registration);
  const fromText = parseHeading(page.text, registration);
  const heading = {
    registered_name: fromTitle.registered_name || fromText.registered_name,
    sex: fromTitle.sex || fromText.sex,
    herdbook: fromTitle.herdbook || fromText.herdbook,
    notes: fromTitle.notes || fromText.notes,
  };
  const dob = parseDobAndAppraisal(page.text);
  const breed = parseBreedPercent(page.text);
  const row = emptyIndividual();
  row.registration_number = registration;
  row.registered_name = heading.registered_name;
  row.sex = heading.sex;
  row.herdbook = heading.herdbook;
  row.breed = breed.breed;
  row.breed_percent = breed.breed_percent;
  row.polled = parsePolled(heading.notes) || parsePolled(page.title ?? "");
  row.black = parseBlack(heading.notes) || parseBlack(page.title ?? "");
  const self = goatLinks(page.links).find(
    (link) => identityKey(link.registration) === identityKey(registration),
  );
  if (self) {
    const marks = flagsFromLinkStyle(self, ignoreBlackCoatColor(goatLinks(page.links)));
    if (marks.polled) row.polled = marks.polled;
    if (marks.black) row.black = marks.black;
  }
  if (row.polled !== "Y") row.polled = "N";
  if (row.black !== "Y") row.black = "N";
  row.polled_from = "identity";
  row.black_from = "identity";
  row.date_of_birth = dob.date_of_birth;
  row.linear_final_score = dob.linear_final_score;
  row.source_url = page.url ?? "";
  row.captured_at = capturedAt;
  row.notes = [heading.notes, dob.notes].filter(Boolean).join(" · ");
  return row;
}

export function extractFromSnapshot(page, capturedAt = "", settings = {}) {
  const registration = registrationFromUrl(page.url ?? "");
  if (!registration) return null;
  const opts = normalizeSettings(settings);
  const view = detectView(page);
  const batch = emptyBatch();
  batch.view = view;
  batch.eventArgument = collapse(page.eventArgument);
  batch.eventTarget = collapse(page.eventTarget);

  const subject = subjectFromPage(page, registration, capturedAt);
  const tree = individualsFromPedigree(
    registration,
    parsePedigreeNodes(page.text, page.links, page.tables),
    capturedAt,
    page.url ?? "",
  );
  const subjectFromTree = tree.find((row) => row.registration_number === registration);
  if (subjectFromTree) {
    subject.sire_registration = subjectFromTree.sire_registration;
    subject.dam_registration = subjectFromTree.dam_registration;
  }
  if (opts.recordIndividuals) {
    batch.individuals.push(subject);
    if (opts.captureAncestry) {
      batch.individuals.push(
        ...tree.filter((row) => row.registration_number !== registration),
      );
      if (view === "pedigree") {
        const have = new Set(batch.individuals.map((row) => row.registration_number));
        for (const stub of stubsFromGoatLinks(page.links, capturedAt, page.url ?? "")) {
          if (have.has(stub.registration_number)) continue;
          have.add(stub.registration_number);
          batch.individuals.push(stub);
        }
      }
    }
    if (opts.recordProgeny && view === "progeny") {
      batch.individuals.push(
        ...extractProgenyRows(page.tables, subject, capturedAt, page.url ?? ""),
      );
    }
  }
  batch.subjectRegistration = registration;
  if (opts.recordLinear) {
    batch.linear.push(
      ...extractLinearRows(
        page.tables,
        registration,
        capturedAt,
        page.url ?? "",
        page.text ?? "",
      ),
    );
    if (view === "linear" || linearHistoryUnavailable(page)) {
      batch.linearComplete = true;
    }
  }

  if (opts.recordPti) {
    const pti = ptiRow(page.text ?? "", registration, capturedAt, page.url ?? "");
    if (pti) batch.pti.push(pti);
    batch.ptiComplete = true;
  }
  return convertBatch(batch, subject.herdbook);
}

function convertRowRegs(row, fields) {
  const next = { ...row };
  for (const field of fields) {
    if (!next[field]) continue;
    next[field] = toAdgaRegistration(
      next[field],
      field === "registration_number" ? next.herdbook : "",
    );
  }
  return next;
}

function convertBatch(batch, subjectBook = "") {
  const book = subjectBook || batch.individuals[0]?.herdbook || "";
  batch.individuals = batch.individuals.map((row) =>
    convertRowRegs(row, [
      "registration_number",
      "sire_registration",
      "dam_registration",
    ]),
  );
  batch.linear = batch.linear.map((row) => ({
    ...row,
    registration_number: toAdgaRegistration(row.registration_number, book),
  }));
  batch.pti = batch.pti.map((row) => ({
    ...row,
    registration_number: toAdgaRegistration(row.registration_number, book),
  }));
  if (batch.subjectRegistration) {
    batch.subjectRegistration = toAdgaRegistration(
      batch.subjectRegistration,
      book,
    );
  }
  const canon = (reg) => {
    if (!reg) return "";
    const hit = batch.individuals.find(
      (row) => identityKey(row.registration_number) === identityKey(reg),
    );
    return hit?.registration_number || toAdgaRegistration(reg);
  };
  for (const row of batch.individuals) {
    row.sire_registration = canon(row.sire_registration);
    row.dam_registration = canon(row.dam_registration);
  }
  return batch;
}

function tableFromElement(table) {
  const rows = [...table.querySelectorAll("tr")].map((tr) =>
    [...tr.querySelectorAll("th,td")].map((cell) => collapse(cell.innerText)),
  );
  if (rows.some((row) => row.some((cell) => cell.length > 200))) {
    return { rows: [] };
  }
  return { rows };
}

function elementAppearance(el) {
  const classes = [];
  let color = "";
  let backgroundColor = "";
  let node = el;
  for (let depth = 0; depth < 4 && node && node.nodeType === 1; depth += 1) {
    classes.push(String(node.className ?? ""));
    const attrColor = node.getAttribute?.("color") || node.style?.color;
    if (attrColor && !color) color = attrColor;
    const attrBg = node.style?.backgroundColor;
    if (attrBg && !backgroundColor) backgroundColor = attrBg;
    node = node.parentElement;
  }
  if (el && typeof getComputedStyle === "function") {
    try {
      const style = getComputedStyle(el);
      if (!color) color = style.color ?? "";
      if (!backgroundColor) backgroundColor = style.backgroundColor ?? "";
    } catch {
      /* jsdom / detached */
    }
  }
  return {
    color,
    backgroundColor,
    className: classes.filter(Boolean).join(" "),
  };
}

export function snapshotFromDocument(doc, url) {
  const links = [...doc.querySelectorAll("a")].map((anchor) => {
    const look = elementAppearance(anchor);
    return {
      href: anchor.href,
      text: collapse(anchor.textContent),
      title: collapse(anchor.getAttribute("title") ?? anchor.title ?? ""),
      onclick: collapse(anchor.getAttribute("onclick") ?? ""),
      color: look.color,
      backgroundColor: look.backgroundColor,
      className: look.className,
    };
  });
  const selected =
    doc.querySelector("[aria-current='page'], .selected, .Selected, .active") ??
    null;
  return {
    url,
    title: doc.title ?? "",
    text: doc.body?.innerText ?? "",
    links,
    tables: [...doc.querySelectorAll("table")]
      .map(tableFromElement)
      .filter((table) => table.rows.length > 0),
    eventArgument: doc.querySelector("#__EVENTARGUMENT")?.value ?? "",
    eventTarget: doc.querySelector("#__EVENTTARGET")?.value ?? "",
    selectedMenu: collapse(selected?.textContent),
  };
}

export function extractFromDocument(doc, url, capturedAt, settings) {
  try {
    return extractFromSnapshot(
      snapshotFromDocument(doc, url),
      capturedAt,
      settings,
    );
  } catch {
    return null;
  }
}
