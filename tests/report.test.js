const test = require("node:test");
const assert = require("node:assert");
const { RemovalLogger } = require("../web/pipeline/removal_logger.js");
const report = require("../web/pipeline/report.js");

test("RemovalLogger dedups same email+reason+stage", () => {
  const log = new RemovalLogger();
  const table = {
    columns: ["Employee Email", "Employee Name", "Zone"],
    rows: [
      { "Employee Email": "A@x.com", "Employee Name": "A", Zone: "NAZ" },
      { "Employee Email": "a@x.com", "Employee Name": "A", Zone: "NAZ" }
    ]
  };
  log.log(table, { reason: "dup", stage: "S" });
  const out = log.toTable();
  assert.equal(out.rows.length, 1);
  assert.deepEqual(out.columns,
    ["Employee Email", "Employee Name", "Zone", "Removal Reason", "Removal Stage"]);
});

test("RemovalLogger keeps different reasons/stages separate", () => {
  const log = new RemovalLogger();
  const t = { columns: ["Employee Email"], rows: [{ "Employee Email": "a@x.com" }] };
  log.log(t, { reason: "r1", stage: "s1" });
  log.log(t, { reason: "r2", stage: "s1" });
  assert.equal(log.toTable().rows.length, 2);
});

test("empty logger returns fixed columns, no rows", () => {
  const out = new RemovalLogger().toTable();
  assert.equal(out.rows.length, 0);
  assert.equal(out.columns.length, 5);
});

test("buildReportSheets makes a Summary Metric/Value table", () => {
  const sheets = report.buildReportSheets({ final_rows: 5 }, [
    { label: "Email Cleaning", stats: { removed_rows: 2 } }
  ]);
  assert.deepEqual(sheets.Summary.columns, ["Metric", "Value"]);
  assert.equal(sheets.Summary.rows[0].Metric, "final_rows");
  assert.equal(sheets.Summary.rows[0].Value, 5);
  assert.ok(sheets["Email Cleaning"]);
});
