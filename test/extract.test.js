import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectView,
  extractFromSnapshot,
  extractOwnedByMeSnapshot,
  isOwnedByMePage,
  memberIdFromPage,
  parseBreedPercent,
  parseDobAndAppraisal,
  parseHeading,
  parsePedigreeNodes,
  registrationFromUrl,
  titleFromName,
} from "../extension/extract.js";
import {
  emptyStore,
  FILE_VERSIONS,
  FORMAT_ID,
  MANIFEST_VERSION,
  parseFileVersion,
  LINEAR_COLUMNS,
  MANIFEST_FILE,
  PTI_COLUMNS,
  INDIVIDUAL_COLUMNS,
  isIndividualComplete,
  scrapeStatus,
} from "../extension/schema.js";
import {
  mergeBatch,
  linearKey,
  normalizeStore,
  ptiKey,
  removeRow,
  storeAsLists,
} from "../extension/merge.js";
import { suggestedPtiEval } from "../extension/pti.js";
import {
  buildExportManifest,
  csvExportFilename,
  exportColumns,
  exportFilename,
  recordsToCsv,
  storeToZipBlob,
  storeToZipFiles,
} from "../extension/csv.js";
import {
  toAdgaRegistration,
  breedName,
  goatDetailUrl,
  hasReliablePaperId,
  paperIdFromGenetics,
  parsePedigreeLinkTitle,
  toAdgaSerial,
  toGeneticsRegNumber,
} from "../extension/registration.js";

function goat(store, reg) {
  return store.individuals[toGeneticsRegNumber(reg) || reg];
}

const SAMPLE_URL =
  "https://genetics.adga.org/GoatDetail.aspx?RegNumber=N001352104";

const PEDIGREE_TEXT = `
  SG ALDER*GLEN TRES BONNE 3*M - N001352104 (PB Doe)
  DOB: 3/20/2020 FS84 (+V++) @ 01-03
  Breed Percent: 100% N
  PTI21: 142
  PTI12: 12
  ETA21: 8
  ETA12: 4
  S : SGCH ALDER*GLEN TRES LECHES 5*M
  D : SGCH ALDER*GLEN TRES BELLE 4*M
  SS : SGCH SOME SIRE
  SD : SGCH SOME DAM
`;

const PEDIGREE_LINKS = [
  {
    href: "GoatDetail.aspx?RegNumber=N001201234",
    text: "SGCH ALDER*GLEN TRES LECHES 5*M",
    title: " PB N001201234 born 1/2/2010 ",
  },
  {
    href: "GoatDetail.aspx?RegNumber=N001198765",
    text: "SGCH ALDER*GLEN TRES BELLE 4*M",
    title: " PB N001198765 born 3/4/2011 ",
  },
  {
    href: "GoatDetail.aspx?RegNumber=N000111111",
    text: "SGCH SOME SIRE",
    title: " AM N000111111 born 5/6/2008 ",
  },
  {
    href: "GoatDetail.aspx?RegNumber=N000222222",
    text: "SGCH SOME DAM",
    title: " PB N000222222 born 7/8/2009 ",
  },
];

describe("toAdgaRegistration", () => {
  it("converts Genetics RegNumber plus herdbook to a paper ID", () => {
    assert.equal(toAdgaRegistration("D002237546", "PB"), "PD2237546");
    assert.equal(toAdgaRegistration("N001352104", "PB"), "PN1352104");
    assert.equal(toAdgaRegistration("D002237546"), "D2237546");
    assert.equal(toAdgaRegistration("PD2237546"), "PD2237546");
  });
});

describe("pedigree link title", () => {
  it("reads herdbook, Genetics id, and DOB", () => {
    const parsed = parsePedigreeLinkTitle(" PB D001822638 born 4/16/2016 ");
    assert.equal(parsed.herdbook, "PB");
    assert.equal(parsed.adga_genetics_id, "D001822638");
    assert.equal(parsed.date_of_birth, "4/16/2016");
    assert.equal(paperIdFromGenetics(parsed.adga_genetics_id, parsed.herdbook), "PD1822638");
    assert.equal(hasReliablePaperId({ herdbook: "PB", adga_genetics_id: "D001822638" }), true);
    assert.equal(hasReliablePaperId({ adga_reg: "PN1352104" }), true);
    assert.equal(hasReliablePaperId({ adga_genetics_id: "D001822638" }), false);
  });
});

describe("breedName", () => {
  it("maps Genetics breed letters and registration prefixes", () => {
    assert.equal(breedName("D"), "Nigerian Dwarf");
    assert.equal(breedName("PD2237546"), "Nigerian Dwarf");
    assert.equal(breedName("N"), "Nubian");
  });
});

describe("toAdgaSerial", () => {
  it("strips paper, Genetics, and padded digits to the same Goat Id", () => {
    assert.equal(toAdgaSerial("PD2434405"), "2434405");
    assert.equal(toAdgaSerial("D002434405"), "2434405");
    assert.equal(toAdgaSerial("D2434405"), "2434405");
    assert.equal(toAdgaSerial("2434405"), "2434405");
    assert.equal(toAdgaSerial("PN1352104"), "1352104");
    assert.equal(toAdgaSerial(""), "");
  });
});

describe("toGeneticsRegNumber", () => {
  it("rebuilds the Genetics query value from a paper ID", () => {
    assert.equal(toGeneticsRegNumber("PD2237546"), "D002237546");
    assert.equal(toGeneticsRegNumber("PN1352104"), "N001352104");
    assert.equal(toGeneticsRegNumber("N1201234"), "N001201234");
  });
});

describe("goatDetailUrl", () => {
  it("rebuilds GoatDetail from a paper ID", () => {
    assert.equal(
      goatDetailUrl("PN1352104"),
      "https://genetics.adga.org/GoatDetail.aspx?RegNumber=N001352104",
    );
  });

  it("keeps source_url when it already points at this animal", () => {
    assert.equal(goatDetailUrl("PN1352104", SAMPLE_URL), SAMPLE_URL);
  });

  it("ignores source_url that belongs to a different animal", () => {
    assert.equal(
      goatDetailUrl("N1201234", SAMPLE_URL),
      "https://genetics.adga.org/GoatDetail.aspx?RegNumber=N001201234",
    );
  });

  it("adds a Linear History hash and strips it for pedigree", () => {
    assert.equal(
      goatDetailUrl("PN1352104", SAMPLE_URL, "linear"),
      `${SAMPLE_URL}#ogr-linear`,
    );
    assert.equal(
      goatDetailUrl("PN1352104", `${SAMPLE_URL}#ogr-linear`),
      SAMPLE_URL,
    );
  });
});

describe("scrapeStatus", () => {
  it("distinguishes found, empty visit, and not visited", () => {
    assert.equal(scrapeStatus(true, true), "found");
    assert.equal(scrapeStatus(undefined, true), "found");
    assert.equal(scrapeStatus(true, false), "empty");
    assert.equal(scrapeStatus(false, true), "missing");
    assert.equal(scrapeStatus(undefined, false), "missing");
  });
});

describe("isIndividualComplete", () => {
  it("requires GoatDetail identity fields, not FS or parents", () => {
    assert.equal(
      isIndividualComplete({
        registered_name: "DOE",
        sex: "DOE",
        herdbook: "PB",
        date_of_birth: "3/20/2020",
        breed: "N",
        breed_percent: "100",
      }),
      true,
    );
    assert.equal(
      isIndividualComplete({
        registered_name: "STUB",
        adga_reg: "N111111",
        sire_adga_reg: "N222222",
      }),
      false,
    );
  });
});

