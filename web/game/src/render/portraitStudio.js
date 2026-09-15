import * as THREE from '../vendor/three.module.js';
import { FighterView } from './fighterView.js';
import { OutputPass } from '../vendor/postprocessing/OutputPass.js';

const WIDTH = 768, HEIGHT = 960;

// Shares the GPU context, never a fighter rig. Readback happens only while the
// selection screen is visible; match rendering pays nothing for the showcase.
export class PortraitStudio {
  constructor({ renderer, roster, onPortrait = () => {}, format = 'threejs', reducedMotion = false }) {
    Object.assign(this, { renderer, roster, onPortrait, format, reducedMotion });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1424);
    this.scene.add(new THREE.HemisphereLight(0xe5edff, 0x464452, 2.5));
    const key = new THREE.DirectionalLight(0xfff2df, 3.4); key.position.set(3, 4, 5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8bbaff, 2.5); rim.position.set(-3, 2, -2); this.scene.add(rim);
    this.keyLight = key; this.rimLight = rim;
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.78, 0.065, 64), new THREE.MeshStandardMaterial({ color: 0x182537, metalness: 0.7, roughness: 0.27 }));
    floor.position.y = -0.05; this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.008, 8, 96), new THREE.MeshBasicMaterial({ color: 0xffc63d })); ring.rotation.x = Math.PI / 2; ring.position.y = -0.01; this.scene.add(ring);
    this.ring = ring; this.previewSide = 0;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 15);
    this.canvas = document.createElement('canvas'); this.canvas.width = WIDTH; this.canvas.height = HEIGHT;
    this.ctx = this.canvas.getContext('2d');
    this.target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { depthBuffer: true });
    this.linearTarget = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { type: THREE.HalfFloatType, depthBuffer: true, samples: 4 });
    this.output = new OutputPass();
    this.pixels = new Uint8Array(WIDTH * HEIGHT * 4); this.picture = this.ctx.createImageData(WIDTH, HEIGHT);
    this.views = new Map(); this.loading = new Map(); this.portraits = new Map();
    this.activeId = null; this.time = 0; this.frameAge = 1; this.generation = 0; this.disposed = false;
  }
  async load(id) {
    if (this.views.has(id)) return this.views.get(id);
    if (this.loading.has(id)) return this.loading.get(id);
    const definition = this.roster.find(f => f.id === id);
    if (!definition) throw new Error(`Unknown fighter ${id}`);
    const view = new FighterView(definition, { scene: this.scene, side: 0 }); view.root.visible = false;
    const pending = view.load(this.format).then(() => {
      if (this.disposed) { view.dispose(); return null; }
      this.views.set(id, view); this.loading.delete(id); return view;
    }).catch(error => { view.dispose(); this.loading.delete(id); throw error; });
    this.loading.set(id, pending); return pending;
  }
  tint(side = 0) {
    this.previewSide = side ? 1 : 0;
    const p1 = this.previewSide === 0;
    this.keyLight.color.set(p1 ? 0xffe4c8 : 0xe4f0ff);
    this.rimLight.color.set(p1 ? 0xff6a55 : 0x6aa8ff);
    this.rimLight.intensity = 3.1;
    this.ring.material.color.set(p1 ? 0xd81f2a : 0x2f6bff);
  }
  async select(id, side = 0) {
    const generation = ++this.generation;
    const view = await this.load(id);
    if (!view || this.disposed || generation !== this.generation) return;
    this.tint(side);
    this.activeId = id; this.time = 0; this.frameAge = 1;
    for (const [key, other] of this.views) other.root.visible = key === id;
    this.pose(view, 0);
    if (!this.portraits.has(id)) this.capturePortrait(view);
    this.renderPreview();
  }
  async prewarm() {
    // Sequential work limits mobile peak memory during startup.
    for (const definition of this.roster) {
      if (this.disposed) return;
      const view = await this.load(definition.id);
      if (!view || this.disposed) return;
      this.pose(view, 0); this.capturePortrait(view);
    }
    for (const [id, view] of this.views) view.root.visible = id === this.activeId;
  }
  pose(view, dt) {
    view.apply({ id: view.definition.id, x: 0, y: 0, facing: 1, state: 'idle', stateFrame: 0, move: null, moveFrame: 0, health: 1000, maxHealth: 1000 }, dt, { freeAnimation: true });
    view.pivot.rotation.y = this.reducedMotion ? 0.2 : 0.15 + Math.sin(this.time * 0.32) * 0.45;
    view.rim.uniforms.uRimStrength.value = 0.12;
    view.root.updateMatrixWorld(true);
  }
  drawToCanvas() {
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousViewport = renderer.getViewport(new THREE.Vector4());
    const previousScissor = renderer.getScissor(new THREE.Vector4());
    const previousScissorTest = renderer.getScissorTest();
    const previousClear = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    const previousAuto = renderer.autoClear;
    try {
      // setRenderTarget uses the target's physical-pixel viewport. Calling
      // renderer.setViewport here would multiply it by the screen's DPR and
      // crop the fighter on a Retina/mobile display.
      renderer.setRenderTarget(this.linearTarget); renderer.setScissorTest(false); renderer.autoClear = true;
      renderer.render(this.scene, this.camera);
      // Match the arena's ACES/sRGB output; a raw byte target would clip the
      // studio lights and bleach the portrait before readback.
      this.output.render(renderer, this.target, this.linearTarget);
      renderer.readRenderTargetPixels(this.target, 0, 0, WIDTH, HEIGHT, this.pixels);
      const stride = WIDTH * 4;
      for (let y = 0; y < HEIGHT; y++) this.picture.data.set(this.pixels.subarray((HEIGHT - 1 - y) * stride, (HEIGHT - y) * stride), y * stride);
      this.ctx.putImageData(this.picture, 0, 0);
    } finally {
      renderer.setViewport(previousViewport); renderer.setScissor(previousScissor); renderer.setScissorTest(previousScissorTest);
      renderer.setRenderTarget(previousTarget); renderer.setClearColor(previousClear, previousAlpha); renderer.autoClear = previousAuto;
    }
  }
  capturePortrait(view) {
    if (this.portraits.has(view.definition.id)) return;
    const visible = [...this.views].filter(([, v]) => v.root.visible).map(([id]) => id);
    for (const v of this.views.values()) v.root.visible = v === view;
    const turn = view.pivot.rotation.y; view.pivot.rotation.y = -0.14;
    const side = this.previewSide; this.tint(0);
    this.camera.aspect = WIDTH / HEIGHT; this.camera.position.set(0.05, 1.65, 2.12); this.camera.lookAt(0, 1.47, 0); this.camera.updateProjectionMatrix();
    this.drawToCanvas();
    const portrait = document.createElement('canvas'); portrait.width = 512; portrait.height = 512;
    portrait.getContext('2d').drawImage(this.canvas, 0, HEIGHT * 0.07, WIDTH, WIDTH, 0, 0, 512, 512);
    const url = portrait.toDataURL('image/webp', 0.92);
    this.portraits.set(view.definition.id, url); this.onPortrait(view.definition.id, url);
    view.pivot.rotation.y = turn;
    this.tint(side);
    for (const [id, v] of this.views) v.root.visible = visible.includes(id);
  }
  renderPreview() {
    if (!this.activeId || !this.views.get(this.activeId)) return;
    this.camera.aspect = WIDTH / HEIGHT; this.camera.position.set(0, 1.12, 4.05); this.camera.lookAt(0, 1.01, 0); this.camera.updateProjectionMatrix();
    this.drawToCanvas();
  }
  update(dt, visible = true) {
    if (!visible || this.disposed || !this.activeId) return;
    this.time += dt; this.frameAge += dt;
    if (this.frameAge < (this.reducedMotion ? 0.1 : 1 / 24)) return;
    const elapsed = Math.min(this.frameAge, 0.1); this.frameAge = 0;
    this.pose(this.views.get(this.activeId), elapsed); this.renderPreview();
  }
  dispose() {
    this.disposed = true; this.generation++;
    for (const view of this.views.values()) view.dispose(); this.views.clear(); this.target.dispose(); this.linearTarget.dispose(); this.output.dispose();
    this.scene.traverse(node => { if (node.isMesh) { node.geometry.dispose(); node.material.dispose(); } });
  }
}

