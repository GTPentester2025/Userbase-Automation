# Userbase Automation — Pipeline Studio

Local web app that runs the 14-step **Userbase Creation SOP** on a Python backend.
Every stage stores its kept / removed / added rows permanently; the working file can
be downloaded, edited in Excel, and re-uploaded at any stage.

## Start

**Double-click `Start_App.bat`.** It creates the Python environment on first run,
starts the local server, and opens the app in your browser at
`http://127.0.0.1:8765/`.

Manual alternative:

```powershell
.venv\Scripts\python server.py
# then open http://127.0.0.1:8765/
```

## The 14 stages

1. **Column Filter** — keep only the 21 SOP Datamart columns.
2. **Base Userbase** — snapshot becomes the master working file.
3. **Email Validation** — remove blank / `noemail` / missing-`@` emails.
4. **OT Filter** — add `OT (Yes/No)` (SUPPLY + allowed Job Family + allowed profile).
5. **SSOUPN O365** — `Mail` → `UserPrincipalName` into `SSOUPN as per AD (O365)`.
6. **SSOUPN Saviynt** — `User Email` → `SSO UPN` into `SSOUPN as per Saviynt`.
7. **Zone Validation** — per zone file: keep `Action = OK` users (marked `<Zone> Validated`), remove the rest. Zones without a file pass through unvalidated.
8. **Zone Additional Append** — append users from each zone file's additional tab.
9. **Zone Loop Summary** — per-zone results at a glance.
10. **Aurora Validation** — `Aurora (Yes/No)` via `E-MAIL`; not-found Aurora users appended.
11. **BSC Validation** — `BSC (Yes/No)` via `Email - Primary Work`; not-found BSC users appended.
12. **CEO Exclusion** — remove users matching `Mail ID` (latest dated CEO sheet) on Employee Email or either SSOUPN.
13. **Duplicate Removal** — dedupe on Employee Email, first kept.
14. **Final Validation & Export** — SOP checklist + `Final Userbase.xlsx`, `Removed_Users_Report.xlsx`, `Automation_Report.xlsx`.

## Input files

| Slot | When asked | Required columns / sheets |
|------|-----------|---------------------------|
| Datamart | start | first sheet; the 21 SOP columns |
| O365 | stage 5 | `Mail`, `UserPrincipalName` |
| Saviynt | stage 6 | `User Email`, `SSO UPN` |
| Zone files ×8 (MAZ, SAZ, NAZ, APC, AFR, EUR, GHQ, Growth) | stage 7 (all optional) | first sheet: `Employee Email`, `Action`; optional sheet whose name contains "add" for additional users |
| Aurora | stage 10 | `E-MAIL` (+ `NAME`) |
| BSC | stage 11 | `Email - Primary Work` |
| CEO | stage 12 | dated sheets ("25 May 2026"); latest is used; column `Mail ID` |

`.xlsx` or `.csv`; multi-sheet inputs (zone, CEO) must be `.xlsx`.

## Storage — nothing is ever deleted

```
runs/run_<date>_<time>/
  manifest.json               run state + per-stage stats
  run_log.txt                 chronological log
  uploads/                    every file as received
  stage_NN_<name>/            kept.parquet · removed.parquet · added.parquet · log.json
  final/                      Final Userbase.xlsx · Removed_Users_Report.xlsx · Automation_Report.xlsx
```

Downloads (xlsx/csv) are generated on demand from the parquet snapshots — fast even
for lakhs of rows. Replacing the working file at stage N archives the old results
into `superseded_<timestamp>/` folders and re-runs from N.

## Intervening mid-pipeline

At any completed stage: **Download current file** → edit in Excel →
**Upload replacement** → later stages re-run on your edited file. Removed and added
rows for every stage are downloadable from that stage's view.

## Development

```powershell
.venv\Scripts\pytest -q                       # 33 tests
.venv\Scripts\python scripts\make_dummy_inputs.py   # sample inputs -> input_dummy/
```

`engine/` holds the pipeline (one module per stage), `server.py` the API,
`web/` the UI. The SOP document is the source of truth for stage logic.
