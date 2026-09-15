import { STEPS, STAGE_HELP } from './copy.js';
import { createStudioViewer } from './viewer.js';
import { createFactoryPreview } from './factoryPreview.js';

const state = {
  step: 'start',
  env: null,
  id: '',
  displayName: '',
  pathA: '',
  pathB: '',
  validation: null,
  config: null,
  defaults: null,
  sources: { web: [], inbox: [] },
  log: [],
  manifest: null,
  running: false,
  tuneClip: 'guard',
  viewerRev: 0,
  poseLive: null,
  publish: null,
  parity: null,
  packing: false,
};

const $ = (sel) => document.querySelector(sel);
const main = () => $('#main');

async function api(path, opts) {
  const res = await fetch('/__api' + path, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  if ((res.headers.get('content-type') || '').includes('text/event-stream')) return res;
  return res.json();
}

function badge(ok, label) {
  return `<span class="badge ${ok ? 'ok' : 'bad'}">${ok ? 'ok' : 'fail'} ${label}</span>`;
}

function renderEnv() {
  const env = state.env;
  if (!env) return;
  const py = env.python || {};
  $('#env-row').innerHTML = [
    badge(py.exists && py.numpy && py.pil, 'python + numpy'),
    badge(env.meshoptimizer, 'meshoptimizer'),
    badge(!env.missingTools?.length, 'tools'),
  ].join('');
}

function renderSteps() {
  const idx = STEPS.findIndex((s) => s.id === state.step);
  $('#steps').innerHTML = STEPS.map((s, i) =>
    `<button class="${s.id === state.step ? 'on' : ''} ${i < idx ? 'done' : ''}" data-step="${s.id}">${s.label}</button>`
  ).join('');
  $('#steps').onclick = (e) => {
    const btn = e.target.closest('button');
    if (btn) go(btn.dataset.step);
  };
}

function go(step) {
  if (state.step === 'tune' && step !== 'tune') disposeStudio();
  if (state.step === 'pack' && step !== 'pack') disposeFactory();
  state.step = step;
  render();
  if (step === 'tune') mountStudio().catch(showErr);
  if (step === 'pack') mountFactoryIfReady().catch(showErr);
}

function actions(html) { return `<div class="actions">${html}</div>`; }

function screenStart() {
  const envFail = state.env && !state.env.ok;
  return `
    <h2>Start</h2>
    <p class="lede">Drop one textured GLB, or two Hitem3D exports of the same sculpt. The tool paints or splits, decimates, fists, measures, rigs, then packs the measured surface into a Three.js factory — the game never loads a .glb. Numbers decide the gates, not “looks fine”.</p>
    ${envFail ? `<div class="error">${state.env.checks.filter((c) => !c.ok).map((c) => `<div><b>${c.message}</b><div class="fix">${c.fix || ''}</div></div>`).join('')}</div>` : ''}
    <div class="row">
      <div class="card">
        <h3>New fighter</h3>
        <p>Name it, drop a textured GLB (parts file optional), and run the validator before any bake starts.</p>
        ${actions('<button class="primary" id="btn-new">New fighter</button>')}
      </div>
      <div class="card">
        <h3>Open a config</h3>
        <p>Resume a checked-in fighter. Trump is the regression baseline.</p>
        ${actions('<button class="ghost" id="btn-trump">Open Trump</button><button class="ghost" id="btn-carney">Open Carney</button>')}
      </div>
    </div>`;
}

function screenDrop() {
  const src = state.sources.web || [];
  return `
    <h2>Drop a GLB</h2>
    <p class="lede">One textured file is enough — atlas + UVs, T-pose. The tool splits Head / Torso / arms / legs. Two Hitem3D exports (textured + six named parts) still give a cleaner cut if you have them. Filenames are ignored.</p>
    <div class="grid2">
      <div>
        <label>Fighter id</label>
        <input id="fid" value="${esc(state.id)}" placeholder="carney" />
        <label>Display name</label>
        <input id="fname" value="${esc(state.displayName)}" placeholder="Carney" />
        <label>Textured GLB</label>
        <input id="pa" value="${esc(state.pathA)}" placeholder="C:\\path\\textured.glb" />
        <label>Parts GLB (optional)</label>
        <input id="pb" value="${esc(state.pathB)}" placeholder="leave empty for a solo textured file" />
        <div class="drop" id="drop">Drop one .glb, or two Hitem3D exports. Large files can also be picked from the list.</div>
        <label class="check-row"><input type="checkbox" id="skip-fists" ${state.config?.fists?.enabled === false ? 'checked' : ''}/> T-pose already has fists — skip the fist bake</label>
      </div>
      <div class="card">
        <h3>GLBs in the web folder</h3>
        <div id="src-list">${src.map((s) =>
          `<div><button class="ghost pick" data-path="${esc(s.path)}">${esc(s.name)}</button> <span class="ref">${(s.bytes/1e6).toFixed(1)} MB</span></div>`
        ).join('') || '<p class="ref">None found.</p>'}</div>
      </div>
    </div>
    ${actions('<button class="primary" id="btn-validate">Validate</button>')}`;
}

function screenReport() {
  const v = state.validation;
  if (!v) return `<h2>Validate</h2><p class="lede">Run the drop step first.</p>`;
  const rows = v.checks.map((c) => `
    <div class="check ${c.ok ? 'ok' : 'bad'}">
      <div class="tag">${c.ok ? 'pass' : 'fail'}</div>
      <div><b>${esc(c.message)}</b>${c.fix && !c.ok ? `<div class="fix">${esc(c.fix)}</div>` : ''}</div>
    </div>`).join('');
  return `
    <h2>${v.ok ? 'PASS' : 'FAIL'}</h2>
    <p class="lede">${v.ok
      ? (v.route === 'pair'
        ? 'This pair can combine. The bake is the next four minutes.'
        : 'Solo textured GLB. Split + atlas sample is seconds, not a four-minute bake.')
      : 'Fail closed — the bake will not start against a file that cannot run.'}</p>
    ${rows}
    <p class="ref">route: ${esc(v.route || 'pair')}<br>textured: ${esc(v.textured || '—')}<br>parts: ${esc(v.parts || '—')}</p>
    ${actions(v.ok
      ? '<button class="primary" id="btn-build">Build fighter</button><button class="ghost" id="btn-back-drop">Change files</button>'
      : '<button class="ghost" id="btn-back-drop">Fix the files and try again</button>')}`;
}

function screenBuild() {
  const stages = ['validate', 'bake', 'decimate', 'fists', 'measure', 'pose', 'rig'];
  const by = Object.fromEntries((state.manifest?.stages || []).map((s) => [s.name, s]));
  return `
    <h2>Build</h2>
    <p class="lede">${state.validation?.route === 'pair' || (!state.validation?.route)
      ? 'Bake is the only long stage. The bar is the python log, not a fake timer.'
      : 'Solo split samples the atlas onto six parts. Seconds. The bar is the python log.'}</p>
    ${stages.map((name) => {
      const st = by[name];
      const running = state.running && !st && name === (state.log.at(-1)?.stage || 'validate');
      const cls = st ? 'pass' : running ? 'run' : '';
      return `<div class="stage"><div class="dot ${cls}"></div><div><b>${name}</b><div class="ref">${STAGE_HELP[name] || ''}</div></div></div>`;
    }).join('')}
    <div class="log" id="log">${state.log.map((l) => esc(l.text)).join('\n')}</div>
    ${actions(state.running
      ? '<button class="primary" disabled>Running…</button>'
      : '<button class="primary" id="btn-build">Build fighter</button><button class="ghost" id="btn-review">Open review</button>')}`;
}

function viewerSrc(clip) {
  if (!state.id) return '';
  const file = `/build/${state.id}/${state.id}_rigged.glb?v=${state.viewerRev}`;
  const c = clip || state.tuneClip || 'guard';
  // The review page sizes its canvas from w/h; without them it defaults to
  // 900x1100 and overflows the iframe.
  return `/review/live/index.html?file=${encodeURIComponent(file)}&clip=${c}&az=-34&el=6&w=1100&h=558`;
}

function screenReview() {
  const gates = state.manifest?.gates || [];
  const ref = state.defaults?.reference;
  return `
    <h2>Review</h2>
    <p class="lede">Gate numbers against Trump’s shipped 150k / head-40% build. A miss is a flag — you decide. Silent auto-pass is the failure mode to avoid.</p>
    ${viewerSrc() ? `<iframe class="viewer" src="${viewerSrc()}"></iframe>` : '<p class="ref">Build first to see the fighter.</p>'}
    <table>
      <thead><tr><th>Gate</th><th>This run</th><th>Limit</th><th>Trump</th><th></th></tr></thead>
      <tbody>
        ${gates.map((g) => `<tr>
          <td>${esc(g.name)}</td>
          <td class="num">${fmt(g.value)}</td>
          <td class="num">${g.cmp || ''} ${fmt(g.threshold)}</td>
          <td class="num">${refHint(g.name, ref)}</td>
          <td class="${g.status}">${g.status}${g.fix ? `<div class="fix">${esc(g.fix)}</div>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="5">No gates yet.</td></tr>'}
      </tbody>
    </table>
    ${actions('<button class="ghost" id="btn-tune">Tune</button><button class="primary" id="btn-pack">Pack into Three.js</button>')}`;
}

function rotGet(bone, axis, fallback = 0) {
  const ops = state.config?.rig?.guard?.[bone]?.r || [];
  const hit = ops.find((o) => o[0] === axis);
  return hit ? hit[1] : fallback;
}
function rotSet(bone, axis, val) {
  const g = state.config.rig.guard;
  g[bone] = { ...(g[bone] || {}) };
  const ops = [...(g[bone].r || [])];
  const i = ops.findIndex((o) => o[0] === axis);
  if (i >= 0) ops[i] = [axis, val];
  else ops.push([axis, val]);
  g[bone].r = ops;
}

function numRow(label, id, value, step = 0.005) {
  return `<div class="num-row"><label for="${id}">${label}</label>` +
    `<input type="number" class="tune-num" id="${id}" value="${(+value).toFixed(3)}" step="${step}" /></div>`;
}

function screenTune() {
  const aim = state.config?.rig?.guard?.aim || { L: [0, 0, 0], R: [0, 0, 0] };
  return `
    <h2>Guard</h2>
    <p class="lede">Click a fist or elbow to get X/Y/Z arrows; drag an arrow to move on one axis, or type the metres. Empty drag orbits. A fist is the wrist target — the knuckles land ~10 cm further along the forearm. An elbow only has one degree of freedom once the wrist is pinned, so it is a swing angle, not a position.</p>
    <div class="tune-layout" id="tune-root">
      <div>
        <canvas id="stage" class="stage-canvas"></canvas>
        <div class="clip-bar">
          <button class="ghost" data-mode="tpose">tpose</button>
          <button class="ghost on" data-mode="guard">guard</button>
          <span class="ref" id="sel-chip">nothing selected</span>
        </div>
        <div id="pose-readout" class="pose-readout">Loading…</div>
      </div>
      <div>
        <div class="card">
          <h3>Guard numbers</h3>
          <p class="ref">Viewer metres on a 1.9 m figure: +X is the lead side, +Z is forward, Y is off the floor.</p>
          <h4>Lead fist (left)</h4>
          <div class="num-grid">
            ${numRow('x', 'aim-L-0', aim.L[0])}
            ${numRow('y', 'aim-L-1', aim.L[1])}
            ${numRow('z', 'aim-L-2', aim.L[2])}
          </div>
          <div class="slider-row">
            <input type="range" id="pole-L" min="-180" max="180" step="1" value="0" />
            <output id="pole-L-out">0°</output>
          </div>
          <p class="ref">Lead elbow swing, 0° = straight down.</p>
          <h4>Rear fist (right)</h4>
          <div class="num-grid">
            ${numRow('x', 'aim-R-0', aim.R[0])}
            ${numRow('y', 'aim-R-1', aim.R[1])}
            ${numRow('z', 'aim-R-2', aim.R[2])}
          </div>
          <div class="slider-row">
            <input type="range" id="pole-R" min="-180" max="180" step="1" value="0" />
            <output id="pole-R-out">0°</output>
          </div>
          <p class="ref">Rear elbow swing. On a wide trunk this is what keeps the elbow outside the belly.</p>
          <h4>Blade</h4>
          ${['hips', 'spine', 'chest'].map((b) => `
            <div class="slider-row">
              <input type="range" class="tune-blade" data-bone="${b}" min="-40" max="40" step="1" value="${rotGet(b, 'y')}" />
              <output id="blade-${b}-out">${rotGet(b, 'y')}°</output>
            </div>
            <p class="ref">${b} yaw</p>`).join('')}
          <p class="ref">Stacked blade <b id="blade-total">${stackedYaw(state.config?.rig?.guard)}°</b>. Past about 35° the near shoulder swings in front of the head and the guard reads as a lunge.</p>
          ${actions('<button class="ghost" id="btn-reset-pose">Reset to defaults</button>')}
        </div>
        <div class="card">
          <h3>Next</h3>
          <p>Pack the measured mesh into Three.js, then save the factory. Wrist targets stay here; packing reads this stance.</p>
          ${actions('<button class="primary" id="btn-pack">Pack into Three.js</button>')}
        </div>
      </div>
    </div>`;
}

function screenPack() {
  const p = state.parity;
  const gates = p?.gates || [];
  const core = gates.filter((g) => !String(g.name).startsWith('clip:'));
  const clipGates = gates.filter((g) => String(g.name).startsWith('clip:'));
  const clipsOk = clipGates.length && clipGates.every((g) => g.status === 'pass');
  return `
    <h2>Pack into Three.js</h2>
    <p class="lede">The GLB is a measuring stick, not the game asset. This step copies the measured verts, vertex colours, skin weights, 25-bone tree and clips into JavaScript. The game imports <code>createFighter()</code> — it never fetches a .glb. Vertex counts must match. A miss here is a bug, not a taste call.</p>
    <div class="tune-layout">
      <div class="pack-stage">
        <canvas id="factory-stage" class="factory-canvas"></canvas>
        <p class="clip-note">Clips</p>
        <div class="clip-bar pack-clips" id="pack-clips"></div>
        <p class="clip-note">Explode</p>
        <div class="slider-row">
          <input type="range" id="explode" min="0" max="100" step="1" value="0" />
          <output id="explode-out">0%</output>
        </div>
        <p class="ref">Pulls the six named parts apart (Head, Torso, arms, legs). That split is why the rig is a formula instead of Mixamo.</p>
        <div id="pack-status" class="ref">${p ? `Packed ${fmt(p.verts)} verts / ${fmt(p.tris)} tris in ${(p.ms / 1000).toFixed(1)} s` : 'Not packed yet.'}</div>
      </div>
      <div class="pack-side">
        <div class="card">
          <h3>Parity</h3>
          <p class="ref">Decoded factory versus the rigged GLB. Equal counts are required. Quantisation error is one uint16 step over the figure box (~0.03 mm on a 2 m fighter).</p>
          <table>
            <thead><tr><th>Gate</th><th>Value</th><th></th></tr></thead>
            <tbody>
              ${core.map((g) => `<tr>
                <td>${esc(g.name)}</td>
                <td class="num">${fmt(g.value)}</td>
                <td class="${g.status}">${g.status}</td>
              </tr>`).join('') || '<tr><td colspan="3">Pack to fill this table.</td></tr>'}
            </tbody>
          </table>
          ${clipGates.length ? `<details class="clip-gates"><summary>${clipGates.length} clips · ${clipsOk ? 'all pass' : 'check durations'}</summary>
            <table><tbody>${clipGates.map((g) => `<tr>
              <td>${esc(g.name.slice(5))}</td>
              <td class="num">${fmt(g.value)} s</td>
              <td class="${g.status}">${g.status}</td>
            </tr>`).join('')}</tbody></table>
          </details>` : ''}
          ${actions(state.packing
            ? '<button class="primary" disabled>Packing…</button>'
            : '<button class="primary" id="btn-encode">Pack into Three.js</button>')}
        </div>
        <div class="card">
          <h3>Use it</h3>
          <pre class="usage">import { prewarm, createFighter } from './createFighterModel.js';

await prewarm();
const { group, play, update } = createFighter();
scene.add(group);
play('idle');</pre>
          <p class="ref">Output lands in <code>web/fighter-tool/output/${esc(state.id || 'id')}/threejs/</code> when you export.</p>
          ${actions('<button class="ghost" id="btn-pubstep">Export the pack</button>')}
        </div>
      </div>
    </div>`;
}

function screenPublish() {
  const p = state.publish;
  const out = `web/fighter-tool/output/${state.id || '<id>'}/`;
  const parity = state.parity;
  return `
    <h2>Export</h2>
    <p class="lede">The deliverable is a Three.js factory. The rigged GLB stays next to it as the measurement source — do not load it in the game.</p>
    <div class="card">
      <h3>Always</h3>
      <p class="num path">${esc(out)}</p>
      <p><code>threejs/createFighterModel.js</code> + packed surface + codec. ${parity ? `${parity.verts} verts, ${parity.tris} tris, clips: ${(parity.clips || []).join(', ')}.` : 'Pack first, or export will pack for you.'}</p>
    </div>
    ${p?.practiceUrl ? `<div class="card"><h3>Also in the practice game</h3><p>${esc(p.practiceUrl)}</p></div>` : ''}
    ${actions('<button class="primary" id="btn-export">Save to output/</button><button class="ghost" id="btn-publish">Also add to practice game</button>')}
    <div id="export-status" class="ref"></div>
  `;
}

function stackedYaw(guard) {
  if (!guard) return 0;
  let y = 0;
  for (const bone of ['hips', 'spine', 'chest']) {
    for (const op of guard[bone]?.r || []) if (op[0] === 'y') y += op[1];
  }
  return y;
}

function fmt(v) {
  if (v == null || Number.isNaN(v)) return '—';
  if (typeof v !== 'number') return String(v);
  if (Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  if (Math.abs(v) > 0 && Math.abs(v) < 0.001) return v.toExponential(2);
  if (Math.abs(v) < 2) return v.toFixed(3);
  return v.toFixed(2);
}
function refHint(name, ref) {
  if (!ref) return '—';
  if (name === 'silhouetteIoU') return ref.heroIoU;
  if (name === 'headDE50') return ref.headDE50;
  if (name === 'headDE95') return ref.headDE95;
  return '—';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bindDrop() {
  const drop = $('#drop');
  if (!drop) return;
  const on = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.addEventListener('dragover', on);
  drop.addEventListener('dragenter', on);
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const files = [...e.dataTransfer.files].filter((f) => f.name.toLowerCase().endsWith('.glb'));
    if (!files.length) return;
    drop.textContent = 'Uploading…';
    const id = $('#fid').value || 'drop';
    const paths = [];
    for (const f of files.slice(0, 2)) {
      const buf = await f.arrayBuffer();
      const r = await fetch(`/__api/upload?id=${encodeURIComponent(id)}&name=${encodeURIComponent(f.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'model/gltf-binary' },
        body: buf,
      }).then((res) => res.json());
      paths.push(r.path);
    }
    if (paths[0]) $('#pa').value = paths[0];
    if (paths[1]) $('#pb').value = paths[1];
    drop.textContent = paths.length === 1
      ? 'Uploaded one GLB. Parts file is optional — validate when ready.'
      : 'Uploaded. Validate when ready.';
  });
}

function readDropFields() {
  state.id = $('#fid')?.value.trim() || state.id;
  state.displayName = $('#fname')?.value.trim() || state.displayName || state.id;
  state.pathA = $('#pa')?.value.trim() || state.pathA;
  state.pathB = $('#pb')?.value.trim() || state.pathB;
  const skip = $('#skip-fists')?.checked;
  if (state.config) state.config.fists = { ...(state.config.fists || {}), enabled: !skip };
  else if (skip) state.config = { fists: { enabled: false } };
}

async function runValidate() {
  readDropFields();
  const v = await api('/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: state.pathA, b: state.pathB }),
  });
  state.validation = v;
  if (v.ok) {
    const skipFists = $('#skip-fists')?.checked || state.config?.fists?.enabled === false;
    state.config = {
      ...(state.defaults || {}),
      ...(state.config || {}),
      id: state.id,
      displayName: state.displayName || state.id,
      source: { textured: v.textured, parts: v.parts, route: v.route || 'pair' },
      fists: { enabled: !skipFists },
    };
    await api('/config/' + state.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.config),
    });
  }
  go('report');
}

async function runBuild(from = 'validate') {
  if (!state.config) throw new Error('Validate a GLB first.');
  state.running = true;
  state.log = [];
  go('build');
  const res = await fetch('/__api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: state.config, from }),
  });
  if (!res.ok || !res.body) {
    state.running = false;
    render();
    throw new Error(`build did not start: ${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const block of parts) {
      const line = block.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const ev = JSON.parse(line.slice(6));
      state.log.push({ stage: ev.stage, text: `${ev.stage || ''} ${ev.status || ''} ${ev.message || ev.logLine || ''}`.trim() });
      if (ev.manifest) state.manifest = ev.manifest;
      const logEl = $('#log');
      if (logEl) { logEl.textContent = state.log.map((l) => l.text).join('\n'); logEl.scrollTop = logEl.scrollHeight; }
    }
  }
  state.running = false;
  state.viewerRev += 1;                 // bust the review iframe's GLB cache
  render();
}

function render() {
  renderEnv();
  renderSteps();
  const screens = { start: screenStart, drop: screenDrop, report: screenReport, build: screenBuild, review: screenReview, tune: screenTune, pack: screenPack, publish: screenPublish };
  main().innerHTML = (screens[state.step] || screenStart)();
  wire();
}

function wire() {
  $('#btn-new')?.addEventListener('click', () => go('drop'));
  $('#btn-trump')?.addEventListener('click', () => openKnown('trump'));
  $('#btn-carney')?.addEventListener('click', () => openKnown('carney'));
  $('#btn-validate')?.addEventListener('click', () => runValidate().catch(showErr));
  $('#btn-back-drop')?.addEventListener('click', () => go('drop'));
  $('#btn-build')?.addEventListener('click', () => runBuild().catch(showErr));
  $('#btn-review')?.addEventListener('click', () => go('review'));
  $('#btn-tune')?.addEventListener('click', () => go('tune'));
  $('#btn-pack')?.addEventListener('click', () => go('pack'));
  $('#btn-encode')?.addEventListener('click', () => runEncode().catch(showErr));
  $('#btn-pubstep')?.addEventListener('click', () => go('publish'));
  $('#btn-publish')?.addEventListener('click', () => runPublish().catch(showErr));
  $('#btn-export')?.addEventListener('click', () => runExport().catch(showErr));
  main().querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    studio?.setMode(b.dataset.mode);
    main().querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x.dataset.mode === b.dataset.mode));
  }));
  main().querySelectorAll('button.pick').forEach((b) => b.addEventListener('click', () => {
    if (!$('#pa').value) $('#pa').value = b.dataset.path;
    else $('#pb').value = b.dataset.path;
  }));
  bindDrop();
}

