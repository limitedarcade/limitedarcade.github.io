import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { createRig, qConj, qRot, VIEW_HEIGHT } from '../tools/fighterRig.mjs';

const JOINTS = [
  { id: 'fistL', bone: 'handEndL', kind: 'fist', side: 'L', color: 0xe6b531 },
  { id: 'fistR', bone: 'handEndR', kind: 'fist', side: 'R', color: 0x31b5b5 },
  { id: 'elbowL', bone: 'forearmL', kind: 'elbow', side: 'L', color: 0xf0a848 },
  { id: 'elbowR', bone: 'forearmR', kind: 'elbow', side: 'R', color: 0x8484b5 },
];

function trunkRadius(trunk, y) {
  if (y <= trunk[0].y) return trunk[0];
  if (y >= trunk[trunk.length - 1].y) return trunk[trunk.length - 1];
  for (let i = 1; i < trunk.length; i++) {
    if (y > trunk[i].y) continue;
    const a = trunk[i - 1], b = trunk[i], t = (y - a.y) / (b.y - a.y);
    return { halfX: a.halfX + t * (b.halfX - a.halfX), halfZ: a.halfZ + t * (b.halfZ - a.halfZ) };
  }
  return trunk[trunk.length - 1];
}

function clearanceAt(rig, trunk, st, pWorld) {
  let best = Infinity;
  for (const name of ['hips', 'spine', 'chest']) {
    const i = rig.boneIndex[name];
    const b = rig.bones[i], n = st.list[i];
    const d = [pWorld[0] - n.pos[0], pWorld[1] - n.pos[1], pWorld[2] - n.pos[2]];
    const local = qRot(qConj(n.q), d);
    const rest = [local[0] + b.world[0], local[1] + b.world[1], local[2] + b.world[2]];
    const R = trunkRadius(trunk, rest[1]);
    const r = Math.hypot(rest[0], rest[2]);
    if (r < 1e-6) return -R.halfX * rig.scale;
    const c = rest[0] / r, sn = rest[2] / r;
    const shell = 1 / Math.hypot(c / R.halfX, sn / R.halfZ);
    const gap = (r - shell) * rig.scale;
    if (Math.abs(gap) < Math.abs(best)) best = gap;
  }
  return best;
}

