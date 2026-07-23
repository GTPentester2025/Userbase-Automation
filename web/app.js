/* app.js — Pipeline Studio controller (glass metro UI + checkpoint nav). */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  var ZONES = UBA.config.ZONES;
  // Which reference inputs each stage needs, requested at that step.
  var STEP_INPUTS = {
    3: ZONES.map(function (z) { return "zone:" + z; }),
    7: ["saviynt", "o365", "aurora", "bsc"],
    10: ["ceo"]
  };
  var INPUT_META = {
    datamart: { label: "DataMart", hint: "xlsx or csv" },
    saviynt: { label: "Saviynt", hint: "xlsx or csv" },
    o365: { label: "O365", hint: "sheet: Export" },
    aurora: { label: "Aurora Users", hint: "sheet: Aurora Userbase" },
    bsc: { label: "BSC users", hint: "sheet: main" },
    ceo: { label: "CEO Minus", hint: "xlsx · dated sheets" }
  };
  ZONES.forEach(function (z) { INPUT_META["zone:" + z] = { label: z + " zone data", hint: "xlsx · Action" }; });
  function metaLabel(k) { return (INPUT_META[k] || { label: k }).label; }
  function metaHint(k) { return (INPUT_META[k] || { hint: "xlsx" }).hint; }

  // ---- SVG icons (Lucide-style, stroke=currentColor) --------------------
  function svg(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>";
  }
  var ICON = {
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
    columns: '<path d="M3 5h18M9 5v14M3 5v14h18V5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    shieldcheck: '<path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6"/><path d="M18 8v6M15 11h6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    fingerprint: '<circle cx="12" cy="11" r="8"/><path d="M12 7a4 4 0 0 0-4 4v3M16 11a4 4 0 0 0-2-3.5M12 11v5"/>',
    merge: '<circle cx="6" cy="18" r="2.5"/><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8.5 6H14a2 2 0 0 1 2 2v1.5"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>',
    mailx: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="m3 7 7 5 3-2"/><path d="m17 8 5 5M22 8l-5 5"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/>',
    play: '<path d="M6 4v16l14-8z"/>',
    forward: '<path d="M4 4v16l10-8zM14 4v16l6-4V8z"/>',
    archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    trash: '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13"/>'
  };
  function icon(name) { return svg(ICON[name] || ""); }

  // station index -> icon
  var STATION_ICON = ["database", "columns", "mail", "shieldcheck", "userplus", "copy",
    "sliders", "fingerprint", "merge", "shield", "mailx", "download"];
  // short tag under each station name
  var STATION_TAG = ["DataMart", "keep required", "blank / noemail", "Action=OK · zones",
    "zone add lists", "unique email", "OT yes/no", "SSO · Aurora · BSC", "not-found rows",
    "re-check zones", "latest sheet", "3 reports"];

  var STAGE_LABELS = ["Load Inputs"].concat(UBA.stages.STAGES.map(function (s) { return s[1]; }));

  // ---- state ------------------------------------------------------------
  var engine = null;
  var latest = -1;              // highest completed stage index (0 = loaded)
  var viewIdx = -1;            // stage currently shown in the panel
  var results = {};           // index -> StageResult (or synthetic for load)
  var previews = {};          // index -> {columns, rows}
  var provided = Object.create(null);  // input key -> true (already given to engine)
  var picks = Object.create(null);     // input key -> File (staged in a collector)
  var inputsSatisfied = Object.create(null); // stage index -> collector completed
  var pickedDatamart = null;

  var $ = function (id) { return document.getElementById(id); };

  // ---- helpers ----------------------------------------------------------
  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function readAB(f) { return new Promise(function (r, j) { var x = new FileReader(); x.onload = function () { r(x.result); }; x.onerror = j; x.readAsArrayBuffer(f); }); }
  function readTx(f) { return new Promise(function (r, j) { var x = new FileReader(); x.onload = function () { r(x.result); }; x.onerror = j; x.readAsText(f); }); }
  function csvShim(t) { return { sheetNames: ["CSV"], table: function () { return t; }, firstTable: function () { return t; } }; }
  async function readWb(f) { return /\.csv$/i.test(f.name) ? csvShim(UBA.io.readCsv(await readTx(f))) : UBA.io.readWorkbook(await readAB(f)); }
  async function readTable(f) { return /\.csv$/i.test(f.name) ? UBA.io.readCsv(await readTx(f)) : UBA.io.readWorkbook(await readAB(f)).firstTable(); }
  function download(bytes, name, mime) {
    var b = new Blob([bytes], { type: mime || "application/octet-stream" }), u = URL.createObjectURL(b);
    var a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a);
    a.click(); a.remove(); URL.revokeObjectURL(u);
  }
  function yieldUI() { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); }
  function busy(on) { $("busybar").classList.toggle("on", on); }
  function countUp(el, from, to) {
    if (reduced || from === to) { el.textContent = to.toLocaleString(); return; }
    var s = performance.now(), dur = 650;
    (function tick(now) {
      var p = Math.min(1, (now - s) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * e).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    })(s);
  }
  function toast(kind, ic, html) {
    var t = document.createElement("div"); t.className = "toast " + kind;
    t.innerHTML = '<span class="ic">' + icon(ic) + "</span><span>" + html + "</span>";
    $("toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }

  // ---- metro rail -------------------------------------------------------
  function buildStations() {
    var ol = $("stations"); ol.innerHTML = "";
    STAGE_LABELS.forEach(function (label, i) {
      var li = document.createElement("li");
      li.className = "station"; li.id = "sta-" + i;
      li.innerHTML =
        '<span class="dot">' + icon(STATION_ICON[i]) + '<span class="idx">' + i + "</span></span>" +
        '<span class="rm-badge"></span>' +
        '<span class="meta"><span class="name">' + esc(label) + "</span>" +
        '<span class="tag">' + esc(STATION_TAG[i]) + "</span></span>";
      li.addEventListener("click", function () {
        if (i <= latest) showStage(i);
      });
      ol.appendChild(li);
    });
  }
  function updateMetro() {
    for (var i = 0; i < STAGE_LABELS.length; i++) {
      var li = $("sta-" + i); if (!li) continue;
      li.classList.remove("done", "removed", "active", "viewing", "clickable");
      var res = results[i];
      if (i < latest || (i === latest && i !== viewIdx && latest === 11)) {
        li.classList.add(res && res.deletedCount ? "removed" : "done");
      } else if (i === latest) {
        li.classList.add(latest === 11 ? (res && res.deletedCount ? "removed" : "done") : "active");
      }
      if (res && res.deletedCount) {
        li.classList.add("removed");
        li.querySelector(".rm-badge").textContent = "−" + res.deletedCount;
      }
      if (i <= latest) li.classList.add("clickable");
      if (i === viewIdx) li.classList.add("viewing");
    }
    // progress pill
    $("pg-count").textContent = Math.max(0, latest) + " / 11";
    $("pg-bar").style.width = (Math.max(0, latest) / 11 * 100) + "%";
    $("jump-latest").hidden = (viewIdx === latest);
  }

  // ---- load view --------------------------------------------------------
  function renderLoad() {
    viewIdx = -1;
    var f = pickedDatamart;
    $("panel").innerHTML =
      '<div class="view load">' +
      "<h2>Start with your DataMart</h2>" +
      '<p class="lead">Load the DataMart to begin. Each later step asks for the files it ' +
      "needs, when it needs them — zone files at Zone Validation, identity files at " +
      "Enrichment, CEO file at the CEO filter.</p>" +
      '<div class="drops"><label class="drop drop-lg' + (f ? " filled" : "") + '" id="drop-datamart">' +
      '<span class="k">' + icon(f ? "check" : "database") + "DataMart</span>" +
      '<span class="f">' + (f ? esc(f.name) : "xlsx or csv") + "</span>" +
      '<input type="file" accept=".xlsx,.csv" id="in-datamart"></label></div>' +
      '<div class="load-foot"><button class="btn primary wide" id="btn-load"' + (f ? "" : " disabled") + ">" +
      icon("play") + "Load &amp; start</button>" +
      '<span class="tag mono" id="load-note"></span></div></div>';
    $("in-datamart").addEventListener("change", function () {
      if (this.files[0]) { pickedDatamart = this.files[0]; renderLoad(); }
    });
    $("btn-load").addEventListener("click", doLoad);
    updateMetro();
  }

  async function doLoad() {
    if (!pickedDatamart) { toast("warn", "upload", "Pick a <b>DataMart</b> file"); return; }
    $("load-note").textContent = "Reading DataMart…"; busy(true); await yieldUI();
    try {
      engine = new UBA.Engine({ stamp: stamp() });
      var res = engine.start(await readWb(pickedDatamart));
      results[0] = { index: 0, label: "Load Inputs", rowsBefore: 0, rowsAfter: res.rowsAfter,
        columnsDropped: [], columnsAdded: [], deletedCount: 0, logs: res.logs };
      previews[0] = engine.previewRows(50);
      latest = 0; toast("good", "database", "Loaded <b>" + res.rowsAfter.toLocaleString() + "</b> DataMart rows");
      showStage(0);
    } catch (e) { toast("warn", "trash", esc(e.message)); }
    finally { busy(false); if ($("load-note")) $("load-note").textContent = ""; }
  }

  // ---- per-step input collector ----------------------------------------
  function neededInputs(index) {
    return (STEP_INPUTS[index] || []).filter(function (k) { return !provided[k]; });
  }
  // A step is blocked until its collector has been completed once.
  function stageBlocked(index) {
    return !!STEP_INPUTS[index] && !inputsSatisfied[index];
  }

  function renderCollector(index, keys) {
    viewIdx = index;
    var optional = (index === 3); // zones: provide what you have; others pass through
    var drops = keys.map(function (k) {
      var got = provided[k] || picks[k];
      var fname = provided[k] ? "provided" : (picks[k] ? picks[k].name : metaHint(k));
      return '<label class="drop' + (got ? " filled" : "") + '" data-k="' + k + '">' +
        '<span class="k">' + icon(got ? "check" : "upload") + esc(metaLabel(k)) + "</span>" +
        '<span class="f">' + esc(fname) + "</span>" +
        (provided[k] ? "" : '<input type="file" accept=".xlsx,.csv" data-k="' + k + '">') + "</label>";
    }).join("");
    var ready = optional || keys.every(function (k) { return provided[k] || picks[k]; });
    $("panel").innerHTML = '<div class="view load collector">' +
      "<h2>" + esc(STAGE_LABELS[index]) + " needs files</h2>" +
      '<p class="lead">' + (optional
        ? "One file per zone (" + ZONES.join(", ") + "). Provide the zones you have — " +
          "users in a zone with no file pass through unvalidated."
        : "Provide the reference file(s) for this step.") + "</p>" +
      '<div class="drops">' + drops + "</div>" +
      '<div class="load-foot"><button class="btn primary wide" id="btn-provide"' + (ready ? "" : " disabled") + ">" +
      icon("play") + "Provide &amp; run step</button>" +
      '<span class="tag mono" id="prov-note"></span></div></div>';

    Array.prototype.forEach.call($("panel").querySelectorAll('input[type=file]'), function (inp) {
      inp.addEventListener("change", function () {
        var k = inp.getAttribute("data-k");
        if (inp.files[0]) { picks[k] = inp.files[0]; renderCollector(index, keys); }
      });
    });
    $("btn-provide").addEventListener("click", function () { doProvide(index, keys); });
    updateMetro();
  }

  async function doProvide(index, keys) {
    $("prov-note").textContent = "Reading…"; busy(true); await yieldUI();
    try {
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (provided[k] || !picks[k]) continue;
        engine.provideInput(k, await readWb(picks[k]));
        provided[k] = true; picks[k] = null;
      }
    } catch (e) { toast("warn", "trash", esc(e.message)); busy(false); return; }
    busy(false);
    inputsSatisfied[index] = true;
    await runStage(index);
  }

  // ---- stage / checkpoint view -----------------------------------------
  function showStage(index) {
    viewIdx = index;
    var res = results[index], prev = previews[index] || { columns: [], rows: [] };
    var frontier = (index === latest);
    var atEnd = (latest === 11);

    var metrics = '<div class="metric rows"><div class="lab">Rows out</div>' +
      '<div class="val" id="m-rows">' + res.rowsAfter.toLocaleString() + "</div></div>";
    if (res.deletedCount) metrics += '<div class="metric removed"><div class="lab">Removed</div>' +
      '<div class="val">−' + res.deletedCount.toLocaleString() + "</div></div>";
    if (res.columnsAdded && res.columnsAdded.length) metrics += '<div class="metric added"><div class="lab">Cols +</div>' +
      '<div class="val">+' + res.columnsAdded.length + "</div></div>";

    var chips = ((res.columnsDropped || []).map(function (c) { return '<span class="chip drop">− ' + esc(c) + "</span>"; })
      .concat((res.columnsAdded || []).map(function (c) { return '<span class="chip add">+ ' + esc(c) + "</span>"; }))).join("");

    var logs = res.logs.map(function (l, i) {
      var cls = /removed|dropped|MISSING/i.test(l) ? "warn" : /\+|added|matched|Loaded/i.test(l) ? "good" : "";
      return '<div class="logline ' + cls + '" style="animation-delay:' + (i * 55) + 'ms">' +
        '<span class="mk"></span>' + esc(l) + "</div>";
    }).join("");

    var head = '<div class="st-head"><div><div class="st-title"><small>Stage ' +
      String(index).padStart(2, "0") + (frontier ? "" : " · checkpoint") + "</small>" + esc(res.label) +
      "</div></div>" + '<div class="st-metrics">' + metrics + "</div></div>";

    var table = prev.rows.length
      ? "<table><thead><tr>" + prev.columns.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") +
        "</tr></thead><tbody>" + prev.rows.map(function (r) {
          return "<tr>" + prev.columns.map(function (c) { return "<td>" + esc(r[c] == null ? "" : r[c]) + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table>"
      : '<div class="empty">No rows at this checkpoint.</div>';

    // actions
    var acts = '<button class="btn" id="a-cur">' + icon("download") + "Current file</button>" +
      '<button class="btn" id="a-del"' + (res.deletedCount ? "" : " disabled") + ">" + icon("trash") + "Deleted rows</button>";
    if (frontier && !atEnd) {
      acts += '<label class="btn" for="a-up">' + icon("upload") + "Upload replacement</label>" +
        '<input type="file" id="a-up" accept=".xlsx,.csv" hidden>' +
        '<button class="btn primary" id="a-cont">' + icon("play") + "Continue</button>" +
        '<button class="btn" id="a-all">' + icon("forward") + "Run all</button>";
    } else if (!frontier) {
      acts += '<span class="tag mono" style="align-self:center;margin-left:auto">Reviewing checkpoint</span>';
    }
    if (atEnd) acts += '<button class="btn primary" id="a-logs">' + icon("archive") + "Download logs.zip</button>";

    $("panel").innerHTML = '<div class="view">' + head +
      (chips ? '<div class="chips">' + chips + "</div>" : "") +
      '<div class="logs">' + logs + "</div>" +
      '<div class="preview-head"><span class="lab">Preview · first 50 rows</span>' +
      '<span class="lab mono">' + prev.rows.length + " shown · " + res.rowsAfter.toLocaleString() + " total</span></div>" +
      '<div class="preview">' + table + "</div>" +
      '<div class="actions">' + acts + "</div></div>";

    // count-up the rows-out metric from rowsBefore
    countUp($("m-rows"), res.rowsBefore || res.rowsAfter, res.rowsAfter);

    // wire actions
    $("a-cur").onclick = function () {
      var b = engine.stageAfterBytes(index) || engine.currentXlsxBytes();
      download(b, "stage_" + String(index).padStart(2, "0") + "_current.xlsx", XLSX_MIME);
    };
    $("a-del").onclick = function () {
      var b = engine.deletedXlsxBytes(index);
      if (!b) return; download(b, "stage_" + String(index).padStart(2, "0") + "_deleted.xlsx", XLSX_MIME);
    };
    if ($("a-cont")) $("a-cont").onclick = function () { runStage(latest + 1); };
    if ($("a-all")) $("a-all").onclick = runAll;
    if ($("a-up")) $("a-up").onchange = function (ev) { onOverride(ev); };
    if ($("a-logs")) $("a-logs").onclick = function () { download(engine.logsZipBytes(), "logs.zip", "application/zip"); };

    updateMetro();
  }

  async function runStage(index, overrideTable) {
    if (!overrideTable && stageBlocked(index)) {
      renderCollector(index, neededInputs(index)); return;
    }
    $("sta-" + index).classList.add("active"); busy(true); await yieldUI();
    try {
      var res = engine.runStage(index, overrideTable);
      results[index] = res; previews[index] = engine.previewRows(50); latest = index;
      var kind = res.deletedCount ? "warn" : "good";
      var msg = res.deletedCount
        ? "<b>−" + res.deletedCount + "</b> removed · " + esc(res.label)
        : (res.columnsAdded && res.columnsAdded.length ? "<b>+" + res.columnsAdded.length + "</b> cols · " : "") + esc(res.label);
      toast(kind, res.deletedCount ? "trash" : "check", msg);
      showStage(index);
    } catch (e) { toast("warn", "trash", esc(e.message)); showStage(latest); throw e; }
    finally { busy(false); }
  }

  async function runAll() {
    try {
      while (latest < 11) {
        var next = latest + 1;
        if (stageBlocked(next)) {
          renderCollector(next, neededInputs(next));
          toast("info", "upload", "Provide files for <b>" + esc(STAGE_LABELS[next]) + "</b>");
          return;
        }
        await runStage(next);
      }
      toast("good", "check", "Pipeline complete");
    } catch (e) { /* surfaced */ }
  }

  async function onOverride(ev) {
    var f = ev.target.files[0]; if (!f) return;
    var idx = latest + 1;
    if (idx > 11) { toast("warn", "upload", "Nothing left to override"); return; }
    toast("info", "upload", "Override → re-running <b>" + esc(STAGE_LABELS[idx]) + "</b>");
    try { await runStage(idx, await readTable(f)); } catch (e) { /* surfaced */ }
    ev.target.value = "";
  }

  // ---- init -------------------------------------------------------------
  function init() {
    buildStations();
    $("jump-latest").addEventListener("click", function () {
      if (latest < 0) renderLoad(); else showStage(latest);
    });
    window.addEventListener("resize", updateMetro);
    renderLoad();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