let studio = null;
let factoryPrev = null;

function disposeStudio() {
  studio?.dispose();
  studio = null;
}

function disposeFactory() {
  factoryPrev?.dispose();
  factoryPrev = null;
}

// One debounced writer. The old code fired a full re-rig -- spawning node and
// writing an 8 MB GLB -- on every drag release, which is why tuning stuttered
// and why a stray drag could persist a bad guard before you had looked at it.
// Tuning saves the numbers; the re-rig happens once, on export.
let saveTimer = null;
function saveRig() {
  if (!state.config || !state.id) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/live-tune', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.id, rig: state.config.rig, rerig: false }),
    }).then((r) => { state.poseLive = r.pose; }).catch(showErr);
  }, 350);
}

function syncTunePanel() {
  const d = studio?.describe?.();
  if (!d) return;
  for (const side of ['L', 'R']) {
    for (let k = 0; k < 3; k++) {
      const el = $(`#aim-${side}-${k}`);
      if (el && document.activeElement !== el) el.value = d.aim[side][k].toFixed(3);
    }
    const p = $(`#pole-${side}`), o = $(`#pole-${side}-out`);
    const deg = Math.round(d.poleAngle[side]);
    if (p && document.activeElement !== p) p.value = deg;
    if (o) o.textContent = `${deg}°`;
  }
  const chip = $('#sel-chip');
  if (chip) chip.textContent = d.selected ? `selected: ${d.selected}` : 'nothing selected';
  for (const bone of ['hips', 'spine', 'chest']) {
    const el = main().querySelector(`.tune-blade[data-bone="${bone}"]`);
    const deg = rotGet(bone, 'y');
    if (el && document.activeElement !== el) el.value = deg;
    const o = $(`#blade-${bone}-out`);
    if (o) o.textContent = `${deg}°`;
  }
  const total = $('#blade-total');
  if (total) total.textContent = `${stackedYaw(state.config?.rig?.guard)}°`;
}

