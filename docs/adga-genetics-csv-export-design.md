# Other Goats Records — ADGA Genetics capture → CSV zip

**Status (2026-09-01):** Milestone 1 (passive-only) is **complete**. Load unpacked from `extension/` (root `README.md`). Milestones 2–3 (active individual / family walk) are not this pass.

The extension does not contact any server.

---

## 1. Overview

A browser extension captures structured animal data from ADGA Genetics GoatDetail views the user opens. Records merge locally by registration number. The user downloads a zip of `manifest.json` plus three CSVs: individuals, linear appraisals, and PTI/ETA.

## 2. Goals

- Capture data from pages and views the user actually opens.
- Tolerate partial rows (pedigree stubs, progeny tables).
- Deduplicate by registration; empty fields never overwrite filled ones.
- Keep all data on this computer until the user downloads a file.
- Produce a normalized zip usable in spreadsheets.

## 3. Non-goals (milestone 1)

- The extension must not POST, click the submenu, or walk registrations.
- No scrape of pages the user never opened.
- No network of its own; no sync with any application.

---

## 4. Capture model

Content script on `https://genetics.adga.org/GoatDetail.aspx*`.

- After load (and after ASP.NET postbacks that swap the content pane), parse the visible DOM.
- Detect the view from `__EVENTARGUMENT` / `__EVENTTARGET` when present, else the selected submenu, else table shape. Default is Pedigree.
- Send a **batch** (individuals + LA rows + PTI rows) to the service worker, according to Settings (all on by default; user can opt out of individuals, ancestry stub rows, progeny stub rows, PTI, or Linear History). Ancestry and progeny stubs only apply when recording individuals. Sire and dam on the open animal are recorded whenever that animal row is saved.
- Debounce identical batches; a view change is a new batch.
- Do not submit the ASP.NET form. Hidden `__EVENTARGUMENT` is recorded for later milestones only.

Background store: `chrome.storage.local` `{ individuals, linear, pti }`.

Merge:

- Individual key: ADGA registration ID (not Genetics `RegNumber`). `D002237546` + PB → `PD2237546`. Later non-empty field values replace earlier ones; blanks do not clobber. Polled/black are an exception: the animal’s own GoatDetail identity pane outranks a progeny `IsPolled`/`IsBlack` cell, which outranks pedigree name colors. A later identity visit overwrites an earlier pedigree guess; pedigree colors never overwrite identity.
- LA key: `registration_number` + `appraisal_date` (or `age` if no date).
- PTI key (today): `registration_number` — one current row; later non-empty values overwrite. **Todo (historic PTI):** key by `registration_number` + the August/December eval implied by `captured_at` so a goat can have several rows.

Popup lists unique individuals and downloads the zip. Clear wipes the local store.

---

## 5. Export

One download: `adga-genetics-export-YYYY-MM-DD-HHmm.zip`

A CSV is one table. Multiple tables are separate files in the zip. **`manifest.json`** describes the zip. Versions are condensed semver **`major.patch`** (string, e.g. `"1.0"`). Same major is compatible — a `1.x` reader can ingest any `1.y`. Bump **patch** when adding fields (debug). Bump **major** when that table’s meaning breaks. Bump `manifestVersion` major only when the manifest shape itself breaks.

### manifest.json

```
format, manifestVersion, exportedAt, exporter { name, version }, files [{ name, kind, version, rows }]
```

`format` is `adga-genetics-export`. `files[].rows` is data rows, not the header. Today `manifestVersion` and each file `version` are `"1.0"`. The manifest is optional; the three CSVs are usable on their own (including a loose CSV download).

**Omit empty columns** (Settings, **off** by default): drop a column when every row is blank. For spreadsheets. Leave off to keep the full locked header. Empty tables still get the full header. When on, `exporter.omitEmptyColumns` is `true` in the zip manifest.

### individuals.csv

One row per registration.

```
registration_number,registered_name,title,breed,breed_percent,herdbook,polled,black,sex,date_of_birth,linear_final_score,linear_majors,linear_age,sire_registration,dam_registration,owner_id,owner_name,breeder_id,breeder_name,tattoo_re,tattoo_le,tattoo_comment,eid,eid_location,ears,horns,conforms,description,status,breeding_method,application_id,file_app_id,format_1,goat_id,source_url,captured_at,notes
```

**`owner_id`:** ADGA membership ID. Fill it when the animal appears on Genetics **Owned by me**, or later from app.adga.org **Owner**. **Empty or omitted = unknown.** Do not invent `owner_id` from a Genetics GoatDetail visit.

**app.adga.org Identity (columns locked; scrape later):** `owner_name`, `breeder_id`, `breeder_name`, `tattoo_re`, `tattoo_le`, `tattoo_comment`, `eid`, `eid_location`, `ears`, `horns`, `conforms`, `description`, `status`, `breeding_method`, `application_id`, `file_app_id`, `format_1` (ICAR/CDCB id, e.g. `NDUSA000002495341`), `goat_id` (numeric). Store `horns` as ADGA shows it (`POLLED`, `DISBUDDED`, `HORNED`, …). `Horns: POLLED` also fills empty `polled` as Y. `DISBUDDED` / `HORNED` do not. Do not overwrite a filled `polled`. `description` is free text (e.g. BUCKSKIN), not the Genetics coat-pattern flags. Parent names and parent-owner boxes belong on the parent’s own row. Photo is out of the CSV.

Parent links are registration numbers only. The parent’s name lives on the parent’s own row. Join later by reg #. `title` is SG / SGCH / CH / GCH when that prefix is on the name. `linear_final_score`, `linear_majors`, and `linear_age` come from the identity pane (`FS84 (+V++) @ 01-03`).

