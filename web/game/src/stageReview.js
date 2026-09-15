// Local artist review only. This entry deliberately stays outside Vite's
// production inputs; the scene, stage reactions and weapon renderer are shared
// with the match so the review cannot silently become a different environment.
if (import.meta.env.DEV) {
  startReview().catch(error => {
    console.error('Lake America review failed', error);
    const loading = document.querySelector('#loading');
    loading.hidden = false;
    loading.classList.add('error');
    loading.textContent = 'Lake America could not load. Check the local development server and reload.';
  });
} else {
  document.querySelector('#loading').textContent = 'Stage review is available on the local development server.';
  document.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
}

async function startReview() {
  const [THREE, { Stage }, { PostFx }, { WeaponView }, { Match, PHASE }, { PHYSICS, BODY, STAGE_AXE_ZONE }] = await Promise.all([
    import('./vendor/three.module.js'),
    import('./render/stage.js'),
    import('./render/postfx.js'),
    import('./render/weapons.js'),
    import('./engine/match.js'),
    import('./engine/frameData.js'),
  ]);
  const $ = id => document.getElementById(id);
  const canvas = $('stage-canvas'), viewport = $('viewport');
  const events = new AbortController();
  const on = (element, name, callback, options = {}) => element.addEventListener(name, callback, { ...options, signal: events.signal });
  let reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let paused = false, ready = false, disposed = false, demoRunning = false, demoTicks = 0, demoClock = 0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.13;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .05, 850);
  const stage = new Stage(scene, { id: 'lake-america', reducedMotion });
  const postfx = new PostFx(renderer, scene, camera, { reducedMotion, grade: 'lakeAmerica' });
  const weapons = new WeaponView(scene, stage);
  const authoredFog = scene.fog;
  const target = new THREE.Vector3();
  const spherical = new THREE.Spherical();
  const offset = new THREE.Vector3();
  const presets = [
    { id: 'combat', label: 'Combat', title: 'Combat camera', position: [0, 2.24, 8.2], target: [0, 1.46, 0], fov: 33 },
    { id: 'orbit', label: 'Three-quarter', title: 'Three-quarter · island depth', position: [13, 5, 14], target: [0, 1, -2] },
    { id: 'reverse', label: 'Reverse', title: 'Reverse · the far shore', position: [0, 3.2, -14], target: [0, 1, 1] },
    { id: 'aerial', label: 'Aerial', title: 'Aerial · the whole island', position: [34, 40, 38], target: [0, 0, -2], fov: 46 },
    { id: 'shore', label: 'Shoreline', title: 'Shoreline · water and rock', position: [26, 3.5, 22], target: [13, .6, -2] },
    { id: 'axe', label: 'Axe station', title: 'Axe station · pickup detail', position: [-4.6, 1.6, 3.4], target: [-5, .65, -.8], fov: 36 },
  ];
  const presetButtons = new Map();
  let activePreset = 'combat';
  function applyCamera() {
    // Keep the same composition on narrow review panes without cropping the
    // entire playable lane off-screen.
    offset.setFromSpherical(spherical).multiplyScalar(Math.max(1, 1.25 / camera.aspect));
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
  }
  function selectPreset(id) {
    const preset = presets.find(value => value.id === id) || presets[0];
    activePreset = preset.id;
    target.fromArray(preset.target);
    spherical.setFromVector3(offset.fromArray(preset.position).sub(target));
    camera.fov = preset.fov || 38;
    camera.updateProjectionMatrix();
    $('view-name').textContent = preset.title;
    presetButtons.forEach((button, key) => button.setAttribute('aria-pressed', String(key === preset.id)));
    applyCamera();
  }
  function markFreeCamera() {
    activePreset = null;
    $('view-name').textContent = 'Free camera';
    presetButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
  }
  for (const preset of presets) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = preset.label; button.setAttribute('aria-pressed', 'false');
    on(button, 'click', () => selectPreset(preset.id));
    $('camera-presets').append(button); presetButtons.set(preset.id, button);
  }
  function resize() {
    const width = viewport.clientWidth, height = viewport.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false); postfx.setSize(width, height);
    camera.aspect = width / height; camera.updateProjectionMatrix(); applyCamera();
  }
  selectPreset(new URLSearchParams(location.search).get('camera'));
  const observer = new ResizeObserver(resize); observer.observe(viewport); resize();

  // Debug overlays use simulation dimensions. They never enter the stage GLB.
  const guides = new THREE.Group(); guides.name = 'Review only · combat dimensions'; guides.visible = false; scene.add(guides);
  const lineMaterial = new THREE.LineBasicMaterial({ color: '#a4e9ff', transparent: true, opacity: .7, depthTest: false });
  function line(points, material = lineMaterial) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point)));
    const object = new THREE.Line(geometry, material); object.renderOrder = 100; guides.add(object); return object;
  }
  const low = PHYSICS.arenaMin, high = PHYSICS.arenaMax;
  line([[low, .035, -.45], [high, .035, -.45], [high, .035, .45], [low, .035, .45], [low, .035, -.45]]);
  for (const x of [low, high]) line([[x, .035, 0], [x, BODY.standTop, 0]]);
  for (const x of [-PHYSICS.startSeparation / 2, PHYSICS.startSeparation / 2]) {
    const helper = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(x - BODY.pushWidth / 2, 0, -.2), new THREE.Vector3(x + BODY.pushWidth / 2, BODY.standTop, .2)), '#d0eaff');
    helper.material.transparent = true; helper.material.opacity = .6; helper.material.depthTest = false; helper.renderOrder = 100; guides.add(helper);
  }
  const axeGuideMaterial = new THREE.LineBasicMaterial({ color: '#ffcc87', transparent: true, opacity: .9, depthTest: false });
  const zoneX = STAGE_AXE_ZONE.x, zoneR = STAGE_AXE_ZONE.reach;
  line([[zoneX - zoneR, .05, -.65], [zoneX + zoneR, .05, -.65], [zoneX + zoneR, .05, .65], [zoneX - zoneR, .05, .65], [zoneX - zoneR, .05, -.65]], axeGuideMaterial);
  on($('guides'), 'change', event => { guides.visible = event.target.checked; });

  let reviewMatch;
  function resetRound() {
    weapons.clear(); stage.resetRound();
    reviewMatch = new Match({ left: { id: 'carney' }, right: { id: 'officer_flock' }, stageId: 'lake-america', hazards: false });
    reviewMatch.phase = PHASE.FIGHT;
    reviewMatch.left.state = reviewMatch.right.state = 'idle';
    reviewMatch.left.x = STAGE_AXE_ZONE.x; reviewMatch.right.x = 1.8;
    demoRunning = false; demoTicks = 0; demoClock = 0;
    $('throw-axe').disabled = !ready || !stage.group.getObjectByName('lake-america-axe');
    $('axe-state').textContent = stage.group.getObjectByName('lake-america-axe') ? 'READY' : 'MISSING';
    $('axe-note').textContent = 'Preview uses the game’s actual throw timing and projectile.';
    weapons.update(reviewMatch.snapshot(), 0);
  }
  function setPaused(value) {
    paused = value;
    $('pause').textContent = paused ? 'Resume scene' : 'Pause scene';
    $('pause').setAttribute('aria-pressed', String(paused));
  }
  on($('pause'), 'click', () => setPaused(!paused));
  $('reduced-motion').checked = reducedMotion; $('orbit').disabled = reducedMotion;
  on($('reduced-motion'), 'change', event => {
    reducedMotion = event.target.checked; stage.reducedMotion = postfx.reducedMotion = reducedMotion;
    stage.environment?.update(0);
    $('orbit').disabled = reducedMotion;
    if (reducedMotion) $('orbit').checked = false;
  });
  on($('fog'), 'change', event => { scene.fog = event.target.checked ? authoredFog : null; });
  on($('grade'), 'change', event => postfx.setGrade(event.target.checked ? 'lakeAmerica' : 'neutral'));
  on($('exposure'), 'input', event => {
    renderer.toneMappingExposure = Number(event.target.value);
    $('exposure-value').value = renderer.toneMappingExposure.toFixed(2);
  });
  const wireMaterials = new Map();
  on($('wireframe'), 'change', event => {
    stage.group.traverse(object => {
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        if (!material?.isMeshStandardMaterial) continue;
        if (!wireMaterials.has(material)) wireMaterials.set(material, material.wireframe);
        material.wireframe = event.target.checked || wireMaterials.get(material);
      }
    });
  });
  let impactSide = -1;
  on($('impact'), 'click', () => {
    impactSide *= -1;
    stage.impact({ type: 'hit', x: impactSide * 1.4, y: .7, bloodScale: 2.7 }, { type: 'blunt', power: 2.7 });
  });
  on($('reset'), 'click', resetRound);
  on($('throw-axe'), 'click', () => {
    resetRound(); setPaused(false); selectPreset('combat');
    // Input passes through Match.step, including startup, consumption, hitstop
    // and projectile motion. No special review-only toss implementation.
    demoRunning = true;
    $('throw-axe').disabled = true;
    $('axe-state').textContent = 'THROWING';
    $('axe-note').textContent = '24-frame windup · one shared throw this round.';
  });
  function advanceDemo(dt) {
    if (!demoRunning) return;
    demoClock += dt;
    while (demoClock >= 1 / 60 && demoRunning) {
      demoClock -= 1 / 60;
      // Hold through the command resolver's chord window; releasing Down on
      // the first frame would turn the buffered command into an ordinary grab.
      const input = demoTicks < 5 ? { down: true, lp: true, hp: true } : {};
      const hits = reviewMatch.step([input, {}]);
      for (const hit of hits) if (hit.type === 'hit' && hit.weapon === 'axe') {
        stage.impact(hit, { type: 'slash', power: 2 });
        $('axe-note').textContent = 'Axe hit confirmed. Reset the round to restore the station.';
      }
      demoTicks++;
      if (demoTicks >= 160) {
        demoRunning = false;
        $('axe-state').textContent = reviewMatch.axeUsed ? 'SPENT' : 'READY';
        if (reviewMatch.axeUsed && reviewMatch.right.health === reviewMatch.right.maxHealth) $('axe-note').textContent = 'Throw complete. Reset the round to restore the station.';
      }
    }
  }
  function toggleControls() {
    const hidden = document.body.classList.toggle('controls-hidden');
    $('show-controls').hidden = !hidden;
    if (hidden) canvas.focus({ preventScroll: true });
    else $('hide-controls').focus({ preventScroll: true });
    resize();
  }
  on($('hide-controls'), 'click', toggleControls); on($('show-controls'), 'click', toggleControls);
  let pointer = null;
  on(canvas, 'pointerdown', event => {
    if (event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
    $('orbit').checked = false;
  });
  on(canvas, 'pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    spherical.theta -= (event.clientX - pointer.x) * .006;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + (event.clientY - pointer.y) * .005, .07, Math.PI / 2 - .012);
    pointer.x = event.clientX; pointer.y = event.clientY;
    markFreeCamera(); applyCamera();
  });
  on(canvas, 'pointerup', () => { pointer = null; }); on(canvas, 'pointercancel', () => { pointer = null; });
  on(canvas, 'lostpointercapture', () => { pointer = null; });
  function zoom(amount) { spherical.radius = THREE.MathUtils.clamp(spherical.radius * amount, 1.6, 180); markFreeCamera(); applyCamera(); }
  on(canvas, 'wheel', event => { event.preventDefault(); zoom(Math.exp(THREE.MathUtils.clamp(event.deltaY, -150, 150) * .0018)); }, { passive: false });
  on(window, 'keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.target.matches('input, select, textarea, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'h') { event.preventDefault(); toggleControls(); return; }
    if (key === 's' && ready) { event.preventDefault(); saveSceneImage(); return; }
    if (event.target !== canvas && event.target !== document.body) return;
    if (event.code === 'Space') { event.preventDefault(); setPaused(!paused); }
    else if (/^[1-6]$/.test(key)) selectPreset(presets[Number(key) - 1].id);
    else if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
      event.preventDefault(); $('orbit').checked = false;
      spherical.theta += key === 'arrowleft' ? .06 : key === 'arrowright' ? -.06 : 0;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + (key === 'arrowup' ? -.04 : key === 'arrowdown' ? .04 : 0), .07, Math.PI / 2 - .012);
      markFreeCamera(); applyCamera();
    } else if (key === '+' || key === '=') { event.preventDefault(); zoom(.9); }
    else if (key === '-') { event.preventDefault(); zoom(1.1); }
  });
  function saveSceneImage() {
    postfx.render();
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `lake-america-${activePreset || 'free'}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    link.click();
  }
  on($('capture'), 'click', saveSceneImage);
  on(canvas, 'webglcontextlost', event => {
    event.preventDefault(); renderer.setAnimationLoop(null);
    $('loading').hidden = false; $('loading').textContent = 'Graphics context paused. Reload this page to continue reviewing.';
  });
  let lastTime = performance.now(), statsAt = 0, fps = 60;
  function frame(now) {
    const realDt = Math.min(.1, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
    const dt = paused || document.hidden ? 0 : realDt;
    if (!paused && !reducedMotion && !document.hidden && $('orbit').checked) { spherical.theta += dt * .12; applyCamera(); }
    if (ready) {
      advanceDemo(dt);
      weapons.update(reviewMatch.snapshot(), dt);
    }
    stage.update(dt);
    postfx.update(dt, { frozen: dt === 0 });
    renderer.info.reset(); postfx.render();
    if (realDt > 0) fps = fps * .94 + .06 / realDt;
    if (now - statsAt > 500) {
      statsAt = now;
      $('stats').textContent = `${Math.round(fps)} FPS · ${renderer.info.render.calls} draws · ${Math.round(renderer.info.render.triangles / 1000)}k tris\nCamera ${camera.position.toArray().map(value => value.toFixed(1)).join(' / ')}`;
    }
  }
  renderer.setAnimationLoop(frame);
  on(window, 'pagehide', () => {
    disposed = true; renderer.setAnimationLoop(null); observer.disconnect(); events.abort();
    weapons.clear(); stage.dispose();
    const geometries = new Set(), materials = new Set();
    guides.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
    geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
    postfx.dispose(); renderer.dispose();
  }, { once: true });
  await stage.ready;
  if (disposed) return;
  ready = true; resetRound(); $('loading').hidden = true;
  for (const id of ['impact', 'reset', 'capture']) $(id).disabled = false;
  if (!stage.group.getObjectByName('lake-america-axe')) $('axe-note').textContent = 'The runtime axe is missing from this export. Rebuild the Blender level before accepting it.';
  // Read-only inspection references for local browser acceptance.
  window.__LAKE_REVIEW__ = { scene, stage, renderer, camera, weapons, match: () => reviewMatch, selectPreset, resetRound };
}