function wireTunePanel() {
  if (!studio) return;
  main().querySelectorAll('.tune-num').forEach((el) => {
    el.addEventListener('change', () => {
      const [, side, k] = el.id.split('-');
      const v = parseFloat(el.value);
      if (Number.isFinite(v)) studio.setAim(side, +k, v);
    });
  });
  for (const side of ['L', 'R']) {
    $(`#pole-${side}`)?.addEventListener('input', (e) => {
      $(`#pole-${side}-out`).textContent = `${e.target.value}°`;
      studio.setPoleAngle(side, parseFloat(e.target.value));
    });
  }
  main().querySelectorAll('.tune-blade').forEach((el) => {
    el.addEventListener('input', () => {
      const bone = el.dataset.bone, v = parseFloat(el.value);
      $(`#blade-${bone}-out`).textContent = `${v}°`;
      rotSet(bone, 'y', v);
      studio.setGuardRot(bone, 'y', v);
    });
  });
  $('#btn-reset-pose')?.addEventListener('click', () => {
    const d = state.defaults?.rig;
    if (!d) return;
    studio.apply((o) => {
      o.aimOffset = [...(d.aimOffset || [0, 0, 0])];
      o.elbowPole = JSON.parse(JSON.stringify(d.elbowPole));
      o.guard = JSON.parse(JSON.stringify(d.guard));
    });
    syncTunePanel();
  });
}

