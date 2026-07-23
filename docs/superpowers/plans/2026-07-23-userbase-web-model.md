# Userbase Automation Web Model — Implementation Plan (Pure JS)

> Execution: inline with `node --test` verification after each task; commit per task.
> Ported faithfully from `config.py` + `modules/*.py` + `main.py`. Algorithm/order preserved.

**Goal:** Browser-only, Python-free, stage-by-stage web app running the 11-stage DataMart
userbase pipeline with full visibility: per-stage labels, live logs, snapshots of the
working file + deleted rows, per-stage download/upload intervention. xlsx **and** csv.

**Architecture:** UMD JS modules (run in Node for tests + browser for the app) implement a
faithful port of the Python pipeline over a `table = {columns, rows}` model. SheetJS reads/
writes xlsx+csv. Vanilla UI (awareness-check palette, poster-app node board). No server, no
build step — double-click `web/index.html`.

**Tech Stack:** Node 22, SheetJS (`xlsx`), `node --test`, vanilla HTML/CSS/JS.

## Global Constraints

- Do NOT change the reference Python (`modules/`, `config.py`, `main.py`). Port from it.
- Preserve pipeline ORDER = `main.py` STEP 1..11 exactly.
- All email/value/id matching case-insensitive + trimmed (port `modules/utils.py`).
- `table = { columns: string[], rows: Array<Record<string,any>> }`. Missing cell = "".
- Deleted-rows artifacts contain FULL removed rows (all columns).
- Palette tokens: `--blk #0A0A0A`, `--blk2 #121212`, `--blk3 #1C1C1C`, `--gold #B8860B`,
  `--gold-hi #D4A420`, `--grn #4CAF7D`, `--red #C0392B`, `--cream #F4EFE7`; radius 12px;
  transition `.2s cubic-bezier(.4,0,.2,1)`; fonts DM Sans + DM Serif Display.
- Stage preview = first 50 rows; full via download.
- UMD pattern for every `web/pipeline/*.js`: works via `require` in Node and global `UBA`
  in the browser.

## UMD module template (every pipeline file)

```javascript
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require);
  else { root.UBA = root.UBA || {}; factory(function (p) {
    return root.UBA[p.replace(/^\.\//, "").replace(/\.js$/, "")]; }); }
})(typeof self !== "undefined" ? self : this, function (require) {
  // const { normalizeEmail } = require("./utils");
  // ...
  const api = { /* exports */ };
  if (typeof module === "object" && module.exports) return api;
  (self.UBA = self.UBA || {})["<modulename>"] = api; return api;
});
```

Browser load order in `index.html` / worker: `utils, io, zip, removal_logger, report,
stages, engine`.

---

## Task 1: Setup + utils.js (port modules/utils.py)

**Files:** Create `package.json`, `web/pipeline/utils.js`, `tests/utils.test.js`; copy
`node_modules/xlsx/dist/xlsx.full.min.js` → `web/vendor/xlsx.full.min.js`.

**Port (exact):** `normalizeHeader`, `normalizeValue`, `normalizeEmail`, `normalizeId`,
`resolveColumn(table, wanted)`, `extractEmailsFromText`. Behaviors from `utils.py`:
- normalizeHeader/Value: unescape HTML entities, strip `\r`, `\n`→space, collapse
  whitespace, trim, `.toLowerCase()` (casefold). null/NaN → "".
- normalizeEmail: `String(v).trim().toLowerCase()`; null → "".
- normalizeId: trim; drop trailing `.0`; remove all whitespace; lowercase.
- resolveColumn: build map of normalizeHeader(col)→original col (first wins); return the
  original column whose normalized header equals normalizeHeader(wanted), else null.
- extractEmailsFromText: regex `/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g`.

**Interfaces produced:** `UBA.utils = { normalizeHeader, normalizeValue, normalizeEmail,
normalizeId, resolveColumn, extractEmailsFromText, isBlank }`. `resolveColumn` takes
`columns: string[]`.