describe("scrape complete flags", () => {
  it("maps 1.x identity keys onto adga_reg / goat_id", () => {
    const store = mergeBatch(emptyStore(), {
      individuals: [
        {
          registration_number: "PD1967652",
          reg_number: "D001967652",
          sire_registration: "PD2076307",
          dam_reg_number: "D001869395",
        },
      ],
    });
    const row = Object.values(store.individuals)[0];
    assert.equal(row.adga_reg, "PD1967652");
    assert.equal(row.adga_genetics_id, "D001967652");
    assert.equal(row.goat_id, "1967652");
    assert.equal(row.sire_adga_reg, "PD2076307");
    assert.equal(row.sire_goat_id, "2076307");
    assert.equal(row.dam_adga_genetics_id, "D001869395");
    assert.equal(row.dam_goat_id, "1869395");
    assert.equal(row.registration_number, undefined);
  });

  it("does not treat a later stub merge as incomplete", () => {
    const first = mergeBatch(emptyStore(), {
      individuals: [{ adga_reg: "PD2237546", registered_name: "ONE" }],
      subjectRegistration: "PD2237546",
      linearComplete: true,
      ptiComplete: true,
    });
    const second = mergeBatch(first, {
      individuals: [{ adga_reg: "PD2237546", registered_name: "" }],
    });
    assert.equal(goat(second, "PD2237546").linear_complete, true);
    assert.equal(goat(second, "PD2237546").pti_complete, true);
  });
});

describe("registrationFromUrl", () => {
  it("reads GoatDetail RegNumber", () => {
    assert.equal(registrationFromUrl(SAMPLE_URL), "N001352104");
  });

  it("rejects other paths", () => {
    assert.equal(registrationFromUrl("https://genetics.adga.org/Default.aspx"), "");
  });
});

describe("parseHeading", () => {
  it("splits name, registration, sex, and herdbook", () => {
    const parsed = parseHeading(
      "SG ALDER*GLEN TRES BONNE 3*M - N001352104 (PB Doe)",
      "N001352104",
    );
    assert.equal(parsed.registered_name, "SG ALDER*GLEN TRES BONNE 3*M");
    assert.equal(parsed.sex, "DOE");
    assert.equal(parsed.herdbook, "PB");
    assert.equal(parsed.title, "SG");
    assert.equal(parsed.notes, "PB Doe");
  });

  it("reads a championship title from the heading parentheses", () => {
    const parsed = parseHeading(
      "TWIN WILLOWS AL KARAMELLO - D002237546 (PB Doe GCH)",
      "D002237546",
    );
    assert.equal(parsed.registered_name, "TWIN WILLOWS AL KARAMELLO");
    assert.equal(parsed.sex, "DOE");
    assert.equal(parsed.herdbook, "PB");
    assert.equal(parsed.title, "GCH");
    assert.equal(parsed.notes, "PB Doe");
  });
});

describe("titleFromName", () => {
  it("reads SGCH before SG, and GCH before CH", () => {
    assert.equal(titleFromName("SGCH SOME SIRE"), "SGCH");
    assert.equal(titleFromName("SG ALDER*GLEN TRES BONNE 3*M"), "SG");
    assert.equal(titleFromName("GCH A DOE"), "GCH");
    assert.equal(titleFromName("CH A BUCK"), "CH");
    assert.equal(titleFromName("TWIN WILLOWS AL KARAMELLO"), "");
  });
});

describe("parseDobAndAppraisal", () => {
  it("splits FS, condensed majors, and age from the identity pane", () => {
    assert.deepEqual(
      parseDobAndAppraisal("DOB: 3/20/2020 FS84 (+V++) @ 01-03"),
      {
        date_of_birth: "3/20/2020",
        linear_final_score: "84",
        linear_majors: "+V++",
        linear_age: "01-03",
      },
    );
  });
});

describe("parseBreedPercent", () => {
  it("splits percent and breed letter", () => {
    assert.deepEqual(parseBreedPercent("Breed Percent: 100% N"), {
      breed: "N",
      breed_percent: "100",
    });
  });
});

describe("parsePedigreeNodes", () => {
  it("reads S/D/SS/SD labels as separate animals", () => {
    const nodes = parsePedigreeNodes(PEDIGREE_TEXT, PEDIGREE_LINKS);
    const labels = nodes.map((n) => n.label);
    assert.deepEqual(labels, ["S", "D", "SS", "SD"]);
    assert.equal(nodes[0].registration, "N001201234");
    assert.equal(nodes[2].name, "SGCH SOME SIRE");
  });

  it("reads polled and black from pedigree name colors", () => {
    const nodes = parsePedigreeNodes(PEDIGREE_TEXT, [
      { ...PEDIGREE_LINKS[0], color: "rgb(0, 128, 0)" },
      { ...PEDIGREE_LINKS[1], color: "red" },
      { ...PEDIGREE_LINKS[2], color: "rgb(0, 0, 238)" },
      { ...PEDIGREE_LINKS[3], color: "rgb(0, 0, 0)" },
    ]);
    const byLabel = Object.fromEntries(nodes.map((node) => [node.label, node]));
    assert.equal(byLabel.S.polled, "Y");
    assert.equal(byLabel.S.black, "N");
    assert.equal(byLabel.D.polled, "Y");
    assert.equal(byLabel.D.black, "Y");
    assert.equal(byLabel.SS.polled, "N");
    assert.equal(byLabel.SS.black, "N");
    assert.equal(byLabel.SD.polled, "N");
    assert.equal(byLabel.SD.black, "Y");
  });

  it("does not treat default black link text as black coat", () => {
    const nodes = parsePedigreeNodes(PEDIGREE_TEXT, [
      { ...PEDIGREE_LINKS[0], color: "rgb(0, 0, 0)" },
      { ...PEDIGREE_LINKS[1], color: "rgb(0, 0, 0)" },
      { ...PEDIGREE_LINKS[2], color: "rgb(0, 0, 0)" },
      { ...PEDIGREE_LINKS[3], color: "rgb(0, 0, 0)" },
    ]);
    assert.equal(nodes.every((node) => node.polled === "N"), true);
    assert.equal(nodes.every((node) => node.black === "N"), true);
  });

  it("strips UI labels from link text", () => {
    const nodes = parsePedigreeNodes("SS : SGCH SOME SIRE", [
      {
        href: "GoatDetail.aspx?RegNumber=N000111111",
        text: "SS : SGCH SOME SIRE",
      },
    ]);
    assert.equal(nodes[0].name, "SGCH SOME SIRE");
  });

  it("does not assign a shorter name from another slot", () => {
    const nodes = parsePedigreeNodes(
      "S : FORGED FARM MAXIMUS\nD : FORGED FARM ROSE",
      [
        { href: "GoatDetail.aspx?RegNumber=N000222222", text: "FORGED FARM ROSE" },
        { href: "GoatDetail.aspx?RegNumber=N000111111", text: "FORGED FARM MAXIMUS" },
        { href: "GoatDetail.aspx?RegNumber=N000333333", text: "FORGED FARM" },
      ],
    );
    const byLabel = Object.fromEntries(nodes.map((node) => [node.label, node]));
    assert.equal(byLabel.S.registration, "N000111111");
    assert.equal(byLabel.D.registration, "N000222222");
  });

  it("uses the leftmost name when a slot text also mentions another animal", () => {
    const nodes = parsePedigreeNodes("S : FORGED FARM MAXIMUS FORGED FARM ROSE\n", [
      { href: "GoatDetail.aspx?RegNumber=N000222222", text: "FORGED FARM ROSE" },
      { href: "GoatDetail.aspx?RegNumber=N000111111", text: "FORGED FARM MAXIMUS" },
    ]);
    assert.equal(nodes[0].registration, "N000111111");
  });
});

