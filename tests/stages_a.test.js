const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const io = require("../web/pipeline/io.js");
const cfg = require("../web/pipeline/config.js");
const { STAGES, STAGE_FUNCS } = require("../web/pipeline/stages.js");
const { Engine } = require("../web/pipeline/engine.js");
const { buildDummyInputs, ZONES } = require("../make_dummy_inputs.js");

function inputs() {
  const p = buildDummyInputs(fs.mkdtempSync(path.join(os.tmpdir(), "uba-sa-")));
  const wb = function (k) { return io.readWorkbook(fs.readFileSync(p[k])); };
  const zones = {};
  ZONES.forEach(function (z) { zones[z] = wb("zone_" + z); });
  return { datamart: wb("datamart"), zones: zones, saviynt: wb("saviynt"),
    o365: wb("o365"), aurora: wb("aurora"), bsc: wb("bsc"), ceo: wb("ceo") };
}
function buildState() { const e = new Engine({ stamp: "t" }); e.loadAll(inputs()); return e; }
function runThrough(state, upto) {
  let last = null;
  for (let i = 1; i <= upto; i++) {
    last = STAGE_FUNCS[STAGES[i - 1][0]](state);
    state.table = last.tableAfter;
  }
  return last;
}
function emails(table) { return table.rows.map(function (r) { return String(r["Employee Email"] || ""); }); }

test("stage1 keeps only required columns + logs a drop", () => {
  const s = buildState();
  const r = runThrough(s, 1);
  s.table.columns.forEach(function (c) { assert.ok(cfg.REQUIRED_COLUMNS.includes(c)); });
  assert.ok(r.logs.some(function (l) { return l.toLowerCase().includes("column"); }));
});

test("stage2 removes blank + noemail, deletedRows 2", () => {
  const s = buildState();
  const r = runThrough(s, 2);
  const es = emails(s.table).map(function (e) { return e.trim().toLowerCase(); });
  assert.ok(!es.includes(""));
  assert.ok(!es.some(function (e) { return e.startsWith("noemail"); }));
  assert.equal(r.deletedRows.rows.length, 2);
});

test("stage3 zone validation: maz_bad removed, maz_ok kept as Zone Validated", () => {
  const s = buildState();
  runThrough(s, 3);
  const es = emails(s.table);
  assert.ok(!es.includes("maz_bad@corp.com"));
  assert.ok(es.includes("maz_ok@corp.com"));
  assert.ok(es.includes("alice@corp.com"));   // NAZ granted Action=OK
  const ok = s.table.rows.find(function (r) { return r["Employee Email"] === "maz_ok@corp.com"; });
  assert.equal(ok["Zone Validated"], "Zone Validated");
});

test("stage4 appends zone additional (maz_add)", () => {
  const s = buildState();
  runThrough(s, 4);
  assert.ok(emails(s.table).includes("maz_add@corp.com"));
});

test("stage5 dedupes alice to a single row", () => {
  const s = buildState();
  const r = runThrough(s, 5);
  assert.equal(emails(s.table).filter(function (e) { return e === "alice@corp.com"; }).length, 1);
  assert.ok(r.deletedRows.rows.length >= 1);
});
