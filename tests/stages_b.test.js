const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const io = require("../web/pipeline/io.js");
const { STAGES, STAGE_FUNCS } = require("../web/pipeline/stages.js");
const { Engine } = require("../web/pipeline/engine.js");
const { buildDummyInputs, ZONES } = require("../make_dummy_inputs.js");

function inputs() {
  const p = buildDummyInputs(fs.mkdtempSync(path.join(os.tmpdir(), "uba-sb-")));
  const wb = function (k) { return io.readWorkbook(fs.readFileSync(p[k])); };
  const zones = {};
  ZONES.forEach(function (z) { zones[z] = wb("zone_" + z); });
  return { datamart: wb("datamart"), zones: zones, saviynt: wb("saviynt"),
    o365: wb("o365"), aurora: wb("aurora"), bsc: wb("bsc"), ceo: wb("ceo") };
}
function buildState() { const e = new Engine({ stamp: "t" }); e.loadAll(inputs()); return e; }
function runThrough(state, upto) {
  let last = null;
  for (let i = 1; i <= upto; i++) { last = STAGE_FUNCS[STAGES[i - 1][0]](state); state.table = last.tableAfter; }
  return last;
}
function emails(table) { return table.rows.map(function (r) { return String(r["Employee Email"] || ""); }); }

test("stage6 OT filter sets Yes for ot@corp.com", () => {
  const s = buildState();
  runThrough(s, 6);
  const ot = s.table.rows.find(function (r) { return r["Employee Email"] === "ot@corp.com"; });
  assert.equal(ot["OT Filter"], "Yes");
});

test("stage7 identity columns for alice", () => {
  const s = buildState();
  runThrough(s, 7);
  const a = s.table.rows.find(function (r) { return r["Employee Email"] === "alice@corp.com"; });
  assert.equal(a["SSOUPN as per Saviynt"], "alice_upn");
  assert.equal(a["Aurora Users"], "yes");
  assert.equal(a["BSC (Yes/No)"], "yes");
});

test("stage8 appends aurora_new + bsc_new", () => {
  const s = buildState();
  runThrough(s, 8);
  const es = emails(s.table);
  assert.ok(es.includes("aurora_new@corp.com"));
  assert.ok(es.includes("bsc_new@corp.com"));
});

test("stage10 removes ceo_target", () => {
  const s = buildState();
  runThrough(s, 10);
  assert.ok(!emails(s.table).includes("ceo_target@corp.com"));
});

test("stage11 produces final/report/removed bytes", () => {
  const s = buildState();
  const r = runThrough(s, 11);
  ["final", "report", "removed"].forEach(function (k) {
    assert.ok(s.outputFiles[k] instanceof Uint8Array);
    assert.ok(s.outputFiles[k].length > 0);
  });
  assert.ok(r.outputFiles["Final_Userbase_With_Identity_Enrichment.xlsx"]);
});
