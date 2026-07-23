/*
 * zip.js — minimal STORE (no compression) ZIP writer with CRC32.
 * xlsx payloads are already compressed, so STORE keeps the bundle simple.
 * UBA.zip.store({ "path/name.xlsx": Uint8Array, ... }) -> Uint8Array
 */
(function (root) {
  "use strict";

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) out.push(code);
      else if (code < 0x800) { out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F)); }
      else { out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F)); }
    }
    return new Uint8Array(out);
  }

  function pushU16(arr, v) { arr.push(v & 0xFF, (v >>> 8) & 0xFF); }
  function pushU32(arr, v) { arr.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); }
  function pushBytes(arr, bytes) { for (var i = 0; i < bytes.length; i++) arr.push(bytes[i]); }

  function store(files) {
    var names = Object.keys(files);
    var local = [];         // byte array of all local records
    var central = [];       // byte array of central directory
    var offset = 0;

    names.forEach(function (name) {
      var data = files[name];
      if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
      var nameBytes = utf8(name.replace(/\\/g, "/"));
      var crc = crc32(data);
      var size = data.length;

      var localHeaderOffset = offset;
      // Local file header
      pushU32(local, 0x04034b50);
      pushU16(local, 20);            // version needed
      pushU16(local, 0);             // flags
      pushU16(local, 0);             // method = store
      pushU16(local, 0);             // mod time
      pushU16(local, 0x0021);        // mod date (1980-01-01)
      pushU32(local, crc);
      pushU32(local, size);          // compressed size
      pushU32(local, size);          // uncompressed size
      pushU16(local, nameBytes.length);
      pushU16(local, 0);             // extra len
      pushBytes(local, nameBytes);
      pushBytes(local, data);
      offset += 30 + nameBytes.length + size;

      // Central directory header
      pushU32(central, 0x02014b50);
      pushU16(central, 20);          // version made by
      pushU16(central, 20);          // version needed
      pushU16(central, 0);           // flags
      pushU16(central, 0);           // method
      pushU16(central, 0);           // mod time
      pushU16(central, 0x0021);      // mod date
      pushU32(central, crc);
      pushU32(central, size);
      pushU32(central, size);
      pushU16(central, nameBytes.length);
      pushU16(central, 0);           // extra len
      pushU16(central, 0);           // comment len
      pushU16(central, 0);           // disk number
      pushU16(central, 0);           // internal attrs
      pushU32(central, 0);           // external attrs
      pushU32(central, localHeaderOffset);
      pushBytes(central, nameBytes);
    });

    var eocd = [];
    pushU32(eocd, 0x06054b50);
    pushU16(eocd, 0);                // disk number
    pushU16(eocd, 0);                // central dir disk
    pushU16(eocd, names.length);     // entries on this disk
    pushU16(eocd, names.length);     // total entries
    pushU32(eocd, central.length);   // central dir size
    pushU32(eocd, local.length);     // central dir offset
    pushU16(eocd, 0);                // comment len

    var out = new Uint8Array(local.length + central.length + eocd.length);
    out.set(local, 0);
    out.set(central, local.length);
    out.set(eocd, local.length + central.length);
    return out;
  }

  var api = { store: store, crc32: crc32 };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.UBA = root.UBA || {};
    root.UBA.zip = api;
  }
})(typeof self !== "undefined" ? self : this);