async function mountStudio() {
  const canvas = $('#stage');
  if (!canvas || !state.id) return;
  disposeStudio();
  const joints = await api(`/build/${state.id}/${state.id}_joints.json`);
  studio = createStudioViewer(canvas, {
    onSelect: syncTunePanel,
    onReadout: (r) => {
      const box = $('#pose-readout');
      if (!box) return;
      const arm = (name, a) =>
        `${name} ${a.vsChin >= 0 ? '+' : ''}${a.vsChin.toFixed(2)} vs chin, ` +
        `${a.fwd.toFixed(2)} m fwd, x ${a.x >= 0 ? '+' : ''}${a.x.toFixed(2)}, ` +
        `${(a.extend * 100).toFixed(0)}% extended` +
        (a.clamped ? ' <span class="flag">at full reach — the arm cannot go further</span>' : '');
      box.innerHTML = [
        arm('lead fist', r.fistL),
        arm('rear fist', r.fistR),
        `trunk clearance ${r.worst >= 0 ? '+' : ''}${r.worst.toFixed(3)} m` +
          (r.worst >= -0.03 ? '' : ' <span class="flag">inside the body</span>'),
      ].join('\n');
      syncTunePanel();
    },
    onChange: (opts) => {
      if (!state.config) return;
      state.config.rig = { ...state.config.rig, ...opts };
      syncTunePanel();
      saveRig();
    },
  });
  await studio.load({
    glbUrl: `/build/${state.id}/${state.id}_rigged.glb`,
    joints,
    rigOpts: state.config.rig,
  });
  wireTunePanel();
  syncTunePanel();
}

