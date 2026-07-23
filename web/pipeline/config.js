/*
 * config.js — constants ported verbatim from config.py.
 */
(function (root) {
  "use strict";

  var api = {
    // Sheet names
    DATAMART_SHEET: null,            // null = first sheet
    MAZ_VALIDATION_SHEET: "MAZ",
    MAZ_ADDITIONAL_SHEET: "add to the list",
    SAVIYNT_SHEET: null,             // null = first sheet
    O365_SHEET: "Export",
    AURORA_SHEET: "Aurora Userbase",
    BSC_SHEET: "main",

    // Core columns
    EMAIL_COLUMN: "Employee Email",
    ZONE_VALIDATED_COLUMN: "Zone Validated",
    OT_FILTER_COLUMN: "OT Filter",

    // Zones subject to Action=OK validation (one data file per zone).
    ZONES: ["MAZ", "NAZ", "SAZ", "AFR", "EUR", "APAC", "GHQ"],
    ZONE_VALIDATION_SHEET_FALLBACK: null,   // null = first sheet of the zone file
    ZONE_ADDITIONAL_SHEET: "add to the list",
    VALIDATED_VALUE: "Zone Validated",
    ADDITIONAL_VALUE: "Zone Additional",

    // Final enrichment output columns
    SAVIYNT_OUTPUT_COLUMN: "SSOUPN as per Saviynt",
    O365_OUTPUT_COLUMN: "SSOUPN as per AD (O365)",
    AURORA_OUTPUT_COLUMN: "Aurora Users",
    BSC_OUTPUT_COLUMN: "BSC (Yes/No)",

    REQUIRED_COLUMNS: [
      "Zone", "Country", "Global Employee ID", "Local Employee ID", "Employee Name",
      "Employee Status", "Worker Type", "Employee Group", "Management Level",
      "First Hire Date", "Last Hire Date", "Position Name", "Job Family Group",
      "Job Family", "Job Profile Description", "ABI Entity 2",
      "Macro Entity Level 2 (Zone)", "text before Email", "Employee Email"
    ],

    VALIDATION_KEY_COLUMNS: [
      "Global Employee ID", "Local Employee ID", "Employee Name"
    ],

    ADDITIONAL_COLUMNS_TO_MAP: [
      "Zone", "Country", "Global Employee ID", "Local Employee ID", "Employee Name",
      "Employee Status", "Management Level", "First Hire Date", "Last Hire Date",
      "Position Name", "Employee Email"
    ],

    OT_JOB_FAMILY_GROUP_ALLOWED: ["SUPPLY"],

    OT_JOB_FAMILY_ALLOWED: ["Engineering & Maintenance", "Plant Management"],

    OT_JOB_PROFILE_DESCRIPTION_ALLOWED: [
      "Automation Engineer I", "Automation Engineer II", "Automation Engineer III",
      "Automation Technician I", "Automation Technician II", "Brewery Plant Director I",
      "Brewery Plant Manager", "Electrical I", "Electrical II",
      "Engineering & Maintenance Manager I", "Engineering & Maintenance Manager II",
      "Engineering & Maintenance Specialist I", "Engineering & Maintenance Specialist II",
      "Engineering & Maintenance Specialist III", "Engineering & Maintenance Supervisor I",
      "Engineering & Maintenance Supervisor II", "Instrumentation Technician I",
      "Instrumentation Technician II", "Maintenance Auxiliary I", "Maintenance Engineer I",
      "Maintenance Engineer II", "Maintenance Engineer III", "Maintenance Technician I",
      "Maintenance Technician II", "Maintenance Technician III", "Maintenance Technician IV",
      "Malting Plant Manager", "Mechanical I", "Mechanical II", "SoftDrinks Plant Manager",
      "Vertical Plant Manager"
    ]
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.UBA = root.UBA || {};
    root.UBA.config = api;
  }
})(typeof self !== "undefined" ? self : this);
