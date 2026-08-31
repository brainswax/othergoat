import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectView,
  extractFromSnapshot,
  parseBreedPercent,
  parseHeading,
  parsePedigreeNodes,
  registrationFromUrl,
} from "../extension/extract.js";
import { emptyStore, LINEAR_COLUMNS, INDIVIDUAL_COLUMNS, isIndividualComplete } from "../extension/schema.js";
import { mergeBatch, linearKey, removeRow } from "../extension/merge.js";
import {
  csvExportFilename,
  exportFilename,
  recordsToCsv,
  storeToZipBlob,
  storeToZipFiles,
} from "../extension/csv.js";
import {
  toAdgaRegistration,
  breedName,
  goatDetailUrl,
  toGeneticsRegNumber,
} from "../extension/registration.js";

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
  { href: "GoatDetail.aspx?RegNumber=N001201234", text: "SGCH ALDER*GLEN TRES LECHES 5*M" },
  { href: "GoatDetail.aspx?RegNumber=N001198765", text: "SGCH ALDER*GLEN TRES BELLE 4*M" },
  { href: "GoatDetail.aspx?RegNumber=N000111111", text: "SGCH SOME SIRE" },
  { href: "GoatDetail.aspx?RegNumber=N000222222", text: "SGCH SOME DAM" },
];

describe("toAdgaRegistration", () => {
  it("converts Genetics RegNumber plus herdbook to a paper ID", () => {
    assert.equal(toAdgaRegistration("D002237546", "PB"), "PD2237546");
    assert.equal(toAdgaRegistration("N001352104", "PB"), "PN1352104");
    assert.equal(toAdgaRegistration("D002237546"), "D2237546");
    assert.equal(toAdgaRegistration("PD2237546"), "PD2237546");
  });
});

describe("breedName", () => {
  it("maps Genetics breed letters and registration prefixes", () => {
    assert.equal(breedName("D"), "Nigerian Dwarf");
    assert.equal(breedName("PD2237546"), "Nigerian Dwarf");
    assert.equal(breedName("N"), "Nubian");
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
        registration_number: "N111111",
        sire_registration: "N222222",
      }),
      false,
    );
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

  it("strips UI labels from link text", () => {
    const nodes = parsePedigreeNodes("SS : SGCH SOME SIRE", [
      {
        href: "GoatDetail.aspx?RegNumber=N000111111",
        text: "SS : SGCH SOME SIRE",
      },
    ]);
    assert.equal(nodes[0].name, "SGCH SOME SIRE");
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
      batch.individuals.map((row) => [row.registration_number, row]),
    );
    assert.equal(byReg.PN1352104.registered_name, "SG ALDER*GLEN TRES BONNE 3*M");
    assert.equal(byReg.PN1352104.sex, "DOE");
    assert.equal(byReg.PN1352104.breed, "N");
    assert.equal(byReg.PN1352104.breed_percent, "100");
    assert.equal(byReg.PN1352104.sire_registration, "N1201234");
    assert.equal(byReg.PN1352104.dam_registration, "N1198765");
    assert.equal(byReg.PN1352104.sire_name, undefined);
    assert.equal(byReg.N1201234.registered_name, "SGCH ALDER*GLEN TRES LECHES 5*M");
    assert.equal(byReg.N1201234.sire_registration, "N111111");
    assert.equal(byReg.N1201234.dam_registration, "N222222");
    assert.equal(byReg.N111111.registered_name, "SGCH SOME SIRE");
    assert.equal(byReg.N111111.sire_registration, "");
    assert.equal(isIndividualComplete(byReg.PN1352104), true);
    assert.equal(isIndividualComplete(byReg.N1201234), false);
    assert.equal(batch.pti.length, 1);
    assert.equal(batch.pti[0].pti21, "142");
    assert.equal(batch.pti[0].pti12, "12");
    assert.equal(batch.pti[0].eta21, "8");
    assert.equal(batch.pti[0].eta12, "4");
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
    assert.equal(batch.individuals[0].sire_registration, "N1201234");
    assert.equal(batch.individuals[0].dam_registration, "N1198765");
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
              ["Name", "Reg #", "Herdbook", "Breed", "Sex", "DOB", "IsPolled"],
              ["KID ONE", "N000333333", "PB", "N", "F", "1/2/2024", "Y"],
            ],
          },
        ],
      },
      "t",
    );
    const kid = batch.individuals.find((row) => row.registration_number === "PN333333");
    assert.equal(kid.registered_name, "KID ONE");
    assert.equal(kid.dam_registration, "PN1352104");
    assert.equal(kid.sire_registration, "");
    assert.equal(kid.polled, "Y");
    assert.equal(isIndividualComplete(kid), false);
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
    assert.equal(batch.linear.length, 2);
    assert.equal(batch.linear[0].appraisal_date, "2024");
    assert.equal(batch.linear[0].stat, "28");
    assert.equal(batch.linear[0].st, "30");
    assert.equal(batch.linear[0].bd, "38");
    assert.equal(batch.linear[1].appraisal_date, "2025");
    assert.equal(batch.linear[1].age, "03-02");
    assert.equal(batch.linear[1].final_score, "84");
    assert.equal(batch.linear[1].majors, "VVEA");
    assert.equal(batch.pti.length, 1);
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

