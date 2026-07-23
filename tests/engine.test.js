const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const io = require("../web/pipeline/io.js");
const zip = require("../web/pipeline/zip.js");
const { Engine } = require("../web/pipeline/engine.js");
const { buildDummyInputs, ZONES } = require("../make_dummy_inputs.js");

function loadEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uba-eng-"));
  const p = buildDummyInputs(dir);
  const wb = function (k) { return io.readWorkbook(fs.readFileSync(p[k])); };
  const zones = {};
  ZONES.forEach(function (z) { zones[z] = wb("zone_" + z); });
  const eng = new Engine({ stamp: "test" });
  eng.loadAll({
    datamart: wb("datamart"), zones: zones, saviynt: wb("saviynt"),
    o365: wb("o365"), aurora: wb("aurora"), bsc: wb("bsc"), ceo: wb("ceo")
  });
  return eng;
}

function emails(table) {
  return table.rows.map(function (r) { return String(r["Employee Email"] || ""); });
}

test("loadInputs returns stage 0 with datamart rows", () => {
  const eng = loadEngine();
  assert.equal(eng.datamartOriginalRows, 8);
});

test("runAll produces 11 results and correct survivors/removed", () => {
  const eng = loadEngine();
  const results = eng.runAll();
  assert.equal(results.length, 11);
  const es = emails(eng.table);
  // survivors
  assert.equal(es.filter(function (e) { return e === "alice@corp.com"; }).length, 1);
  ["maz_ok@corp.com", "maz_add@corp.com", "aurora_new@corp.com", "bsc_new@corp.com"]
    .forEach(function (e) { assert.ok(es.includes(e), "expected survivor " + e); });
  // removed
  ["maz_bad@corp.com", "ceo_target@corp.com", "noemail99"]
    .forEach(function (e) { assert.ok(!es.includes(e), "should be removed " + e); });
  // outputs
  ["final", "report", "removed"].forEach(function (k) {
    assert.ok(eng.outputFileBytes(k) instanceof Uint8Array);
  });
});

test("deleted snapshots exist for removal stages", () => {
  const eng = loadEngine();
  eng.runAll();
  // stage 2 email_clean, 3 maz_validation, 5 dedupe, 10 ceo removed rows
  [2, 3, 5, 10].forEach(function (i) {
    assert.ok(eng.deletedXlsxBytes(i) instanceof Uint8Array, "deleted bytes for stage " + i);
  });
});

test("logsZip contains stage dirs + run_log", () => {
  const eng = loadEngine();
  eng.runAll();
  const bytes = eng.logsZipBytes();
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
  // read back with SheetJS's CFB? Simpler: scan central directory names as ascii.
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.includes("stage_02_email_clean"));
  assert.ok(text.includes("stage_11_export"));
  assert.ok(text.includes("run_log.txt"));
  assert.ok(text.includes("Final_Userbase_With_Identity_Enrichment.xlsx"));
});

test("preview returns <= 50 rows as strings", () => {
  const eng = loadEngine();
  eng.runStage(1);
  const p = eng.previewRows(50);
  assert.ok(p.rows.length <= 50);
  assert.ok(p.columns.length > 0);
});