**Tests (node --test):**
```javascript
const test = require("node:test"); const assert = require("node:assert");
const u = require("../web/pipeline/utils.js");
test("normalizeEmail trims + lowercases", () => {
  assert.equal(u.normalizeEmail("  A@B.Com "), "a@b.com");
  assert.equal(u.normalizeEmail(null), "");
});
test("normalizeId strips .0 and spaces", () => {
  assert.equal(u.normalizeId("123.0"), "123");
  assert.equal(u.normalizeId(" 12 3 "), "123");
});
test("normalizeHeader collapses whitespace + casefold", () => {
  assert.equal(u.normalizeHeader("  Employee\nEmail "), "employee email");
});
test("resolveColumn matches on normalized header", () => {
  assert.equal(u.resolveColumn(["Employee\nEmail", "Zone"], "employee email"),
    "Employee\nEmail");
  assert.equal(u.resolveColumn(["Zone"], "Missing"), null);
});
test("extractEmailsFromText finds all", () => {
  assert.deepEqual(u.extractEmailsFromText("a@x.com; b@y.org"), ["a@x.com", "b@y.org"]);
});
```
Run: `node --test tests/utils.test.js` → PASS. Commit `feat: utils port + setup`.

---

## Task 2: io.js — SheetJS read/write, table model, csv

**Files:** Create `web/pipeline/io.js`, `tests/io.test.js`.

**Interfaces produced:** `UBA.io`:
- `readWorkbook(bytes|arrayBuffer) -> { sheetNames: string[], sheet(name) -> table }`.
  Uses `XLSX.read(data, {type})`; `sheetToTable` via `XLSX.utils.sheet_to_json(ws,
  {header:1, defval:"", raw:false})` → first row = columns, rest = row objects. Preserves
  column order; duplicate/blank handling matches pandas `dtype=object` (all values strings
  or original; use `raw:false` so dates render as text; missing → "").
- `readCsv(text) -> table` (SheetJS `read(text,{type:"string"})`, first sheet).
- `firstSheetName(wb)`, `sheetByName`.
- `tableToXlsxBytes(table, sheetName, {autofilter=true}) -> Uint8Array` — build ws from
  `[columns, ...rows-as-arrays]`, set `!autofilter` + `!freeze` (A2) when autofilter, write
  `{type:"array", bookType:"xlsx"}`.
- `tableToCsvString(table)`.
- `emptyTable(columns)`, `cloneTable`, `selectColumns(table, cols)`,
  `concatTables(a, b)` (union not needed — same columns), `rowGet(row, col, def="")`.
- In browser, `XLSX` is the global from vendor script; in Node, `require("xlsx")` (dev dep).
  io.js resolves `XLSX` via `typeof XLSX !== "undefined" ? XLSX : require("xlsx")`.

**Tests:** round-trip a table → xlsx bytes → readWorkbook → same columns+rows; csv string
round-trip; `readWorkbook` of a 2-sheet buffer lists both sheet names; `defval` fills blanks
with "". Run `node --test tests/io.test.js` → PASS. Commit `feat: io (SheetJS xlsx/csv + table model)`.

---

## Task 3: make_dummy_inputs.js + input_dummy/

**Files:** Create `make_dummy_inputs.js` (Node), `tests/dummy.test.js`.

Mirror the approved dummy dataset (labeled emails driving every filter):
- DataMart rows (REQUIRED_COLUMNS, hard-coded list copied from `config.py`): `alice@corp.com`
  (NAZ) ×2 (dedupe), blank-email (NAZ), `noemail99` (NAZ), `maz_ok@corp.com` (MAZ),
  `maz_bad@corp.com` (MAZ), `ot@corp.com` (NAZ; SUPPLY / Plant Management / Brewery Plant
  Manager), `ceo_target@corp.com` (NAZ). All 19 required columns present.
- MAZ file: sheet `MAZ` (G4 Action=OK, G5 Action=No), sheet `add to the list`
  (`maz_add@corp.com`, Zone MAZ).
- Saviynt: `User Email`/`SSO UPN` → alice/alice_upn.
- O365 sheet `Export`: `Mail`/`UserPrincipalName` → alice/alice@ad.
- Aurora sheet `Aurora Userbase`: `NAME`,`E-MAIL`,`reverse lookup` — alice/found,
  Aurora New/aurora_new@corp.com/not found.
- BSC sheet `main`: `Email - Primary Work`,`Zone`,`reverse lookup` — alice/NAZ/found,
  bsc_new@corp.com/MAZ/not found.
- CEO file: sheets `19 Feb 2026` (Mail ID old@corp.com) + `25 May 2026` (Mail ID
  ceo_target@corp.com).

