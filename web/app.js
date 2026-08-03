/* Userbase Automation — Pipeline Studio (API-backed) */
'use strict';

// ---------- api client ----------
async function jfetch(url, opts) {
  const method = (opts && opts.method) || 'GET';
  const t0 = (self.performance || Date).now();
  logEvent('req', `${method} ${url}`);
  let r;
  try {
    r = await fetch(url, opts);
  } catch (e) {
    logEvent('error', `${method} ${url} — network error`, String((e && e.message) || e));
    throw new Error('Network error — is the server running?');
  }
  const ms = Math.round(((self.performance || Date).now()) - t0);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.clone().json()).detail || msg; } catch (e) { /* non-JSON body */ }
    logEvent('error', `${r.status} ${method} ${url} (${ms}ms)`, msg);
    throw new Error(`${msg} (${r.status})`);
  }
  logEvent('resp', `${r.status} ${method} ${url} (${ms}ms)`);
  return r.json();
}
async function upload(url, file) {
  const fd = new FormData();
  fd.append('file', file);
  logEvent('info', `Uploading "${file.name}" (${(file.size / 1e6).toFixed(1)} MB)`);
  return jfetch(url, { method: 'POST', body: fd });
}

// ---------- activity log ----------
const LOG = [];
const LOG_MAX = 1000;
function _logTime() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function logEvent(level, msg, detail) {
  const e = { ts: _logTime(), level, msg: String(msg), detail: detail ? String(detail) : '' };
  LOG.push(e);
  if (LOG.length > LOG_MAX) LOG.shift();
  _appendLogRow(e);
  _updateLogBadge();
}
function _logLineText(e) {
  return `[${e.ts}] ${e.level.toUpperCase().padEnd(5)} ${e.msg}${e.detail ? '  |  ' + e.detail : ''}`;
}
function _appendLogRow(e) {
  const body = document.getElementById('logbody');
  if (!body) return;
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 48;
  const row = el('div', `logrow lv-${e.level}`,
    `<span class="lt">${e.ts}</span><span class="ll">${esc(e.level)}</span>` +
    `<span class="lm">${esc(e.msg)}${e.detail ? ` <span class="ld">${esc(e.detail)}</span>` : ''}</span>`);
  body.appendChild(row);
  if (atBottom) body.scrollTop = body.scrollHeight;
}
function _updateLogBadge() {
  const b = document.getElementById('log-badge');
  if (!b) return;
  const errs = LOG.reduce((n, e) => n + (e.level === 'error' ? 1 : 0), 0);
  b.textContent = errs ? `${errs}!` : String(LOG.length);
  b.classList.toggle('has-err', errs > 0);
}
function _renderAllLogs() {
  const body = document.getElementById('logbody');
  if (!body) return;
  body.innerHTML = '';
  LOG.forEach(_appendLogRow);
  body.scrollTop = body.scrollHeight;
}
async function copyLog() {
  const text = LOG.map(_logLineText).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('Activity log copied', 'good');
  } catch (e) {
    const ta = el('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch (_) { /* ignore */ }
    ta.remove();
    toast(done ? 'Activity log copied' : 'Copy failed — open the log and copy manually', done ? 'good' : 'warn');
  }
}
// Base path of the app as served. Locally that is "/"; behind the portal the app
// lives under "/userbase-automation/". Deriving it from the current document keeps
// every API/download URL relative to the mount point, so the same build works in
// both places (nginx strips the subpath before it reaches the backend).
const BASE = new URL('.', location.href).pathname;   // e.g. "/" or "/userbase-automation/"
const api = {
  runs: () => jfetch(`${BASE}api/runs`),
  run: id => jfetch(`${BASE}api/runs/${id}`),
  createRun: (file, mode) =>
    upload(`${BASE}api/runs${mode === 'single_zone' ? '?mode=single_zone' : ''}`, file),
  uploadInput: (id, slot, file) => upload(`${BASE}api/runs/${id}/inputs/${slot}`, file),
  clearInput: (id, slot) => jfetch(`${BASE}api/runs/${id}/inputs/${slot}/clear`, { method: 'POST' }),
  advance: id => jfetch(`${BASE}api/runs/${id}/advance`, { method: 'POST' }),
  skip: (id, n) => jfetch(`${BASE}api/runs/${id}/stages/${n}/skip`, { method: 'POST' }),
  runAll: id => jfetch(`${BASE}api/runs/${id}/run-all`, { method: 'POST' }),
  zoneValues: id => jfetch(`${BASE}api/runs/${id}/zone-values`),
  setZoneFilter: (id, value) =>
    jfetch(`${BASE}api/runs/${id}/zone-filter?value=${encodeURIComponent(value)}`, { method: 'POST' }),
  preview: (id, n, kind, page, q) =>
    jfetch(`${BASE}api/runs/${id}/stages/${n}/preview?kind=${kind}&page=${page}&q=${encodeURIComponent(q || '')}`),
  replace: (id, n, file) => upload(`${BASE}api/runs/${id}/stages/${n}/replace`, file),
  downloadUrl: (id, n, kind, fmt) => `${BASE}api/runs/${id}/stages/${n}/download?kind=${kind}&fmt=${fmt}`,
  finalUrl: (id, name) => `${BASE}api/runs/${id}/final/${encodeURIComponent(name)}`,
  logsUrl: id => `${BASE}api/runs/${id}/logs.zip`,
};

