/*
 * make_dummy_inputs.js — Node script writing synthetic input_dummy/*.xlsx:
 * DataMart + one zone-data file per zone (MAZ, NAZ, SAZ, AFR, EUR, APAC, GHQ) +
 * Saviynt / O365 / Aurora / BSC / CEO. Labeled emails drive every pipeline filter.
 */
const fs = require("fs");
const path = require("path");
const io = require("./web/pipeline/io.js");

const ZONES = ["MAZ", "NAZ", "SAZ", "AFR", "EUR", "APAC", "GHQ"];

const REQUIRED_COLUMNS = [
  "Zone", "Country", "Global Employee ID", "Local Employee ID", "Employee Name",
  "Employee Status", "Worker Type", "Employee Group", "Management Level",
  "First Hire Date", "Last Hire Date", "Position Name", "Job Family Group",
  "Job Family", "Job Profile Description", "ABI Entity 2",
  "Macro Entity Level 2 (Zone)", "text before Email", "Employee Email"
];

function mk(over) {
  const r = {};
  REQUIRED_COLUMNS.forEach(function (c) { r[c] = ""; });
  return Object.assign(r, over);
}

function datamartTable() {
  const rows = [
    mk({ "Employee Email": "alice@corp.com", Zone: "NAZ", "Employee Name": "Alice A",
      "Global Employee ID": "G1", "Local Employee ID": "G1", "Employee Status": "Active" }),
    mk({ "Employee Email": "alice@corp.com", Zone: "NAZ", "Employee Name": "Alice A",
      "Global Employee ID": "G1", "Local Employee ID": "G1", "Employee Status": "Active" }),
    mk({ "Employee Email": "", Zone: "NAZ", "Employee Name": "Blank B",
      "Global Employee ID": "G2", "Local Employee ID": "G2" }),
    mk({ "Employee Email": "noemail99", Zone: "NAZ", "Employee Name": "NoEmail N",
      "Global Employee ID": "G3", "Local Employee ID": "G3" }),
    mk({ "Employee Email": "maz_ok@corp.com", Zone: "MAZ", "Employee Name": "Maz Ok",
      "Global Employee ID": "G4", "Local Employee ID": "G4" }),
    mk({ "Employee Email": "maz_bad@corp.com", Zone: "MAZ", "Employee Name": "Maz Bad",
      "Global Employee ID": "G5", "Local Employee ID": "G5" }),
    mk({ "Employee Email": "ot@corp.com", Zone: "NAZ", "Employee Name": "OT User",
      "Global Employee ID": "G6", "Local Employee ID": "G6",
      "Job Family Group": "SUPPLY", "Job Family": "Plant Management",
      "Job Profile Description": "Brewery Plant Manager" }),
    mk({ "Employee Email": "ceo_target@corp.com", Zone: "NAZ", "Employee Name": "Ceo Target",
      "Global Employee ID": "G7", "Local Employee ID": "G7" })
  ];
  return { columns: REQUIRED_COLUMNS.slice(), rows: rows };
}

// Action=OK rows per zone. NAZ grants OK to alice/ot/ceo_target; MAZ to maz_ok.
const ZONE_OK = {
  MAZ: [
    { id: "G4", name: "Maz Ok", action: "OK" },
    { id: "G5", name: "Maz Bad", action: "No" }
  ],
  NAZ: [
    { id: "G1", name: "Alice A", action: "OK" },
    { id: "G6", name: "OT User", action: "OK" },
    { id: "G7", name: "Ceo Target", action: "OK" }
  ]
};

function zoneValidationTable(zone) {
  const rows = (ZONE_OK[zone] || []).map(function (r) {
    return { "Global Employee ID": r.id, "Local Employee ID": r.id,
      "Employee Name": r.name, "Action": r.action };
  });
  return io.tableFromObjects(
    ["Global Employee ID", "Local Employee ID", "Employee Name", "Action"], rows);
}