function factoryModuleUrl() {
  return `/build/${state.id}/threejs/createFighterModel.js?v=${state.viewerRev}`;
}

async function mountFactoryIfReady() {
  if (!state.id || !$('#factory-stage')) return;
  if (!state.parity) {
    try { state.parity = await api(`/build/${state.id}/threejs/parity.json`); }
    catch { return; }
    render();
  }
  const canvas = $('#factory-stage');
  if (!canvas || !state.parity) return;
  disposeFactory();
  factoryPrev = createFactoryPreview(canvas);
  await factoryPrev.load(factoryModuleUrl());
  const bar = $('#pack-clips');
  if (bar) {
    const names = factoryPrev.clips();
    bar.innerHTML = names.map((n) => `<button class="ghost" data-clip="${esc(n)}">${esc(n)}</button>`).join('');
    bar.querySelectorAll('[data-clip]').forEach((b) => b.addEventListener('click', () => {
      factoryPrev.play(b.dataset.clip);
      bar.querySelectorAll('[data-clip]').forEach((x) => x.classList.toggle('on', x === b));
    }));
  }
  $('#explode')?.addEventListener('input', (e) => {
    const t = parseFloat(e.target.value) / 100;
    $('#explode-out').textContent = `${e.target.value}%`;
    factoryPrev.explode(t);
  });
}

