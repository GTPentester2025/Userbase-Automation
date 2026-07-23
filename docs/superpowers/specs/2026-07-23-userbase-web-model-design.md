# DataMart Userbase Automation — Web Model — Design Spec

Date: 2026-07-23
Status: Approved (design); revised to pure-JS architecture 2026-07-23

## Purpose

Build a browser-based, fully-visible web model of the existing `main.py` DataMart
Userbase automation. The user must see and control every one of the 11 pipeline
stages: clear labels, live logs of what each stage removes/adds/changes, snapshots
of the working file and deleted rows at every stage (downloadable), and the ability
to download or upload a replacement file at any stage to intervene.

## Architecture decision: pure JavaScript (no Python)

The pipeline is **ported from the Python `modules/` to JavaScript** and runs
**entirely in the browser** (and in Node for tests). Rationale:

- The target machine has **Smart App Control ON**, which blocks native pandas
  `.pyd` on every local Python — Python/Pyodide dev + Flask are non-viable here.
  Node.js is signed and runs freely.
- Inputs are **very large** (lakhs / hundreds of thousands of rows, xlsx **and**
  csv). Pure-JS with hash-map lookups (mirroring the Python dict/set logic) is fast,
  and avoids the ~100 MB Pyodide bundle.
- **The algorithm and pipeline order are preserved exactly** — this is a faithful
  port of `config.py` + `modules/*.py` + `main.py` STEP 1..11, not a redesign.

Stack: vanilla JS (UMD modules usable in both Node and browser), **SheetJS**
(`xlsx`, pure-JS, bundled locally) for xlsx **and** csv read/write. No framework,
no build step, no server — double-click `web/index.html` runs offline. Tests use the
Node built-in test runner (`node --test`). Heavy per-stage work runs on the main
thread with chunked progress updates (stepwise UX means one stage per click);
a Web Worker is a documented future optimization (blocked on `file://` in browsers).

## Data model

A **table** = `{ columns: string[], rows: Array<Record<string, any>> }` — row
objects keyed by column name, mirroring a pandas DataFrame so the port stays
line-faithful. Deleted rows are captured as tables. All email/value/id matching is
case-insensitive + trimmed, ported from `modules/utils.py`.

## The 11 stages (each = one labeled node on the board)

Derived directly from `main.py` STEP 1..11. Each stage is a discrete, pausable
function returning `{ tableAfter, deletedRows, stats, logs }`.

| # | Stage id | Ports (Python) | Row effect | Example log line |
|---|----------|----------------|-----------|------------------|
| 0 | `load` | `read_excel` x7 | — | "DataMart: 12,430 rows / 58 cols loaded" |
| 1 | `column_filter` | `filter_required_columns` | drops columns | "Dropped 39 columns; kept 19; MISSING: 'ABI Entity 2'" |
| 2 | `email_clean` | `remove_blank_and_noemail_rows` | removes rows | "320 dropped — blank email; 44 dropped — noemail*" |
| 3 | `maz_validation` | `validate_maz_ok_users` | removes rows | "88 MAZ rows removed — no Action=OK match" |
| 4 | `maz_additional` | `append_maz_additional_users` | adds rows | "+120 appended as MAZ Additional" |
| 5 | `email_dedupe` | `remove_duplicate_emails` | removes rows | "210 duplicate-email rows removed" |
| 6 | `ot_filter` | `add_ot_filter_column` | adds column | "OT Filter: 76 Yes / 11,900 No" |
| 7 | `identity_enrichment` | `enrich_with_identity_sources` | adds 4 cols | "Saviynt matched 8,010; Aurora Yes 512" |
| 8 | `reverse_lookup` | `append_not_found_reverse_lookup_users` | adds rows | "+64 Aurora + 90 BSC not-found rows" |
| 9 | `final_maz_enforce` | `enforce_maz_action_ok_for_maz_zone` | removes rows | "12 appended MAZ rows removed" |
| 10 | `ceo_filter` | `remove_latest_ceo_managers` | removes rows | "35 removed — in CEO latest sheet" |
| 11 | `export` | `write_excel_with_autofilter` + `report_generator` | — | "Wrote 3 output files" |

Reference files (MAZ, Saviynt, O365, Aurora, BSC, CEO) are uploaded upfront in the
Load stage and consumed by the stages that need them. Every input accepts **xlsx or
csv** (csv → single sheet).

## Pipeline engine (`web/pipeline/engine.js`)

- Holds `RunState`: working `table`, loaded reference tables, a `RemovalLogger`
  (ported), the run id, ordered stage list, and a `snapshots` map.
- Each stage: `run(state) -> { tableAfter, deletedRows, stats, logs }`.
- After each stage the engine records a snapshot in memory:
  - `after.xlsx` (working table post-stage, bytes)
  - `deleted.xlsx` (rows removed this stage; empty stages skip it)
  - `dropped_columns.json` where relevant
  - `log.txt` (the human log lines)