`buildDummyInputs(outDir) -> {datamart,maz,saviynt,o365,aurora,bsc,ceo}` writes files via
`UBA.io.tableToXlsxBytes` / multi-sheet SheetJS. Filenames = `config.py` defaults. `main`
block writes `input_dummy/`.

**Tests:** all 7 files exist; datamart has required cols + 2 alice rows; reference sheet
names present. Run `node --test tests/dummy.test.js` → PASS. Run `node make_dummy_inputs.js`.
Commit `feat: dummy input generator + input_dummy`.

---

## Task 4: removal_logger.js + report.js

**Files:** Create `web/pipeline/removal_logger.js`, `web/pipeline/report.js`,
`tests/report.test.js`.

**RemovalLogger** (port `modules/removal_logger.py`): `log(table, {reason, stage,
emailCol="Employee Email", nameCol="Employee Name", zoneCol="Zone"})` appends normalized
5-col rows; `toTable()` returns columns `["Employee Email","Employee Name","Zone","Removal
Reason","Removal Stage"]`, dedup by `(casefold(email), reason, stage)` keep-first.

**report.js** (port `modules/report_generator.py`): `buildReportSheets({...stats}) ->
{sheetName: table}` (Summary, Column Check, Email Cleaning, ...). Only sheets needed for the
export report; keep the Summary metrics. `dictToTable(obj)` → columns `["Metric","Value"]`.

**Tests:** logger dedups same email+reason+stage; toTable column order fixed; buildReportSheets
returns a Summary table with Metric/Value. Run `node --test tests/report.test.js` → PASS.
Commit `feat: removal logger + report port`.

---

## Task 5: stages.js A — stages 1-5

**Files:** Create `web/pipeline/stages.js` (stages 1-5 + `STAGES` list + `STAGE_FUNCS`),
`tests/stages_a.test.js`.

Port faithfully; each `fn(state) -> {tableAfter, deletedRows|null, stats, logs}` and sets
`state.table`. `state = {table, refs, removalLogger, ...}`.

1. `column_filter` (port `filter_required_columns`): for each required col, `resolveColumn`
   in current columns; keep found (renamed to required name), collect missing. Logs: kept N,
   dropped list, MISSING list.
2. `email_clean` (port `remove_blank_and_noemail_rows`): blank = trimmed email==""; noemail =
   casefold startsWith "noemail" & !blank. Deleted = blank ∪ noemail (full rows).
   `removalLogger.log` both reasons. Logs counts.
3. `maz_validation` (port `validate_maz_ok_users`): standardize key cols + Zone via
   resolveColumn; mazOk = maz rows Action normalizeValue=="ok"; key = join of
   normalizeId(idcols)/normalizeValue(name); keepMask = !ZoneIsMAZ OR (ZoneIsMAZ &
   keyInMazOk); removed = rest; set `Zone Validated`="MAZ Validated" on retained MAZ rows.
4. `maz_additional` (port `append_maz_additional_users`): build rows shaped to base columns
   from additional sheet via resolveColumn per column; set `Zone Validated`="MAZ Additional";
   concat.
5. `email_dedupe` (port `remove_duplicate_emails`): key=casefold(trim(email)); duplicate =
   key!="" & seen-before; keep first. Deleted = dups.

**Tests (build state via dummy + run 1..5):** stage1 columns ⊆ required + a "dropped" log;
stage2 no blank/noemail, deletedCount==2; stage3 maz_bad gone, maz_ok present with Zone
Validated=="MAZ Validated"; stage4 maz_add present; stage5 alice count==1. Run
`node --test tests/stages_a.test.js` → PASS. Commit `feat: stages 1-5 port`.

---

## Task 6: stages.js B — stages 6-11

**Files:** Extend `web/pipeline/stages.js`, create `tests/stages_b.test.js`.

6. `ot_filter` (port `add_ot_filter_column`): require Job Family Group/Job Family/Job Profile
   Description; normalizedValue in allowed sets (from copied config lists); `OT Filter`
   Yes/No; move column to end. No rows removed.
7. `identity_enrichment` (port `enrich_with_identity_sources`): standardize ref cols; build
   `saviyntMap` (User Email→SSO UPN, first non-blank), `o365Map` (Mail→UserPrincipalName),
   `auroraSet` (E-MAIL), `bscSet` (Email - Primary Work) via normalizeEmail; add 4 columns
   (`SSOUPN as per Saviynt`, `SSOUPN as per AD (O365)`, `Aurora Users` yes/no,
   `BSC (Yes/No)` yes/no); move to end.