describe("detectView", () => {
  it("uses EVENTARGUMENT when present", () => {
    assert.equal(detectView({ eventArgument: "LinearHistory" }), "linear");
    assert.equal(detectView({ selectedMenu: "Progeny" }), "progeny");
  });

  it("falls back to table shape", () => {
    assert.equal(
      detectView({
        tables: [
          {
            rows: [
              ["Name", "Reg #", "Herdbook", "Breed", "Sex", "DOB", "IsPolled"],
              ["KID", "N000333333", "PB", "N", "F", "1/1/2024", "Y"],
            ],
          },
        ],
      }),
      "progeny",
    );
  });
});

describe("extractFromSnapshot pedigree", () => {
  it("creates a row for every tree node and parent regs only", () => {
    const batch = extractFromSnapshot(
      {
        url: SAMPLE_URL,
        title: "ADGA Genetics",
        text: PEDIGREE_TEXT,
        links: PEDIGREE_LINKS,
      },
      "2026-08-30T04:00:00.000Z",
      { captureAncestry: true },
    );
    assert.equal(batch.view, "pedigree");
    const byReg = Object.fromEntries(
      batch.individuals.map((row) => [row.adga_reg, row]),
    );
    assert.equal(byReg.PN1352104.registered_name, "SG ALDER*GLEN TRES BONNE 3*M");
    assert.equal(byReg.PN1352104.title, "SG");
    assert.equal(byReg.PN1352104.sex, "DOE");
    assert.equal(byReg.PN1352104.breed, "N");
    assert.equal(byReg.PN1352104.breed_percent, "100");
    assert.equal(byReg.PN1352104.linear_final_score, "84");
    assert.equal(byReg.PN1352104.linear_majors, "+V++");
    assert.equal(byReg.PN1352104.linear_age, "01-03");
    assert.equal(byReg.PN1352104.sire_adga_reg, "PN1201234");
    assert.equal(byReg.PN1352104.dam_adga_reg, "PN1198765");
    assert.equal(byReg.PN1352104.sire_adga_genetics_id, "N001201234");
    assert.equal(byReg.PN1352104.adga_genetics_id, "N001352104");
    assert.equal(byReg.PN1352104.goat_id, "1352104");
    assert.equal(byReg.PN1352104.sire_goat_id, "1201234");
    assert.equal(byReg.PN1352104.dam_goat_id, "1198765");
    assert.equal(byReg.PN1352104.sire_name, undefined);
    assert.equal(byReg.PN1201234.registered_name, "SGCH ALDER*GLEN TRES LECHES 5*M");
    assert.equal(byReg.PN1201234.title, "SGCH");
    assert.equal(byReg.PN1201234.sex, "BUCK");
    assert.equal(byReg.PN1201234.date_of_birth, "1/2/2010");
    assert.equal(byReg.PN1201234.herdbook, "PB");
    assert.equal(byReg.PN1201234.sire_adga_reg, "AN111111");
    assert.equal(byReg.PN1201234.dam_adga_reg, "PN222222");
    assert.equal(byReg.PN1198765.sex, "DOE");
    assert.equal(byReg.AN111111.registered_name, "SGCH SOME SIRE");
    assert.equal(byReg.AN111111.sex, "BUCK");
    assert.equal(byReg.AN111111.sire_adga_reg, "");
    assert.equal(byReg.PN222222.sex, "DOE");
    assert.equal(byReg.PN1352104.polled, "N");
    assert.equal(byReg.PN1352104.black, "N");
    assert.equal(byReg.PN1201234.polled, "N");
    assert.equal(byReg.PN1201234.black, "N");
    assert.equal(isIndividualComplete(byReg.PN1352104), true);
    assert.equal(isIndividualComplete(byReg.PN1201234), false);
    assert.equal(batch.pti.length, 1);
    assert.equal(batch.pti[0].pti21, "142");
    assert.equal(batch.pti[0].registered_name, "SG ALDER*GLEN TRES BONNE 3*M");
    assert.equal(batch.pti[0].pti12, "12");
    assert.equal(batch.pti[0].eta21, "8");
    assert.equal(batch.pti[0].eta12, "4");
    assert.equal(batch.ptiComplete, true);
    assert.equal(batch.linearComplete, false);
  });

  it("copies pedigree color marks onto ancestor rows", () => {
    const batch = extractFromSnapshot(
      {
        url: SAMPLE_URL,
        title: "ADGA Genetics",
        text: PEDIGREE_TEXT.replace("(PB Doe)", "(PB Doe Polled)"),
        links: [
          { ...PEDIGREE_LINKS[0], color: "green" },
          { ...PEDIGREE_LINKS[1], color: "rgb(0, 0, 238)" },
          { ...PEDIGREE_LINKS[2], className: "black" },
          { ...PEDIGREE_LINKS[3], color: "rgb(0, 0, 238)" },
        ],
      },
      "t",
      { captureAncestry: true },
    );
    const byReg = Object.fromEntries(
      batch.individuals.map((row) => [row.adga_reg, row]),
    );
    assert.equal(byReg.PN1352104.polled, "Y");
    assert.equal(byReg.PN1352104.black, "N");
    assert.equal(byReg.PN1352104.polled_from, "identity");
    assert.equal(byReg.PN1352104.black_from, "identity");
    assert.equal(byReg.PN1201234.polled, "Y");
    assert.equal(byReg.PN1201234.black, "N");
    assert.equal(byReg.PN1201234.polled_from, "pedigree");
    assert.equal(byReg.AN111111.polled, "N");
    assert.equal(byReg.AN111111.black, "Y");
    assert.equal(byReg.PN1198765.polled, "N");
    assert.equal(byReg.PN1198765.black, "N");
  });

  it("does not copy pedigree name colors onto the open animal", () => {
    const batch = extractFromSnapshot(
      {
        url: SAMPLE_URL,
        title: "ADGA Genetics",
        text: PEDIGREE_TEXT,
        links: [
          { ...PEDIGREE_LINKS[0], color: "green" },
          { ...PEDIGREE_LINKS[1], color: "rgb(0, 0, 238)" },
          { ...PEDIGREE_LINKS[2], color: "rgb(0, 0, 238)" },
          { ...PEDIGREE_LINKS[3], color: "rgb(0, 0, 238)" },
        ],
      },
      "t",
      { captureAncestry: true },
    );
    const byReg = Object.fromEntries(
      batch.individuals.map((row) => [row.adga_reg, row]),
    );
    assert.equal(byReg.PN1352104.polled, "N");
    assert.equal(byReg.PN1352104.polled_from, "identity");
    assert.equal(byReg.PN1201234.polled, "Y");
    assert.equal(byReg.PN1201234.polled_from, "pedigree");
  });

  it("returns null when the URL is not a goat detail page", () => {
    assert.equal(
      extractFromSnapshot({ url: "https://genetics.adga.org/Default.aspx" }),
      null,
    );
  });

  it("records sire and dam on the subject without ancestor rows", () => {
    const batch = extractFromSnapshot(
      {
        url: SAMPLE_URL,
        title: "ADGA Genetics",
        text: PEDIGREE_TEXT,
        links: PEDIGREE_LINKS,
      },
      "t",
      { captureAncestry: false },
    );
    assert.equal(batch.individuals.length, 1);
    assert.equal(batch.individuals[0].sire_adga_reg, "PN1201234");
    assert.equal(batch.individuals[0].dam_adga_reg, "PN1198765");
  });

  it("skips PTI when recordPti is off", () => {
    const batch = extractFromSnapshot(
      {
        url: SAMPLE_URL,
        title: "ADGA Genetics",
        text: PEDIGREE_TEXT,
        links: PEDIGREE_LINKS,
      },
      "t",
      { recordPti: false },
    );
    assert.equal(batch.pti.length, 0);
    assert.equal(batch.ptiComplete, false);
  });

  it("marks Linear History looked-at when the menu item is not a link", () => {
    const batch = extractFromSnapshot({
      url: SAMPLE_URL,
      title: "ADGA Genetics",
      text: `
        SOME GOAT - N001352104 (PB Doe)
        Pedigree Inbreeding Line Breeding Progeny Linear History Type Eval
        DOB: 3/20/2020
        Breed Percent: 100% N
      `,
      links: PEDIGREE_LINKS,
    });
    assert.equal(batch.view, "pedigree");
    assert.equal(batch.linear.length, 0);
    assert.equal(batch.linearComplete, true);
  });

  it("does not mark Linear History complete when the menu still posts back", () => {
    const batch = extractFromSnapshot({
      url: SAMPLE_URL,
      title: "ADGA Genetics",
      text: `
        SOME GOAT - N001352104 (PB Doe)
        Pedigree Inbreeding Progeny Linear History
        DOB: 3/20/2020
        Breed Percent: 100% N
      `,
      links: [
        ...PEDIGREE_LINKS,
        {
          href: "javascript:__doPostBack('ctl00$Menu','LinearHistory')",
          text: "Linear History",
        },
      ],
    });
    assert.equal(batch.linearComplete, false);
  });

  it("marks PTI looked-at when the identity pane has no scores", () => {
    const batch = extractFromSnapshot({
      url: SAMPLE_URL,
      title: "ADGA Genetics",
      text: `
        SOME GOAT - N001352104 (PB Doe)
        DOB: 3/20/2020
        Breed Percent: 100% N
      `,
    });
    assert.equal(batch.pti.length, 0);
    assert.equal(batch.ptiComplete, true);
  });

  it("skips individual rows when recordIndividuals is off", () => {
    const batch = extractFromSnapshot(
      {
        url: SAMPLE_URL,
        title: "ADGA Genetics",
        text: PEDIGREE_TEXT,
        links: PEDIGREE_LINKS,
      },
      "t",
      { recordIndividuals: false, captureAncestry: true },
    );
    assert.equal(batch.individuals.length, 0);
    assert.equal(batch.pti.length, 1);
  });
});

