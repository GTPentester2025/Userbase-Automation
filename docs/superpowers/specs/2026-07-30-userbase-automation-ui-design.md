# Userbase Automation — Web UI over Python Backend — Design

Date: 2026-07-30
Status: Approved (pending spec review)

## Purpose

A local web application that runs the Userbase Creation SOP (14 steps) with a Python
backend, stage by stage, with full auditability: every stage's kept, removed, and
added rows are stored permanently, downloadable at any point, and the working file
can be replaced mid-pipeline (download → edit → reupload → re-run).

Source of truth for pipeline logic: `Userbase_Creation_SOP.docx`
(extracted text at `.firecrawl/sop.md`). The existing Python scripts in
`extracted/Userbase Automation For MAZ - Copy/` are the starting codebase but are
refactored to follow the SOP exactly (the SOP differs in step order, matching keys,
and scope). The earlier JS project at
`C:\Users\GT\Documents\test_UAT\new\Userbase Automation` contributes **design
only** (metro-rail UI, per-step file requests, checkpoint navigation) — none of its
JS pipeline logic is used.

## Architecture

- **Backend:** Python 3.12+, FastAPI + uvicorn, pandas engine.
  - `engine/` package: one module per stage, pure functions
    `run(df, inputs, config) -> StageResult(kept_df, removed_df, added_df, stats, log_lines)`.
  - `server.py`: REST API + serves the static frontend.
- **Frontend:** static `web/index.html` + `app.js` + `styles.css` (no build step,
  no framework). Served by the backend at `http://127.0.0.1:8765/`.
- **Launcher:** `Start_App.bat` — creates/reuses `.venv`, installs
  `requirements.txt` if missing, starts uvicorn, opens the default browser at the
  app URL. Feels like one click. `python server.py` also works manually.
- **Dependencies:** fastapi, uvicorn, pandas, pyarrow, openpyxl (read),
  xlsxwriter (write), python-multipart.

## Pipeline stages (SOP-faithful)

| # | Stage | Action | Removes | Adds rows | Inputs requested |
|---|-------|--------|---------|-----------|------------------|
| 1 | Column Filter | Keep only the 21 SOP columns | columns only | — | Datamart (start) |
| 2 | Base Userbase | Snapshot as master file | — | — | — |
| 3 | Email Validation | Drop blank / contains `noemail` / no `@` | rows | — | — |
| 4 | OT Filter | Add `OT (Yes/No)` column | — | — | — |
| 5 | SSOUPN O365 | Match `Employee Email` ↔ `Mail`, populate `UserPrincipalName` → `SSOUPN as per AD (O365)` | — | — | O365 file |
| 6 | SSOUPN Saviynt | Match `Employee Email` ↔ `User Email`, populate `SSO UPN` → `SSOUPN as per Saviynt` | — | — | Saviynt file |
| 7 | Zone Validation | Per zone: match `Employee Email` against zone file; `Action = OK` → keep + `<Zone> Validated` in `Zone Validation` column; `Action ≠ OK` → remove. Zone with no file uploaded: rows pass through unvalidated (flagged in report). | rows | — | Zone files (MAZ, SAZ, NAZ, APC, AFR, EUR, GHQ, Growth — each optional) |
| 8 | Zone Additional Append | Per zone file `Additional` tab: append users missing from Userbase (by email), populate matching columns | — | rows | (same zone files) |
| 9 | Zone Loop Summary | Stages 7–8 already loop over every provided zone; station 9 auto-completes and shows the per-zone summary (validated / removed / appended / no-file zones). No computation of its own. | — | — | — |
| 10 | Aurora | `Aurora (Yes/No)` via `E-MAIL`; append not-found Aurora users with matching columns + Aurora=Yes | — | rows | Aurora file |
| 11 | BSC | `BSC (Yes/No)` via `Email - Primary Work`; append not-found BSC users + BSC=Yes | — | rows | BSC file |
| 12 | CEO Exclusion | Remove rows where CEO `Mail ID` matches `Employee Email` OR `SSOUPN as per AD (O365)` OR `SSOUPN as per Saviynt` | rows | — | CEO file |
| 13 | Dedupe | Duplicate `Employee Email` → keep first | rows | — | — |
| 14 | Final Validation + Export | SOP checklist evaluated; write `Final Userbase.xlsx`, `Removed_Users_Report.xlsx`, `Automation_Report.xlsx` | — | — | — |

- All email matching: case-insensitive, trimmed.
- The 21 SOP columns include `Band 4+`, `Manager Employee ID Level 01`,
  `Manager Name Level 01` (and do not include `text before Email`).
- Zone-file sheet convention: first sheet = validation list with `Action` column;
  a sheet whose name contains "add" (e.g. `add to the list` / `Additional`) = additional users. Missing additional sheet is fine.