8. `reverse_lookup` (port `append_not_found_reverse_lookup_users`): Aurora rows where
   `reverse lookup` normalizeValue=="not found" & email!="" → blank rows with NAME→Employee
   Name, E-MAIL→Employee Email, Aurora Users="yes". BSC: all rows with non-blank email,
   dedup within BSC by email keep-first, skip emails already in output OR in the aurora
   appends; new → blank rows with email + Zone + BSC="yes". Concat output+aurora+bsc.
9. `final_maz_enforce` (port `enforce_maz_action_ok_for_maz_zone`): keep non-MAZ ∪ MAZ
   Additional ∪ BSC-user ∪ (MAZ & (keyMatch ∨ emailMatch to mazOk)); removed = rest; set
   Zone Validated on retained regular MAZ (not additional, not bsc).
10. `ceo_filter` (port `remove_latest_ceo_managers`): pick latest dated sheet (parse formats
    `d MMM yyyy`, `d MMMM yyyy`, `MM/dd/yyyy`, `yyyy-MM-dd`); resolveColumn "Mail ID";
    collect emails via extractEmailsFromText (fallback normalizeEmail if contains @); remove
    output rows whose email ∈ set.
11. `export` (port `main.py` export block): produce `state.outputFiles = {final, report,
    removed}` bytes. final = tableToXlsxBytes(current, "Final Output", autofilter). removed =
    removalLogger.toTable() → 5 cols → bytes. report = multi-sheet from buildReportSheets.

Date parsing helper `parseSheetDate(name)` ported from `report... _parse_sheet_date`.

**Tests:** stage6 ot@corp.com OT Filter=="Yes"; stage7 alice SSOUPN as per Saviynt=="alice_upn",
Aurora Users=="yes", BSC=="yes"; stage8 aurora_new + bsc_new appended; stage10 ceo_target
gone; stage11 outputFiles has final/report/removed non-empty bytes. Run
`node --test tests/stages_b.test.js` → PASS. Commit `feat: stages 6-11 port`.

---

## Task 7: engine.js + zip.js + parity integration test

**Files:** Create `web/pipeline/engine.js`, `web/pipeline/zip.js`, `tests/engine.test.js`.

**zip.js:** `UBA.zip.store(files: {path: Uint8Array}) -> Uint8Array` — minimal STORE zip with
CRC32 (no compression; xlsx already compressed). Local file headers + central directory + EOCD.

**engine.js** `UBA.Engine`:
- `new Engine()` — runId `run_<stamp>`, `snapshots={}`, `runLog=[]`, `removalLogger`.
- `loadInputs({datamart,maz,maz_add?,saviynt,o365,aurora,bsc,ceo})` where each value is a
  `{sheets}` workbook or table; reads sheets per config (DATAMART first sheet, MAZ "MAZ",
  "add to the list", O365 "Export", Aurora "Aurora Userbase", BSC "main"); ceo kept as
  workbook for stage 10; sets `table`, `refs`, `datamartOriginalRows`; stage-0 result.
- `STAGES` = 11 `[id,label]`; `runStage(i, overrideTable?)` → dispatch STAGE_FUNCS; wraps in
  `_finishStage` computing columns dropped/added, deletedCount, recording snapshot
  (`after.xlsx`, `deleted.xlsx`, `log.txt`, `dropped_columns.json`) into `snapshots` +
  `runLog`.
- `runAll()` loops 1..11.
- `previewRows(n=50)`, `currentXlsxBytes()`, `deletedXlsxBytes(i)`, `outputFileBytes(kind)`,
  `logsZipBytes()` (assemble tree paths → zip.store).
- `StageResult` shape: `{stageId,label,index,rowsBefore,rowsAfter,columnsBefore,columnsAfter,
  columnsDropped,columnsAdded,deletedCount,stats,logs}` (plain object, JSON-friendly).

**Parity test:** load dummy (via io.readWorkbook of buildDummyInputs bytes), `runAll()`;
assert survivors (alice once, maz_ok, maz_add, aurora_new, bsc_new) + removed (maz_bad,
ceo_target, noemail99); outputFiles complete; `logsZipBytes()` decodes and contains
`stage_02_email_clean` + `run_log.txt`. Run `node --test tests/engine.test.js` and
`node --test` (all) → PASS. Commit `feat: engine + zip + parity`.

