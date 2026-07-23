/*
 * utils.js — faithful port of modules/utils.py
 * Normalizers + resolveColumn + email extraction. Runs in Node (require) and
 * browser (global UBA.utils). No dependencies.
 */
(function (root) {
  "use strict";

  var NAMED_ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    "#39": "'"
  };

  // Minimal HTML unescape mirroring html.unescape for the entities that appear
  // in spreadsheet headers/values. Decodes &name; and numeric &#NN; / &#xHH;.
  function htmlUnescape(str) {
    return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (m, body) {
      if (body[0] === "#") {
        var code = body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        if (!isNaN(code)) {
          try { return String.fromCodePoint(code); } catch (e) { return m; }
        }
        return m;
      }
      var lower = body.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower)
        ? NAMED_ENTITIES[lower] : m;
    });
  }

  // pandas pd.isna equivalent for scalar cell values.
  function isNa(value) {
    return value === null || value === undefined ||
      (typeof value === "number" && isNaN(value));
  }

  function normalizeHeader(value) {
    if (value === null || value === undefined) return "";
    var v = htmlUnescape(String(value)).replace(/\r/g, "").replace(/\n/g, " ");
    v = v.trim().replace(/\s+/g, " ");
    return v.toLowerCase();
  }

  function normalizeValue(value) {
    if (isNa(value)) return "";
    var v = htmlUnescape(String(value)).replace(/\r/g, "").replace(/\n/g, " ");
    v = v.trim().replace(/\s+/g, " ");
    return v.toLowerCase();
  }

  function normalizeEmail(value) {
    if (isNa(value)) return "";
    return String(value).trim().toLowerCase();
  }

  function normalizeId(value) {
    if (isNa(value)) return "";
    var text = String(value).trim();
    if (text.slice(-2) === ".0") text = text.slice(0, -2);
    // Remove whitespace and thousands separators. Python reads IDs from pandas
    // dtype=object (plain "12345"); SheetJS with a comma number format can yield
    // "12,345" — stripping commas keeps the composite key matching identical.
    text = text.replace(/[,\s]/g, "");
    return text.toLowerCase();
  }

  // columns: array of original column names. Returns the first original column
  // whose normalized header equals the normalized wanted name, else null.
  function resolveColumn(columns, wanted) {
    var lookup = {};
    for (var i = 0; i < columns.length; i++) {
      var norm = normalizeHeader(columns[i]);
      if (norm && !Object.prototype.hasOwnProperty.call(lookup, norm)) {
        lookup[norm] = columns[i];
      }
    }
    var key = normalizeHeader(wanted);
    return Object.prototype.hasOwnProperty.call(lookup, key) ? lookup[key] : null;
  }

  var EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

  function extractEmailsFromText(value) {
    if (isNa(value)) return [];
    var text = String(value);
    var matches = text.match(EMAIL_RE);
    return matches ? matches : [];
  }

  var api = {
    isNa: isNa,
    htmlUnescape: htmlUnescape,
    normalizeHeader: normalizeHeader,
    normalizeValue: normalizeValue,
    normalizeEmail: normalizeEmail,
    normalizeId: normalizeId,
    resolveColumn: resolveColumn,
    extractEmailsFromText: extractEmailsFromText
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.UBA = root.UBA || {};
    root.UBA.utils = api;
  }
})(typeof self !== "undefined" ? self : this);