describe("extractFromSnapshot progeny", () => {
  it("stubs kids and sets dam when the current animal is a doe", () => {
    const batch = extractFromSnapshot(
      {
        url: SAMPLE_URL,
        title: "ADGA Genetics",
        selectedMenu: "Progeny",
        text: "SG ALDER*GLEN TRES BONNE 3*M - N001352104 (PB Doe)\nPTI21: 10",
        tables: [
          {
            rows: [
              ["Name", "Reg #", "Herdbook", "Breed", "Sex", "DOB", "IsPolled", "IsBlack"],
              ["KID ONE", "N000333333", "PB", "N", "F", "1/2/2024", "Y", "Y"],
            ],
          },
        ],
      },
      "t",
    );
    const kid = batch.individuals.find((row) => row.adga_reg === "PN333333");
    assert.equal(kid.registered_name, "KID ONE");
    assert.equal(kid.dam_adga_reg, "PN1352104");
    assert.equal(kid.sire_adga_reg, "");
    assert.equal(kid.polled, "Y");
    assert.equal(kid.black, "Y");
    assert.equal(kid.polled_from, "progeny");
    assert.equal(kid.black_from, "progeny");
    assert.equal(isIndividualComplete(kid), false);
  });

  it("skips progeny rows when recordProgeny is off", () => {
    const batch = extractFromSnapshot(
      {
        url: SAMPLE_URL,
        title: "ADGA Genetics",
        selectedMenu: "Progeny",
        text: "SG ALDER*GLEN TRES BONNE 3*M - N001352104 (PB Doe)\nPTI21: 10",
        tables: [
          {
            rows: [
              ["Name", "Reg #", "Herdbook", "Breed", "Sex", "DOB", "IsPolled"],
              ["KID ONE", "N000333333", "PB", "N", "F", "1/2/2024", "Y"],
            ],
          },
        ],
      },
      "t",
      { recordProgeny: false },
    );
    assert.equal(
      batch.individuals.some((row) => row.adga_reg === "PN333333"),
      false,
    );
    assert.equal(batch.individuals[0].adga_reg, "PN1352104");
  });
});

