# DataMart Userbase Automation — Web Model

A browser-only, pure-JavaScript app that runs the 11-stage DataMart userbase
pipeline with full visibility: a vertical metro stepper, per-step file inputs,
live logs, per-stage snapshots (working file + deleted rows), checkpoint
navigation, and a downloadable `logs.zip` audit trail. No install, no server,
no Python — SheetJS handles xlsx/csv in the browser.

## Run it

- **Open the app:** double-click `web/index.html`, or serve statically
  (`python -m http.server 8000` → http://localhost:8000/web/index.html).
- **Sample inputs:** `node make_dummy_inputs.js` writes a fresh `input_dummy/`
  (DataMart + 7 zone files + Saviynt/O365/Aurora/BSC/CEO).
- **Tests:** `node --test` (needs `npm install` once, for the `xlsx` dev dep).

## The pipeline (11 stages)

Start with the DataMart; each step requests the files it needs, when it needs them.

1. Column Filter — keep required columns.
2. Email Cleaning — drop blank + `noemail*` rows.
3. Zone Validation — keep users matched with `Action = OK` in their zone's file
   (MAZ, NAZ, SAZ, AFR, EUR, APAC, GHQ — one file per zone).
4. Zone Additional Append — append each zone's `add to the list` users.
5. Email Dedupe — remove duplicate emails.
6. OT Filter — add Yes/No column.
7. Identity Enrichment — add Saviynt / O365 / Aurora / BSC columns.
8. Reverse-Lookup Append — append Aurora + BSC "not found" users.
9. Final Zone Enforcement — re-check the per-zone rule after appends.
10. CEO Mail ID Filter — remove users in the latest CEO sheet's `Mail ID`.
11. Export — Final Output, Automation Report, Removed Users Report.

Full walkthrough: `USER_GUIDE.md`.

## Layout

```
web/            the app (index.html, styles.css, app.js)
  vendor/       SheetJS (xlsx.full.min.js)
  pipeline/     utils, config, io, zip, removal_logger, report, stages, engine
make_dummy_inputs.js   generates sample input_dummy/*.xlsx
tests/          node --test suites
docs/superpowers/  design spec + implementation plan
```