- Accepted uploads: `.xlsx` (multi-sheet inputs) and `.csv` (single-sheet inputs).

## Storage layout (nothing is ever deleted)

```
runs/
  run_2026-07-30_141502/
    manifest.json              # run state machine: stage statuses, stats, file refs
    run_log.txt                # chronological human-readable log
    uploads/                   # every uploaded file, as received, timestamped
    stage_01_column_filter/
      kept.parquet             # working file AFTER the stage
      removed_columns.json
      log.json                 # stats + log lines
    stage_03_email_validation/
      kept.parquet
      removed.parquet          # rows discarded, with Removal Reason + Stage
      log.json
    stage_08_zone_additional/
      kept.parquet
      added.parquet            # rows appended, with Source
      log.json
    ...
    final/
      Final Userbase.xlsx
      Removed_Users_Report.xlsx    # all removed rows, all stages, with reason+stage
      Automation_Report.xlsx       # per-stage stats + checklist + unvalidated zones
```

- Snapshots are parquet (fast + compact for lakhs of rows). `.xlsx`/`.csv` for any
  artifact is generated on demand when the user clicks download, then cached in the
  stage folder.
- On "upload replacement" at stage N: the replacement is saved to `uploads/`,
  stages ≥ N re-run; prior results are moved to
  `stage_NN_.../superseded_<timestamp>/` — never overwritten.
- Past runs are listed in the UI and can be reopened read-only (all previews and
  downloads work).

## API (REST, JSON)

- `POST /api/runs` — new run (uploads Datamart) → run id
- `GET /api/runs` / `GET /api/runs/{id}` — list runs / manifest
- `POST /api/runs/{id}/inputs/{slot}` — upload an input file (o365, saviynt,
  zone_MAZ … zone_Growth, aurora, bsc, ceo)
- `POST /api/runs/{id}/advance` — run next stage; `POST .../run-all` — run all
  runnable stages (stops when a needed input is missing)
- `GET /api/runs/{id}/stages/{n}/preview?kind=kept|removed|added&page=&q=` —
  paginated preview (200 rows/page, optional contains-search)
- `GET /api/runs/{id}/stages/{n}/download?kind=kept|removed|added&fmt=xlsx|csv`
- `POST /api/runs/{id}/stages/{n}/replace` — upload replacement working file,
  re-run from stage n
- `GET /api/runs/{id}/logs.zip` — full audit bundle
- Long stages run in a worker thread; the manifest reports `running` and the UI
  polls; errors land in the manifest with the message and the stage turns red
  (retryable after fixing inputs).

## UI (design carried from the old Pipeline Studio)

- **Top bar:** app name, run selector (new run / past runs), progress pill `n / 14`.
- **Left metro rail:** one station per stage — dim (pending), gold pulsing
  (running), green check (done), red (error), amber `−N` / green `+N` badges for
  removed/added rows. Gold line fills downward.
- **Right detail panel:** stage title + description (SOP text), animated
  row/column metrics, dropped/added column chips, log lines, and the paginated
  preview table (kept / removed / added tabs). Preview is the only scrolling area.
- **File slots:** each stage that needs inputs shows labeled drop-zones at that
  stage (files asked for when needed, not upfront). Zone stage shows 8 optional
  slots.
- **Controls:** Continue · Run All · Download current file · Download removed ·
  Download added · Upload replacement · (after export) Download logs.zip.
- **Checkpoint navigation:** click any completed station → read-only review of
  that checkpoint (metrics, logs, previews, downloads). "Latest" button returns to
  the frontier.
- Fonts/visual language: DM Sans / DM Serif Display / JetBrains Mono, dark studio
  theme with gold accent, as in the reference project.

## Error handling

- Missing required columns in an upload → stage fails with an explicit list of
  missing columns; user replaces the file and retries.
- Wrong/missing sheet names → same pattern, message names the expected sheet.
- Empty results (e.g. every row removed) → allowed, warned in log.
- Server restart mid-run → manifest on disk is the state; run reopens where it
  stopped.

## Testing

- `pytest` unit tests per stage module (small synthetic frames covering: match
  trimming/case, Action≠OK removal, additional append column mapping, CEO 3-column
  match, dedupe keep-first, checklist evaluation).
- One end-to-end test: generated dummy inputs → full pipeline → assert final row
  counts, removed-report contents, checklist all-green.
- Dummy-input generator script (port of `make_dummy_inputs.js` idea) for manual UI
  testing.

## Out of scope

- Multi-user/concurrent editing, authentication, cloud deployment.
- Editing rows inside the UI (intervention happens via download → edit in Excel →
  reupload, per requirement).
