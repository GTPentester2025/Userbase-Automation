/*
 * stages.js — faithful port of the pipeline stages from modules/*.py.
 * Each stage: fn(state) -> { tableAfter, deletedRows|null, stats, logs }.
 * state = { table, refs:{maz,maz_add,saviynt,o365,aurora,bsc}, ceoWorkbook,
 *           removalLogger, datamartOriginalRows }.
 */
(function (root) {
  "use strict";

  var utils, cfg, io, report;
  if (typeof module === "object" && module.exports) {
    utils = require("./utils.js");
    cfg = require("./config.js");
    io = require("./io.js");
    report = require("./report.js");
  } else {
    utils = root.UBA.utils;
    cfg = root.UBA.config;
    io = root.UBA.io;
    report = root.UBA.report;
  }
  var normalizeValue = utils.normalizeValue;
  var normalizeEmail = utils.normalizeEmail;
  var normalizeId = utils.normalizeId;
  var resolveColumn = utils.resolveColumn;

  // ---- shared helpers ---------------------------------------------------
  function cell(row, col) {
    var v = row[col];
    return (v === undefined || v === null) ? "" : v;
  }

  function tableOf(columns, rows) { return { columns: columns.slice(), rows: rows }; }

  // Rename source columns to standard names (port _standardize_columns).
  function standardizeColumns(table, wanted) {
    var renameMap = {};
    for (var i = 0; i < wanted.length; i++) {
      var actual = resolveColumn(table.columns, wanted[i]);
      if (actual !== null && actual !== wanted[i]) renameMap[actual] = wanted[i];
    }
    if (Object.keys(renameMap).length === 0) return table;
    var newCols = table.columns.map(function (c) { return renameMap[c] || c; });
    var newRows = table.rows.map(function (r) {
      var o = {};
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) {
        o[renameMap[k] || k] = r[k];
      }
      return o;
    });
    return { columns: newCols, rows: newRows };
  }

  // Composite validation key for one row (port _build_key).
  function keyForRow(row, keyColumns) {
    var parts = [];
    for (var i = 0; i < keyColumns.length; i++) {
      var col = keyColumns[i];
      var val = cell(row, col);
      parts.push(col.toLowerCase().indexOf("id") !== -1
        ? normalizeId(val) : normalizeValue(val));
    }
    return parts.join("|");
  }

  function zoneIsMaz(row) {
    return String(cell(row, "Zone")).trim().toUpperCase() === "MAZ";
  }

  function num(n) { return Number(n).toLocaleString("en-US"); }

  // First non-blank value per normalized-email key (port _make_first_value_map).
  function firstValueMap(table, keyCol, valueCol) {
    if (table.columns.indexOf(keyCol) === -1) throw new Error("Mapping key column '" + keyCol + "' not found.");
    if (table.columns.indexOf(valueCol) === -1) throw new Error("Mapping value column '" + valueCol + "' not found.");
    var map = Object.create(null);
    for (var i = 0; i < table.rows.length; i++) {
      var k = normalizeEmail(cell(table.rows[i], keyCol));
      if (k === "") continue;
      var v = table.rows[i][valueCol];
      if (!(k in map) && v !== null && v !== undefined && String(v).trim() !== "") map[k] = v;
    }
    return map;
  }

  // Set of normalized emails present in a column (port _make_email_set).
  function emailSet(table, keyCol) {
    if (table.columns.indexOf(keyCol) === -1) throw new Error("Lookup email column '" + keyCol + "' not found.");
    var set = Object.create(null);
    for (var i = 0; i < table.rows.length; i++) {
      var k = normalizeEmail(cell(table.rows[i], keyCol));
      if (k !== "") set[k] = true;
    }
    return set;
  }

  var MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9,
    oct: 10, nov: 11, dec: 12, january: 1, february: 2, march: 3, april: 4,
    june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
  };

  // Port _parse_sheet_date: "25 May 2026", "25 May 2026" (full), "05/25/2026", "2026-05-25".
  function parseSheetDate(name) {
    var s = String(name).trim();
    var m;
    m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (m) {
      var mon = MONTHS[m[2].toLowerCase()];
      if (mon) return new Date(Date.UTC(+m[3], mon - 1, +m[1]));
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return null;
  }

  function truthyYes(v) {
    var s = String(v == null ? "" : v).trim().toLowerCase();
    return s === "yes" || s === "y" || s === "true" || s === "1";
  }

  // ---- Stage 1: column_filter (port filter_required_columns) ------------
  function columnFilter(state) {
    var table = state.table;
    var required = cfg.REQUIRED_COLUMNS;
    var found = [], missing = [];
    var actualByReq = {};
    for (var i = 0; i < required.length; i++) {
      var actual = resolveColumn(table.columns, required[i]);
      if (actual !== null) { found.push(required[i]); actualByReq[required[i]] = actual; }
      else missing.push(required[i]);
    }
    var rows = table.rows.map(function (r) {
      var o = {};
      for (var j = 0; j < found.length; j++) o[found[j]] = cell(r, actualByReq[found[j]]);
      return o;
    });
    var after = tableOf(found, rows);
    var dropped = table.columns.filter(function (c) {
      // dropped = source columns not mapped to a kept required column
      for (var k in actualByReq) if (actualByReq[k] === c) return false;
      return true;
    });
    var logs = ["Kept " + found.length + " required columns; dropped " +
      dropped.length + " source columns."];
    dropped.forEach(function (c) { logs.push("Column '" + c + "' dropped (not required)."); });
    missing.forEach(function (c) { logs.push("Required column '" + c + "' MISSING in DataMart."); });
    return {
      tableAfter: after, deletedRows: null,
      stats: { found: found.length, missing: missing.slice(), dropped: dropped.length },
      logs: logs
    };
  }

  // ---- Stage 2: email_clean (port remove_blank_and_noemail_rows) --------
  function emailClean(state) {
    var table = state.table;
    var EMAIL = cfg.EMAIL_COLUMN;
    if (table.columns.indexOf(EMAIL) === -1) {
      throw new Error("Required email column '" + EMAIL + "' was not found.");
    }
    var keep = [], blank = [], noemail = [];
    table.rows.forEach(function (r) {
      var e = String(cell(r, EMAIL)).trim();
      var el = e.toLowerCase();
      if (e === "") blank.push(r);
      else if (el.indexOf("noemail") === 0) noemail.push(r);
      else keep.push(r);
    });
    var deletedRows = blank.concat(noemail);
    if (blank.length) state.removalLogger.log(tableOf(table.columns, blank),
      { reason: "Blank Employee Email", stage: "Email Cleaning" });
    if (noemail.length) state.removalLogger.log(tableOf(table.columns, noemail),
      { reason: "Employee Email starts with noemail", stage: "Email Cleaning" });
    var logs = [
      num(blank.length) + " rows dropped — blank Employee Email.",
      num(noemail.length) + " rows dropped — email starts with 'noemail'.",
      "Rows: " + num(table.rows.length) + " -> " + num(keep.length) + "."
    ];
    return {
      tableAfter: tableOf(table.columns, keep),
      deletedRows: deletedRows.length ? tableOf(table.columns, deletedRows) : null,
      stats: {
        original_rows: table.rows.length, blank_email_rows: blank.length,
        noemail_rows: noemail.length, removed_rows: deletedRows.length,
        final_rows: keep.length
      },
      logs: logs
    };
  }

  // ---- Stage 3: maz_validation (port validate_maz_ok_users) -------------
  // Build { zone -> okKeySet } (and optionally okEmailSet) from provided zone files.
  function buildZoneOk(state, keyCols, withEmail) {
    var zones = state.refs.zones || {};
    var okKeys = {}, okEmails = {}, present = [];
    var EMAIL = cfg.EMAIL_COLUMN;
    Object.keys(zones).forEach(function (z) {
      var v = zones[z] && zones[z].validation;
      if (!v) return;
      var std = standardizeColumns(v, keyCols.concat(["Action", EMAIL]));
      if (std.columns.indexOf("Action") === -1) return;
      var ks = Object.create(null), es = Object.create(null);
      var hasEmail = std.columns.indexOf(EMAIL) !== -1;
      std.rows.forEach(function (r) {
        if (normalizeValue(cell(r, "Action")) === "ok") {
          ks[keyForRow(r, keyCols)] = true;
          if (withEmail && hasEmail) { var e = normalizeEmail(cell(r, EMAIL)); if (e) es[e] = true; }
        }
      });
      okKeys[z] = ks; okEmails[z] = es; present.push(z);
    });
    return { okKeys: okKeys, okEmails: okEmails, present: present };
  }

  function zoneUpper(r) { return String(cell(r, "Zone")).trim().toUpperCase(); }

  // ---- Stage 3: zone_validation ----------------------------------------
  // For any user whose Zone is one of cfg.ZONES, keep only when matched with
  // Action=OK in THAT zone's data file. Zones with no provided file pass through.
  function zoneValidation(state) {
    var keyCols = cfg.VALIDATION_KEY_COLUMNS;
    var ZV = cfg.ZONE_VALIDATED_COLUMN;
    var cleaned = standardizeColumns(state.table, keyCols.concat(["Zone"]));
    if (cleaned.columns.indexOf("Zone") === -1) throw new Error("Column 'Zone' not found.");

    var z = buildZoneOk(state, keyCols, false);
    var kept = [], removed = [], passThru = 0;
    cleaned.rows.forEach(function (r) {
      var zone = zoneUpper(r);
      if (cfg.ZONES.indexOf(zone) === -1) { kept.push(r); return; }   // not a validated zone
      if (!z.okKeys[zone]) { kept.push(r); passThru++; return; }      // no data file -> keep
      if (z.okKeys[zone][keyForRow(r, keyCols)]) kept.push(r); else removed.push(r);
    });

    var outCols = cleaned.columns.indexOf(ZV) === -1 ? cleaned.columns.concat([ZV]) : cleaned.columns.slice();
    var marked = 0;
    var keptRows = kept.map(function (r) {
      var zone = zoneUpper(r);
      var o = Object.assign({}, r);
      if (cfg.ZONES.indexOf(zone) !== -1 && z.okKeys[zone]) { o[ZV] = cfg.VALIDATED_VALUE; marked++; }
      else if (!(ZV in o)) o[ZV] = "";
      return o;
    });

    if (removed.length) state.removalLogger.log(tableOf(cleaned.columns, removed),
      { reason: "Zone user not found with Action = OK", stage: "Zone Validation" });

    var logs = [
      num(removed.length) + " users removed — zone requires Action=OK, none matched.",
      num(marked) + " users marked '" + cfg.VALIDATED_VALUE + "'.",
      "Validated zones: " + (z.present.length ? z.present.join(", ") : "none") +
        (passThru ? "; " + num(passThru) + " kept from zones with no data file" : "") + ".",
      "Rows: " + num(cleaned.rows.length) + " -> " + num(keptRows.length) + "."
    ];
    return {
      tableAfter: tableOf(outCols, keptRows),
      deletedRows: removed.length ? tableOf(cleaned.columns, removed) : null,
      stats: {
        rows_before_zone_validation: cleaned.rows.length,
        zone_rows_removed_not_ok: removed.length,
        rows_marked_validated: marked,
        validated_zones: z.present.join(", "),
        rows_kept_after_zone_validation: keptRows.length
      },
      logs: logs
    };
  }

  // ---- Stage 4: zone_additional ----------------------------------------
  // Append the "add to the list" users from every provided zone file.
  function zoneAdditional(state) {
    var base = state.table;
    var ZV = cfg.ZONE_VALIDATED_COLUMN;
    var baseCols = base.columns.slice();
    var zones = state.refs.zones || {};
    var addRows = [], sources = 0;

    Object.keys(zones).forEach(function (zn) {
      var add = zones[zn] && zones[zn].additional;
      if (!add || !add.rows.length) return;
      sources++;
      var actualByBase = {};
      baseCols.forEach(function (c) { actualByBase[c] = resolveColumn(add.columns, c); });
      cfg.ADDITIONAL_COLUMNS_TO_MAP.forEach(function (c) {
        if (baseCols.indexOf(c) !== -1) actualByBase[c] = resolveColumn(add.columns, c);
      });
      add.rows.forEach(function (r) {
        var o = {};
        baseCols.forEach(function (c) {
          var a = actualByBase[c];
          o[c] = (a !== null && a !== undefined) ? cell(r, a) : "";
        });
        o[ZV] = cfg.ADDITIONAL_VALUE;
        addRows.push(o);
      });
    });

    var combined = base.rows.concat(addRows);
    var logs = [
      "+" + num(addRows.length) + " users appended as '" + cfg.ADDITIONAL_VALUE +
        "' from " + sources + " zone file(s).",
      "Rows: " + num(base.rows.length) + " -> " + num(combined.length) + "."
    ];
    return {
      tableAfter: tableOf(baseCols, combined),
      deletedRows: null,
      stats: {
        rows_before_additional_append: base.rows.length,
        additional_rows_appended: addRows.length,
        rows_after_additional_append: combined.length
      },
      logs: logs
    };
  }

  // ---- Stage 5: email_dedupe (port remove_duplicate_emails) -------------
  function emailDedupe(state) {
    var table = state.table;
    var EMAIL = cfg.EMAIL_COLUMN;
    if (table.columns.indexOf(EMAIL) === -1) {
      throw new Error("Required email column '" + EMAIL + "' was not found for dedupe.");
    }
    var seen = Object.create(null);
    var keep = [], removed = [];
    table.rows.forEach(function (r) {
      var key = String(cell(r, EMAIL)).trim().toLowerCase();
      if (key !== "" && seen[key]) removed.push(r);
      else { if (key !== "") seen[key] = true; keep.push(r); }
    });
    if (removed.length) state.removalLogger.log(tableOf(table.columns, removed),
      { reason: "Duplicate Employee Email; first occurrence retained", stage: "Email Dedupe" });
    var logs = [
      num(removed.length) + " duplicate-email rows removed.",
      "Rows: " + num(table.rows.length) + " -> " + num(keep.length) + "."
    ];
    return {
      tableAfter: tableOf(table.columns, keep),
      deletedRows: removed.length ? tableOf(table.columns, removed) : null,
      stats: {
        rows_before_email_dedupe: table.rows.length,
        duplicate_email_rows_removed: removed.length,
        rows_after_email_dedupe: keep.length
      },
      logs: logs
    };
  }

  // ---- Stage 6: ot_filter (port add_ot_filter_column) -------------------
  function otFilter(state) {
    var table = state.table;
    var OT = cfg.OT_FILTER_COLUMN;
    ["Job Family Group", "Job Family", "Job Profile Description"].forEach(function (c) {
      if (table.columns.indexOf(c) === -1) {
        throw new Error("Required OT filter source column '" + c + "' not found in output.");
      }
    });
    var jfg = {}, jf = {}, jp = {};
    cfg.OT_JOB_FAMILY_GROUP_ALLOWED.forEach(function (v) { jfg[normalizeValue(v)] = true; });
    cfg.OT_JOB_FAMILY_ALLOWED.forEach(function (v) { jf[normalizeValue(v)] = true; });
    cfg.OT_JOB_PROFILE_DESCRIPTION_ALLOWED.forEach(function (v) { jp[normalizeValue(v)] = true; });

    var yes = 0;
    var outCols = table.columns.filter(function (c) { return c !== OT; }).concat([OT]);
    var rows = table.rows.map(function (r) {
      var match = jfg[normalizeValue(cell(r, "Job Family Group"))] &&
        jf[normalizeValue(cell(r, "Job Family"))] &&
        jp[normalizeValue(cell(r, "Job Profile Description"))];
      var o = Object.assign({}, r);
      o[OT] = match ? "Yes" : "No";
      if (match) yes++;
      return o;
    });
    var logs = ["OT Filter added: " + num(yes) + " Yes / " + num(rows.length - yes) +
      " No (no rows removed)."];
    return {
      tableAfter: tableOf(outCols, rows), deletedRows: null,
      stats: { ot_filter_yes_rows: yes, ot_filter_no_rows: rows.length - yes,
        rows_removed_by_ot_filter: 0 },
      logs: logs
    };
  }

  // ---- Stage 7: identity_enrichment (port enrich_with_identity_sources) --
  function identityEnrichment(state) {
    var table = state.table;
    var EMAIL = cfg.EMAIL_COLUMN;
    if (table.columns.indexOf(EMAIL) === -1) {
      throw new Error("Employee email column '" + EMAIL + "' not found in output.");
    }
    var saviynt = standardizeColumns(state.refs.saviynt, ["User Email", "SSO UPN"]);
    var o365 = standardizeColumns(state.refs.o365, ["Mail", "UserPrincipalName"]);
    var aurora = standardizeColumns(state.refs.aurora, ["E-MAIL"]);
    var bsc = standardizeColumns(state.refs.bsc, ["Email - Primary Work"]);

    var saviyntMap = firstValueMap(saviynt, "User Email", "SSO UPN");
    var o365Map = firstValueMap(o365, "Mail", "UserPrincipalName");
    var auroraSet = emailSet(aurora, "E-MAIL");
    var bscSet = emailSet(bsc, "Email - Primary Work");

    var SC = cfg.SAVIYNT_OUTPUT_COLUMN, OC = cfg.O365_OUTPUT_COLUMN,
      AC = cfg.AURORA_OUTPUT_COLUMN, BC = cfg.BSC_OUTPUT_COLUMN;
    var newCols = [SC, OC, AC, BC];
    var outCols = table.columns.filter(function (c) { return newCols.indexOf(c) === -1; })
      .concat(newCols);

    var sMatch = 0, oMatch = 0, aYes = 0, bYes = 0;
    var rows = table.rows.map(function (r) {
      var k = normalizeEmail(cell(r, EMAIL));
      var o = Object.assign({}, r);
      o[SC] = (k in saviyntMap) ? saviyntMap[k] : "";
      o[OC] = (k in o365Map) ? o365Map[k] : "";
      o[AC] = auroraSet[k] ? "yes" : "no";
      o[BC] = bscSet[k] ? "yes" : "no";
      if (String(o[SC]).trim() !== "") sMatch++;
      if (String(o[OC]).trim() !== "") oMatch++;
      if (o[AC] === "yes") aYes++;
      if (o[BC] === "yes") bYes++;
      return o;
    });
    var logs = [
      "Saviynt matched " + num(sMatch) + " rows.",
      "O365 matched " + num(oMatch) + " rows.",
      "Aurora Yes " + num(aYes) + "; BSC Yes " + num(bYes) + ".",
      "4 enrichment columns added (no rows removed)."
    ];
    return {
      tableAfter: tableOf(outCols, rows), deletedRows: null,
      stats: { saviynt_sso_upn_matched_rows: sMatch, o365_upn_matched_rows: oMatch,
        aurora_yes_rows: aYes, bsc_yes_rows: bYes, rows_removed_by_identity_enrichment: 0 },
      logs: logs
    };
  }

  // ---- Stage 8: reverse_lookup (port append_not_found_reverse_lookup_users)
  function reverseLookup(state) {
    var output = state.table;
    var baseCols = output.columns.slice();
    var EMAIL = cfg.EMAIL_COLUMN;
    if (baseCols.indexOf(EMAIL) === -1) throw new Error("Output column '" + EMAIL + "' not found.");
    if (baseCols.indexOf("Zone") === -1) throw new Error("Output column 'Zone' not found.");

    // AURORA
    var aurora = standardizeColumns(state.refs.aurora, ["NAME", "E-MAIL", "reverse lookup"]);
    ["NAME", "E-MAIL", "reverse lookup"].forEach(function (c) {
      if (aurora.columns.indexOf(c) === -1) throw new Error("Aurora source column '" + c + "' not found.");
    });
    var auroraNotFound = aurora.rows.filter(function (r) {
      return normalizeValue(cell(r, "reverse lookup")) === "not found" &&
        normalizeEmail(cell(r, "E-MAIL")) !== "";
    });
    var hasName = baseCols.indexOf("Employee Name") !== -1;
    var hasAuroraCol = baseCols.indexOf(cfg.AURORA_OUTPUT_COLUMN) !== -1;
    var auroraRows = auroraNotFound.map(function (r) {
      var o = {}; baseCols.forEach(function (c) { o[c] = ""; });
      if (hasName) o["Employee Name"] = cell(r, "NAME");
      o[EMAIL] = cell(r, "E-MAIL");
      if (hasAuroraCol) o[cfg.AURORA_OUTPUT_COLUMN] = "yes";
      return o;
    });

    // BSC
    var bsc = standardizeColumns(state.refs.bsc, ["Email - Primary Work", "Zone"]);
    ["Email - Primary Work", "Zone"].forEach(function (c) {
      if (bsc.columns.indexOf(c) === -1) throw new Error("BSC source column '" + c + "' not found.");
    });
    var seenBsc = Object.create(null);
    var bscCandidates = [];
    bsc.rows.forEach(function (r) {
      var k = normalizeEmail(cell(r, "Email - Primary Work"));
      if (k === "" || seenBsc[k]) return;
      seenBsc[k] = true; bscCandidates.push(r);
    });
    var existing = Object.create(null);
    output.rows.forEach(function (r) {
      var k = normalizeEmail(cell(r, EMAIL)); if (k) existing[k] = true;
    });
    auroraRows.forEach(function (r) {
      var k = normalizeEmail(cell(r, EMAIL)); if (k) existing[k] = true;
    });
    var hasBscCol = baseCols.indexOf(cfg.BSC_OUTPUT_COLUMN) !== -1;
    var bscToAppend = bscCandidates.filter(function (r) {
      return !existing[normalizeEmail(cell(r, "Email - Primary Work"))];
    });
    var bscRows = bscToAppend.map(function (r) {
      var o = {}; baseCols.forEach(function (c) { o[c] = ""; });
      o[EMAIL] = cell(r, "Email - Primary Work");
      o["Zone"] = cell(r, "Zone");
      if (hasBscCol) o[cfg.BSC_OUTPUT_COLUMN] = "yes";
      return o;
    });

    var combined = output.rows.concat(auroraRows, bscRows);
    var logs = [
      "+" + num(auroraRows.length) + " Aurora not-found rows.",
      "+" + num(bscRows.length) + " BSC new-email rows (" +
        num(bscCandidates.length - bscToAppend.length) + " skipped as existing).",
      "Rows: " + num(output.rows.length) + " -> " + num(combined.length) + "."
    ];
    return {
      tableAfter: tableOf(baseCols, combined), deletedRows: null,
      stats: {
        rows_before_reverse_lookup_append: output.rows.length,
        aurora_not_found_rows_appended: auroraRows.length,
        bsc_new_email_rows_appended: bscRows.length,
        bsc_existing_email_rows_not_appended: bscCandidates.length - bscToAppend.length,
        rows_after_reverse_lookup_append: combined.length
      },
      logs: logs
    };
  }

  // ---- Stage 9: final_zone_enforce -------------------------------------
  // Re-check the per-zone Action=OK rule after appends. Keep: non-zone users,
  // Zone Additional users, BSC users, and zone users matched (key or email) in
  // their zone's data. Zones with no data file pass through.
  function finalZoneEnforce(state) {
    var keyCols = cfg.VALIDATION_KEY_COLUMNS;
    var EMAIL = cfg.EMAIL_COLUMN, ZV = cfg.ZONE_VALIDATED_COLUMN, BC = cfg.BSC_OUTPUT_COLUMN;
    var output = standardizeColumns(state.table, keyCols.concat(["Zone", EMAIL, ZV, BC]));
    if (output.columns.indexOf("Zone") === -1) throw new Error("Column 'Zone' not found in output.");

    var z = buildZoneOk(state, keyCols, true);
    var hasZV = output.columns.indexOf(ZV) !== -1;
    var hasBC = output.columns.indexOf(BC) !== -1;
    var addLower = cfg.ADDITIONAL_VALUE.toLowerCase();

    function matched(r, zone) {
      if (!z.okKeys[zone]) return true;            // no data file -> pass
      return z.okKeys[zone][keyForRow(r, keyCols)] === true ||
        z.okEmails[zone][normalizeEmail(cell(r, EMAIL))] === true;
    }

    var kept = [], removed = [];
    output.rows.forEach(function (r) {
      var zone = zoneUpper(r);
      var inZone = cfg.ZONES.indexOf(zone) !== -1;
      var additional = hasZV && normalizeValue(cell(r, ZV)) === addLower;
      var bscUser = hasBC && truthyYes(cell(r, BC));
      if (!inZone || additional || bscUser || matched(r, zone)) kept.push(r);
      else removed.push(r);
    });

    var keptRows = kept.map(function (r) {
      var zone = zoneUpper(r);
      var additional = hasZV && normalizeValue(cell(r, ZV)) === addLower;
      var bscUser = hasBC && truthyYes(cell(r, BC));
      var o = Object.assign({}, r);
      if (cfg.ZONES.indexOf(zone) !== -1 && !additional && !bscUser && z.okKeys[zone]) o[ZV] = cfg.VALIDATED_VALUE;
      return o;
    });

    if (removed.length) state.removalLogger.log(tableOf(output.columns, removed),
      { reason: "Appended zone user is not found with Action = OK", stage: "Final Zone Enforcement" });

    var logs = [
      num(removed.length) + " appended zone users removed (no Action=OK match).",
      "Rows: " + num(output.rows.length) + " -> " + num(keptRows.length) + "."
    ];
    return {
      tableAfter: tableOf(output.columns, keptRows),
      deletedRows: removed.length ? tableOf(output.columns, removed) : null,
      stats: {
        rows_before_final_zone_enforcement: output.rows.length,
        zone_rows_removed_not_ok: removed.length,
        rows_after_final_zone_enforcement: keptRows.length
      },
      logs: logs
    };
  }

  // ---- Stage 10: ceo_filter (port remove_latest_ceo_managers) -----------
  function ceoFilter(state) {
    var EMAIL = cfg.EMAIL_COLUMN;
    var wb = state.ceoWorkbook;
    if (!wb) throw new Error("CEO workbook not loaded.");
    var dated = [];
    wb.sheetNames.forEach(function (name) {
      var d = parseSheetDate(name);
      if (d) dated.push({ date: d, name: name });
    });
    if (!dated.length) throw new Error("No date-based sheet was found in the CEO Minus file.");
    dated.sort(function (a, b) { return b.date - a.date; });
    var latest = dated[0];
    var ceoTable = wb.table(latest.name);
    var mailCol = resolveColumn(ceoTable.columns, "Mail ID");
    if (mailCol === null) throw new Error("Mail ID column not found in CEO sheet '" + latest.name + "'.");

    var ceoSet = Object.create(null);
    ceoTable.rows.forEach(function (r) {
      var val = cell(r, mailCol);
      var found = utils.extractEmailsFromText(val);
      if (found.length) {
        found.forEach(function (e) { var n = normalizeEmail(e); if (n) ceoSet[n] = true; });
      } else {
        var n = normalizeEmail(val);
        if (n && n.indexOf("@") !== -1) ceoSet[n] = true;
      }
    });

    var kept = [], removed = [];
    state.table.rows.forEach(function (r) {
      if (ceoSet[normalizeEmail(cell(r, EMAIL))]) removed.push(r); else kept.push(r);
    });
    if (removed.length) state.removalLogger.log(tableOf(state.table.columns, removed),
      { reason: "Employee Email found in CEO latest-sheet Mail ID", stage: "CEO Mail ID Filter" });

    var d = latest.date;
    var iso = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") +
      "-" + String(d.getUTCDate()).padStart(2, "0");
    var logs = [
      "Latest CEO sheet: " + latest.name + " (" + iso + ").",
      num(removed.length) + " rows removed (email in CEO Mail ID)."
    ];
    return {
      tableAfter: tableOf(state.table.columns, kept),
      deletedRows: removed.length ? tableOf(state.table.columns, removed) : null,
      stats: {
        ceo_latest_sheet_used: latest.name, ceo_latest_sheet_date: iso,
        rows_removed_by_ceo_mail_id_filter: removed.length,
        rows_after_ceo_mail_id_filter: kept.length
      },
      logs: logs
    };
  }

  // ---- Stage 11: export (port main.py export block) ---------------------
  function exportStage(state) {
    var table = state.table;
    var finalBytes = io.tableToXlsxBytes(table, "Final Output", { autofilter: true });

    var removedTable = state.removalLogger.toTable();
    var removedBytes = io.tableToXlsxBytes(removedTable, "Removed Users", { autofilter: true });

    var summary = {
      original_datamart_rows: state.datamartOriginalRows || 0,
      final_rows: table.rows.length,
      final_columns: table.columns.length,
      removed_log_entries: removedTable.rows.length
    };
    var reportSheets = report.buildReportSheets(summary, state.stageStats || []);
    var reportBytes = io.tablesToXlsxBytes(reportSheets);

    state.outputFiles = { final: finalBytes, report: reportBytes, removed: removedBytes };
    var logs = [
      "Final rows: " + num(table.rows.length) + ".",
      "Removed-users log entries: " + num(removedTable.rows.length) + ".",
      "Wrote Final Output, Automation Report, Removed Users Report."
    ];
    return {
      tableAfter: table, deletedRows: null,
      stats: summary, logs: logs,
      outputFiles: {
        "Final_Userbase_With_Identity_Enrichment.xlsx": finalBytes,
        "Automation_Report.xlsx": reportBytes,
        "Removed_Users_Report.xlsx": removedBytes
      }
    };
  }

  // ---- registry ---------------------------------------------------------
  var STAGES = [
    ["column_filter", "Column Filter"],
    ["email_clean", "Email Cleaning"],
    ["zone_validation", "Zone Validation"],
    ["zone_additional", "Zone Additional Append"],
    ["email_dedupe", "Email Dedupe"],
    ["ot_filter", "OT Filter Column"],
    ["identity_enrichment", "Identity Enrichment"],
    ["reverse_lookup", "Reverse-Lookup Append"],
    ["final_zone_enforce", "Final Zone Enforcement"],
    ["ceo_filter", "CEO Mail ID Filter"],
    ["export", "Export Final + Reports"]
  ];

  var STAGE_FUNCS = {
    column_filter: columnFilter,
    email_clean: emailClean,
    zone_validation: zoneValidation,
    zone_additional: zoneAdditional,
    email_dedupe: emailDedupe,
    ot_filter: otFilter,
    identity_enrichment: identityEnrichment,
    reverse_lookup: reverseLookup,
    final_zone_enforce: finalZoneEnforce,
    ceo_filter: ceoFilter,
    export: exportStage
  };

  var api = {
    STAGES: STAGES,
    STAGE_FUNCS: STAGE_FUNCS,
    // helpers exported for stages 6-11 (Task 6) + tests
    _helpers: {
      cell: cell, tableOf: tableOf, standardizeColumns: standardizeColumns,
      keyForRow: keyForRow, zoneIsMaz: zoneIsMaz, num: num
    }
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.UBA = root.UBA || {};
    root.UBA.stages = api;
  }
})(typeof self !== "undefined" ? self : this);