describe("extractFromSnapshot linear", () => {
  const linearText = `
    TWIN WILLOWS AL KARAMELLO - N001352104 (PB Doe)
    PTI21: 40 PTI12: 33 ETA21: 44 ETA12: 29
    Appraisal History For: TWIN WILLOWS AL KARAMELLO - N001352104 (PB Doe)
    Linear Traits
    LAYear Age Stature Strength Dairyness Rump Angle Rump Width Rear Leg Side View Fore Udder Attachment Rear Udder Height Rear Udder Arch Medial Udder Depth Teat Placement Teat Diameter Teat Length Body Depth Rear Udder Side View
    2024 02-01 28 30 29 35 31 32 30 29 34 15 33 20 11 36 38 2
    2025 03-02 32 34 32 37 33 33 31 30 36 14 34 21 10 37 40 1
    The data listed above are raw field scores.
    Structural Traits
    LAYear Age Head Shoulder Assembly Front Legs Rear Legs Feet Back Rump Udder Texture General Appearance Dairy Strength Body Capacity Mammary System FS
    2025 03-02 V G A G V E V V V E A 84
    Miscellaneous Codes
    LAYear Age Code1 Code2 Code3
    2025 03-02 32 14
  `;

  it("reads Genetics Linear History rows and ignores Type Eval soup", () => {
    const batch = extractFromSnapshot({
      url: SAMPLE_URL,
      eventArgument: "LinearHistory",
      text: linearText,
      tables: [
        {
          rows: [
            ["Stature", "Short", "Tall", "PTA", "REL"],
            ["Strength", "Weak", "Powerful", "0.6", "45"],
          ],
        },
        {
          rows: [
            ["Pedigree", "Inbreeding", "Progeny"],
            ["Linear History", "Type Eval", "PTI/ETA"],
          ],
        },
      ],
    });
    assert.equal(batch.linearComplete, true);
    assert.equal(batch.ptiComplete, true);
    assert.equal(batch.linear.length, 2);
    assert.equal(batch.linear[0].registered_name, "TWIN WILLOWS AL KARAMELLO");
    assert.equal(batch.linear[0].appraisal_date, "2024");
    assert.equal(batch.linear[0].stat, "28");
    assert.equal(batch.linear[0].st, "30");
    assert.equal(batch.linear[0].bd, "38");
    assert.equal(batch.linear[1].appraisal_date, "2025");
    assert.equal(batch.linear[1].age, "03-02");
    assert.equal(batch.linear[1].final_score, "84");
    assert.equal(batch.linear[1].head, "V");
    assert.equal(batch.linear[1].shoulder, "G");
    assert.equal(batch.linear[1].front_legs, "A");
    assert.equal(batch.linear[1].rear_legs, "G");
    assert.equal(batch.linear[1].feet, "V");
    assert.equal(batch.linear[1].back, "E");
    assert.equal(batch.linear[1].rump, "V");
    assert.equal(batch.linear[1].udder_texture, "V");
    assert.equal(batch.linear[1].ga, "V");
    assert.equal(batch.linear[1].ds, "E");
    assert.equal(batch.linear[1].bc, "A");
    assert.equal(batch.linear[1].misc1, "32");
    assert.equal(batch.linear[1].misc2, "14");
    assert.equal(batch.pti.length, 1);
    assert.equal(batch.pti[0].registered_name, "TWIN WILLOWS AL KARAMELLO");
    assert.equal(batch.pti[0].pti21, "40");
    assert.equal(batch.pti[0].eta12, "29");
  });

  it("skips Linear History when recordLinear is off", () => {
    const batch = extractFromSnapshot(
      {
        url: SAMPLE_URL,
        eventArgument: "LinearHistory",
        text: linearText,
        tables: [],
      },
      "t",
      { recordLinear: false },
    );
    assert.equal(batch.linear.length, 0);
    assert.equal(batch.linearComplete, false);
  });

  it("records PTI and Linear History without an individual row", () => {
    const batch = extractFromSnapshot(
      {
        url: SAMPLE_URL,
        eventArgument: "LinearHistory",
        text: linearText,
        tables: [],
      },
      "t",
      { recordIndividuals: false },
    );
    assert.equal(batch.individuals.length, 0);
    assert.equal(batch.linear.length, 2);
    assert.equal(batch.pti.length, 1);
    assert.equal(batch.linear[0].registered_name, "TWIN WILLOWS AL KARAMELLO");
    assert.equal(batch.pti[0].registered_name, "TWIN WILLOWS AL KARAMELLO");
    assert.equal(batch.pti[0].pti21, "40");
  });

  it("does not treat a Type Eval page as linear rows", () => {
    const batch = extractFromSnapshot({
      url: SAMPLE_URL,
      selectedMenu: "Type Eval",
      text: `
        TWIN WILLOWS AL KARAMELLO - N001352104 (PB Doe)
        Type Evaluation For: TWIN WILLOWS AL KARAMELLO - N001352104 (PB Doe)
        PTI21: 40 PTI12: 33 ETA21: 44 ETA12: 29
        Stature Short 32 Tall 1.0 62
      `,
      tables: [
        {
          rows: [
            ["Trait", "TraitAvg", "PTA", "REL"],
            ["Stature", "32", "1.0", "62"],
            ["Strength", "34", "0.6", "45"],
          ],
        },
      ],
    });
    assert.equal(batch.view, "type_eval");
    assert.equal(batch.linear.length, 0);
    assert.equal(batch.pti[0].pti21, "40");
  });

  it("reads structural letters and misc codes from Linear History tables", () => {
    const batch = extractFromSnapshot({
      url: SAMPLE_URL,
      eventArgument: "LinearHistory",
      text: "Appraisal History For: TWIN WILLOWS AL KARAMELLO - N001352104 (PB Doe)",
      tables: [
        {
          rows: [
            [
              "LAYear",
              "Age",
              "Stature",
              "Strength",
              "Dairyness",
              "Rump Angle",
              "Rump Width",
              "Rear Leg Side View",
              "Fore Udder Attachment",
              "Rear Udder Height",
              "Rear Udder Arch",
              "Medial",
              "Udder Depth",
              "Teat Placement",
              "Teat Diameter",
              "Teat Length",
              "Body Depth",
              "Rear Udder Side View",
            ],
            [
              "2025",
              "03-02",
              "32",
              "34",
              "32",
              "37",
              "33",
              "33",
              "31",
              "30",
              "36",
              "14",
              "34",
              "21",
              "10",
              "37",
              "40",
              "1",
            ],
          ],
        },
        {
          rows: [
            [
              "LAYear",
              "Age",
              "Head",
              "Shoulder Assembly",
              "Front Legs",
              "Rear Legs",
              "Feet",
              "Back",
              "Rump",
              "Udder Texture",
              "General Appearance",
              "Dairy Strength",
              "Body Capacity",
              "Mammary System",
              "FS",
            ],
            [
              "2025",
              "03-02",
              "V",
              "G",
              "A",
              "G",
              "V",
              "E",
              "V",
              "V",
              "V",
              "E",
              "A",
              "V",
              "84",
            ],
          ],
        },
        {
          rows: [
            ["LAYear", "Age", "Code1", "Code2", "Code3"],
            ["2025", "03-02", "32", "14", ""],
          ],
        },
      ],
    });
    assert.equal(batch.linear.length, 1);
    assert.equal(batch.linear[0].stat, "32");
    assert.equal(batch.linear[0].head, "V");
    assert.equal(batch.linear[0].udder_texture, "V");
    assert.equal(batch.linear[0].ms, "V");
    assert.equal(batch.linear[0].final_score, "84");
    assert.equal(batch.linear[0].misc1, "32");
    assert.equal(batch.linear[0].misc2, "14");
  });
});

describe("extractFromSnapshot progeny rejects layout tables", () => {
  it("ignores mashed Registry/DOB chrome", () => {
    const batch = extractFromSnapshot({
      url: SAMPLE_URL,
      selectedMenu: "Progeny",
      text: "TWIN WILLOWS AL KARAMELLO - N001352104 (PB Doe)",
      tables: [
        {
          rows: [
            ["SG", "Registry", "DOB", "Appraisals", "PTAFS"],
            [
              "TWIN WILLOWS AL KARAMELLO - N001352104 (PB Doe) SG Registry DOB",
              "Pedigree",
              "Inbreeding",
              "Linear History",
              "Type Eval",
            ],
          ],
        },
        {
          rows: [
            ["Name", "Reg #", "Herdbook", "Breed", "Sex", "DOB", "IsPolled"],
            ["KID ONE", "N000333333", "PB", "N", "F", "1/2/2024", "Y"],
          ],
        },
      ],
    });
    const names = batch.individuals.map((row) => row.registered_name);
    assert.deepEqual(names, ["TWIN WILLOWS AL KARAMELLO", "KID ONE"]);
    assert.equal(batch.individuals[0].notes, "PB Doe");
  });
});

describe("extractFromSnapshot heading title", () => {
  it("stores a championship title from the heading parentheses", () => {
    const batch = extractFromSnapshot({
      url: "https://genetics.adga.org/GoatDetail.aspx?RegNumber=D002237546",
      title: "TWIN WILLOWS AL KARAMELLO - D002237546 (PB Doe GCH)",
      text: "TWIN WILLOWS AL KARAMELLO - D002237546 (PB Doe GCH)\nDOB: 3/1/2018",
      links: [],
      tables: [],
    });
    const row = batch.individuals[0];
    assert.equal(row.registered_name, "TWIN WILLOWS AL KARAMELLO");
    assert.equal(row.title, "GCH");
    assert.equal(row.notes, "PB Doe");
    assert.equal(row.sex, "DOE");
    assert.equal(row.herdbook, "PB");
  });
});

