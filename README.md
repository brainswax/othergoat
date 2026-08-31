# Other Goats Records

A **Chrome / Chromium** (120+) browser extension that captures animal data from [ADGA Genetics](https://genetics.adga.org/) pages **you actually visit**, merges them on this computer, and downloads a zip of CSVs.

It has **no network of its own**: it does not scrape pages you never opened, and it does not talk to Goatsmith or any other server.

License: [GPL-3.0](./LICENSE).

Design: [`docs/goatsmith-adga-genetics-csv-export-design.md`](./docs/goatsmith-adga-genetics-csv-export-design.md).

## Milestones

1. **Passive-only (current)** — Capture GoatDetail views as you open them. No POST from the extension.
2. **Active individual** — Point at one registration; the extension POSTs that animal’s own views.
3. **Active family** — After (2), POST-walk direct progeny, siblings, and parents.

Goatsmith zip import is later (herdsmith P-18).

## Load unpacked (Chrome)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. **Load unpacked** and choose the `extension/` folder in this repo.
4. Browse animal pages such as  
   `https://genetics.adga.org/GoatDetail.aspx?RegNumber=…`
5. Open Pedigree, Progeny, and Linear History on animals you care about (each view adds more rows).
6. Click the extension icon → **Download zip**  
   (`adga-genetics-export-YYYY-MM-DD-HHmm.zip`).

Cloudflare’s “verify your browser” interstitial is common on first load. The content script retries until the animal heading is present. Switching submenu items is an ASP.NET postback on the same URL; the extension re-reads the DOM after the pane updates.

If you already loaded an older build, click **Reload** on `chrome://extensions`, then **refresh the Genetics tab**. An open page keeps the old content script until you reload it.

## Export

The zip contains three CSVs (one table each):

- `individuals.csv` — one row per **ADGA registration ID** (`PD2237546`, not Genetics `D002237546`); `sire_registration` / `dam_registration` only (no parent names). Pedigree creates a stub for every animal in the visible tree.
- `linear_appraisals.csv` — one row per Linear History event; trait columns follow the Genetics table order (Stature, Strength, … Body Depth, Rear Udder Side View).
- `pti.csv` — one row per registration: `pti21`, `pti12`, `eta21`, `eta12`.

Opening Pedigree creates a stub row for every animal in the visible tree (name, registration, parent registrations). Visiting that animal later fills breed, DOB, LA, and PTI. Empty cells are not overwritten.

## Tests

```bash
npm test
```

Parser, merge, and CSV helpers are plain ES modules. No build step.

## What this is not

- POST-back or family walk (milestones 2–3)
- A Goatsmith plugin
- Firefox
