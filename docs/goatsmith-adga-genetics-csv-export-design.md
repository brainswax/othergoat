# Goatsmith – ADGA Genetics CSV Export Extension & Import

**Proposal and Design Document**

---

## 1. Overview

A browser extension automatically captures structured animal data (registration, name, PTI/indexes, Linear Appraisals, immediate pedigree) from every ADGA Genetics animal page the user visits. Captured records accumulate in a local queue. The user later opens the extension popup, selects which records to keep, and downloads a clean CSV of only the selected records.

Goatsmith accepts the same CSV format through a standard import path. The extension is general-purpose and has no knowledge of or communication with Goatsmith.

---

## 2. Goals

- Automatically capture data from animal pages the user actually visits.
- Give the user full control at export time by selecting which records to include in the CSV.
- Keep all data strictly local until the user downloads a file.
- Produce a neutral, well-documented CSV usable in spreadsheets or Goatsmith.
- Remain clearly user-driven: the human navigates the pages and the human selects and exports.

## 3. Non-Goals

- Automatic navigation or pedigree walking.
- Background scraping of pages the user never visited.
- Any network communication from the extension.
- Real-time sync with any application.

---

## 4. Capture Model

### Content script

- Runs only on `https://genetics.adga.org/*` (and any current equivalent domains).
- On page load or navigation to a recognized animal record page, extracts the structured data.
- Sends the record to the background script.
- Deduplicates by registration number (latest version of an animal overwrites earlier ones).
- Optional light visual feedback (small non-intrusive badge or toast) that can be disabled in settings.
- Debounces rapid successive loads of the same page.

### Background / service worker

- Maintains a local queue using chrome.storage.local or IndexedDB.
- Stores the full structured record plus capture timestamp and source URL.
- Soft limit (approximately 100–200 animals) with a warning when approaching the limit.
- Supports a “pause auto-capture” setting.

### Popup UI

- Lists all currently queued animals (name + registration number + capture time).
- Checkboxes for multi-select.
- Controls:
  - Select All / Deselect All
  - Download Selected (CSV)
  - Remove Selected
  - Clear Entire Queue
- Displays count of selected versus total.
- Optional simple search/filter by name or registration.

---

## 5. CSV Format

One row per selected animal.

Recommended columns:

```
registration_number,registered_name,herd_name,breed,sex,date_of_birth,
pti,eta,linear_appraisal_date,linear_final_score,
sire_registration,sire_name,dam_registration,dam_name,
source_url,captured_at,notes
```

Filename pattern: `adga-genetics-export-YYYY-MM-DD-HHmm.csv`

---

## 6. Goatsmith Import

- Standard CSV import path labeled for ADGA Genetics export files.
- Accepts the column set above (extra columns ignored; missing columns tolerated).
- Shows a preview table before commit.
- On import:
  - Creates or matches animals by registration number.
  - Stores provenance (source = “ADGA Genetics CSV export”, capture date, original URL).
  - Maps PTI and linear appraisal data into existing performance records.
  - Links sire/dam when those animals already exist; otherwise stores registration and name for later resolution.
- User can choose to import only selected rows.

---

## 7. User Flows

1. User browses ADGA Genetics normally.
2. Extension quietly captures each animal page visited.
3. User opens the extension popup.
4. Reviews the list and selects the desired animals (or Select All).
5. Clicks “Download Selected”.
6. Imports the resulting CSV into a spreadsheet or Goatsmith.

Control points include pause auto-capture, remove unwanted records, and clear the queue at any time.

---

## 8. Technical Notes

- Deduplication keys on registration number and keeps the most recently captured version.
- Prefer IndexedDB for larger queues; chrome.storage.local is acceptable for modest sizes.
- Extraction must be fast and non-blocking.
- Extraction logic tolerates missing fields and minor page structure changes; failures must not break the page.
- Data exists only because the user navigated to the page. Export requires deliberate selection and download. No automatic bulk collection beyond pages the user visited.

---

## 9. Implementation Phases

### Milestone 1 – Auto-capture foundation

Content script detects animal pages and extracts core fields. Background stores records with deduplication. Popup shows the queue and allows download of all current records.

Acceptance: Browse several animals → open popup → download a correct multi-row CSV.

### Milestone 2 – Selection UI

Checkboxes, Select All / Deselect All, Download Selected, Remove Selected, Clear Queue. Soft queue limit and warning.

Acceptance: User can selectively export a subset of captured animals.

### Milestone 3 – Robustness and settings

Improved extraction resilience. Pause auto-capture toggle. Optional light capture feedback. Firefox support.

Acceptance: Stable across common page layouts; user can pause and resume.

### Milestone 4 – Goatsmith CSV import

Upload + preview + mapping of the standard format. Provenance recording.

Acceptance: CSV produced by the extension imports cleanly into Goatsmith.

### Milestone 5 (later)

Additional linear trait detail. Search/filter in the popup. Optional deeper pedigree fields captured only from pages the user visited.

---

## 10. Open Questions

1. Preferred visibility of capture feedback (silent, subtle badge, or toast).
2. Soft queue limit preference.
3. Whether to keep older versions of an animal or always overwrite with the latest capture.
4. Exact selectors and text patterns available on current ADGA Genetics animal pages (to be determined by live inspection during implementation).

---

## 11. Success Criteria

- A user can capture animals while browsing ADGA Genetics and obtain a usable CSV with minimal friction.
- The same CSV imports into Goatsmith without manual re-entry of registration numbers, PTI, or linear scores.
- The extension never contacts any server and never collects data from pages the user did not visit.
- The design remains clearly user-driven and general-purpose.