---

## Task 8: Web UI shell — styles.css + index.html

**Files:** Create `web/styles.css`, `web/index.html`.

styles.css = palette tokens + node board state machine (`.node`, `.active` gold pulse,
`.passed` green, `.removed` amber badge) + buttons (gold gradient primary) + log/feed mono
panels + preview table + file grid. (Same CSS as previously specced; awareness-check tokens.)

index.html: top bar; Help `<details>`; `#board`; grid `main`(load card with 7 file inputs +
"Load & start"; stage card: title, delta, chips, `#stage-log`, action bar
[current/deleted/upload/continue/run-all/logs], `#preview`) + aside `#event-feed`. Loads
`web/vendor/xlsx.full.min.js` then `web/pipeline/*.js` (order above) then `web/app.js`, all
classic `<script>` (no modules → file:// works).

Verify: open `web/index.html` → dark-gold shell renders, 12-node board, no console errors.
Commit `feat: web UI shell`.

---

## Task 9: app.js — browser controller

**Files:** Create `web/app.js`.

Uses global `UBA`. `let engine, currentIndex`. On "Load & start": read the 7 file inputs via
`FileReader.readAsArrayBuffer` → `UBA.io.readWorkbook`; `engine.loadInputs(...)`; render
stage 0. "Continue": `engine.runStage(currentIndex+1)` → render. "Run all": loop render each.
Upload override: `readWorkbook` the chosen file → `engine.runStage(currentIndex+1,
overrideTable)`. Downloads: build Blob from `engine.currentXlsxBytes()` /
`deletedXlsxBytes(i)` / `outputFileBytes(kind)` / `logsZipBytes()` → `a.download`.

Render: node board states, stage title + "rows A → B · N removed", dropped/added chips,
stage log lines (also pushed to timestamped `#event-feed`), 50-row preview table.
Big-file guard: wrap stage run in a "Processing…" state + `requestAnimationFrame` yield so UI
paints before a heavy pass.

Verify via Playwright (Task 10). Commit `feat: web app controller`.

---

## Task 10: USER_GUIDE.md + in-app help + README + browser E2E

**Files:** Create `USER_GUIDE.md`; update `README.md`; verify with Playwright MCP.

USER_GUIDE: what it does; run (double-click `web/index.html`; if a browser blocks local file
reads, `python -m http.server 8000` → `/web/index.html` — no Python deps needed, just a static
server; or `npx serve`); inputs (xlsx/csv, samples in `input_dummy/`, `node make_dummy_inputs.js`);
the 11 stages; controls (Continue/Run all/download current/download deleted/upload replacement/
logs.zip); logs bundle layout.

README: add "Web model (browser, no install)" section.

**Browser E2E (Playwright MCP):** `python -m http.server 8000` in project root; navigate
`http://localhost:8000/web/index.html`; upload the 7 `input_dummy/` files; click through all
11 stages; assert board advances, deleted badges on stages 2/3/5/9/10, event feed populated,
a download triggers, override upload re-runs a stage. Screenshot final state.
Commit `docs: user guide + README + E2E verified`.

---

## Self-Review (author checklist — completed)

- **Coverage:** utils→T1, io→T2, dummy→T3, logger/report→T4, stages1-5→T5, stages6-11→T6,
  engine+zip+parity→T7, UI shell→T8, controller→T9, guide/E2E→T10. Logs/snapshots/deleted →
  engine `_finishStage`. Download/upload → T9. logs.zip → T7/T9. Palette → T8. Node board →
  T8/T9. Dummy → T3. xlsx+csv → T2.
- **No placeholders:** each task names exact files, exact ported behavior with source
  function, and concrete test assertions.
- **Consistency:** `table={columns,rows}`, `StageResult` fields, `UBA.*` namespaces, stage
  `fn(state)->{tableAfter,deletedRows,stats,logs}` uniform across T5-T7. Download kinds
  (`current`,`deleted/i`,`final`,`report`,`removed`,`logs_zip`) consistent T7/T9.
- **Port fidelity:** each stage cites its Python source function; parity test on deterministic
  dummy data guards behavior against `main.py`.