describe("merge", () => {
  it("lists complete individuals before stubs, then by name", () => {
    const identity = {
      sex: "DOE",
      herdbook: "PB",
      date_of_birth: "1/1/2020",
      breed: "N",
      breed_percent: "100",
    };
    const lists = storeAsLists({
      individuals: {
        stub: { adga_reg: "N3", registered_name: "AAA STUB" },
        late: { adga_reg: "N2", registered_name: "ZEBRA", ...identity },
        early: { adga_reg: "N1", registered_name: "BETA", ...identity },
      },
      linear: {},
      pti: {},
    });
    assert.deepEqual(
      lists.individuals.map((row) => row.registered_name),
      ["BETA", "ZEBRA", "AAA STUB"],
    );
  });

  it("fills empty fields and does not clobber with blanks", () => {
    const first = mergeBatch(emptyStore(), {
      individuals: [
        {
          adga_reg: "N1",
          registered_name: "ONE",
          breed: "",
          sire_adga_reg: "PN111111",
          dam_adga_reg: "",
        },
      ],
    });
    const second = mergeBatch(first, {
      individuals: [
        {
          adga_reg: "N1",
          registered_name: "",
          breed: "N",
          sire_adga_reg: "",
          dam_adga_reg: "PN222222",
        },
      ],
    });
    const row = goat(second, "N1");
    assert.equal(row.registered_name, "ONE");
    assert.equal(row.breed, "N");
    assert.equal(row.sire_adga_reg, "PN111111");
    assert.equal(row.dam_adga_reg, "PN222222");
  });

  it("does not let a pedigree stub overwrite another animal's parents", () => {
    const first = mergeBatch(emptyStore(), {
      subjectRegistration: "N1",
      individuals: [
        {
          adga_reg: "N1",
          sire_adga_reg: "PN111111",
          dam_adga_reg: "PN222222",
        },
        {
          adga_reg: "N2",
          sire_adga_reg: "PN333333",
          dam_adga_reg: "PN444444",
        },
      ],
    });
    const second = mergeBatch(first, {
      subjectRegistration: "N2",
      individuals: [
        {
          adga_reg: "N1",
          sire_adga_reg: "PN333333",
          dam_adga_reg: "PN444444",
        },
        {
          adga_reg: "N2",
          sire_adga_reg: "PN555555",
          dam_adga_reg: "PN666666",
        },
      ],
    });
    assert.equal(goat(second, "N1").sire_adga_reg, "PN111111");
    assert.equal(goat(second, "N1").dam_adga_reg, "PN222222");
    assert.equal(goat(second, "N2").sire_adga_reg, "PN555555");
    assert.equal(goat(second, "N2").dam_adga_reg, "PN666666");
  });

  it("fills goat_id and parent serials so parents join on ADGA Goat Id", () => {
    const store = mergeBatch(emptyStore(), {
      subjectRegistration: "D002434405",
      individuals: [
        {
          adga_reg: "",
          adga_genetics_id: "D002434405",
          herdbook: "",
          sire_adga_genetics_id: "D002076307",
          dam_adga_genetics_id: "D001869395",
        },
      ],
    });
    const row = goat(store, "D002434405");
    assert.equal(row.goat_id, "2434405");
    assert.equal(row.sire_goat_id, "2076307");
    assert.equal(row.dam_goat_id, "1869395");
    assert.equal(row.adga_reg, "");
  });

  it("lets a later non-empty value replace an earlier one", () => {
    const first = mergeBatch(emptyStore(), {
      individuals: [{ adga_reg: "N1", breed: "A" }],
    });
    const second = mergeBatch(first, {
      individuals: [{ adga_reg: "N1", breed: "N" }],
    });
    assert.equal(goat(second, "N1").breed, "N");
  });

  it("lets an identity page overwrite pedigree name colors", () => {
    const first = mergeBatch(emptyStore(), {
      individuals: [
        {
          adga_reg: "N1",
          polled: "Y",
          black: "Y",
          polled_from: "pedigree",
          black_from: "pedigree",
        },
      ],
    });
    const second = mergeBatch(first, {
      individuals: [
        {
          adga_reg: "N1",
          polled: "N",
          black: "N",
          polled_from: "identity",
          black_from: "identity",
        },
      ],
    });
    assert.equal(goat(second, "N1").polled, "N");
    assert.equal(goat(second, "N1").black, "N");
    assert.equal(goat(second, "N1").polled_from, "identity");
  });

  it("does not let pedigree name colors overwrite an identity page", () => {
    const first = mergeBatch(emptyStore(), {
      individuals: [
        {
          adga_reg: "N1",
          polled: "Y",
          black: "N",
          polled_from: "identity",
          black_from: "identity",
        },
      ],
    });
    const second = mergeBatch(first, {
      individuals: [
        {
          adga_reg: "N1",
          polled: "N",
          black: "Y",
          polled_from: "pedigree",
          black_from: "pedigree",
        },
      ],
    });
    assert.equal(goat(second, "N1").polled, "Y");
    assert.equal(goat(second, "N1").black, "N");
    assert.equal(goat(second, "N1").polled_from, "identity");
    assert.equal(goat(second, "N1").black_from, "identity");
  });

  it("removes one animal without touching LA or PTI", () => {
    const store = mergeBatch(emptyStore(), {
      individuals: [
        { adga_reg: "PD2237546", registered_name: "KEEP" },
        { adga_reg: "PN1352104", registered_name: "DROP" },
      ],
      linear: [
        { adga_reg: "PN1352104", appraisal_date: "2025", age: "03-02" },
        { adga_reg: "PD2237546", appraisal_date: "2024", age: "02-01" },
      ],
      pti: [
        { adga_reg: "PN1352104", pti21: "1" },
        { adga_reg: "PD2237546", pti21: "2" },
      ],
    });
    const next = removeRow(store, "individuals", "N001352104");
    assert.equal(Object.keys(next.individuals).length, 1);
    assert.equal(goat(next, "PD2237546").registered_name, "KEEP");
    assert.equal(Object.keys(next.linear).length, 2);
    assert.equal(Object.keys(next.pti).length, 2);
    assert.ok(
      Object.values(next.pti).some((row) => row.adga_reg === "PN1352104"),
    );
  });

  it("removes a single LA row without dropping the animal", () => {
    const store = mergeBatch(emptyStore(), {
      individuals: [{ adga_reg: "PD2237546" }],
      linear: [
        { adga_reg: "PD2237546", appraisal_date: "2025", age: "03-02" },
        { adga_reg: "PD2237546", appraisal_date: "2024", age: "02-01" },
      ],
    });
    const drop = linearKey({
      adga_reg: "PD2237546",
      appraisal_date: "2025",
      age: "03-02",
    });
    goat(store, "PD2237546").linear_complete = true;
    goat(store, "PD2237546").pti_complete = true;
    const next = removeRow(store, "linear", drop);
    assert.ok(goat(next, "PD2237546"));
    assert.equal(Object.keys(next.linear).length, 1);
    assert.equal(goat(next, "PD2237546").linear_complete, false);
    assert.equal(goat(next, "PD2237546").pti_complete, true);
  });

  it("clears PTI complete without dropping the animal or LA rows", () => {
    const store = mergeBatch(emptyStore(), {
      individuals: [
        {
          adga_reg: "PD2237546",
          registered_name: "KEEP",
        },
      ],
      linear: [
        { adga_reg: "PD2237546", appraisal_date: "2024", age: "02-01" },
      ],
      pti: [{ adga_reg: "PD2237546", pti21: "40" }],
      subjectRegistration: "PD2237546",
      linearComplete: true,
      ptiComplete: true,
    });
    assert.equal(goat(store, "PD2237546").linear_complete, true);
    assert.equal(goat(store, "PD2237546").pti_complete, true);
    const next = removeRow(store, "pti", "PD2237546");
    assert.ok(goat(next, "PD2237546"));
    assert.equal(goat(next, "PD2237546").pti_complete, false);
    assert.equal(goat(next, "PD2237546").linear_complete, true);
    assert.equal(Object.keys(next.linear).length, 1);
    assert.equal(Object.keys(next.pti).length, 0);
  });

  it("marks Linear History complete even when the table is empty", () => {
    const batch = {
      individuals: [{ adga_reg: "PD2237546" }],
      linear: [],
      pti: [],
      subjectRegistration: "PD2237546",
      linearComplete: true,
    };
    const store = mergeBatch(emptyStore(), batch);
    assert.equal(goat(store, "PD2237546").linear_complete, true);
    assert.equal(Object.keys(store.linear).length, 0);
  });
});

