/*
 * report.js — port of modules/report_generator.py (Metric/Value sheets).
 * Builds the Automation Report sheet tables from collected stats.
 */
(function (root) {
  "use strict";

  function dictToTable(obj) {
    var rows = Object.keys(obj).map(function (k) {
      var v = obj[k];
      if (v && typeof v === "object") v = JSON.stringify(v);
      return { Metric: k, Value: v };
    });
    return { columns: ["Metric", "Value"], rows: rows };
  }

  // summary: metrics object. perStage: array of {label, stats}.
  function buildReportSheets(summary, perStage) {
    var sheets = { Summary: dictToTable(summary || {}) };
    (perStage || []).forEach(function (s) {
      if (s && s.stats && Object.keys(s.stats).length) {
        var name = String(s.label || "Stage").slice(0, 31);
        sheets[name] = dictToTable(s.stats);
      }
    });
    return sheets;
  }

  var api = { dictToTable: dictToTable, buildReportSheets: buildReportSheets };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.UBA = root.UBA || {};
    root.UBA.report = api;
  }
})(typeof self !== "undefined" ? self : this);
