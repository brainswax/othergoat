# Other Goats Records — ADGA Genetics capture → CSV zip

**Status (2026-08-30):** Milestone 1 (passive-only) is implemented in `extension/`. Load unpacked from that folder (root `README.md`).

The extension does not contact any server.

---

## 1. Overview

A browser extension captures structured animal data from ADGA Genetics GoatDetail views the user opens. Records merge locally by registration number. The user downloads a zip of three CSVs: individuals, linear appraisals, and PTI/ETA.

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
- Send a **batch** (individuals + LA rows + PTI rows) to the service worker, according to Settings (all on by default; user can opt out of individuals, ancestry stub rows, PTI, or Linear History). Ancestry stubs only apply when recording individuals. Sire and dam on the open animal are recorded whenever that animal row is saved.
- Debounce identical batches; a view change is a new batch.
- Do not submit the ASP.NET form. Hidden `__EVENTARGUMENT` is recorded for later milestones only.

Background store: `chrome.storage.local` `{ individuals, linear, pti }`.

Merge:

- Individual key: ADGA registration ID (not Genetics `RegNumber`). `D002237546` + PB → `PD2237546`. Later non-empty field values replace earlier ones; blanks do not clobber.
- LA key: `registration_number` + `appraisal_date` (or `age` if no date).
- PTI key: `registration_number`.

Popup lists unique individuals and downloads the zip. Clear wipes the local store.

---

## 5. Export

One download: `adga-genetics-export-YYYY-MM-DD-HHmm.zip`

A CSV is one table. Multiple tables are separate files in the zip.

### individuals.csv

One row per registration.

```
registration_number,registered_name,breed,breed_percent,herdbook,polled,sex,date_of_birth,linear_final_score,sire_registration,dam_registration,source_url,captured_at,notes
```

Parent links are registration numbers only. The parent’s name lives on the parent’s own row. Join later by reg #.

**Pedigree:** every visible tree node (subject, S, D, SS, …) becomes a row. Stubs get name, registration, and parent registration numbers when those nodes are on the page. Visiting that animal later fills the rest.

**Progeny:** each table row is a stub; `sire_registration` or `dam_registration` is set to the current animal (buck → sire, doe → dam).

### linear_appraisals.csv

One row per Linear History event.

```
registration_number,appraisal_date,age,stat,st,dy,ra,rw,rls,fua,ruh,rua,msl,ud,tp,td,tl,bd,rusv,final_score,majors,source_url,captured_at,notes
```

Trait keys follow the Genetics Linear History column order. Unmapped Genetics columns go in `notes`.

### pti.csv

One row per registration. The left pane always has four slots (empty if not published).

```
registration_number,pti21,pti12,eta21,eta12,source_url,captured_at
```

---

## 6. User flow (milestone 1)

1. Browse ADGA Genetics normally (Pedigree, Progeny, Linear History, evals).
2. Extension merges whatever is on the page.
3. Open the popup → **Download zip**.
4. Open the three CSVs in a spreadsheet.

---

## 7. Technical notes

- Extraction must not throw into the host page.
- Cloudflare’s “verify your browser” interstitial: retry until the heading/reg appears.
- Progeny paging: only the page the user is looking at; the next page is another capture, then merge.
- Ancestry is a directed graph via `sire_registration` / `dam_registration` on the individual row (at most one of each).

---

## 8. Milestones

### 1 – Passive-only (this pass)

Collect as the user browses. Parse the DOM after they open a view. Do not POST.

Acceptance: Browse several animals and views → popup lists unique registrations → zip contains `individuals.csv`, `linear_appraisals.csv`, and `pti.csv` with merged partial rows.

### 2 – Active individual (not this pass)

User points at one registration. The extension fires the site’s own postbacks on that GoatDetail and merges Pedigree identity, Linear History, PTI/ETA, and Progeny stubs for **that animal only**. No walk to relatives’ pages.

### 3 – Active family (not this pass)

After (2), POST-walk **direct** progeny, siblings, and parents (not the whole tree). For each of those registrations, collect the same individual payload as (2). End goal: pick a buck, pull the family.

---

## 9. Live page notes

- Animal URL: `GoatDetail.aspx?RegNumber={REG}`.
- Heading: `NAME - REG (PB Doe|Buck…)`. DOB/FS: `DOB: M/D/YYYY FS84 (+V++) @ 01-03`.
- Breed: `Breed Percent: 100% N` → `breed_percent=100`, `breed=N`.
- Pedigree labels `S :` / `D :` / `SS :` / … with GoatDetail links.
- Views swap via ASP.NET postback on the same URL (`__EVENTARGUMENT`). Milestone 1 only reads the resulting DOM.
- Linear History on Genetics is `LAYear` + `Age` + traits in this order: Stature, Strength, Dairyness, RA, RW, RLS, FUA, RUH, RUA, Medial, UD, TP, TD, TL, Body Depth, Rear Udder Side View. Type Eval / PTA tables are not LA rows. Layout tables (Pedigree, Registry, DOB chrome) are not progeny.

---

## 10. Success criteria

- A user can click through ADGA Genetics and obtain a usable zip with minimal friction.
- Partial pedigree/progeny rows do not duplicate an animal or wipe fields filled on another view.
- Milestone 1 never POSTs and never collects data from pages the user did not visit.