describe("merge", () => {
  it("fills empty fields and does not clobber with blanks", () => {
    const first = mergeBatch(emptyStore(), {
      individuals: [
        {
          registration_number: "N1",
          registered_name: "ONE",
          breed: "",
          sire_registration: "S1",
          dam_registration: "",
        },
      ],
    });
    const second = mergeBatch(first, {
      individuals: [
        {
          registration_number: "N1",
          registered_name: "",
          breed: "N",
          sire_registration: "",
          dam_registration: "D1",
        },
      ],
    });
    const row = second.individuals.N1;
    assert.equal(row.registered_name, "ONE");
    assert.equal(row.breed, "N");
    assert.equal(row.sire_registration, "S1");
    assert.equal(row.dam_registration, "D1");
  });

  it("lets a later non-empty value replace an earlier one", () => {
    const first = mergeBatch(emptyStore(), {
      individuals: [{ registration_number: "N1", breed: "A" }],
    });
    const second = mergeBatch(first, {
      individuals: [{ registration_number: "N1", breed: "N" }],
    });
    assert.equal(second.individuals.N1.breed, "N");
  });

  it("removes one animal without touching LA or PTI", () => {
    const store = mergeBatch(emptyStore(), {
      individuals: [
        { registration_number: "PD2237546", registered_name: "KEEP" },
        { registration_number: "PN1352104", registered_name: "DROP" },
      ],
      linear: [
        { registration_number: "PN1352104", appraisal_date: "2025", age: "03-02" },
        { registration_number: "PD2237546", appraisal_date: "2024", age: "02-01" },
      ],
      pti: [
        { registration_number: "PN1352104", pti21: "1" },
        { registration_number: "PD2237546", pti21: "2" },
      ],
    });
    const next = removeRow(store, "individuals", "N001352104");
    assert.equal(Object.keys(next.individuals).length, 1);
    assert.equal(next.individuals.PD2237546.registered_name, "KEEP");
    assert.equal(Object.keys(next.linear).length, 2);
    assert.equal(Object.keys(next.pti).length, 2);
    assert.ok(next.pti.PN1352104);
  });

  it("removes a single LA row without dropping the animal", () => {
    const store = mergeBatch(emptyStore(), {
      individuals: [{ registration_number: "PD2237546" }],
      linear: [
        { registration_number: "PD2237546", appraisal_date: "2025", age: "03-02" },
        { registration_number: "PD2237546", appraisal_date: "2024", age: "02-01" },
      ],
    });
    const drop = linearKey({
      registration_number: "PD2237546",
      appraisal_date: "2025",
      age: "03-02",
    });
    const next = removeRow(store, "linear", drop);
    assert.ok(next.individuals.PD2237546);
    assert.equal(Object.keys(next.linear).length, 1);
  });
});

describe("csv zip", () => {
  it("quotes commas and writes three named files", () => {
    const csv = recordsToCsv(
      [{ registration_number: "N1", registered_name: "Name, with comma" }],
      INDIVIDUAL_COLUMNS,
    );
    assert.match(csv, /^registration_number,registered_name,breed,/);
    assert.equal(
      LINEAR_COLUMNS.slice(3, 19).join(","),
      "stat,st,dy,ra,rw,rls,fua,ruh,rua,msl,ud,tp,td,tl,bd,rusv",
    );
    assert.match(csv, /"Name, with comma"/);
    const files = storeToZipFiles({
      individuals: [{ registration_number: "N1" }],
      linear: [],
      pti: [],
    });
    assert.deepEqual(
      files.map((f) => f.name),
      ["individuals.csv", "linear_appraisals.csv", "pti.csv"],
    );
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
      individuals: [{ registration_number: "N1" }],
      linear: [],
      pti: [],
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
    assert.equal(bytes[2], 0x03);
    assert.equal(bytes[3], 0x04);
  });
});
