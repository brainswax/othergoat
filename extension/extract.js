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

export function parseIndexes(text) {
  const blob = collapse(text);
  const grab = (re) => blob.match(re)?.[1] ?? "";
  return {
    pti21: grab(/\bPTI21\s*:\s*(-?\d+(?:\.\d+)?)/i),
    pti12: grab(/\bPTI12\s*:\s*(-?\d+(?:\.\d+)?)/i),
    eta21: grab(/\bETA21\s*:\s*(-?\d+(?:\.\d+)?)/i),
    eta12: grab(/\bETA12\s*:\s*(-?\d+(?:\.\d+)?)/i),
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
  return (
    headers.includes("layear") &&
    headers.includes("fs") &&
    headers.some((h) => h.includes("general appearance") || h === "ga")
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
  const nodes = [];
  const seen = new Set();
  const add = (label, link) => {
    if (!link?.registration || !label) return;
    const key = `${label}|${link.registration}`;
    if (seen.has(key)) return;
    seen.add(key);
    nodes.push({
      label,
      registration: link.registration,
      name: stripPedigreeLabel(link.text),
      herdbook: herdbookFromTitle(link.title),
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
  return goatLinks(links).map((link) => {
    const row = emptyIndividual();
    row.registration_number = link.registration;
    row.registered_name = stripPedigreeLabel(link.text);
    row.herdbook = herdbookFromTitle(link.title);
    row.source_url = sourceUrl;
    row.captured_at = capturedAt;
    return row;
  });
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
      row.herdbook = node.herdbook ?? "";
      row.source_url = sourceUrl;
      row.captured_at = capturedAt;
      byReg.set(node.registration, row);
    } else if (node.name && !byReg.get(node.registration).registered_name) {
      byReg.get(node.registration).registered_name = node.name;
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

function mapTraitHeaders(headers) {
  const map = {};
  headers.forEach((cell, index) => {
    const h = headerKey(cell);
    for (const [key, aliases] of Object.entries(TRAIT_HEADER_ALIASES)) {
      if (map[key] != null) continue;
      if (aliases.some((alias) => h === alias)) map[key] = index;
    }
  });
  return map;
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
      row.polled = polledI >= 0 ? polledFromCell(cells[polledI]) : "";
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

function extractLinearFromTables(tables, registration, capturedAt, sourceUrl) {
  const linear = [];
  const majorsByKey = new Map();
  for (const table of tables ?? []) {
    const rows = table.rows ?? [];
    if (looksLikeStructuralTable(table)) {
      const headers = rows[0].map((cell) => collapse(cell));
      const yearI = headerIndex(headers, "layear", "year");
      const ageI = headerIndex(headers, "age");
      const fsI = headerIndex(headers, "fs");
      const gaI = headerIndex(headers, "general appearance");
      const dsI = headerIndex(headers, "dairy strength");
      const bcI = headerIndex(headers, "body capacity");
      const msI = headerIndex(headers, "mammary system");
      for (const cells of rows.slice(1)) {
        const year = yearI >= 0 ? collapse(cells[yearI]) : "";
        const age = ageI >= 0 ? collapse(cells[ageI]) : "";
        if (!/^\d{4}$/.test(year)) continue;
        majorsByKey.set(`${year}|${age}`, {
          final_score: fsI >= 0 ? collapse(cells[fsI]) : "",
          majors: [gaI, dsI, bcI, msI]
            .map((index) => (index >= 0 ? collapse(cells[index]) : ""))
            .filter(Boolean)
            .join(""),
        });
      }
      continue;
    }
    if (!looksLikeLinearTraitTable(table)) continue;
    const headers = rows[0].map((cell) => collapse(cell));
    const yearI = headerIndex(headers, "layear", "year");
    const ageI = headerIndex(headers, "age");
    const traits = mapTraitHeaders(headers);
    const rusvI = headerIndex(headers, "rear udder side view");
    for (const cells of rows.slice(1)) {
      const year = yearI >= 0 ? collapse(cells[yearI]) : "";
      const age = ageI >= 0 ? collapse(cells[ageI]) : "";
      if (!/^\d{4}$/.test(year) || !/^\d{2}-\d{2}$/.test(age)) continue;
      const scores = GENETICS_LINEAR_ORDER.map((key) =>
        traits[key] != null ? collapse(cells[traits[key]]) : "",
      );
      if (scores.filter(isScore).length < 8) continue;
      const extras = [];
      if (rusvI >= 0) extras.push(`rusv=${collapse(cells[rusvI])}`);
      linear.push(
        linearFromScoreRow(registration, year, age, scores, extras, capturedAt, sourceUrl),
      );
    }
  }
  for (const row of linear) {
    const extra = majorsByKey.get(`${row.appraisal_date}|${row.age}`);
    if (!extra) continue;
    row.final_score = extra.final_score;
    row.majors = extra.majors;
  }
  return linear;
}

export function extractLinearFromText(text, registration, capturedAt, sourceUrl) {
  const blob = String(text ?? "").replace(/\u00a0/g, " ");
  const block = blob.match(
    /Linear Traits[\s\S]*?LAYear\s+Age\s+Stature[\s\S]*?(?=Structural Traits|The data listed|$)/i,
  );
  if (!block) return [];
  const linear = [];
  const rowRe = /(\d{4})\s+(\d{2}-\d{2})\s+((?:\d+\s+){14}\d+(?:\s+\d+)?)/g;
  let match;
  while ((match = rowRe.exec(block[0]))) {
    const scores = collapse(match[3]).split(" ").filter(Boolean);
    if (scores.filter(isScore).length < 8) continue;
    linear.push(
      linearFromScoreRow(
        registration,
        match[1],
        match[2],
        scores,
        [],
        capturedAt,
        sourceUrl,
      ),
    );
  }
  const structural = blob.match(
    /Structural Traits[\s\S]*?LAYear\s+Age[\s\S]*?(?=Pedigree|PTI21|$)/i,
  );
  if (structural) {
    const structRe = /(\d{4})\s+(\d{2}-\d{2})\s+((?:[A-Z]\s+)+)(\d{2,3})/g;
    let sm;
    while ((sm = structRe.exec(structural[0]))) {
      const letters = collapse(sm[3]).split(" ");
      const row = linear.find(
        (item) => item.appraisal_date === sm[1] && item.age === sm[2],
      );
      if (!row) continue;
      row.final_score = sm[4];
      row.majors = letters.slice(-4).join("");
    }
  }
  return linear;
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
  row.polled = parsePolled(heading.notes);
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
  batch.individuals.push(subject);

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

  if (view === "progeny") {
    batch.individuals.push(
      ...extractProgenyRows(page.tables, subject, capturedAt, page.url ?? ""),
    );
  }
  if (view === "linear" && opts.recordLinear) {
    batch.linear.push(
      ...extractLinearRows(
        page.tables,
        registration,
        capturedAt,
        page.url ?? "",
        page.text ?? "",
      ),
    );
  }

  if (opts.recordPti) {
    const pti = ptiRow(page.text ?? "", registration, capturedAt, page.url ?? "");
    if (pti) batch.pti.push(pti);
  }
  return convertBatch(batch);
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

function convertBatch(batch) {
  const subjectBook = batch.individuals[0]?.herdbook ?? "";
  batch.individuals = batch.individuals.map((row) =>
    convertRowRegs(row, [
      "registration_number",
      "sire_registration",
      "dam_registration",
    ]),
  );
  batch.linear = batch.linear.map((row) => ({
    ...row,
    registration_number: toAdgaRegistration(row.registration_number, subjectBook),
  }));
  batch.pti = batch.pti.map((row) => ({
    ...row,
    registration_number: toAdgaRegistration(row.registration_number, subjectBook),
  }));
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

export function snapshotFromDocument(doc, url) {
  const links = [...doc.querySelectorAll("a")].map((anchor) => ({
    href: anchor.href,
    text: collapse(anchor.textContent),
    title: collapse(anchor.getAttribute("title") ?? anchor.title ?? ""),
  }));
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