// Standard Operating Procedure — shown on the start screen (source: Userbase_Creation_SOP.docx).
const SOP = {
  purpose: 'Build the final Userbase from the Datamart plus O365, Saviynt, Zone, '
    + 'Aurora, BSC and CEO files — validated, cleaned, deduplicated and ready for '
    + 'campaign execution, awareness targeting, reporting and segmentation.',
  inputs: ['Datamart', 'O365', 'Saviynt', 'Zone files (MAZ, SAZ, NAZ, APC, AFR, EUR, GHQ, Growth)',
    'Aurora', 'BSC', 'CEO'],
  steps: [
    ['Create Base Userbase from Datamart', 'Keep only the 21 SOP columns; drop everything else.'],
    ['Create New Userbase', 'The filtered Datamart becomes the master working file.'],
    ['Validate Employee Email', 'Remove rows where the email is blank, contains "noemail", or has no "@".'],
    ['Identify OT Users', 'Add OT (Yes/No): Yes only for SUPPLY + allowed Job Family + allowed Job Profile.'],
    ['Add SSOUPN as per AD (O365)', 'Map Employee Email → O365 Mail; write UserPrincipalName.'],
    ['Add SSOUPN as per Saviynt', 'Map Employee Email → Saviynt User Email; write SSO UPN.'],
    ['Validate Zone Users', 'Per zone file keep Action = OK (mark "<Zone> Validated"); remove the rest.'],
    ['Add Additional Users from Zone Files', 'Append users from each zone file\'s additional tab.'],
    ['Repeat Zone Validation for All Zones', 'Steps 7–8 across every zone before Aurora.'],
    ['Aurora Validation', 'Flag Aurora (Yes/No) via E-MAIL; append not-found Aurora users.'],
    ['BSC Validation', 'Flag BSC (Yes/No) via Email - Primary Work; append not-found BSC users.'],
    ['CEO Exclusion', 'Remove users whose email or either SSOUPN matches the latest CEO Mail ID sheet.'],
    ['Remove Duplicate Users', 'Deduplicate on Employee Email — first occurrence kept.'],
    ['Final Validation', 'Run the SOP checklist and export Final Userbase.xlsx + reports.'],
  ],
};

// ---------- state ----------
const state = {
  runId: null, manifest: null,
  viewStage: null,          // null = frontier
  previewKind: 'kept', page: 1, q: '',
  fmt: 'xlsx', busy: false,
  newMode: 'full',          // 'full' | 'single_zone' — selected on the start screen
};

