import './vfxStudio.css';
import * as THREE from './vendor/three.module.js';
import { ModelVfx } from './render/modelVfx.js';
import { VFX_PRESETS } from './render/vfxPresets.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'bfi-vfx-studio-v1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const events = new AbortController();
const on = (target, name, callback, options = {}) => target.addEventListener(name, callback, { ...options, signal: events.signal });
const descriptions = {
  fireball: ['A concentrated shot of heat.', 'Projectile', '#ff7844'],
  laser: ['A clean line of pure energy.', 'Energy beam', '#75dbef'],
  shield: ['A little space to stand your ground.', 'Protection', '#b4a2ff'],
  appearance: ['Give every entrance a moment.', 'Arrival', '#9ee5a6'],
  burst: ['The finishing touch to a big hit.', 'Impact', '#ffe5ad'],
};
const icons = {
  fireball: '<path d="M12 29C7 22 16 12 21 9c-1 6 3 8 5 4 10 9 8 22-3 24-7 1-12-3-11-8Z" fill="currentColor" opacity=".22"/><path d="M17 29c-1-5 6-7 5-12 9 8 9 15 2 17-4 1-7-1-7-5Z" fill="currentColor"/><path d="m8 12-3-3m7 7-7-1m12-9-1-3" stroke="currentColor" stroke-width="1.3"/>',
  laser: '<path d="M5 29 36 14" stroke="currentColor" stroke-width="10" opacity=".12"/><path d="M5 29 36 14" stroke="currentColor" stroke-width="4" opacity=".6"/><path d="M5 29 36 14" stroke="#e6fcff" stroke-width="1.5"/><path d="m28 13 7-5m-1 13 5 1M9 21l-4-2" stroke="currentColor" stroke-width="1.2"/>',
  shield: '<path d="m22 5 14 6v12c-1 8-8 12-14 16-6-4-13-8-14-16V11Z" fill="currentColor" opacity=".09" stroke="currentColor" stroke-width="2"/><path d="m22 10 10 4v9c-1 5-5 9-10 12-5-3-9-7-10-12v-9Z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="m16 22 4 4 8-9" fill="none" stroke="currentColor" stroke-width="2"/>',
  appearance: '<ellipse cx="22" cy="35" rx="15" ry="4" fill="none" stroke="currentColor" opacity=".7"/><path d="M14 6v26m8-30v35M30 6v26" stroke="currentColor" stroke-width="2" opacity=".8"/><path d="M10 12v14M34 12v14" stroke="currentColor" opacity=".3"/><path d="m22 8-5 8m5-8 5 8" fill="none" stroke="currentColor"/>',
  burst: '<path d="m22 5 3 11 10-7-5 12 11 3-12 4 4 11-10-8-7 10 1-13-13-1 12-6-6-10 11 6Z" fill="currentColor" opacity=".24"/><path d="m22 12 2 9 9 2-9 3-3 9-1-10-9-3 9-1Z" fill="currentColor"/><path d="m8 7 4 4m22 21 4 3m-4-28 3-4" stroke="currentColor"/>',
};
const ids = Object.keys(descriptions).filter(id => VFX_PRESETS[id]);
const settingsKeys = ['size', 'color', 'glow', 'opacity', 'duration', 'speed', 'delay', 'yaw', 'tilt'];
let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { /* Private browsing still supports a complete preview. */ }
if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
let selected = ids.includes(saved.selected) ? saved.selected : ids[0];
let settings = {}, effects, renderer, scene, camera, ready = false, playing = !reducedMotion, elapsed = 0, generation = 0;
let animationFrame, lastTime = 0, lastStats = '', replayTimer, disposed = false, finished = false, currentHandle = null;
const cards = new Map();
const target = new THREE.Vector3(0, 1.15, 0);
const spherical = new THREE.Spherical(8.2, 1.18, .40);
const offset = new THREE.Vector3();

