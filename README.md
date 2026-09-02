# Other Goats Records

A **Chrome / Chromium** (120+) browser extension that captures animal data from [ADGA Genetics](https://genetics.adga.org/) pages **you actually visit**, merges them on this computer, and downloads a zip of CSVs.

It has **no network of its own**: it does not scrape pages you never opened, and it does not talk to any other server.

License: [GPL-3.0](./LICENSE).

Design: [`docs/adga-genetics-csv-export-design.md`](./docs/adga-genetics-csv-export-design.md).

## Milestones

1. **Passive-only (done)** — Capture GoatDetail views as you open them. No POST from the extension.
2. **Active individual** — Point at one registration; the extension POSTs that animal’s own views.
3. **Active family** — After (2), POST-walk direct progeny, siblings, and parents.

The zip is **`manifestVersion` 1.0**: `manifest.json` plus the three CSVs (each file version `1.0`). Versions are `major.patch`; same major is compatible. See the design doc.

## Install

Until this is on the Chrome Web Store, install **0.2.47** from GitHub:

**[Download Other Goats Records 0.2.47](https://github.com/brainswax/othergoat/releases/download/v0.2.47/other-goats-records-0.2.47.zip)**

([0.2.47 release](https://github.com/brainswax/othergoat/releases/tag/v0.2.47) · [All releases](https://github.com/brainswax/othergoat/releases))

1. Unzip the file. You should get a folder named `other-goats-records-…` that contains `manifest.json`.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose **that folder** (the one with `manifest.json` inside, not the zip).
5. Pin **Other Goats Records** on the toolbar, then open a goat on [ADGA Genetics](https://genetics.adga.org/).

Chrome will warn that this is an unpacked developer extension. That is expected until a Web Store listing exists. If the GitHub repo is private, you need access to download the release (or someone must send you the zip).

## Load unpacked from this repo (development)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. **Load unpacked** and choose the `extension/` folder in this repo.
4. Browse animal pages such as  
   `https://genetics.adga.org/GoatDetail.aspx?RegNumber=…`
5. Open Pedigree, Progeny, and Linear History on animals you care about (each view adds more rows). Open **Owned by me** to fill `owner_id`. On Genetics pages, the panel stays in the header — pause/play and minimize/maximize persist. Off Genetics, use the toolbar icon.
6. Click the extension icon for the queue, **Settings** (what to capture), and **Download zip**  
   (`adga-genetics-export-YYYY-MM-DD-HHmm.zip`).

Cloudflare’s “verify your browser” interstitial is common on first load. The content script retries until the animal heading is present. Switching submenu items is an ASP.NET postback on the same URL; the extension re-reads the DOM after the pane updates.

If you already loaded an older build, click **Reload** on `chrome://extensions`, then **refresh the Genetics tab**. An open page keeps the old content script until you reload it.

## Export

The zip contains `manifest.json` and three CSVs (one table each):

- `manifest.json` — format id, `manifestVersion` (`1.0`), exporter version, and per-file `version` (`major.patch`) + row counts.
- `individuals.csv` — one row per **ADGA registration ID** (`PD2237546`, not Genetics `D002237546`); `sire_registration` / `dam_registration` only (no parent names). `title` is SG/SGCH/CH/GCH. Identity pane FS, condensed majors, and appraisal age go on this row. `owner_id` is the ADGA member ID when the animal appears on Genetics **Owned by me** (empty = unknown). Also reserved: tattoos, EID, ears, horns, conforms, description, status, breeder, breeding method, Format 1, goat id (filled later from app.adga.org Identity). Pedigree creates a stub for every animal in the visible tree.
- `linear_appraisals.csv` — one row per Linear History event: registration, registered name, linear scores, structural letters, GA/DS/BC/MS, final score, miscellaneous codes.
- `pti.csv` — one row per registration per scrape-season: registered name, `pti21`, `pti12`, `eta21`, `eta12`, `captured_at` (maps to August or December).

Opening Pedigree creates a stub row for every animal in the visible tree (name, registration, parent registrations). Visiting that animal later fills breed, DOB, LA, and PTI. Empty cells are not overwritten.

Settings → **Omit empty columns on download** is off by default (Goatsmith wants the full header). Turn it on for a slimmer spreadsheet.

## Tests

```bash
npm test
```

Parser, merge, and CSV helpers are plain ES modules. No compile step.

```bash
npm run pack
```

Writes `dist/other-goats-records-{version}.zip`. Testers unzip and **Load unpacked** on the folder that contains `manifest.json`.

To publish, bump `version` in `extension/manifest.json`, merge to `main`, then:

```bash
npm run release
```

That command reads the manifest version, points the install links in this README at it, commits if needed, tags `v{version}`, and pushes. GitHub Actions packs the zip and creates the Release. `npm run readme:version` only rewrites the links (no tag).

## What this is not

- POST-back or family walk (milestones 2–3)
- Firefox