function buildDummyInputs(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const paths = { datamart: path.join(outDir, "Data Mart for userbase creation.xlsx") };
  const write = function (p, bytes) { fs.writeFileSync(p, Buffer.from(bytes)); };

  write(paths.datamart, io.tableToXlsxBytes(datamartTable(), "DataMart"));

  // one file per zone; MAZ also carries an "add to the list" sheet
  ZONES.forEach(function (zone) {
    const key = "zone_" + zone;
    paths[key] = path.join(outDir, zone + " zone data.xlsx");
    const sheets = [{ name: zone, table: zoneValidationTable(zone) }];
    if (zone === "MAZ") {
      sheets.push({ name: "add to the list", table: io.tableFromObjects(
        ["Zone", "Country", "Global Employee ID", "Local Employee ID", "Employee Name",
          "Employee Status", "Management Level", "First Hire Date", "Last Hire Date",
          "Position Name", "Employee Email"],
        [{ Zone: "MAZ", Country: "X", "Global Employee ID": "G8", "Local Employee ID": "G8",
          "Employee Name": "Maz Add", "Employee Status": "Active",
          "Employee Email": "maz_add@corp.com" }]) });
    }
    write(paths[key], io.tablesToXlsxBytes(sheets));
  });

  paths.saviynt = path.join(outDir, "Saviynt.xlsx");
  write(paths.saviynt, io.tableToXlsxBytes(io.tableFromObjects(
    ["User Email", "SSO UPN"], [{ "User Email": "alice@corp.com", "SSO UPN": "alice_upn" }]), "Saviynt"));

  paths.o365 = path.join(outDir, "O365.xlsx");
  write(paths.o365, io.tablesToXlsxBytes([{ name: "Export", table: io.tableFromObjects(
    ["Mail", "UserPrincipalName"], [{ Mail: "alice@corp.com", UserPrincipalName: "alice@ad" }]) }]));

  paths.aurora = path.join(outDir, "Aurora Users.xlsx");
  write(paths.aurora, io.tablesToXlsxBytes([{ name: "Aurora Userbase", table: io.tableFromObjects(
    ["NAME", "E-MAIL", "reverse lookup"], [
      { NAME: "Alice A", "E-MAIL": "alice@corp.com", "reverse lookup": "found" },
      { NAME: "Aurora New", "E-MAIL": "aurora_new@corp.com", "reverse lookup": "not found" }
    ]) }]));

  paths.bsc = path.join(outDir, "BSC users.xlsx");
  write(paths.bsc, io.tablesToXlsxBytes([{ name: "main", table: io.tableFromObjects(
    ["Email - Primary Work", "Zone", "reverse lookup"], [
      { "Email - Primary Work": "alice@corp.com", Zone: "NAZ", "reverse lookup": "found" },
      { "Email - Primary Work": "bsc_new@corp.com", Zone: "MAZ", "reverse lookup": "not found" }
    ]) }]));

  paths.ceo = path.join(outDir, "CEO Minus 1 and 2 - 2026 1.xlsx");
  write(paths.ceo, io.tablesToXlsxBytes([
    { name: "19 Feb 2026", table: io.tableFromObjects(["Manager", "Mail ID"], [{ Manager: "Old", "Mail ID": "old@corp.com" }]) },
    { name: "25 May 2026", table: io.tableFromObjects(["Manager", "Mail ID"], [{ Manager: "Boss", "Mail ID": "ceo_target@corp.com" }]) }
  ]));

  return paths;
}

module.exports = { buildDummyInputs, REQUIRED_COLUMNS, ZONES };

if (require.main === module) {
  const out = path.join(__dirname, "input_dummy");
  const paths = buildDummyInputs(out);
  console.log("Wrote dummy inputs:");
  Object.keys(paths).forEach(function (k) { console.log(" - " + k + ": " + paths[k]); });
}
