/*
 * io.js — SheetJS-backed I/O + the table model.
 * table = { columns: string[], rows: Array<Record<string, any>> }
 * Missing cells are "". Runs in Node (require xlsx) and browser (global XLSX).
 */
(function (root) {
  "use strict";

  var XLSX = (typeof module === "object" && module.exports)
    ? require("xlsx")
    : root.XLSX;

  // ---- table helpers ----------------------------------------------------
  function emptyTable(columns) {
    return { columns: columns.slice(), rows: [] };
  }

  function cloneTable(table) {
    return {
      columns: table.columns.slice(),
      rows: table.rows.map(function (r) { return Object.assign({}, r); })
    };
  }

  function rowGet(row, col, def) {
    var v = row[col];
    return (v === undefined || v === null) ? (def === undefined ? "" : def) : v;
  }

  // Build a table from a column list and plain row objects (fills missing "").
  function tableFromObjects(columns, rowObjs) {
    var rows = rowObjs.map(function (o) {
      var r = {};
      for (var i = 0; i < columns.length; i++) {
        var c = columns[i];
        r[c] = (o[c] === undefined || o[c] === null) ? "" : o[c];
      }
      return r;
    });
    return { columns: columns.slice(), rows: rows };
  }

  function selectColumns(table, columns) {
    return tableFromObjects(columns, table.rows);
  }

  // Append rows (array of objects) to a copy of table; missing cols -> "".
  function appendRows(table, rowObjs) {
    var out = cloneTable(table);
    for (var i = 0; i < rowObjs.length; i++) {
      var r = {};
      for (var j = 0; j < out.columns.length; j++) {
        var c = out.columns[j];
        var v = rowObjs[i][c];
        r[c] = (v === undefined || v === null) ? "" : v;
      }
      out.rows.push(r);
    }
    return out;
  }

  // ---- worksheet <-> table ---------------------------------------------
  // First row = header (matches pandas read_excel header=0). defval "".
  function sheetToTable(ws) {
    var aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1, defval: "", raw: false, blankrows: false
    });
    if (!aoa.length) return { columns: [], rows: [] };
    var header = aoa[0].map(function (h) {
      return (h === undefined || h === null) ? "" : String(h);
    });
    var rows = [];
    for (var i = 1; i < aoa.length; i++) {
      var arr = aoa[i];
      var r = {};
      var allBlank = true;
      for (var c = 0; c < header.length; c++) {
        var val = arr[c];
        if (val === undefined || val === null) val = "";
        r[header[c]] = val;
        if (val !== "") allBlank = false;
      }
      if (!allBlank) rows.push(r);
    }
    return { columns: header, rows: rows };
  }

  function readWorkbook(data) {
    var input = data;
    if (data instanceof ArrayBuffer) input = new Uint8Array(data);
    var wb = XLSX.read(input, { type: "array", cellDates: false });
    var sheetNames = wb.SheetNames.slice();
    return {
      sheetNames: sheetNames,
      workbook: wb,
      table: function (name) {
        var target = name;
        if (target == null) target = sheetNames[0];
        var ws = wb.Sheets[target];
        if (!ws) throw new Error("Sheet not found: " + target);
        return sheetToTable(ws);
      },
      firstTable: function () {
        return sheetToTable(wb.Sheets[sheetNames[0]]);
      }
    };
  }

  function readCsv(text) {
    var wb = XLSX.read(text, { type: "string" });
    return sheetToTable(wb.Sheets[wb.SheetNames[0]]);
  }

  function tableToAoa(table) {
    var aoa = [table.columns.slice()];
    for (var i = 0; i < table.rows.length; i++) {
      var row = table.rows[i];
      var arr = [];
      for (var c = 0; c < table.columns.length; c++) {
        var v = row[table.columns[c]];
        arr.push((v === undefined || v === null) ? "" : v);
      }
      aoa.push(arr);
    }
    return aoa;
  }

  function _wsFromTable(table, autofilter) {
    var ws = XLSX.utils.aoa_to_sheet(tableToAoa(table));
    if (autofilter && ws["!ref"]) {
      ws["!autofilter"] = { ref: ws["!ref"] };
    }
    return ws;
  }

  function tableToXlsxBytes(table, sheetName, opts) {
    opts = opts || {};
    var autofilter = opts.autofilter !== false;
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, _wsFromTable(table, autofilter),
      (sheetName || "Sheet1").slice(0, 31));
    var out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    return new Uint8Array(out);
  }

  // sheets: array of { name, table, autofilter? } OR object {name: table}
  function tablesToXlsxBytes(sheets) {
    var wb = XLSX.utils.book_new();
    var list = Array.isArray(sheets) ? sheets : Object.keys(sheets).map(function (n) {
      return { name: n, table: sheets[n] };
    });
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var af = s.autofilter !== false;
      XLSX.utils.book_append_sheet(wb, _wsFromTable(s.table, af),
        String(s.name).slice(0, 31));
    }
    var out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    return new Uint8Array(out);
  }

  function tableToCsvString(table) {
    return XLSX.utils.sheet_to_csv(_wsFromTable(table, false));
  }

  var api = {
    emptyTable: emptyTable,
    cloneTable: cloneTable,
    rowGet: rowGet,
    tableFromObjects: tableFromObjects,
    selectColumns: selectColumns,
    appendRows: appendRows,
    sheetToTable: sheetToTable,
    readWorkbook: readWorkbook,
    readCsv: readCsv,
    tableToXlsxBytes: tableToXlsxBytes,
    tablesToXlsxBytes: tablesToXlsxBytes,
    tableToCsvString: tableToCsvString
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.UBA = root.UBA || {};
    root.UBA.io = api;
  }
})(typeof self !== "undefined" ? self : this);