describe("csv zip", () => {
  it("quotes commas and writes three named files", () => {
    const csv = recordsToCsv(
      [{ adga_reg: "N1", registered_name: "Name, with comma" }],
      INDIVIDUAL_COLUMNS,
    );
    assert.match(csv, /^adga_reg,adga_genetics_id,goat_id,registered_name,title,breed,/);
    assert.equal(
      LINEAR_COLUMNS.slice(0, 6).join(","),
      "adga_reg,adga_genetics_id,goat_id,registered_name,appraisal_date,age",
    );
    assert.equal(
      LINEAR_COLUMNS.slice(6, -3).join(","),
      "stat,st,dy,ra,rw,rls,fua,ruh,rua,msl,ud,tp,td,tl,bd,rusv,head,shoulder,front_legs,rear_legs,feet,back,rump,udder_texture,ga,ds,bc,ms,final_score,misc1,misc2,misc3",
    );
    assert.equal(
      PTI_COLUMNS.slice(0, 4).join(","),
      "adga_reg,adga_genetics_id,goat_id,registered_name",
    );
    assert.match(csv, /"Name, with comma"/);
    const files = storeToZipFiles(
      {
        individuals: [{ adga_reg: "N1" }],
        linear: [],
        pti: [],
      },
      { omitWithoutPaperId: false },
    );
    assert.deepEqual(
      files.map((f) => f.name),
      [MANIFEST_FILE, "individuals.csv", "linear_appraisals.csv", "pti.csv"],
    );
  });

  it("omits rows without a paper id by default", () => {
    const files = storeToZipFiles({
      individuals: [
        {
          adga_reg: "PN1352104",
          herdbook: "PB",
          adga_genetics_id: "N001352104",
          registered_name: "KEEP",
        },
        {
          adga_reg: "",
          herdbook: "",
          adga_genetics_id: "D002237546",
          registered_name: "STUB",
        },
      ],
      linear: [
        { adga_reg: "PN1352104", appraisal_date: "2024" },
        { adga_genetics_id: "D002237546", appraisal_date: "2025" },
      ],
      pti: [{ adga_genetics_id: "D002237546", pti21: "40" }],
    });
    const individuals = files.find((file) => file.name === "individuals.csv").text;
    const linear = files.find((file) => file.name === "linear_appraisals.csv").text;
    const pti = files.find((file) => file.name === "pti.csv").text;
    const manifest = JSON.parse(files.find((file) => file.name === MANIFEST_FILE).text);
    assert.match(individuals, /PN1352104/);
    assert.match(individuals, /KEEP/);
    assert.doesNotMatch(individuals, /STUB/);
    assert.doesNotMatch(individuals, /D002237546/);
    assert.match(linear, /PN1352104/);
    assert.doesNotMatch(linear, /D002237546/);
    assert.doesNotMatch(pti, /D002237546/);
    assert.equal(manifest.files[0].rows, 1);
    assert.equal(manifest.exporter.omitWithoutPaperId, undefined);
    const all = storeToZipFiles(
      {
        individuals: [
          { adga_reg: "", adga_genetics_id: "D002237546", registered_name: "STUB" },
        ],
        linear: [],
        pti: [],
      },
      { omitWithoutPaperId: false },
    );
    assert.match(all.find((file) => file.name === "individuals.csv").text, /STUB/);
    assert.equal(
      JSON.parse(all.find((file) => file.name === MANIFEST_FILE).text).exporter
        .omitWithoutPaperId,
      false,
    );
  });

  it("fills LA and PTI registered_name from the individual row", () => {
    const files = storeToZipFiles(
      {
        individuals: [
          { adga_reg: "PN1352104", registered_name: "SG ALDER*GLEN TRES BONNE 3*M" },
        ],
        linear: [{ adga_reg: "PN1352104", appraisal_date: "2025", age: "03-02" }],
        pti: [{ adga_reg: "PN1352104", pti21: "142" }],
      },
      { omitWithoutPaperId: false },
    );
    const linear = files.find((file) => file.name === "linear_appraisals.csv").text;
    const pti = files.find((file) => file.name === "pti.csv").text;
    assert.match(linear, /^adga_reg,adga_genetics_id,goat_id,registered_name,appraisal_date,/);
    assert.match(linear, /PN1352104,,1352104,SG ALDER\*GLEN TRES BONNE 3\*M,2025/);
    assert.match(pti, /^adga_reg,adga_genetics_id,goat_id,registered_name,pti21,/);
    assert.match(pti, /PN1352104,,1352104,SG ALDER\*GLEN TRES BONNE 3\*M,142/);
  });

  it("names the download with a local timestamp", () => {
    const name = exportFilename(new Date("2026-08-28T16:05:00"));
    assert.equal(name, "adga-genetics-export-2026-08-28-1605.zip");
    assert.equal(
      csvExportFilename("linear", new Date("2026-08-28T16:05:00")),
      "adga-genetics-linear_appraisals-2026-08-28-1605.csv",
    );
  });

  it("builds a store-only zip", async () => {
    const blob = storeToZipBlob({
      individuals: [{ adga_reg: "N1" }],
      linear: [],
      pti: [],
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
    assert.equal(bytes[2], 0x03);
    assert.equal(bytes[3], 0x04);
  });

  it("writes zip manifest.json with per-file versions and row counts", () => {
    const files = storeToZipFiles(
      {
        individuals: [{ adga_reg: "N1" }, { adga_reg: "N2" }],
        linear: [{ adga_reg: "N1", appraisal_date: "2025" }],
        pti: [{ adga_reg: "N1", pti21: "40" }],
      },
      {
        exportedAt: "2026-09-02T12:00:00.000Z",
        exporterVersion: "0.2.50",
        omitWithoutPaperId: false,
      },
    );
    const raw = files.find((file) => file.name === MANIFEST_FILE).text;
    const manifest = JSON.parse(raw);
    assert.equal(manifest.format, FORMAT_ID);
    assert.equal(manifest.manifestVersion, MANIFEST_VERSION);
    assert.equal(manifest.exportedAt, "2026-09-02T12:00:00.000Z");
    assert.equal(manifest.exporter.name, "other-goats-records");
    assert.equal(manifest.exporter.version, "0.2.50");
    assert.deepEqual(
      manifest.files.map((file) => [file.name, file.kind, file.version, file.rows]),
      [
        ["individuals.csv", "individuals", FILE_VERSIONS.individuals, 2],
        ["linear_appraisals.csv", "linear_appraisals", FILE_VERSIONS.linear, 1],
        ["pti.csv", "pti", FILE_VERSIONS.pti, 1],
      ],
    );
    assert.equal(
      buildExportManifest({ individuals: [], linear: [], pti: [] }).manifestVersion,
      "1.0",
    );
    assert.deepEqual(parseFileVersion("1.12"), { major: 1, patch: 12 });
    assert.deepEqual(parseFileVersion("2.0"), { major: 2, patch: 0 });
  });

  it("omits columns that are empty on every row when asked", () => {
    const rows = [
      { adga_reg: "PN1352104", registered_name: "TRES", owner_id: "" },
    ];
    assert.deepEqual(
      exportColumns(rows, INDIVIDUAL_COLUMNS, false),
      INDIVIDUAL_COLUMNS,
    );
    const slim = exportColumns(rows, INDIVIDUAL_COLUMNS, true);
    assert.deepEqual(slim, ["adga_reg", "registered_name"]);
    assert.equal(exportColumns([], INDIVIDUAL_COLUMNS, true), INDIVIDUAL_COLUMNS);
    const files = storeToZipFiles(
      { individuals: rows, linear: [], pti: [] },
      { omitEmptyColumns: true, omitWithoutPaperId: false },
    );
    const csv = files.find((file) => file.name === "individuals.csv").text;
    assert.equal(csv.split("\n")[0], "adga_reg,goat_id,registered_name");
    assert.match(csv, /PN1352104,1352104,TRES/);
    assert.doesNotMatch(csv, /owner_id/);
    const full = storeToZipFiles(
      { individuals: rows, linear: [], pti: [] },
      { omitWithoutPaperId: false },
    );
    assert.match(full.find((file) => file.name === "individuals.csv").text, /^adga_reg,adga_genetics_id,goat_id,registered_name,title,/);
  });

  it("includes owner_id on individuals.csv", () => {
    assert.ok(INDIVIDUAL_COLUMNS.includes("owner_id"));
    assert.ok(INDIVIDUAL_COLUMNS.includes("tattoo_re"));
    assert.ok(INDIVIDUAL_COLUMNS.includes("format_1"));
    const csv = recordsToCsv(
      [{ adga_reg: "PN1352104", owner_id: "1234567" }],
      INDIVIDUAL_COLUMNS,
    );
    assert.match(
      csv,
      /sire_adga_reg,sire_adga_genetics_id,sire_goat_id,dam_adga_reg,dam_adga_genetics_id,dam_goat_id,owner_id,owner_name,breeder_id,breeder_name,tattoo_re,tattoo_le,tattoo_comment,eid,eid_location,ears,horns,conforms,description,status,breeding_method,application_id,file_app_id,format_1,source_url/,
    );
    assert.match(csv, /PN1352104,.*,1234567,/);
  });
});

describe("pti seasons", () => {
  it("maps scrape dates to August or December", () => {
    assert.deepEqual(suggestedPtiEval(new Date("2026-09-02T12:00:00Z")), {
      evalYear: 2026,
      evalMonth: "AUGUST",
    });
    assert.deepEqual(suggestedPtiEval(new Date("2026-12-15T12:00:00Z")), {
      evalYear: 2026,
      evalMonth: "DECEMBER",
    });
    assert.deepEqual(suggestedPtiEval(new Date("2026-03-01T12:00:00Z")), {
      evalYear: 2025,
      evalMonth: "DECEMBER",
    });
  });

  it("keeps one PTI row per registration per season", () => {
    const first = mergeBatch(emptyStore(), {
      pti: [
        {
          adga_reg: "PD2237546",
          pti21: "40",
          captured_at: "2026-03-01T12:00:00.000Z",
        },
      ],
    });
    const second = mergeBatch(first, {
      pti: [
        {
          adga_reg: "PD2237546",
          pti21: "41",
          captured_at: "2026-03-20T12:00:00.000Z",
        },
        {
          adga_reg: "PD2237546",
          pti21: "55",
          captured_at: "2026-09-02T12:00:00.000Z",
        },
      ],
    });
    assert.equal(Object.keys(second.pti).length, 2);
    assert.equal(second.pti[ptiKey({ adga_reg: "PD2237546", captured_at: "2026-03-01T12:00:00.000Z" })].pti21, "41");
    assert.equal(second.pti[ptiKey({ adga_reg: "PD2237546", captured_at: "2026-09-02T12:00:00.000Z" })].pti21, "55");
  });

  it("re-keys a registration-only stored PTI row", () => {
    const store = normalizeStore({
      individuals: {},
      linear: {},
      pti: {
        PD2237546: {
          adga_reg: "PD2237546",
          pti21: "40",
          captured_at: "2026-09-02T12:00:00.000Z",
        },
      },
    });
    const key = ptiKey({
      adga_reg: "PD2237546",
      captured_at: "2026-09-02T12:00:00.000Z",
    });
    assert.equal(store.pti[key].pti21, "40");
    assert.equal(store.pti.PD2237546, undefined);
  });

  it("removing one season keeps the other and PTI complete", () => {
    const store = mergeBatch(emptyStore(), {
      individuals: [{ adga_reg: "PD2237546" }],
      pti: [
        {
          adga_reg: "PD2237546",
          pti21: "10",
          captured_at: "2026-03-01T12:00:00.000Z",
        },
        {
          adga_reg: "PD2237546",
          pti21: "20",
          captured_at: "2026-09-02T12:00:00.000Z",
        },
      ],
      subjectRegistration: "PD2237546",
      ptiComplete: true,
    });
    const drop = ptiKey({
      adga_reg: "PD2237546",
      captured_at: "2026-03-01T12:00:00.000Z",
    });
    const next = removeRow(store, "pti", drop);
    assert.equal(Object.keys(next.pti).length, 1);
    assert.equal(goat(next, "PD2237546").pti_complete, true);
  });
});

describe("owned by me", () => {
  const ownedPage = {
    url: "https://genetics.adga.org/OwnedByMe.aspx",
    title: "Owned by me",
    text: "Owned by me\nMember ID: 1234567",
    links: [
      {
        href: "GoatDetail.aspx?RegNumber=D002237546",
        text: "TWIN WILLOWS AL KARAMELLO",
      },
    ],
    tables: [],
  };

  it("detects the page and member ID", () => {
    assert.equal(isOwnedByMePage(ownedPage), true);
    assert.equal(memberIdFromPage(ownedPage), "1234567");
    assert.equal(isOwnedByMePage({ url: SAMPLE_URL, title: "Goat Detail", text: "" }), false);
  });

  it("fills owner_id on listed animals and does not invent it on GoatDetail", () => {
    const batch = extractOwnedByMeSnapshot(ownedPage, "2026-09-02T12:00:00.000Z");
    assert.equal(batch.view, "owned");
    assert.equal(batch.individuals.length, 1);
    assert.equal(batch.individuals[0].adga_reg, "");
    assert.equal(batch.individuals[0].adga_genetics_id, "D002237546");
    assert.equal(batch.individuals[0].owner_id, "1234567");
    assert.equal(batch.individuals[0].registered_name, "TWIN WILLOWS AL KARAMELLO");
    const goat = extractFromSnapshot({
      url: SAMPLE_URL,
      title: "SG ALDER*GLEN TRES BONNE 3*M - N001352104 (PB Doe)",
      text: PEDIGREE_TEXT,
      links: PEDIGREE_LINKS,
      tables: [],
    });
    assert.equal(goat.individuals[0].owner_id, "");
  });

  it("does not clear a filled owner_id with a later blank", () => {
    const first = mergeBatch(emptyStore(), {
      individuals: [{ adga_reg: "PD2237546", owner_id: "1234567" }],
    });
    const second = mergeBatch(first, {
      individuals: [{ adga_reg: "PD2237546", owner_id: "" }],
    });
    assert.equal(goat(second, "PD2237546").owner_id, "1234567");
  });
});
