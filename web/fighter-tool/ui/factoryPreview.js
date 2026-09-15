import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createFactoryPreview(canvas) {
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
  key.position.set(2.2, 3.4, 3.0);
  key.castShadow = true;
  scene.add(
    key,
    new THREE.DirectionalLight(0xbcd2ff, 0.85).translateX(-3),
    new THREE.HemisphereLight(0x9fb4d8, 0x2b2620, 0.65),
  );

  const clock = new THREE.Clock();
  let built = null;
  let selected = null;
  let raf = 0;
  let disposed = false;
  let exploding = false;

  function resize() {
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 480;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function frame(group) {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.y, size.x / Math.max(camera.aspect, 0.5));
    camera.position.set(centre.x + span * 0.55, centre.y + span * 0.15, centre.z + span * 1.55);
    controls.target.copy(centre);
    controls.update();
  }

  function tick() {
    if (disposed) return;
    const dt = clock.getDelta();
    built?.update(dt);
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => {
    if (!built) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);
    const hits = ray.intersectObjects(built.parts.map((p) => p.mesh), false);
    for (const p of built.parts) {
      p.mesh.material.emissive?.setHex(0x000000);
    }
    if (hits[0]) {
      selected = hits[0].object.name;
      hits[0].object.material.emissive = new THREE.Color(0x3a2a08);
      hits[0].object.material.emissiveIntensity = 0.45;
    } else selected = null;
  });

  resize();
  new ResizeObserver(resize).observe(canvas);
  tick();

  return {
    async load(moduleUrl) {
      if (built) {
        scene.remove(built.group);
        built.dispose();
        built = null;
      }
      const mod = await import(/* @vite-ignore */ moduleUrl);
      await mod.prewarm();
      built = mod.createFighter({ castShadow: true, receiveShadow: true });
      scene.add(built.group);
      frame(built.group);
      return built;
    },
    play(name) { built?.play(name, 0.1); },
    explode(t) {
      if (!built) return;
      if (t > 0.02 && !exploding) {
        built.play('tpose', 0.08);
        exploding = true;
      }
      if (t <= 0.02) exploding = false;
      built.explode(t);
    },
    selected: () => selected,
    clips: () => built?.clips.map((c) => c.name) || [],
    parts: () => built?.parts.map((p) => p.id) || [],
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      built?.dispose();
      renderer.dispose();
    },
  };
}
