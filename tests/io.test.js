const test = require("node:test");
const assert = require("node:assert");
const io = require("../web/pipeline/io.js");

test("xlsx round-trip preserves columns + rows", () => {
  const table = {
    columns: ["Employee Email", "Zone"],
    rows: [
      { "Employee Email": "a@x.com", Zone: "NAZ" },
      { "Employee Email": "b@y.com", Zone: "MAZ" }
    ]
  };
  const bytes = io.tableToXlsxBytes(table, "Test");
  const wb = io.readWorkbook(bytes);
  const back = wb.table("Test");
  assert.deepEqual(back.columns, ["Employee Email", "Zone"]);
  assert.equal(back.rows.length, 2);
  assert.equal(back.rows[0]["Employee Email"], "a@x.com");
  assert.equal(back.rows[1].Zone, "MAZ");
});

test("readWorkbook lists multiple sheet names", () => {
  const bytes = io.tablesToXlsxBytes({
    MAZ: { columns: ["Action"], rows: [{ Action: "OK" }] },
    "add to the list": { columns: ["Employee Email"], rows: [] }
  });
  const wb = io.readWorkbook(bytes);
  assert.ok(wb.sheetNames.includes("MAZ"));
  assert.ok(wb.sheetNames.includes("add to the list"));
});

test("missing cells become '' via defval", () => {
  // build a sheet where a row is short: simulate by object missing a col
  const table = io.tableFromObjects(["A", "B"], [{ A: "x" }]);
  const bytes = io.tableToXlsxBytes(table, "S");
  const back = io.readWorkbook(bytes).table("S");
  assert.equal(back.rows[0].B, "");
});

test("csv round-trip", () => {
  const table = {
    columns: ["Email - Primary Work", "Zone"],
    rows: [{ "Email - Primary Work": "c@z.com", Zone: "MAZ" }]
  };
  const csv = io.tableToCsvString(table);
  const back = io.readCsv(csv);
  assert.deepEqual(back.columns, ["Email - Primary Work", "Zone"]);
  assert.equal(back.rows[0]["Email - Primary Work"], "c@z.com");
});

test("appendRows fills missing columns with ''", () => {
  const base = io.tableFromObjects(["A", "B"], [{ A: "1", B: "2" }]);
  const out = io.appendRows(base, [{ A: "9" }]);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[1].B, "");
});
