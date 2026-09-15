import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const P = new URLSearchParams(location.search);
const SRC  = P.get('src') || 'tex';
const AZ   = parseFloat(P.get('az') ?? '0');
const EL   = parseFloat(P.get('el') ?? '4');
const W    = parseInt(P.get('w') ?? '900', 10);
const H    = parseInt(P.get('h') ?? '1100', 10);
const BG   = P.get('bg') || 'neutral';
const CLIP = P.get('clip') || '';
const BONES = P.get('bones') === '1';
const RATE = parseFloat(P.get('rate') ?? '1');

const FILES = {
  tex:    '/sources/trump%203D%20Model_allparts_20260903_235636.glb',
  part:   '/sources/trump_allparts_20260904_002203.glb',
  painted:'',
  lo:     '',
  rig:    '',
};
// ?file=/build/<id>/<id>_rigged.glb overrides the named presets.
const FILE = P.get('file') || FILES[SRC] || '';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG === 'dark' ? 0x0b0d11 : BG === 'white' ? 0xf2f2f2 : 0x22252c);

const camera = new THREE.PerspectiveCamera(32, W / H, 0.01, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

// three-point rig
const key = new THREE.DirectionalLight(0xfff3e0, 3.0);
key.position.set(2.2, 3.4, 3.0); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -2; key.shadow.camera.right = 2;
key.shadow.camera.top = 2; key.shadow.camera.bottom = -2;
key.shadow.bias = -0.0012;
const fill = new THREE.DirectionalLight(0xbcd2ff, 0.85); fill.position.set(-3.0, 1.2, 1.6);
const rim  = new THREE.DirectionalLight(0xffd9a8, 2.2);  rim.position.set(-1.4, 2.2, -3.2);
scene.add(key, fill, rim, new THREE.HemisphereLight(0x9fb4d8, 0x2b2620, 0.65));

const hud = document.getElementById('hud');
const clock = new THREE.Clock();
let mixer = null, actions = {}, current = null, currentName = '-';

if (!FILE) {
  hud.textContent = 'no file — pass ?file=/build/<id>/<id>_rigged.glb';
} else new GLTFLoader().load(FILE, (gltf) => {
  const root = gltf.scene;
  let tris = 0, meshes = 0, g0 = false, skinned = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (o.isSkinnedMesh) { skinned++; o.frustumCulled = false; }
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    g.computeVertexNormals && !g.attributes.normal && g.computeVertexNormals();
    o.castShadow = true; o.receiveShadow = true;
    if (g.attributes.color) g0 = true;
    const src = o.material;
    o.material = new THREE.MeshPhysicalMaterial({
      map: src.map || null,
      vertexColors: !!g.attributes.color && !src.map,
      color: 0xffffff,
      roughness: 0.62, metalness: 0.0,
      clearcoat: 0.18, clearcoatRoughness: 0.55,
      sheen: 0.25, sheenColor: new THREE.Color(0x8fa4c8),
    });
    if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
  });

  // normalise to 1.9 m, feet on floor, centred. Measured on the bind pose, so
  // the framing does not drift when a clip moves the hips.
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const s = 1.9 / size.y;
  root.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(root);
  const c2 = box2.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(c2.x, box2.min.y, c2.z));
  scene.add(root);

  const b = new THREE.Box3().setFromObject(root);
  const sz = b.getSize(new THREE.Vector3());

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(4, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.95 }));
  ground.receiveShadow = true; scene.add(ground);

  // Frame on the binding axis. The bind pose is a T-pose, far wider than tall,
  // and framing every clip on that leaves a posed fighter small in the middle
  // of the canvas -- so a clip is framed on its own width instead, measured
  // once after the first pose is applied.
  frame(sz);

  // ---- clips ------------------------------------------------------------
  const names = gltf.animations.map((c) => c.name);
  if (gltf.animations.length) {
    mixer = new THREE.AnimationMixer(root);
    for (const c of gltf.animations) {
      const act = mixer.clipAction(c);
      act.clampWhenFinished = true;
      actions[c.name] = act;
    }
    play(CLIP && actions[CLIP] ? CLIP : (names.includes('idle') ? 'idle' : names[0]), 0);
    buildClipBar(names);
  }

  if (BONES) {
    const helper = new THREE.SkeletonHelper(root);
    helper.material.linewidth = 2;
    helper.material.depthTest = false;
    helper.renderOrder = 999;
    scene.add(helper);
  }

  window.__FIGHTER3D__ = { scene, root, camera, renderer, controls, mixer, actions, frame };
  if (mixer) { mixer.update(0); frame(posedSize()); }
  hud.innerHTML = `<b>${FILE.split('/').pop()}</b><br>` +
    `${meshes} mesh(es)${skinned ? ` (${skinned} skinned)` : ''} &middot; <b>${(tris / 1000).toFixed(1)}k tris</b> &middot; ` +
    `${g0 ? 'vertex colour' : 'texture'}<br>` +
    `height 1.90 m &middot; span ${sz.x.toFixed(2)} m &middot; az ${AZ}&deg; el ${EL}&deg;` +
    (names.length ? `<br>clip <b id="clipname">${currentName}</b> &middot; ${names.length} clips` : '<br>no clips');

  renderer.render(scene, camera);
  window.__READY__ = true;
}, (p) => { hud.textContent = `loading ${(p.loaded / 1e6).toFixed(1)} MB…`; },
   (e) => { hud.textContent = 'ERROR ' + e; console.error(e); });