const ZONES = ['MAZ', 'SAZ', 'NAZ', 'APC', 'AFR', 'EUR', 'GHQ', 'Growth'];
const SLOT_LABELS = {
  datamart: 'Datamart', o365: 'O365 Export', saviynt: 'Saviynt', aurora: 'Aurora Users',
  bsc: 'BSC Users', ceo: 'CEO File',
};
ZONES.forEach(z => { SLOT_LABELS[`zone_${z}`] = `${z} zone file`; });

const DESCRIPTIONS = {
  1: 'Keep only the 21 SOP columns from the Datamart. Every other column is dropped (logged); missing required columns are created blank.',
  2: 'The filtered Datamart becomes the Base Userbase — the master working file for the rest of the run.',
  3: 'Remove rows whose Employee Email is blank, contains "noemail", or is missing "@". Removed rows are stored and downloadable.',
  4: 'Add the OT (Yes/No) column. Yes requires Job Family Group = SUPPLY, an allowed Job Family, and an allowed Job Profile.',
  5: 'Match Employee Email against the O365 file (Mail) and populate SSOUPN as per AD (O365) from UserPrincipalName.',
  6: 'Match Employee Email against the Saviynt file (User Email) and populate SSOUPN as per Saviynt from SSO UPN.',
  7: 'Per zone with a file: users must appear with Action = OK, else removed; kept users are marked "<Zone> Validated". Zones without a file pass through unvalidated. All 8 zone files are optional.',
  8: 'Append users from each zone file\'s additional tab who are missing from the Userbase, marked "<Zone> Additional".',
  9: 'Summary of the zone loop — per-zone validated / removed / appended counts and any zones that had no file.',
  10: 'Flag Aurora (Yes/No) via E-MAIL; Aurora users missing from the Userbase are appended with Aurora = Yes.',
  11: 'Flag BSC (Yes/No) via Email - Primary Work; missing BSC users are appended with BSC = Yes.',
  12: 'Remove users whose Employee Email or either SSOUPN matches Mail ID in the latest dated CEO sheet.',
  13: 'Remove duplicate Employee Email rows — first occurrence kept.',
  14: 'Evaluate the SOP checklist and write Final Userbase.xlsx, Removed_Users_Report.xlsx and Automation_Report.xlsx.',
};