async function runEncode() {
  if (!state.config) throw new Error('Build a character first.');
  disposeFactory();
  state.packing = true;
  render();
  const el = $('#pack-status');
  if (el) el.textContent = 'Re-rigging with the tuned guard, then packing…';
  try {
    state.parity = await api('/encode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: state.config, id: state.id, rerig: true }),
    });
    state.viewerRev += 1;
  } finally {
    state.packing = false;
  }
  render();
  await mountFactoryIfReady();
}

async function runExport() {
  if (!state.config) throw new Error('Build a character first.');
  const el0 = $('#export-status');
  if (el0) el0.textContent = 'Re-rigging with the tuned guard…';
  // Tuning only writes numbers. The GLB is rebuilt here, once, so what lands in
  // output/ is the stance on screen and not whatever the last build produced.
  await api('/live-tune', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: state.id, rig: state.config.rig, rerig: true }),
  });
  const result = await api('/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: state.config, id: state.id }),
  });
  state.viewerRev += 1;
  const el = $('#export-status');
  if (el) el.textContent = `Wrote ${result.destDir} (Three.js factory)`;
  state.publish = { ...state.publish, outputDir: result.destDir };
  if (result.parity) state.parity = result.parity;
}

async function runPublish() {
  // Same reason as runExport: tuning writes numbers, not geometry.
  await api('/live-tune', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: state.id, rig: state.config?.rig, rerig: true }),
  });
  state.viewerRev += 1;
  state.publish = await api('/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: state.config, id: state.id }),
  });
  render();
}

async function openKnown(id) {
  try {
    state.config = await api('/config/' + id);
    state.id = state.config.id;
    state.displayName = state.config.displayName;
    state.pathA = state.config.source?.textured || '';
    state.pathB = state.config.source?.parts || '';
    go('drop');
  } catch {
    state.id = id;
    state.displayName = id[0].toUpperCase() + id.slice(1);
    go('drop');
  }
}

function showErr(err) {
  main().insertAdjacentHTML('afterbegin', `<div class="error">${esc(err.message)}</div>`);
}

async function boot() {
  try {
    state.env = await api('/env');
    state.defaults = await api('/defaults');
    state.sources = await api('/sources');
  } catch (err) {
    $('#env-row').innerHTML = badge(false, err.message);
  }
  render();
}

boot();
