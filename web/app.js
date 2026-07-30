/* Userbase Automation — Pipeline Studio (API-backed) */
'use strict';

// ---------- api client ----------
async function jfetch(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch (e) { /* keep statusText */ }
    throw new Error(msg);
  }
  return r.json();
}
async function upload(url, file) {
  const fd = new FormData();
  fd.append('file', file);
  return jfetch(url, { method: 'POST', body: fd });
}
// Base path of the app as served. Locally that is "/"; behind the portal the app
// lives under "/userbase-automation/". Deriving it from the current document keeps
// every API/download URL relative to the mount point, so the same build works in
// both places (nginx strips the subpath before it reaches the backend).
const BASE = new URL('.', location.href).pathname;   // e.g. "/" or "/userbase-automation/"
const api = {
  runs: () => jfetch(`${BASE}api/runs`),
  run: id => jfetch(`${BASE}api/runs/${id}`),
  createRun: file => upload(`${BASE}api/runs`, file),
  uploadInput: (id, slot, file) => upload(`${BASE}api/runs/${id}/inputs/${slot}`, file),
  advance: id => jfetch(`${BASE}api/runs/${id}/advance`, { method: 'POST' }),
  runAll: id => jfetch(`${BASE}api/runs/${id}/run-all`, { method: 'POST' }),
  preview: (id, n, kind, page, q) =>
    jfetch(`${BASE}api/runs/${id}/stages/${n}/preview?kind=${kind}&page=${page}&q=${encodeURIComponent(q || '')}`),
  replace: (id, n, file) => upload(`${BASE}api/runs/${id}/stages/${n}/replace`, file),
  downloadUrl: (id, n, kind, fmt) => `${BASE}api/runs/${id}/stages/${n}/download?kind=${kind}&fmt=${fmt}`,
  logsUrl: id => `${BASE}api/runs/${id}/logs.zip`,
};

// ---------- state ----------
const state = {
  runId: null, manifest: null,
  viewStage: null,          // null = frontier
  previewKind: 'kept', page: 1, q: '',
  fmt: 'xlsx', busy: false,
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
    if (doneMsg) toast(doneMsg, 'good');
  } catch (e) {
    toast(e.message, 'warn');
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
  $('#pg-pill').hidden = true;
  $('#jump-latest').hidden = true;
  $('#home-btn').hidden = true;
  const panel = $('#panel');
  panel.innerHTML = '';
  const v = el('div', 'view load');
  v.appendChild(el('h2', null, 'Start a run'));
  v.appendChild(el('div', 'lead',
    'Upload the Datamart extract to begin a new pipeline run. Every stage stores its kept, removed and added rows — download or replace the working file at any point.'));
  const drops = el('div', 'drops');
  const dz = el('label', 'drop drop-lg',
    `<span class="k"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
     Upload Datamart — new run</span><span class="f">.xlsx or .csv · first sheet is used</span>`);
  const inp = el('input');
  inp.type = 'file'; inp.accept = '.xlsx,.csv';
  inp.addEventListener('change', () => {
    if (!inp.files.length) return;
    guard(async () => {
      const r = await api.createRun(inp.files[0]);
      state.runId = r.run_id;
      state.viewStage = null;
    }, 'Run created — Datamart uploaded');
  });
  dz.appendChild(inp);
  drops.appendChild(dz);
  v.appendChild(drops);
  panel.appendChild(v);

  try {
    const runs = await api.runs();
    if (runs.length) {
      v.appendChild(el('div', 'lead', ''));
      const head = el('div', null, '<h2 style="font-size:1.05rem">Past runs</h2>');
      v.appendChild(head);
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
      v.appendChild(list);
    }
  } catch (e) { /* server down: home stays usable */ }
}

// ---------- render: run ----------
function render() {
  const m = state.manifest;
  $('#metro').hidden = false;
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
    }
    if (isErr) li.classList.add('error');
    if (!entry && sm.n === frontier() && m.status !== 'complete') li.classList.add('active');
    if (sm.n === viewedStage()) li.classList.add('viewing');
    const dot = el('span', 'dot');
    dot.innerHTML = entry ? CHECK_SVG : `<span class="idx">${sm.n}</span>`;
    li.appendChild(dot);
    if (entry && entry.removed > 0) li.appendChild(el('span', 'rm-badge', `−${entry.removed}`));
    if (entry && entry.added > 0) li.appendChild(el('span', 'add-badge', `+${entry.added}`));
    const meta = el('span', 'meta',
      `<span class="name">${esc(sm.title)}</span>
       <span class="tag">${entry ? `${entry.rows.toLocaleString()} rows` : (sm.missing.length ? 'needs ' + sm.missing.map(s => SLOT_LABELS[s] || s).join(', ') : '')}</span>`);
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
    `<small>Stage ${n} of 14${entry ? '' : (n === frontier() ? ' · up next' : '')}</small>${esc(sm.title)}`);
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

  // input dropzones
  const isFrontierView = !state.viewStage || state.viewStage === frontier();
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
    const fmtSel = el('select', 'fmt-sel', '<option value="xlsx">xlsx</option><option value="csv">csv</option>');
    fmtSel.value = state.fmt;
    fmtSel.addEventListener('change', () => { state.fmt = fmtSel.value; });
    actions.appendChild(fmtSel);
    actions.appendChild(mkBtn('Download current file', () =>
      window.open(api.downloadUrl(state.runId, n, 'kept', state.fmt))));
    actions.appendChild(mkBtn('Download removed', () =>
      window.open(api.downloadUrl(state.runId, n, 'removed', state.fmt)), { disabled: entry.removed === 0 }));
    actions.appendChild(mkBtn('Download added', () =>
      window.open(api.downloadUrl(state.runId, n, 'added', state.fmt)), { disabled: entry.added === 0 }));
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
    actions.appendChild(mkBtn('Run all', () => guard(async () => {
      const r = await api.runAll(state.runId);
      state.viewStage = null;
      if (r.blocked_on) toast(`Waiting for: ${r.blocked_on.map(s => SLOT_LABELS[s] || s).join(', ')}`, 'warn');
      else toast('Pipeline complete', 'good');
    })));
    const missing = m.stage_meta.find(s => s.n === frontier());
    actions.appendChild(mkBtn('Continue ▸', () => guard(async () => {
      await api.advance(state.runId);
      state.viewStage = null;
    }, null), { primary: true, disabled: missing && missing.missing.length > 0 }));
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

// ---------- boot ----------
renderHome();