**Pedigree:** every visible tree node (subject, S, D, SS, …) becomes a row. Stubs get name, registration, and parent registration numbers when those nodes are on the page. Visiting that animal later fills the rest. Ancestor polled/black are implied from name colors: green = polled, black (when distinct from default link text) = black coat, red = both; unmarked names store `N`. The open animal uses the identity pane only (heading `Polled`/`Black`, else `N`), not tree colors. If that animal’s own page disagrees with a color seen on someone else’s pedigree, the identity page wins.

**Progeny:** each table row is a stub; `sire_registration` or `dam_registration` is set to the current animal (buck → sire, doe → dam).

### linear_appraisals.csv

One row per Linear History event.

```
registration_number,registered_name,appraisal_date,age,stat,st,dy,ra,rw,rls,fua,ruh,rua,msl,ud,tp,td,tl,bd,rusv,head,shoulder,front_legs,rear_legs,feet,back,rump,udder_texture,ga,ds,bc,ms,final_score,misc1,misc2,misc3,source_url,captured_at,notes
```

`registered_name` is copied from the individual row so a spreadsheet is readable without joining. Trait keys follow Genetics Linear History / LA report groups: linear scores, structural letters, the four majors (`ga`, `ds`, `bc`, `ms`), final score, then miscellaneous codes. Unmapped Genetics columns go in `notes`.

### pti.csv

One row per registration per CDCB season. The left pane always has four slots (empty if not published).

```
registration_number,registered_name,pti21,pti12,eta21,eta12,source_url,captured_at
```

Map `captured_at` (scrape date) to August or December (Jan–Jul → prior December; Aug–Nov → August that year; Dec → December that year). Same-season merge updates the four numbers; a scrape after the next drop is a new row. Do not invent a third season.

---

## 6. User flow (milestone 1)

1. Browse ADGA Genetics normally (Pedigree, Progeny, Linear History, evals).
2. Extension merges whatever is on the page.
3. Open the popup → **Download zip**.
4. Open the three CSVs (and the JSON manifest) in a spreadsheet or editor.

---

## 7. Technical notes

- Extraction must not throw into the host page.
- Cloudflare’s “verify your browser” interstitial: retry until the heading/reg appears.
- Progeny paging: only the page the user is looking at; the next page is another capture, then merge.
- Ancestry is a directed graph via `sire_registration` / `dam_registration` on the individual row (at most one of each).

---

## 8. Milestones

### 1 – Passive-only (**done**)

Collect as the user browses. Parse the DOM after they open a view. Do not POST.

Acceptance: Browse several animals and views → popup lists unique registrations → zip contains `manifest.json`, `individuals.csv`, `linear_appraisals.csv`, and `pti.csv` with merged partial rows.

### 2 – Active individual (not this pass)

User points at one registration. The extension fires the site’s own postbacks on that GoatDetail and merges Pedigree identity, Linear History, PTI/ETA, and Progeny stubs for **that animal only**. No walk to relatives’ pages.

### 3 – Active family (not this pass)

After (2), POST-walk **direct** progeny, siblings, and parents (not the whole tree). For each of those registrations, collect the same individual payload as (2). End goal: pick a buck, pull the family.

### Historic PTI/ETA (**done** in format v1)

Keep **multiple** PTI/ETA records for the same animal when scrapes fall in different semi-annual updates (CDCB yield: August and December). Derive the eval from `captured_at`. Merge key: registration + eval year + August|December. Same-season re-visit updates that snapshot. Export every stored snapshot.

### Later — scrape app.adga.org Goat Details (Identity)

Columns are in `individuals.csv`. Do not capture `app.adga.org` until this item. Genetics GoatDetail stays the current fill path.

### `owner_id` / Owned by me (**format locked**; fill from Owned by me)

`owner_id` is on the individual row (ADGA member ID). Capture Genetics **Owned by me** so we know which membership owns the animal. GoatDetail visits do not set it.

Empty or omitted `owner_id` is **unknown** (stubs, other people’s goats, pages that are not Owned by me). Only a **present** `owner_id` asserts a membership.

---

## 9. Live page notes

- Animal URL: `GoatDetail.aspx?RegNumber={REG}`.
- Heading: `NAME - REG (PB Doe|Buck…)`. Prefixes `SG` / `SGCH` / `CH` / `GCH` are stored in `title`. DOB/FS: `DOB: M/D/YYYY FS84 (+V++) @ 01-03` → `date_of_birth`, `linear_final_score`, `linear_majors`, `linear_age`.
- Breed: `Breed Percent: 100% N` → `breed_percent=100`, `breed=N`.
- Pedigree labels `S :` / `D :` / `SS :` / … with GoatDetail links. Ancestor sex is inferred from the last letter (`S` → buck, `D` → doe). Polled/black on the tree are name colors (green / black / red); unmarked names store `N`. Those implied flags lose to the same animal’s own identity heading.
- Views swap via ASP.NET postback on the same URL (`__EVENTARGUMENT`). Milestone 1 only reads the resulting DOM.
- Linear History on Genetics is `LAYear` + `Age` + linear scores (Stature … Rear Udder Side View), then a Structural Traits table (Head, Shoulder Assembly, Front Legs, Rear Legs, Feet, Back, Rump, Udder Texture, General Appearance, Dairy Strength, Body Capacity, Mammary System, FS), plus miscellaneous codes when present. Export column groups match that report: linear, structural, majors, final score, misc. Type Eval / PTA tables are not LA rows. Layout tables (Pedigree, Registry, DOB chrome) are not progeny.

---

## 10. Success criteria

- A user can click through ADGA Genetics and obtain a usable zip with minimal friction.
- Partial pedigree/progeny rows do not duplicate an animal or wipe fields filled on another view.
- Milestone 1 never POSTs and never collects data from pages the user did not visit.