function worstClear(rig, meas, pose) {
  const st = rig.fk(pose);
  let worst = Infinity;
  for (const n of ['forearmL', 'forearmR', 'handL', 'handR']) {
    worst = Math.min(worst, clearanceAt(rig, meas.trunk, st, st.list[rig.boneIndex[n]].pos));
  }
  return { st, worst };
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }
function norm(a) { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

export function createStudioViewer(canvas, hooks = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x22252c);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  const key = new THREE.DirectionalLight(0xfff3e0, 3.0);
  key.position.set(2.2, 3.4, 3.0); key.castShadow = true;
  scene.add(key,
    new THREE.DirectionalLight(0xbcd2ff, 0.85).translateX(-3),
    new THREE.HemisphereLight(0x9fb4d8, 0x2b2620, 0.65));

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(4, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.95 }));
  ground.receiveShadow = true;
  scene.add(ground);

  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const gizmo = new TransformControls(camera, canvas);
  gizmo.setMode('translate');
  gizmo.setSpace('world');
  gizmo.size = 0.7;
  gizmo.showX = true;
  gizmo.showY = true;
  gizmo.showZ = true;
  gizmo.detach();
  scene.add(gizmo.getHelper());

  let root = null, bones = {}, restPos = {};
  let meas = null, opts = null, solver = null;
  let markers = {};
  let selected = null;
  let clampedSide = { L: false, R: false };
  let draggingGizmo = false;
  let live = true;
  let disposed = false;

  gizmo.addEventListener('dragging-changed', (e) => {
    draggingGizmo = e.value;
    controls.enabled = !e.value;
    if (!e.value) {
      // Drag over: snap every handle onto where the solve actually put the
      // joint. During the drag the handle is allowed to lead the cursor; on
      // release it has to tell the truth, especially for an elbow, which can
      // only ride the circle around the shoulder-to-wrist axis.
      placeHandles();
      clampedSide = { L: false, R: false };
      readout();
      hooks.onChange?.(opts);
    }
  });
  gizmo.addEventListener('objectChange', () => {
    if (!selected || !markers[selected]) return;
    applyJointDrag(selected, markers[selected].position);
    showGuard({ keep: selected });
  });

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 640;
    const h = canvas.clientHeight || 520;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  function namedBones(obj) {
    const map = {};
    obj.traverse((o) => { if (o.isBone || o.name) map[o.name] = o; });
    return map;
  }

  function applyPose(pose, keep) {
    if (!solver) return;
    for (const b of solver.bones) {
      const obj = bones[b.name];
      if (!obj) continue;
      const p = pose[b.name];
      const q = p?.r || [0, 0, 0, 1];
      obj.quaternion.set(q[0], q[1], q[2], q[3]);
      const rest = restPos[b.name];
      if (!rest) continue;
      if (p?.t) obj.position.set(rest[0] + p.t[0], rest[1] + p.t[1], rest[2] + p.t[2]);
      else obj.position.set(rest[0], rest[1], rest[2]);
    }
    root.updateMatrixWorld(true);
    placeHandles(keep);
  }

  function worldOf(name) {
    const o = bones[name];
    if (!o) return null;
    const w = new THREE.Vector3();
    o.getWorldPosition(w);
    return w;
  }

  function jointById(id) {
    return JOINTS.find((j) => j.id === id);
  }

  function placeHandles(keep) {
    for (const j of JOINTS) {
      if (keep && j.id === keep) continue;
      const w = worldOf(j.bone);
      if (w && markers[j.id]) markers[j.id].position.copy(w);
    }
  }

  function selectJoint(id) {
    selected = id;
    for (const j of JOINTS) {
      const m = markers[j.id];
      if (!m) continue;
      const on = j.id === id;
      m.material.opacity = on ? 1 : 0.55;
      m.material.transparent = true;
      m.material.emissive.setHex(on ? j.color : 0x000000);
      m.material.emissiveIntensity = on ? 0.5 : 0;
      m.scale.setScalar(on ? 1.25 : 1);
    }
    if (id && markers[id] && live) gizmo.attach(markers[id]);
    else gizmo.detach();
    hooks.onSelect?.(id);
  }

  // Shoulder position and arm span for one side, in viewer metres, under the
  // pose the guard currently resolves to.
  function armFrame(side) {
    const st = solver.fk(solver.resolve({}, { quiet: true }));
    const at = (n) => solver.toView(st.list[solver.boneIndex[n]].pos);
    const S = at('upperArm' + side), E = at('forearm' + side), W = at('hand' + side);
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    return { shoulder: S, span: d(E, S) + d(W, E), wrist: W, elbow: E };
  }

  function applyJointDrag(id, world) {
    const j = jointById(id);
    if (!j || !opts) return;
    rebuildSolver();
    const p = [world.x, world.y, world.z];
    const { shoulder, span } = armFrame(j.side);

    if (j.kind === 'fist') {
      // The handle sits on the knuckles; the solver aims the WRIST. Carry the
      // knuckle-to-wrist offset back so the fist lands under the cursor.
      const hand = worldOf('hand' + j.side), end = worldOf('handEnd' + j.side);
      let wrist = p;
      if (hand && end) wrist = [p[0] + hand.x - end.x, p[1] + hand.y - end.y, p[2] + hand.z - end.z];
      // Clamp inside the arm's reach. Dragging past it used to lock the arm
      // straight and silently stop tracking the cursor, which is what made the
      // handles feel dead: the pose stopped changing but the handle kept going.
      const d = sub(wrist, shoulder), r = len(d);
      const max = span * 0.985;
      clampedSide[j.side] = r > max;
      if (r > max) wrist = add(shoulder, mul(norm(d), max));
      opts.guard.aim[j.side] = wrist.map((v) => +v.toFixed(4));
      return;
    }

    // Elbow. With the wrist pinned, the elbow can only travel around the circle
    // whose axis is shoulder->wrist, so a drag can set its ANGLE and nothing
    // else. Store the pole as a unit vector: it is a direction, and leaving the
    // raw drag magnitude in the config makes the number unreadable.
    const T = opts.guard.aim[j.side];
    const n = norm(sub(T, shoulder));
    const d = sub(p, shoulder);
    let pole = sub(d, mul(n, dot(d, n)));
    if (len(pole) < 1e-4) return;                    // dead on the axis, no angle to read
    pole = norm(pole);
    // The solve works in model space and the axis is the same there, so only
    // the scale differs -- a direction needs no conversion beyond normalising.
    opts.elbowPole[j.side] = pole.map((v) => +v.toFixed(4));
  }

  function readout() {
    if (!solver || !meas) return;
    const pose = solver.resolve({}, { quiet: true });
    const { st, worst } = worstClear(solver, meas, pose);
    const v = (n) => solver.toView(st.list[solver.boneIndex[n]].pos);
    const chin = v('head')[1] - 0.10;
    const side = (S) => {
      const up = v('upperArm' + S), el = v('forearm' + S), wr = v('hand' + S), fi = v('handEnd' + S);
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      return {
        vsChin: fi[1] - chin, fwd: fi[2], x: fi[0],
        extend: d(wr, up) / (d(el, up) + d(wr, el)),
        elbow: el,
        clamped: !!(pose.clamped || []).includes(S) || clampedSide[S],
      };
    };
    hooks.onReadout?.({ worst, fistL: side('L'), fistR: side('R'), opts });
  }

  function rebuildSolver() {
    solver = createRig(meas.joints, meas.bounds, opts);
  }

  function showGuard(flags = {}) {
    rebuildSolver();
    applyPose(solver.resolve({}, { quiet: true }), flags.keep);
    readout();
  }

  function showBind() {
    rebuildSolver();
    applyPose(solver.resolve({}, { bind: true }));
  }

  function makeMarker(j) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 16, 12),
      new THREE.MeshStandardMaterial({
        color: j.color, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.95,
      }),
    );
    m.name = 'joint-' + j.id;
    m.userData.id = j.id;
    scene.add(m);
    return m;
  }

  function ndc(ev) {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  }

  function onDown(ev) {
    if (!live || !root || draggingGizmo) return;
    ndc(ev);
    ray.setFromCamera(pointer, camera);
    if (gizmo.object) {
      const gizHits = ray.intersectObject(gizmo.getHelper(), true);
      if (gizHits.length) return;
    }
    const objs = Object.values(markers).filter(Boolean);
    const hits = ray.intersectObjects(objs, false);
    if (hits.length) selectJoint(hits[0].object.userData.id);
    else selectJoint(null);
  }

  canvas.addEventListener('pointerdown', onDown);

  const loader = new GLTFLoader();
  const clock = new THREE.Clock();

  function tick() {
    if (disposed) return;
    requestAnimationFrame(tick);
    resize();
    controls.update();
    renderer.render(scene, camera);
    clock.getDelta();
  }
  tick();

  async function load({ glbUrl, joints, rigOpts }) {
    meas = joints;
    opts = JSON.parse(JSON.stringify(rigOpts));
    if (root) { scene.remove(root); root = null; }
    const gltf = await loader.loadAsync(glbUrl);
    root = gltf.scene;
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.isSkinnedMesh) o.frustumCulled = false;
      o.castShadow = true; o.receiveShadow = true;
      const src = o.material;
      const g = o.geometry;
      o.material = new THREE.MeshPhysicalMaterial({
        map: src.map || null,
        vertexColors: !!g.attributes.color && !src.map,
        color: 0xffffff, roughness: 0.62, metalness: 0,
        clearcoat: 0.18, clearcoatRoughness: 0.55,
      });
      if (o.material.map) o.material.map.colorSpace = THREE.SRGBColorSpace;
    });
    // Put the model in the rig's own frame -- 1.9 m tall, feet on the floor,
    // x/z origin on the model origin -- rather than fitting its bounding box.
    // Wrist targets are authored in exactly those metres, so any other framing
    // (a bbox-centred one, say) leaves a constant offset between where a fist
    // is dragged to and where the solver is told to put it.
    rebuildSolver();
    root.scale.setScalar(solver.scale);
    root.position.set(0, -solver.floor * solver.scale, 0);
    scene.add(root);

    bones = namedBones(root);
    restPos = {};
    for (const [name, o] of Object.entries(bones)) {
      restPos[name] = o.position.toArray();
    }

    for (const m of Object.values(markers)) scene.remove(m);
    markers = {};
    for (const j of JOINTS) markers[j.id] = makeMarker(j);
    selectJoint(null);

    // Frame on the figure, not on its bounding box. Box3 on a SkinnedMesh
    // caches the BIND pose, so the box here is the T-pose -- arms out to a 1.9 m
    // span -- and fitting that width pushed the camera far enough back that a
    // guarded fighter was a thumbnail in the middle of the canvas.
    const target = new THREE.Vector3(0, VIEW_HEIGHT * 0.54, 0);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const halfH = VIEW_HEIGHT * 0.56;             // figure plus a little headroom
    const halfW = VIEW_HEIGHT * 0.32;             // a guard is about this wide
    const dist = Math.max(halfH, halfW / Math.max(camera.aspect, 0.01)) / Math.tan(fov / 2);
    const az = THREE.MathUtils.degToRad(-34), el = THREE.MathUtils.degToRad(6);
    camera.position.set(
      target.x + dist * Math.cos(el) * Math.sin(az),
      target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(el) * Math.cos(az),
    );
    camera.lookAt(target);
    controls.target.copy(target);

    live = true;
    showGuard();
  }

  function setMode(mode) {
    live = mode !== 'tpose';
    for (const m of Object.values(markers)) m.visible = live;
    if (!live) selectJoint(null);
    if (mode === 'tpose') showBind();
    else showGuard();
  }

  function dispose() {
    disposed = true;
    canvas.removeEventListener('pointerdown', onDown);
    gizmo.dispose();
    renderer.dispose();
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  // The elbow pole has three numbers but only one degree of freedom: with the
  // wrist pinned the elbow rides a circle, so all a pole does is pick an angle
  // on it. Measuring that angle from straight-down gives a control you can
  // actually read -- "the rear elbow is 34 degrees off vertical" -- instead of
  // three coordinates whose length means nothing.
  function poleBasis(side) {
    const { shoulder } = armFrame(side);
    const n = norm(sub(opts.guard.aim[side], shoulder));
    let u = sub([0, -1, 0], mul(n, dot([0, -1, 0], n)));
    if (len(u) < 1e-4) u = sub([0, 0, 1], mul(n, dot([0, 0, 1], n)));
    u = norm(u);
    return { n, u, v: cross(n, u) };
  }

  function poleAngle(side) {
    const { n, u, v } = poleBasis(side);
    const p = opts.elbowPole?.[side];
    if (!p) return 0;
    const pp = sub(p, mul(n, dot(p, n)));
    if (len(pp) < 1e-6) return 0;
    return (Math.atan2(dot(pp, v), dot(pp, u)) * 180) / Math.PI;
  }

  function setPoleAngle(side, deg) {
    const { u, v } = poleBasis(side);
    const a = (deg * Math.PI) / 180;
    opts.elbowPole[side] = add(mul(u, Math.cos(a)), mul(v, Math.sin(a))).map((x) => +x.toFixed(4));
  }

  // A flat description of the tunable state, for the number panel.
  function describe() {
    if (!solver || !opts) return null;
    rebuildSolver();
    return {
      aim: { L: [...opts.guard.aim.L], R: [...opts.guard.aim.R] },
      poleAngle: { L: poleAngle('L'), R: poleAngle('R') },
      pole: { L: [...opts.elbowPole.L], R: [...opts.elbowPole.R] },
      selected,
    };
  }

  // The number panel and the drag handles are the same edit, so they go through
  // one path: mutate opts, re-solve, redraw, report.
  function apply(mutate) {
    if (!opts) return;
    mutate(opts);
    clampedSide = { L: false, R: false };
    showGuard();
    hooks.onChange?.(opts);
  }

  return {
    load, setMode, dispose, apply, describe,
    getOpts: () => opts,
    select: selectJoint,
    setAim: (side, axis, value) => apply((o) => { o.guard.aim[side][axis] = value; }),
    setPoleAngle: (side, deg) => apply(() => setPoleAngle(side, deg)),
    setGuardRot: (bone, axis, deg) => apply((o) => {
      const g = (o.guard[bone] ||= {});
      const ops = [...(g.r || [])];
      const i = ops.findIndex((x) => x[0] === axis);
      if (i >= 0) ops[i] = [axis, deg]; else ops.push([axis, deg]);
      g.r = ops;
    }),
    refresh: () => showGuard(),
  };
}
