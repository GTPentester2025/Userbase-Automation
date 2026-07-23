/*
 * engine.js — stateful stage runner. Drives the ported stages, records a logs
 * tree (in memory), and exposes previews + downloadable artifacts.
 */
(function (root) {
  "use strict";

  var cfg, io, stagesMod, report, zip, removalMod;
  if (typeof module === "object" && module.exports) {
    cfg = require("./config.js");
    io = require("./io.js");
    stagesMod = require("./stages.js");
    report = require("./report.js");
    zip = require("./zip.js");
    removalMod = require("./removal_logger.js");
  } else {
    cfg = root.UBA.config; io = root.UBA.io; stagesMod = root.UBA.stages;
    report = root.UBA.report; zip = root.UBA.zip; removalMod = root.UBA.removal_logger;
  }
  var STAGES = stagesMod.STAGES;
  var STAGE_FUNCS = stagesMod.STAGE_FUNCS;

  function pad2(n) { return String(n).padStart(2, "0"); }

  function sheetOrFirst(wb, name) {
    return name == null ? wb.firstTable() : wb.table(name);
  }

  function Engine(opts) {
    opts = opts || {};
    // stamp injected for determinism in tests; defaults to a fixed label otherwise.
    var stamp = opts.stamp || "run";
    this.runId = "run_" + stamp;
    this.table = null;
    this.refs = {};
    this.ceoWorkbook = null;
    this.datamartOriginalRows = 0;
    this.removalLogger = new removalMod.RemovalLogger();
    this.stageStats = [];
    this.outputFiles = null;
    this.snapshots = [];        // [{ dir, files: {name: Uint8Array}, logs: [] }]
    this.lastDeleted = {};      // index -> table
    this.afterBytesByIndex = {}; // index -> post-stage xlsx bytes (checkpoint downloads)
    this.runLog = [];
  }

  Engine.prototype.stageAfterBytes = function (index) {
    return this.afterBytesByIndex[index] || null;
  };

  Engine.prototype._appendRunLog = function (index, stageId, logs) {
    var self = this;
    logs.forEach(function (l) {
      self.runLog.push("[stage " + pad2(index) + " " + stageId + "] " + l);
    });
  };

  Engine.prototype._recordSnapshot = function (dir, files, logs) {
    this.snapshots.push({ dir: dir, files: files, logs: logs });
  };

  // Start with just the DataMart. Other inputs are provided per-step via
  // provideInput(). datamartWb = io.readWorkbook(...) result (or csv shim).
  Engine.prototype.start = function (datamartWb) {
    this.table = sheetOrFirst(datamartWb, cfg.DATAMART_SHEET);
    this.refs.zones = {};
    this.datamartOriginalRows = this.table.rows.length;

    var logs = ["DataMart loaded: " + this.table.rows.length + " rows / " +
      this.table.columns.length + " columns"];
    this.afterBytesByIndex[0] = io.tableToXlsxBytes(this.table, "DataMart", { autofilter: true });
    this._appendRunLog(0, "load", logs);
    this._recordSnapshot(this.runId + "/stage_00_load", {
      "summary.json": io_bytes(JSON.stringify({ datamart_rows: this.datamartOriginalRows }, null, 2))
    }, logs);

    return {
      stageId: "load", label: "Load Inputs", index: 0,
      rowsBefore: 0, rowsAfter: this.datamartOriginalRows,
      columnsBefore: [], columnsAfter: this.table.columns.slice(),
      columnsDropped: [], columnsAdded: [], deletedCount: 0,
      stats: { datamart_rows: this.datamartOriginalRows }, logs: logs
    };
  };

  // Provide a reference input when its step needs it.
  // key: "zone:MAZ".."zone:GHQ" | "saviynt" | "o365" | "aurora" | "bsc" | "ceo".
  Engine.prototype.provideInput = function (key, wb) {
    if (key.indexOf("zone:") === 0) {
      var z = key.slice(5).toUpperCase();
      this.refs.zones = this.refs.zones || {};
      var additional = wb.sheetNames.indexOf(cfg.ZONE_ADDITIONAL_SHEET) !== -1
        ? wb.table(cfg.ZONE_ADDITIONAL_SHEET) : { columns: [], rows: [] };
      this.refs.zones[z] = {
        validation: sheetOrFirst(wb, cfg.ZONE_VALIDATION_SHEET_FALLBACK),
        additional: additional
      };
    } else if (key === "saviynt") {
      this.refs.saviynt = sheetOrFirst(wb, cfg.SAVIYNT_SHEET);
    } else if (key === "o365") {
      this.refs.o365 = wb.table(cfg.O365_SHEET);
    } else if (key === "aurora") {
      this.refs.aurora = wb.table(cfg.AURORA_SHEET);
    } else if (key === "bsc") {
      this.refs.bsc = wb.table(cfg.BSC_SHEET);
    } else if (key === "ceo") {
      this.ceoWorkbook = wb;
    } else {
      throw new Error("Unknown input key: " + key);
    }
  };

  // Convenience for tests/scripts: start + provide everything up front.
  // inputs: { datamart, zones:{MAZ:wb,...}, saviynt, o365, aurora, bsc, ceo }.
  Engine.prototype.loadAll = function (inputs) {
    var res = this.start(inputs.datamart);
    var zones = inputs.zones || {};
    var self = this;
    Object.keys(zones).forEach(function (z) { self.provideInput("zone:" + z, zones[z]); });
    ["saviynt", "o365", "aurora", "bsc", "ceo"].forEach(function (k) {
      if (inputs[k]) self.provideInput(k, inputs[k]);
    });
    return res;
  };

  Engine.prototype.runStage = function (index, overrideTable) {
    var pair = STAGES[index - 1];
    var stageId = pair[0], label = pair[1];
    if (overrideTable) this.table = overrideTable;
    var before = this.table;
    var columnsBefore = before ? before.columns.slice() : [];

    var result = STAGE_FUNCS[stageId](this);
    this.table = result.tableAfter;
    this.stageStats.push({ label: label, stats: result.stats });

    var columnsAfter = this.table.columns.slice();
    var dropped = columnsBefore.filter(function (c) { return columnsAfter.indexOf(c) === -1; });
    var added = columnsAfter.filter(function (c) { return columnsBefore.indexOf(c) === -1; });
    var deletedCount = result.deletedRows ? result.deletedRows.rows.length : 0;
    this.lastDeleted[index] = result.deletedRows || null;

    // snapshot files
    var dir = this.runId + "/stage_" + pad2(index) + "_" + stageId;
    var files = {};
    if (stageId === "export" && result.outputFiles) {
      Object.keys(result.outputFiles).forEach(function (n) { files[n] = result.outputFiles[n]; });
    } else {
      files["after.xlsx"] = io.tableToXlsxBytes(this.table, "After", { autofilter: false });
    }
    if (result.deletedRows && result.deletedRows.rows.length) {
      files["deleted.xlsx"] = io.tableToXlsxBytes(result.deletedRows, "Deleted", { autofilter: false });
    }
    files["log.txt"] = io_bytes(result.logs.join("\n"));
    if (dropped.length) files["dropped_columns.json"] = io_bytes(JSON.stringify(dropped, null, 2));
    this.afterBytesByIndex[index] = (stageId === "export" && result.outputFiles)
      ? result.outputFiles["Final_Userbase_With_Identity_Enrichment.xlsx"]
      : files["after.xlsx"];
    this._recordSnapshot(dir, files, result.logs);
    this._appendRunLog(index, stageId, result.logs);

    return {
      stageId: stageId, label: label, index: index,
      rowsBefore: before ? before.rows.length : 0,
      rowsAfter: this.table.rows.length,
      columnsBefore: columnsBefore, columnsAfter: columnsAfter,
      columnsDropped: dropped, columnsAdded: added,
      deletedCount: deletedCount, stats: result.stats, logs: result.logs
    };
  };

  Engine.prototype.runAll = function () {
    var results = [];
    for (var i = 1; i <= STAGES.length; i++) results.push(this.runStage(i));
    return results;
  };

  Engine.prototype.previewRows = function (n) {
    n = n || 50;
    if (!this.table) return { columns: [], rows: [] };
    var rows = this.table.rows.slice(0, n).map(function (r) {
      var o = {};
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) {
        o[k] = r[k] == null ? "" : String(r[k]);
      }
      return o;
    });
    return { columns: this.table.columns.slice(), rows: rows };
  };

  Engine.prototype.currentXlsxBytes = function () {
    return io.tableToXlsxBytes(this.table, "Current", { autofilter: true });
  };

  Engine.prototype.deletedXlsxBytes = function (index) {
    var t = this.lastDeleted[index];
    if (!t || t.rows.length === 0) return null;
    return io.tableToXlsxBytes(t, "Deleted", { autofilter: true });
  };

  Engine.prototype.outputFileBytes = function (kind) {
    return this.outputFiles ? this.outputFiles[kind] : null;
  };

  Engine.prototype.logsZipBytes = function () {
    var files = {};
    this.snapshots.forEach(function (snap) {
      Object.keys(snap.files).forEach(function (name) {
        files[snap.dir + "/" + name] = snap.files[name];
      });
    });
    files[this.runId + "/run_log.txt"] = io_bytes(this.runLog.join("\n"));
    return zip.store(files);
  };

  function io_bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, "utf-8"));
  }

  var api = { Engine: Engine, STAGES: STAGES };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.UBA = root.UBA || {};
    root.UBA.engine = api;
    root.UBA.Engine = Engine;
  }
})(typeof self !== "undefined" ? self : this);