function posedSize() {
  const root = window.__FIGHTER3D__?.root || scene.children.find((o) => o.type === 'Group');
  const b = new THREE.Box3().setFromObject(root);
  return b.getSize(new THREE.Vector3());
}

function frame(sz) {
  const target = new THREE.Vector3(0, sz.y * 0.52, 0);
  const fovY = THREE.MathUtils.degToRad(camera.fov);
  const need = Math.max(sz.y / 2 / Math.tan(fovY / 2),
                        (sz.x / 2) / Math.tan(fovY / 2) / camera.aspect);
  const dist = need * 1.18;
  const a = THREE.MathUtils.degToRad(AZ), e = THREE.MathUtils.degToRad(EL);
  camera.position.set(target.x + dist * Math.cos(e) * Math.sin(a),
                      target.y + dist * Math.sin(e),
                      target.z + dist * Math.cos(e) * Math.cos(a));
  camera.lookAt(target); controls.target.copy(target); controls.update();
}

function play(name, fade = 0.18) {
  const next = actions[name];
  if (!next || next === current) return;
  next.reset();
  next.setLoop(THREE.LoopRepeat, Infinity);
  next.enabled = true;
  next.paused = false;
  next.setEffectiveTimeScale(RATE);
  next.setEffectiveWeight(1);
  if (current) {
    // Two actions left playing blend by weight, so an un-faded switch has to
    // stop the old one or the new pose arrives averaged with the old one.
    if (fade > 0) next.crossFadeFrom(current, fade, false);
    else current.stop();
  }
  next.play();
  current = next; currentName = name;
  const el = document.getElementById('clipname');
  if (el) el.textContent = name;
  document.querySelectorAll('#clips button').forEach((btn) => {
    btn.classList.toggle('on', btn.textContent === name);
  });
}

function buildClipBar(names) {
  const bar = document.createElement('div');
  bar.id = 'clips';
  bar.innerHTML = names.map((n) => `<button>${n}</button>`).join('');
  document.body.appendChild(bar);
  bar.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') play(e.target.textContent); });
  addEventListener('keydown', (e) => {
    const i = parseInt(e.key, 10) - 1;
    if (i >= 0 && i < names.length) play(names[i]);
  });
  play(currentName, 0);
}

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (mixer) mixer.update(dt);
  controls.update();
  renderer.render(scene, camera);
});

// ---- capture helpers for the review loop --------------------------------
// Poses are deterministic: pick a clip, seek to an absolute time, render once.
window.__setClip = (name, t = 0) => {
  play(name, 0);
  if (!mixer || !current) return false;
  current.paused = true;
  current.time = t;
  mixer.update(0);                 // apply the frozen time without advancing it
  renderer.render(scene, camera);
  return { clip: currentName, t: current.time };
};
window.__play = (name) => { play(name, 0.18); if (current) current.paused = false; return currentName; };

// Park the camera at an arbitrary eye/target. OrbitControls rebuilds the camera
// from its own target every frame, so setting camera.position alone is undone
// on the next tick -- the target has to move with it.
window.__look = (eye, at) => {
  controls.target.set(at[0], at[1], at[2]);
  camera.position.set(eye[0], eye[1], eye[2]);
  camera.lookAt(controls.target);
  controls.update();
  renderer.render(scene, camera);
  return true;
};

window.__shoot = async (name, az, el, headshot = false) => {
  const root = window.__FIGHTER3D__.root;
  const b = new THREE.Box3().setFromObject(root);
  const sz = b.getSize(new THREE.Vector3());
  const target = headshot
    ? new THREE.Vector3(0, sz.y * 0.895, 0.02)
    : new THREE.Vector3(0, sz.y * 0.52, 0);
  const fovY = THREE.MathUtils.degToRad(camera.fov);
  const dist = headshot
    ? 0.62
    : Math.max(sz.y / 2 / Math.tan(fovY / 2), (sz.x / 2) / Math.tan(fovY / 2) / camera.aspect) * 1.16;
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  camera.position.set(target.x + dist * Math.cos(e) * Math.sin(a),
                      target.y + dist * Math.sin(e),
                      target.z + dist * Math.cos(e) * Math.cos(a));
  camera.lookAt(target); controls.target.copy(target); controls.update();
  renderer.render(scene, camera);
  const b64 = canvas.toDataURL('image/png').split(',')[1];
  const r = await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: b64 });
  return r.text();
};