- Column-drop log lines come from diffing `columns` before/after; row-removal lines
  from the stage's returned `deletedRows` — concrete, e.g. "Column 'X' dropped",
  "row a@b.com removed — duplicate".
- **Intervention:** a stage can run against an **uploaded override** table instead of
  the current working table. The engine warns (non-fatal) if the override is missing
  columns downstream stages need.
- **Logs bundle:** `logsZipBytes()` packages the full `logs/run_.../` tree
  (per-stage `after`/`deleted`/`log`, plus `run_log.txt`) as a downloadable
  `logs.zip` (pure-JS store-zip with CRC32).

## UI (poster-app pipeline viz + awareness-check palette)

Palette tokens (awareness-check): `--blk #0A0A0A`, `--blk2 #121212`, `--blk3 #1C1C1C`,
`--gold #B8860B`, `--gold-hi #D4A420`, `--grn #4CAF7D`, `--red #C0392B`,
`--cream #F4EFE7`; radius 12px; transition `.2s cubic-bezier(.4,0,.2,1)`. Fonts DM
Sans (body) + DM Serif Display (headers).

Layout:

- **Top — node board:** 12 nodes (Load + 11), labeled. State machine per node: `idle`
  (dim) → `active` (gold pulse) → `passed` (green), amber count badge when rows were
  removed. poster-app `.node` state CSS reused.
- **Center — stage review panel (pause point):** header with rows in→out delta and
  columns added/dropped chips; a **live log feed** ("Column '123' dropped",
  "filtering Zone=MAZ"); preview table (**first 50 rows**; full via download).
- **Per-stage action bar:** Download current file · Download deleted rows · Upload
  replacement (override) · Continue · Run all (express) · Download logs.zip (after
  export).
- **Right — global event feed:** every stage's log lines, timestamped, collapsible,
  `aria-live="polite"`.
- **Help panel:** in-app quick guide mirroring USER_GUIDE.md.

Preview decision (approved): 50-row preview + download-for-full.

## Logs folder / bundle layout

```
logs/run_YYYYMMDD_HHMMSS/
  stage_00_load/            summary.json
  stage_01_column_filter/   after.xlsx  dropped_columns.json  log.txt
  stage_02_email_clean/     after.xlsx  deleted.xlsx  log.txt
  ...
  stage_11_export/          Final_Userbase_With_Identity_Enrichment.xlsx
                            Automation_Report.xlsx  Removed_Users_Report.xlsx
  run_log.txt               full chronological log
```

In the browser this tree is downloadable as `logs.zip`. In Node (tests/dummy tooling)
it can be written to real disk.

## Deliverables

- `web/index.html`, `web/styles.css`, `web/app.js`
- `web/vendor/xlsx.full.min.js` (SheetJS, copied from npm)
- `web/pipeline/`: `utils.js`, `io.js`, `removal_logger.js`, `report.js`,
  `stages.js`, `engine.js`, `zip.js` — UMD modules (run in Node + browser)
- `make_dummy_inputs.js` (Node + SheetJS) → `input_dummy/` synthetic xlsx for all 7
  inputs with correct sheet names + required columns, so it runs out-of-the-box
- `tests/` — `node --test` suites for utils, io, stages, engine (parity)
- `USER_GUIDE.md`
- `package.json` (dev dep: `xlsx`)
- Existing Python `modules/`, `config.py`, `main.py` remain as the reference source
  of truth (untouched).

## Testing

- `node --test` runs locally (Node is signed; unaffected by Smart App Control).
- Unit: `utils` normalizers + `resolveColumn`; `io` xlsx/csv round-trip; each stage on
  dummy data returns expected `{tableAfter, deletedRows, stats, logs}`.
- Integration/parity: full 11-stage run on `input_dummy/` yields the 3 output files
  and a complete logs tree; specific survivor/removed emails asserted (alice deduped,
  maz_bad/ceo_target/noemail removed, maz_add/aurora_new appended) — behavioral parity
  with `main.py` on the same data.
- Browser E2E: drive `web/index.html` via Playwright on `input_dummy/` — load → step
  all 11 → verify logs, deleted counts, downloads, override upload.

## Risks / decisions

- **Huge files in-browser memory:** row-objects for lakhs of rows are heavy but
  feasible; stepwise (one pass per click) keeps each step bounded; chunked progress
  UI avoids freezes. Web Worker is a documented future optimization.
- **`file://` module loading:** avoided by UMD classic scripts (global `UBA`
  namespace) — no ES-module CORS issues; double-click works. `python -m http.server`
  documented as fallback only if a browser restricts local file reads.
- **Port fidelity:** algorithm must match `modules/*.py` exactly; parity test on
  deterministic dummy data guards this. Python source remains in-repo for diffing.
