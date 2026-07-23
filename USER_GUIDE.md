# Userbase Automation — Web Model — User Guide

A browser-only, **pure-JavaScript** version of the 11-stage DataMart userbase
pipeline. No Python, no install, no server needed. Every stage is labeled, logs
what it removes/adds/changes, and lets you download the working file, download the
rows it deleted, or upload a replacement to intervene.

## Run it

### Easiest — double-click
1. Keep the `web/` folder together (it contains `index.html`, `app.js`,
   `styles.css`, `pipeline/`, and `vendor/xlsx.full.min.js`).
2. Double-click `web/index.html`. It opens offline in your browser.

If your browser blocks a page opened from `file://` (some do, for local file
reads), serve the folder statically instead — still no Python packages required:

```
# from the project root
python -m http.server 8000
# then open http://localhost:8000/web/index.html
```

(or `npx serve` if you prefer Node.)

## Inputs — asked for per step

You start with just the **DataMart**. Each later step requests the files it needs,
when it needs them. Ready-made samples are in `input_dummy/` — regenerate any time
with `node make_dummy_inputs.js`.

| When | Input(s) | Notes |
|------|----------|-------|
| Start | DataMart | first sheet · .xlsx or .csv |
| **Zone Validation** (step 3) | one file per zone: `MAZ`, `NAZ`, `SAZ`, `AFR`, `EUR`, `APAC`, `GHQ` | each `<ZONE> zone data.xlsx`: first sheet lists that zone's users with an `Action` column; optional `add to the list` sheet |
| **Identity Enrichment** (step 7) | Saviynt, O365 (`Export`), Aurora (`Aurora Userbase`), BSC (`main`) | .xlsx or .csv |
| **CEO Mail ID Filter** (step 10) | CEO Minus | **.xlsx** with dated sheets |

At the Zone step you may provide only the zones you have — users in a zone with **no
file pass through unvalidated**. Files that rely on named/multiple sheets (zone files,
CEO) should be `.xlsx`.

## The 11 stages

1. **Column Filter** — keep required columns; logs every dropped/missing column.
2. **Email Cleaning** — remove blank + `noemail*` email rows.
3. **Zone Validation** — for any user whose Zone is one of MAZ/NAZ/SAZ/AFR/EUR/APAC/GHQ,
   keep only those matched in that zone's data with `Action = OK`; mark "Zone Validated".
4. **Zone Additional Append** — append the `add to the list` users from every zone file.
5. **Email Dedupe** — remove duplicate emails (first occurrence kept).
6. **OT Filter** — add a Yes/No column (no rows removed).
7. **Identity Enrichment** — add Saviynt / O365 / Aurora / BSC columns.
8. **Reverse-Lookup Append** — append Aurora + BSC "not found" users.
9. **Final Zone Enforcement** — re-check the per-zone `Action = OK` rule after appends
   (Zone Additional and BSC users are exempt).
10. **CEO Mail ID Filter** — remove users found in the latest CEO sheet's `Mail ID`.
11. **Export** — produce Final Output, Automation Report, Removed Users Report.

## The interface

- **Vertical metro rail** (left) — one station per stage. States: dim (pending),
  gold pulsing ring (running), green check (done), amber `−N` badge (rows removed).
  A gold line fills downward as the pipeline progresses.
- **Checkpoint navigation** — click any completed station to jump back and review
  that checkpoint (its rows, logs, and downloads), read-only. The **Latest** button
  (top-right) returns you to the live frontier.
- **Detail panel** (right) — the active stage's title, row/column metrics (animated
  count-up), added/dropped column chips, and the stage's log lines. Logs surface as
  animated lines here plus a brief pop-up on each transition — there is no separate
  feed to watch.
- The Excel **preview** is the only scrolling area (scroll it horizontally for wide
  sheets); the rest fits on one screen.

## Controls

- **Continue** — run the next stage and pause.
- **Run all** — run every remaining stage.
- **Current file** — download the working file at the viewed stage.
- **Deleted rows** — download the rows that stage removed (disabled when none).
- **Upload replacement** — override the working file at the frontier; that stage
  re-runs with your edited file. Your chance to intervene mid-pipeline.
- **Download logs.zip** (after Export) — the full audit trail.

## Logs bundle (`logs.zip`)

```
run_YYYYMMDD_HHMMSS/
  stage_00_load/            summary.json
  stage_01_column_filter/   after.xlsx  dropped_columns.json  log.txt
  stage_02_email_clean/     after.xlsx  deleted.xlsx  log.txt
  ...
  stage_11_export/          Final_Userbase_With_Identity_Enrichment.xlsx
                            Automation_Report.xlsx  Removed_Users_Report.xlsx
  run_log.txt               full chronological log
```

Every stage's post-stage file and the rows it deleted are captured here, so you have
a complete record of what happened at each step.

## Notes on large files

Inputs with lakhs of rows work — the pipeline is single-pass per stage with hash-map
lookups. Because it's stepwise (one stage per click), each step stays bounded and a
"Processing…" indicator shows while a stage runs.

## Developer

- Run the test suite: `node --test` (33 tests: utils, io, dummy, report, stages,
  engine/parity).
- The JS pipeline is a faithful port of the Python reference in `modules/` +
  `config.py` + `main.py`, which remain in the repo as the source of truth.