function normalizeColor(value, fallback = '#ff7844') {
  try { return `#${new THREE.Color(value ?? fallback).getHexString()}`; } catch { return fallback; }
}
function defaults(id) {
  const preset = VFX_PRESETS[id];
  return { size: 2, color: normalizeColor(preset.color, descriptions[id][2]), glow: preset.glow ?? 1,
    opacity: preset.opacity ?? 1, duration: 2, speed: 1, delay: 0, yaw: 0, tilt: 0 };
}
function sanitize(value, fallback) {
  const result = { ...fallback };
  for (const key of settingsKeys) {
    const input = $(key);
    if (key === 'color') { if (/^#[0-9a-f]{6}$/i.test(value?.color)) result.color = value.color; continue; }
    const number = Number(value?.[key]);
    if (value?.[key] != null && Number.isFinite(number)) result[key] = Math.min(Number(input.max), Math.max(Number(input.min), number));
  }
  return result;
}
function runtimeOptions() {
  const rotation = [...(VFX_PRESETS[selected].rotation || [0, 0, 0])];
  rotation[0] += THREE.MathUtils.degToRad(settings.tilt);
  rotation[1] += THREE.MathUtils.degToRad(settings.yaw);
  return { x: 0, y: 1.15, z: 0, size: settings.size, color: settings.color, glow: settings.glow,
    opacity: settings.opacity, duration: settings.duration, speed: settings.speed, delay: settings.delay, rotation };
}
function exportPreset() {
  const { x, y, z, ...options } = runtimeOptions();
  return JSON.stringify({ effect: selected, ...options }, null, 2);
}
function saveSettings() {
  saved.selected = selected;
  saved[selected] = { ...settings };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); $('save-status').textContent = 'Settings saved on this device.'; }
  catch { $('save-status').textContent = 'Copy your preset to keep these settings.'; }
}
function syncControls() {
  for (const key of settingsKeys) {
    $(key).value = settings[key];
    const value = settings[key];
    const format = key === 'color' ? value.toUpperCase() : key === 'opacity' ? `${Math.round(value * 100)}%` : key === 'yaw' || key === 'tilt' ? `${value}°` : `${value.toFixed(2)}${key === 'size' ? ' m' : key === 'glow' || key === 'speed' ? '×' : ' s'}`;
    $(`${key}-output`).textContent = format;
    if (key !== 'color') {
      const ratio = (value - Number($(key).min)) / (Number($(key).max) - Number($(key).min));
      $(key).style.background = `linear-gradient(to right, #ab8b70 ${ratio * 100}%, #3a4a50 ${ratio * 100}%)`;
    }
  }
  document.querySelectorAll('[data-color]').forEach(button => {
    const active = button.dataset.color === settings.color;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('preset-json').value = exportPreset();
}
function setMessage(message, error = false) {
  $('stage-message').hidden = !message;
  $('stage-message').textContent = message;
  $('stage-message').classList.toggle('error', error);
}
function setPlaying(value) {
  playing = value;
  $('play-label').textContent = playing ? 'Pause' : 'Play';
  $('play-icon').textContent = playing ? 'Ⅱ' : '▶';
  $('play-toggle').setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview');
  updateTimeline();
}
function totalTime() { return settings.delay + settings.duration / settings.speed; }
function updateTimeline() {
  const total = totalTime();
  const progress = Math.min(1, elapsed / total);
  $('time-output').textContent = `${Math.min(elapsed, total).toFixed(2)} / ${total.toFixed(2)} s`;
  $('timeline-fill').style.width = `${progress * 100}%`;
  $('preview-position').value = String(progress);
  $('preview-position').setAttribute('aria-valuetext', `${Math.min(elapsed, total).toFixed(2)} of ${total.toFixed(2)} seconds`);
  const state = !ready ? 'Loading' : finished ? 'Complete' : !playing ? 'Paused' : elapsed < settings.delay ? 'Waiting' : 'Playing';
  $('stage-state').textContent = state;
  $('playback-label').textContent = state === 'Waiting' ? 'Start delay' : finished && $('loop').checked ? 'Next take coming up' : `${state} · preview playback`;
}
function replay({ resume = true } = {}) {
  clearTimeout(replayTimer);
  if (!ready || !effects) return;
  effects.clear();
  elapsed = 0;
  finished = false;
  if (resume) setPlaying(true);
  currentHandle = effects.spawn(selected, runtimeOptions());
  if (!currentHandle) { setMessage('This effect could not start. Select another effect and try again.', true); return; }
  setMessage('');
  // A representative still makes paused tuning useful even for arrival clips
  // whose authored first frames are intentionally invisible.
  if (!playing) { currentHandle.seek(.32); elapsed = settings.delay + settings.duration / settings.speed * .32; }
  updateTimeline();
}
function scrubPreview(fraction) {
  if (!ready) return;
  clearTimeout(replayTimer);
  effects.clear();
  currentHandle = effects.spawn(selected, runtimeOptions());
  if (!currentHandle) return;
  elapsed = THREE.MathUtils.clamp(fraction, 0, 1) * totalTime();
  if (elapsed < settings.delay) effects.update(elapsed);
  else currentHandle.seek((elapsed - settings.delay) / (settings.duration / settings.speed));
  finished = elapsed >= totalTime();
  setPlaying(false);
  setMessage('');
}
async function chooseEffect(id) {
  const request = ++generation;
  clearTimeout(replayTimer);
  ready = false;
  lastStats = '';
  currentHandle = null;
  effects?.clear();
  selected = id;
  settings = sanitize(saved[id], defaults(id));
  cards.forEach((button, key) => button.setAttribute('aria-pressed', String(key === id)));
  $('effect-title').textContent = VFX_PRESETS[id].label;
  $('effect-description').textContent = descriptions[id][0];
  $('play-toggle').disabled = true;
  $('replay').disabled = true;
  $('preview-position').disabled = true;
  elapsed = 0;
  finished = false;
  syncControls();
  saveSettings();
  updateTimeline();
  setMessage(`Preparing ${VFX_PRESETS[id].label.toLowerCase()}…`);
  $('load-status').textContent = 'Loading selected effect…';
  try {
    await effects.preload([id]);
    if (request !== generation || disposed) return;
    if (effects.errors?.has(id) || effects.errors?.has(VFX_PRESETS[id].asset)) throw new Error('The selected effect failed to load.');
    ready = true;
    $('play-toggle').disabled = false;
    $('replay').disabled = false;
    $('preview-position').disabled = false;
    replay({ resume: playing });
    if (reducedMotion && !playing) $('load-status').textContent = 'Ready · press Play to preview';
  } catch (error) {
    if (request !== generation || disposed) return;
    setMessage('This effect could not load. Try another effect, or reload the page.', true);
    $('stage-state').textContent = 'Unavailable';
    $('load-status').textContent = 'Selected effect unavailable';
    console.warn('Effect preview unavailable:', error);
  }
}
for (const [index, id] of ids.entries()) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'effect-card';
  button.setAttribute('aria-pressed', String(id === selected));
  button.style.setProperty('--effect-color', descriptions[id][2]);
  button.innerHTML = `<span class="asset-icon" aria-hidden="true"><svg viewBox="0 0 44 44" fill="none">${icons[id]}</svg></span><span class="card-copy"><strong></strong><small></small></span><span class="card-index" aria-hidden="true">0${index + 1}</span>`;
  button.querySelector('strong').textContent = VFX_PRESETS[id].label;
  button.querySelector('small').textContent = descriptions[id][1];
  on(button, 'click', () => { if (effects) chooseEffect(id); });
  $('effect-library').append(button);
  cards.set(id, button);
}

function applyCamera() {
  offset.setFromSpherical(spherical).multiplyScalar(Math.max(1, .95 / camera.aspect));
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
}
function setCamera(view) {
  spherical.set(8.2, view === 'front' ? Math.PI / 2 - .06 : 1.18, view === 'front' ? 0 : .40);
  $('camera-perspective').classList.toggle('selected', view !== 'front');
  $('camera-front').classList.toggle('selected', view === 'front');
  $('camera-perspective').setAttribute('aria-pressed', String(view !== 'front'));
  $('camera-front').setAttribute('aria-pressed', String(view === 'front'));
  applyCamera();
}
function addReference() {
  const reference = new THREE.Group();
  reference.position.set(-1.8, 0, -.35);
  const material = new THREE.MeshStandardMaterial({ color: 0x53686c, metalness: .15, roughness: .8, transparent: true, opacity: .52 });
  const part = (geometry, x, y, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    reference.add(mesh);
    return mesh;
  };
  part(new THREE.SphereGeometry(.12, 20, 16), 0, 1.68);
  part(new THREE.CylinderGeometry(.23, .15, .48, 12), 0, 1.25);
  part(new THREE.SphereGeometry(.18, 16, 12), 0, .96).scale.set(1, .65, .65);
  for (const direction of [-1, 1]) {
    part(new THREE.CylinderGeometry(.07, .06, .76, 10), direction * .11, .5).rotation.z = direction * -.035;
    part(new THREE.CylinderGeometry(.06, .045, .62, 10), direction * .29, 1.16).rotation.z = direction * .14;
    part(new THREE.BoxGeometry(.12, .08, .24), direction * .12, .06, .045);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(.44, .448, 64), new THREE.MeshBasicMaterial({ color: 0x5c858d, transparent: true, opacity: .65, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .011;
  reference.add(ring);
  scene.add(reference);
}

async function start() {
  renderer = new THREE.WebGLRenderer({ canvas: $('effect-canvas'), antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x132128, 0);
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x17272e, .065);
  camera = new THREE.PerspectiveCamera(37, 1, .05, 70);
  scene.add(new THREE.HemisphereLight(0xd7eeed, 0x162326, 2.1));
  const key = new THREE.DirectionalLight(0xdce8e2, 2.8);
  key.position.set(3, 6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x789faf, 3);
  rim.position.set(-4, 3, -2);
  scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshStandardMaterial({ color: 0x182a30, roughness: 1, transparent: true, opacity: .42 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -.025;
  scene.add(floor);
  const grid = new THREE.GridHelper(18, 36, 0x52717a, 0x34515b);
  grid.material.transparent = true;
  grid.material.opacity = .38;
  scene.add(grid);
  const pad = new THREE.Mesh(new THREE.RingGeometry(1.28, 1.293, 96), new THREE.MeshBasicMaterial({ color: 0x8da79a, transparent: true, opacity: .4, side: THREE.DoubleSide }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = .006;
  scene.add(pad);
  addReference();
  effects = new ModelVfx(scene, { assetBase: import.meta.env.BASE_URL, quality: 1, reducedMotion });
  const resize = () => {
    const { width, height } = $('viewport').getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    applyCamera();
  };
  const observer = new ResizeObserver(resize);
  observer.observe($('viewport'));
  resize();
  on($('camera-front'), 'click', () => setCamera('front'));
  on($('camera-perspective'), 'click', () => setCamera('perspective'));
  on($('camera-reset'), 'click', () => setCamera('perspective'));
  let drag;
  on($('effect-canvas'), 'pointerdown', event => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
    $('effect-canvas').setPointerCapture(event.pointerId);
  });
  on($('effect-canvas'), 'pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    spherical.theta -= (event.clientX - drag.x) * .006;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - (event.clientY - drag.y) * .006, .25, Math.PI / 2 + .12);
    drag.x = event.clientX;
    drag.y = event.clientY;
    $('camera-perspective').classList.remove('selected');
    $('camera-front').classList.remove('selected');
    $('camera-perspective').setAttribute('aria-pressed', 'false');
    $('camera-front').setAttribute('aria-pressed', 'false');
    applyCamera();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) on($('effect-canvas'), name, () => { drag = null; });
  on($('effect-canvas'), 'wheel', event => {
    event.preventDefault();
    spherical.radius = THREE.MathUtils.clamp(spherical.radius * Math.exp(event.deltaY * .001), 3.5, 15);
    applyCamera();
  }, { passive: false });
  on($('effect-canvas'), 'keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '='].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowLeft') spherical.theta -= .12;
    if (event.key === 'ArrowRight') spherical.theta += .12;
    if (event.key === 'ArrowUp') spherical.phi -= .08;
    if (event.key === 'ArrowDown') spherical.phi += .08;
    if (event.key === '+' || event.key === '=') spherical.radius -= .4;
    if (event.key === '-') spherical.radius += .4;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, .25, Math.PI / 2 + .12);
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, 3.5, 15);
    applyCamera();
  });
  function frame(now) {
    if (disposed) return;
    const dt = Math.min((now - (lastTime || now)) / 1000, .05);
    lastTime = now;
    if (ready && playing && !document.hidden) {
      effects.update(dt);
      elapsed += dt;
      finished = elapsed >= totalTime();
      if (finished && $('loop').checked && elapsed >= totalTime() + .55) replay({ resume: false });
      else if (finished && !$('loop').checked) setPlaying(false);
      updateTimeline();
    }
    const stats = effects.stats;
    const status = `${stats.loaded} of ${ids.length} effects ready · ${stats.active} on stage`;
    if (ready && status !== lastStats) { $('load-status').textContent = status; lastStats = status; }
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(frame);
  }
  animationFrame = requestAnimationFrame(frame);
  on(window, 'pagehide', event => {
    if (event.persisted) return;
    disposed = true;
    generation++;
    clearTimeout(replayTimer);
    cancelAnimationFrame(animationFrame);
    observer.disconnect();
    effects.dispose();
    const geometries = new Set(), materials = new Set();
    scene.traverse(node => { if (node.geometry) geometries.add(node.geometry); if (node.material) for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material); });
    geometries.forEach(value => value.dispose());
    materials.forEach(value => value.dispose());
    renderer.dispose();
    events.abort();
  });
  await chooseEffect(selected);
}

for (const key of settingsKeys) on($(key), 'input', () => {
  settings[key] = key === 'color' ? $(key).value : Number($(key).value);
  syncControls();
  saveSettings();
  clearTimeout(replayTimer);
  replayTimer = setTimeout(() => replay({ resume: playing }), 90);
});
document.querySelectorAll('[data-color]').forEach(button => on(button, 'click', () => {
  settings.color = button.dataset.color;
  syncControls();
  saveSettings();
  replay({ resume: playing });
}));
on($('reset-preset'), 'click', () => {
  settings = defaults(selected);
  syncControls();
  saveSettings();
  replay({ resume: playing });
});
function togglePlayback() {
  if (!ready) return;
  if (!playing && finished) replay();
  else setPlaying(!playing);
}
on($('play-toggle'), 'click', togglePlayback);
on($('replay'), 'click', () => replay());
on($('preview-position'), 'input', () => scrubPreview(Number($('preview-position').value)));
on($('loop'), 'change', () => { if ($('loop').checked && finished) replay(); });
on(document, 'keydown', event => {
  if (event.code !== 'Space' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest('input, textarea, select, button, summary, a, [contenteditable="true"]')) return;
  event.preventDefault();
  togglePlayback();
});
on(document, 'visibilitychange', () => { lastTime = 0; });
on($('copy-preset'), 'click', async () => {
  $('preset-json').value = exportPreset();
  try {
    await navigator.clipboard.writeText($('preset-json').value);
    $('save-status').textContent = 'Preset copied. Ready to reuse.';
  } catch {
    $('preset-export').open = true;
    $('preset-json').focus();
    $('preset-json').select();
    $('save-status').textContent = 'Select and copy the preset below.';
  }
});
if (reducedMotion) $('loop').checked = false;
settings = sanitize(saved[selected], defaults(selected));
syncControls();
setPlaying(playing);
start().catch(error => {
  console.warn('Effects studio unavailable:', error);
  setMessage('The 3D preview could not start. Reload the page with WebGL enabled to try again.', true);
  $('stage-state').textContent = 'Unavailable';
  $('load-status').textContent = '3D preview unavailable';
  $('play-toggle').disabled = true;
  $('replay').disabled = true;
});
