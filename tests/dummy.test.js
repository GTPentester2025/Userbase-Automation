const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const io = require("../web/pipeline/io.js");
const { buildDummyInputs, ZONES } = require("../make_dummy_inputs.js");

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "uba-dummy-")); }

test("builds datamart + 7 zone files + identity/ceo", () => {
  const p = buildDummyInputs(tmpDir());
  assert.ok(fs.existsSync(p.datamart));
  ZONES.forEach(function (z) { assert.ok(fs.existsSync(p["zone_" + z]), "missing zone " + z); });
  ["saviynt", "o365", "aurora", "bsc", "ceo"].forEach(function (k) {
    assert.ok(fs.existsSync(p[k]), "missing " + k);
  });
});

test("datamart has required columns + 2 alice rows", () => {
  const p = buildDummyInputs(tmpDir());
  const t = io.readWorkbook(fs.readFileSync(p.datamart)).firstTable();
  ["Zone", "Employee Email", "Employee Name", "Job Family Group", "Global Employee ID"]
    .forEach(function (c) { assert.ok(t.columns.includes(c), "missing col " + c); });
  const emails = t.rows.map(function (r) { return String(r["Employee Email"]); });
  assert.equal(emails.filter(function (e) { return e === "alice@corp.com"; }).length, 2);
});

test("MAZ zone file has zone + add-to-list sheets; NAZ has zone sheet", () => {
  const p = buildDummyInputs(tmpDir());
  const maz = io.readWorkbook(fs.readFileSync(p.zone_MAZ)).sheetNames;
  assert.ok(maz.includes("MAZ") && maz.includes("add to the list"));
  assert.ok(io.readWorkbook(fs.readFileSync(p.zone_NAZ)).sheetNames.includes("NAZ"));
});

test("reference sheet names present", () => {
  const p = buildDummyInputs(tmpDir());
  assert.ok(io.readWorkbook(fs.readFileSync(p.o365)).sheetNames.includes("Export"));
  assert.ok(io.readWorkbook(fs.readFileSync(p.aurora)).sheetNames.includes("Aurora Userbase"));
  assert.ok(io.readWorkbook(fs.readFileSync(p.bsc)).sheetNames.includes("main"));
  assert.ok(io.readWorkbook(fs.readFileSync(p.ceo)).sheetNames.some(function (s) { return s.indexOf("2026") !== -1; }));
});