// ---------- dom helpers ----------
const $ = s => document.querySelector(s);
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, kind) {
  const t = el('div', `toast ${kind || 'info'}`,
    `<span class="ic">${kind === 'warn' ? '!' : kind === 'good' ? '✓' : 'i'}</span><span>${esc(msg)}</span>`);
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function setBusy(on) {
  state.busy = on;
  $('#busybar').classList.toggle('on', on);
  document.querySelectorAll('.btn').forEach(b => { b.disabled = on || b.dataset.forceDisabled === '1'; });
}
async function guard(fn, doneMsg) {
  if (state.busy) return;
  setBusy(true);
  try {
    await fn();
    if (doneMsg) { toast(doneMsg, 'good'); logEvent('info', doneMsg); }
  } catch (e) {
    toast(e.message, 'warn');
    logEvent('error', 'Action failed', e.message);
  } finally {
    setBusy(false);
    if (state.runId) await refresh(true);
  }
}

// ---------- data ----------
async function refresh(rerenderOnly) {
  if (!state.runId) { renderHome(); return; }
  if (!rerenderOnly || true) state.manifest = await api.run(state.runId);
  render();
}
function stageEntry(n) { return state.manifest.stages[String(n)]; }
function frontier() { return state.manifest.frontier; }
function viewedStage() {
  if (state.viewStage) return state.viewStage;
  return Math.min(frontier(), 14);
}
function completedCount() { return Object.keys(state.manifest.stages).length; }

// ---------- render: home ----------
async function renderHome() {
  $('#metro').hidden = true;
  document.querySelector('.stage').classList.add('home');
  $('#pg-pill').hidden = true;
  $('#jump-latest').hidden = true;
  $('#home-btn').hidden = true;
  const panel = $('#panel');
  panel.innerHTML = '';
  const v = el('div', 'view load home');
  const left = el('div', 'home-left');
  const right = el('div', 'home-right');
  v.appendChild(left);
  v.appendChild(right);
  left.appendChild(el('h2', null, 'Start a run'));
  left.appendChild(el('div', 'lead',
    'Upload the Datamart extract to begin. Every stage stores its kept, removed and added '
    + 'rows — preview, download or replace the working file at any point.'));

  // ── Run mode: full pipeline vs single-zone extract ──
  const modes = el('div', 'modes');
  const mkMode = (mode, title, sub) => {
    const b = el('button', `mode-card${state.newMode === mode ? ' on' : ''}`,
      `<span class="mc-title">${title}</span><span class="mc-sub">${sub}</span>`);
    b.addEventListener('click', () => { state.newMode = mode; renderHome(); });
    return b;
  };
  modes.appendChild(mkMode('full', 'Full run', 'All zones · complete 14-stage pipeline'));
  modes.appendChild(mkMode('single_zone', 'Single-zone run',
    'Pick one zone up front — everyone else is dropped at the start'));
  left.appendChild(modes);

  const drops = el('div', 'drops');
  const single = state.newMode === 'single_zone';
  const dz = el('label', 'drop drop-lg',
    `<span class="k"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
     Upload Datamart — ${single ? 'single-zone run' : 'new run'}</span><span class="f">.xlsx or .csv · <b>CSV is ~5× faster</b> for large files${single ? ' · pick the zone next' : ''}</span>`);
  const inp = el('input');
  inp.type = 'file'; inp.accept = '.xlsx,.csv';
  inp.addEventListener('change', () => {
    if (!inp.files.length) return;
    const mode = state.newMode;
    guard(async () => {
      const r = await api.createRun(inp.files[0], mode);
      state.runId = r.run_id;
      state.viewStage = null;
      logEvent('info', `Run created: ${r.run_id} (${mode})`);
    }, 'Run created — Datamart uploaded');
  });
  dz.appendChild(inp);
  drops.appendChild(dz);
  left.appendChild(drops);

  // ── SOP reference (fills the space before upload) ──
  const sop = el('details', 'sop');
  sop.open = true;
  const sum = el('summary', null,
    '<span class="sop-t">Standard Operating Procedure</span><span class="sop-h">Userbase Creation — 14 steps</span>');
  sop.appendChild(sum);
  sop.appendChild(el('div', 'sop-purpose', esc(SOP.purpose)));
  sop.appendChild(el('div', 'sop-inputs',
    '<b>Inputs:</b> ' + SOP.inputs.map(esc).join(' · ')));
  const ol = el('ol', 'sop-steps');
  SOP.steps.forEach(([t, d], i) => {
    ol.appendChild(el('li', null,
      `<span class="sn">${i + 1}</span><span class="sb"><b>${esc(t)}</b><span>${esc(d)}</span></span>`));
  });
  sop.appendChild(ol);
  right.appendChild(sop);
  panel.appendChild(v);

  try {
    const runs = await api.runs();
    if (runs.length) {
      const left = document.querySelector('.home-left');
      const head = el('div', 'runs-head', '<h2 style="font-size:1.05rem">Past runs</h2>');
      left.appendChild(head);
      const list = el('div', 'runs-list');
      runs.forEach(m => {
        const done = Object.keys(m.stages).length;
        const row = el('div', 'run-row',
          `<span class="rid mono">${esc(m.run_id)}</span>
           <span class="rmeta">${esc(m.status)} · ${done} / 14 stages</span>`);
        row.addEventListener('click', () => {
          state.runId = m.run_id; state.viewStage = null;
          refresh();
        });
        list.appendChild(row);
      });
      left.appendChild(list);
    }
  } catch (e) {
    // server down / wrong build: home stays usable, but make the reason explicit.
    logEvent('error', 'Cannot reach the backend at ' + BASE + 'api/runs', e.message);
    logEvent('info', 'If this is the portal, the app likely still serves the old static '
      + 'build — redeploy so /userbase-automation/ proxies to the FastAPI service.');
  }
}

// ---------- render: run ----------
function render() {
  const m = state.manifest;
  $('#metro').hidden = false;
  document.querySelector('.stage').classList.remove('home');
  $('#pg-pill').hidden = false;
  $('#home-btn').hidden = false;
  $('#jump-latest').hidden = !state.viewStage;
  $('#pg-count').textContent = `${completedCount()} / 14`;
  $('#pg-bar').style.width = `${(completedCount() / 14) * 100}%`;
  renderRail();
  renderPanel();
}

const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

function renderRail() {
  const m = state.manifest;
  const ol = $('#stations');
  ol.innerHTML = '';
  m.stage_meta.forEach(sm => {
    const entry = stageEntry(sm.n);
    const li = el('li', 'station');
    const isErr = m.error && m.error.stage === sm.n;
    if (entry) {
      li.classList.add('done');
      if (entry.removed > 0) li.classList.add('removed');
      if (entry.skipped) li.classList.add('skipped');
    }
    if (isErr) li.classList.add('error');
    if (!entry && sm.n === frontier() && m.status !== 'complete') li.classList.add('active');
    if (sm.n === viewedStage()) li.classList.add('viewing');
    const dot = el('span', 'dot');
    dot.innerHTML = entry ? CHECK_SVG : `<span class="idx">${sm.n}</span>`;
    li.appendChild(dot);
    if (entry && entry.removed > 0) li.appendChild(el('span', 'rm-badge', `−${entry.removed}`));
    if (entry && entry.added > 0) li.appendChild(el('span', 'add-badge', `+${entry.added}`));
    const tagText = entry
      ? (entry.skipped ? 'skipped' : `${entry.rows.toLocaleString()} rows`)
      : (sm.missing.length ? 'needs ' + sm.missing.map(s => SLOT_LABELS[s] || s).join(', ') : '');
    const meta = el('span', 'meta',
      `<span class="name">${esc(sm.title)}</span><span class="tag">${tagText}</span>`);
    li.appendChild(meta);
    if (entry || sm.n === frontier()) {
      li.classList.add('clickable');
      li.addEventListener('click', () => {
        state.viewStage = (sm.n === frontier() && !entry) ? null : sm.n;
        state.previewKind = 'kept'; state.page = 1; state.q = '';
        render();
      });
    }
    ol.appendChild(li);
  });
}

// ---------- single-zone picker ----------
function renderZonePicker(container, m) {
  const box = el('div', 'zonepick');
  container.appendChild(box);
  if (m.zone_filter) _zoneSelected(box, m); else _zoneList(box);
}
function _zoneSelected(box, m) {
  box.innerHTML = '<div class="zp-h">Zone selected</div>';
  const cur = el('div', 'zp-current',
    `<b>${esc(m.zone_filter.value)}</b><span>only this zone is kept — everyone else is dropped at Stage 1</span>`);
  const ch = el('button', 'ghost-btn', 'Change');
  ch.addEventListener('click', () => _zoneList(box));
  cur.appendChild(ch);
  box.appendChild(cur);
}
function _zoneList(box) {
  box.innerHTML = '<div class="zp-h">Pick a zone — Macro Entity Level 2 (Zone)</div>'
    + '<div class="zp-list"><span class="zp-load">Reading zones from the Datamart…</span></div>';
  const list = box.querySelector('.zp-list');
  api.zoneValues(state.runId).then(res => {
    list.innerHTML = '';
    if (!res.values.length) { list.innerHTML = '<span class="zp-load">No zone values found.</span>'; return; }
    res.values.forEach(zv => {
      const b = el('button', 'zp-opt', `<b>${esc(zv.value)}</b><span>${zv.count.toLocaleString()} people</span>`);
      b.addEventListener('click', () =>
        guard(() => api.setZoneFilter(state.runId, zv.value), `Zone set: ${zv.value}`));
      list.appendChild(b);
    });
  }).catch(e => { list.innerHTML = `<span class="zp-load">${esc(e.message)}</span>`; });
}

function renderPanel() {
  const m = state.manifest;
  const n = viewedStage();
  const sm = m.stage_meta.find(s => s.n === n);
  const entry = stageEntry(n);
  const panel = $('#panel');
  panel.innerHTML = '';
  const v = el('div', 'view');

  if (m.error) {
    v.appendChild(el('div', 'error-banner',
      `<b>Stage ${m.error.stage} failed:</b> ${esc(m.error.message)} — fix the input and retry.`));
  }

  // head
  const head = el('div', 'st-head');
  const title = el('div', 'st-title',
    `<small>Stage ${n} of 14${entry && entry.skipped ? ' · skipped' : (entry ? '' : (n === frontier() ? ' · up next' : ''))}</small>${esc(sm.title)}`);
  head.appendChild(title);
  if (entry) {
    const metrics = el('div', 'st-metrics');
    metrics.appendChild(el('div', 'metric rows',
      `<div class="lab">Rows</div><div class="val mono">${entry.rows.toLocaleString()}</div>`));
    metrics.appendChild(el('div', 'metric removed',
      `<div class="lab">Removed</div><div class="val mono">${entry.removed.toLocaleString()}</div>`));
    metrics.appendChild(el('div', 'metric added',
      `<div class="lab">Added</div><div class="val mono">${entry.added.toLocaleString()}</div>`));
    head.appendChild(metrics);
  }
  v.appendChild(head);
  v.appendChild(el('div', 'lead', esc(DESCRIPTIONS[n] || '')));

  // ── Per-stage downloads — prominent, above the preview, on every completed stage ──
  if (entry) {
    const dl = el('div', 'stage-dl');
    const head = el('div', 'sdl-head');
    head.appendChild(el('span', 'sdl-lab', 'Download this stage'));
    const fmtSel = el('select', 'fmt-sel', '<option value="xlsx">xlsx</option><option value="csv">csv</option>');
    fmtSel.value = state.fmt;
    fmtSel.addEventListener('change', () => { state.fmt = fmtSel.value; });
    head.appendChild(fmtSel);
    dl.appendChild(head);
    const row = el('div', 'sdl-row');
    const mkDl = (kind, label, count, cls) => {
      const b = el('button', `sdl-btn ${cls}`,
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
        + `<span class="sdl-k">${label}</span><span class="sdl-c">${count.toLocaleString()}</span>`);
      if (count === 0 && kind !== 'kept') { b.disabled = true; }
      else b.addEventListener('click', () => window.open(api.downloadUrl(state.runId, n, kind, state.fmt)));
      return b;
    };
    row.appendChild(mkDl('kept', 'Kept', entry.rows, 'k'));
    row.appendChild(mkDl('removed', 'Removed', entry.removed, 'r'));
    row.appendChild(mkDl('added', 'Added', entry.added, 'a'));
    dl.appendChild(row);
    v.appendChild(dl);
  }

  // ── Final outputs (Stage 14) — the deliverables, downloadable immediately ──
  if (entry && entry.stats && entry.stats.output_files && entry.stats.output_files.length) {
    const fo = el('div', 'final-outputs');
    fo.appendChild(el('div', 'fo-lab',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Final outputs ready — download'));
    const row = el('div', 'fo-row');
    entry.stats.output_files.forEach(name => {
      const b = el('button', 'fo-btn',
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>${esc(name)}</span>`);
      b.addEventListener('click', () => window.open(api.finalUrl(state.runId, name)));
      row.appendChild(b);
    });
    fo.appendChild(row);
    v.appendChild(fo);
  }

  // input dropzones
  const isFrontierView = !state.viewStage || state.viewStage === frontier();

  // single-zone: pick the zone before Stage 1 runs
  if (n === 1 && !entry && isFrontierView && m.mode === 'single_zone') {
    renderZonePicker(v, m);
  }
  const slots = n === 7 || n === 8 ? ZONES.map(z => `zone_${z}`) : sm.needs;
  if (isFrontierView && !entry && slots.length) {
    const drops = el('div', 'drops');
    slots.forEach(slot => {
      const filled = !!m.inputs[slot];
      const d = el('label', `drop${filled ? ' filled' : ''}`,
        `<span class="k"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
         ${esc(SLOT_LABELS[slot] || slot)}${n === 7 || n === 8 ? ' <span style="color:var(--faint)">(optional)</span>' : ''}</span>
         <span class="f">${filled ? '✓ ' + esc(m.inputs[slot].split('_').slice(2).join('_') || m.inputs[slot]) : 'click or drop .xlsx / .csv'}</span>`);
      const inp = el('input');
      inp.type = 'file'; inp.accept = '.xlsx,.csv';
      inp.addEventListener('change', () => {
        if (!inp.files.length) return;
        guard(() => api.uploadInput(state.runId, slot, inp.files[0]),
          `${SLOT_LABELS[slot] || slot} uploaded`);
      });
      d.appendChild(inp);
      if (filled) {
        const rm = el('button', 'drop-rm', '✕');
        rm.title = 'Remove this file';
        rm.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          guard(() => api.clearInput(state.runId, slot), `${SLOT_LABELS[slot] || slot} removed`);
        });
        d.appendChild(rm);
      }
      drops.appendChild(d);
    });
    drops.style.flex = '0 0 auto';
    v.appendChild(drops);
  }

  // stats extras
  if (entry) {
    const st = entry.stats || {};
    const chips = el('div', 'chips');
    (st.dropped_columns || []).slice(0, 30).forEach(c => chips.appendChild(el('span', 'chip drop', `− ${esc(c)}`)));
    (st.missing_columns || []).forEach(c => chips.appendChild(el('span', 'chip', `blank ${esc(c)}`)));
    (st.unvalidated_zones || []).forEach(z => chips.appendChild(el('span', 'chip', `${esc(z)}: no file`)));
    if (st.checklist) st.checklist.forEach(c =>
      chips.appendChild(el('span', `chip ${c.status === 'Completed' ? 'add' : 'drop'}`,
        `${c.status === 'Completed' ? '✓' : '!'} ${esc(c.item)}`)));
    if (chips.children.length) v.appendChild(chips);
    const logs = el('div', 'logs');
    (entry.log_lines || []).forEach(l => logs.appendChild(el('div', 'logline', `<span class="mk"></span>${esc(l)}`)));
    if (logs.children.length) v.appendChild(logs);
  }

  // preview
  if (entry) {
    const ph = el('div', 'preview-head');
    const tabs = el('div', 'tabbar');
    [['kept', 'Kept', entry.rows], ['removed', 'Removed', entry.removed], ['added', 'Added', entry.added]]
      .forEach(([kind, lab, count]) => {
        const b = el('button', `tab${state.previewKind === kind ? ' active' : ''}`, `${lab} (${count.toLocaleString()})`);
        b.disabled = count === 0 && kind !== 'kept';
        b.addEventListener('click', () => { state.previewKind = kind; state.page = 1; renderPanel(); });
        tabs.appendChild(b);
      });
    ph.appendChild(tabs);
    const right = el('div', 'pager');
    const search = el('input', 'search');
    search.placeholder = 'search…'; search.value = state.q;
    let deb;
    search.addEventListener('input', () => {
      clearTimeout(deb);
      deb = setTimeout(() => { state.q = search.value; state.page = 1; loadPreview(n); }, 300);
    });
    right.appendChild(search);
    right.appendChild(el('span', null, `<span id="pager-lab"></span>`));
    const prev = el('button', null, '‹'); const next = el('button', null, '›');
    prev.id = 'pg-prev'; next.id = 'pg-next';
    prev.addEventListener('click', () => { state.page--; loadPreview(n); });
    next.addEventListener('click', () => { state.page++; loadPreview(n); });
    right.appendChild(prev); right.appendChild(next);
    ph.appendChild(right);
    v.appendChild(ph);
    const pv = el('div', 'preview');
    pv.id = 'preview';
    pv.innerHTML = '<div class="empty">Loading…</div>';
    v.appendChild(pv);
  }

  // actions
  const actions = el('div', 'actions');
  const mkBtn = (label, fn, opts) => {
    const b = el('button', `btn${opts && opts.primary ? ' primary wide' : ''}`, label);
    if (opts && opts.disabled) { b.disabled = true; b.dataset.forceDisabled = '1'; }
    if (fn) b.addEventListener('click', fn);
    return b;
  };
  if (entry) {
    const rep = mkBtn('Upload replacement…', null);
    const repInp = el('input');
    repInp.type = 'file'; repInp.accept = '.xlsx,.csv'; repInp.style.display = 'none';
    repInp.addEventListener('change', () => {
      if (!repInp.files.length) return;
      if (!confirm(`Replace the working file at stage ${n}? Stages after ${n} will be superseded (archived) and must re-run.`)) return;
      guard(async () => {
        await api.replace(state.runId, n, repInp.files[0]);
        state.viewStage = null;
      }, 'Working file replaced');
    });
    rep.addEventListener('click', () => repInp.click());
    actions.appendChild(rep);
    actions.appendChild(repInp);
  }
  if (stageEntry(14)) {
    actions.appendChild(mkBtn('Download logs.zip', () => window.open(api.logsUrl(state.runId))));
  }
  if (m.status !== 'complete') {
    const atFrontier = !entry && n === frontier();
    const needZonePick = m.mode === 'single_zone' && !m.zone_filter && frontier() === 1;
    actions.appendChild(mkBtn('Run all', () => guard(async () => {
      const r = await api.runAll(state.runId);
      state.viewStage = null;
      if (r.blocked_on) {
        const need = r.blocked_on.map(s => SLOT_LABELS[s] || s).join(', ');
        toast(`Waiting for: ${need}`, 'warn');
        logEvent('info', `Run-all paused — needs input: ${need}`);
      } else {
        toast('Pipeline complete', 'good');
        logEvent('info', 'Run-all complete — all 14 stages done');
      }
    }), { disabled: needZonePick }));
    // Skip — pass the current working file through unchanged (any stage after 1).
    if (atFrontier && n > 1) {
      actions.appendChild(mkBtn('Skip step', () => guard(async () => {
        await api.skip(state.runId, n);
        state.viewStage = null;
      }, `Stage ${n} skipped`)));
    }
    const missing = m.stage_meta.find(s => s.n === frontier());
    actions.appendChild(mkBtn('Continue ▸', () => guard(async () => {
      await api.advance(state.runId);
      state.viewStage = null;
    }, null), { primary: true, disabled: (missing && missing.missing.length > 0) || needZonePick }));
  }
  v.appendChild(actions);
  panel.appendChild(v);

  if (entry) loadPreview(n);
}

async function loadPreview(n) {
  const pv = $('#preview');
  if (!pv) return;
  try {
    const d = await api.preview(state.runId, n, state.previewKind, state.page, state.q);
    state.page = d.page;
    const lab = $('#pager-lab');
    if (lab) lab.textContent = `${d.total.toLocaleString()} rows · page ${d.page}/${d.pages}`;
    const prev = $('#pg-prev'), next = $('#pg-next');
    if (prev) prev.disabled = d.page <= 1;
    if (next) next.disabled = d.page >= d.pages;
    if (!d.rows.length) { pv.innerHTML = '<div class="empty">No rows.</div>'; return; }
    const thead = `<thead><tr>${d.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${d.rows.map(r =>
      `<tr>${r.map(c => `<td title="${esc(c)}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    pv.innerHTML = `<table>${thead}${tbody}</table>`;
  } catch (e) {
    pv.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// ---------- top bar ----------
$('#jump-latest').addEventListener('click', () => {
  state.viewStage = null;
  render();
});
$('#home-btn').addEventListener('click', () => {
  state.runId = null; state.manifest = null; state.viewStage = null;
  renderHome();
});

// ---------- activity log wiring ----------
$('#log-btn').addEventListener('click', () => {
  const dock = $('#logdock');
  dock.hidden = !dock.hidden;
  if (!dock.hidden) _renderAllLogs();
});
$('#log-copy').addEventListener('click', copyLog);
$('#log-clear').addEventListener('click', () => { LOG.length = 0; _renderAllLogs(); _updateLogBadge(); });
$('#log-hide').addEventListener('click', () => { $('#logdock').hidden = true; });

// ---------- boot ----------
logEvent('info', `Userbase Automation ready — API base "${BASE}"`);
renderHome();
