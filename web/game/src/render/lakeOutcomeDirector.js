import * as THREE from '../vendor/three.module.js';
import { stageOutcome, LAKE_OUTCOME_FRAMES } from '../engine/stageOutcomes.js';
import { lakeOutcomeCamera, smooth } from './lakeCameraDirector.js';
import { CinematicGrip } from './cinematicGrip.js';

export function lakeOutcomeActors(snapshot, source, frame) {
  const t = Math.min(LAKE_OUTCOME_FRAMES, Math.max(0, frame)) / 60;
  return source.map((actor, side) => {
    // Preserve every finisher's last victim pose, including missing body parts
    // and the stage-drop's submerged root. No post-match resurrection.
    if (side !== snapshot.winner && (snapshot.finisher || actor.state === 'finished')) return { ...actor, z: actor.z || 0 };
    const winner = side === snapshot.winner, travel = smooth((t - 1.8) / 1.5);
    const x = winner ? THREE.MathUtils.lerp(actor.x, -2.2, travel)
      : actor.x + (actor.id === 'trump' ? .7 * smooth(t / 1.1) : 0);
    const z = winner ? -1.5 * travel : 0;
    return { ...actor, x, z, y: 0, cinematicClip: winner ? 'lakeAmericaWin' : 'lakeAmericaLose',
      clipTime: t, reelKey: `${snapshot.round}:lake:${winner ? 'win' : 'lose'}`,
      // Turn the winner toward the shore for the strike, then back to camera.
      outcomeYaw: winner ? Math.PI * smooth((t - 2.5) / .8) * (1 - smooth((t - 4.6) / 1.0)) : 0 };
  });
}

function labelTexture(lines, color, background = '#142b3e') {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = background; ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 1008, 240);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  ctx.font = 'bold 92px Georgia'; ctx.fillText(lines[0], 512, 99, 950);
  ctx.font = 'bold 38px sans-serif'; ctx.fillText(lines[1], 512, 195, 950);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

export class LakeOutcomeDirector {
  constructor(scene, stage) {
    this.scene = scene; this.stage = stage; this.key = null; this.grips = [new CinematicGrip(), new CinematicGrip()];
  }
  restore() { this.grips.forEach(grip => grip.restore()); }
  reset() {
    this.restore();
    if (this.sign) {
      this.sign.rotation.copy(this.signRotation);
      for (const [label, visible] of this.labels) label.visible = visible;
    }
    this.plate?.removeFromParent();
    this.root?.removeFromParent();
    const geometries = new Set(), materials = new Set(), maps = new Set();
    for (const root of [this.root, this.plate]) root?.traverse(o => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) { materials.add(o.material); if (o.material.map) maps.add(o.material.map); }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); maps.forEach(m => m.dispose());
    this.root = this.plate = this.sign = null; this.key = null;
  }
  begin(snapshot, source, definition) {
    this.reset();
    this.key = `${this.stage.generation}:${snapshot.round}:${snapshot.winner}:${snapshot.fighters[snapshot.winner].id}`;
    this.source = source.map(actor => ({ ...actor }));
    this.root = new THREE.Group(); this.root.name = 'Lake America ending'; this.scene.add(this.root);
    this.sign = this.stage.group.getObjectByName('lake-america-trail-sign');
    if (this.sign) {
      this.signRotation = this.sign.rotation.clone();
      this.labels = this.sign.children.filter(o => /^Sign.*(?:Lake|Lac)_America/.test(o.name)).map(o => [o, o.visible]);
      this.plate = new THREE.Mesh(new THREE.PlaneGeometry(4.72, .98), new THREE.MeshStandardMaterial({
        map: labelTexture([definition.sign, definition.sub], definition.color), roughness: .65, side: THREE.DoubleSide,
        metalness: snapshot.fighters[snapshot.winner].id === 'trump' ? .45 : 0,
      }));
      this.plate.name = 'Lake victory nameplate'; this.plate.position.set(0, 2.12, .19);
      this.plate.visible = false; this.sign.add(this.plate);
    }
    this.wave = new THREE.Mesh(new THREE.RingGeometry(.85, 1, 80), new THREE.MeshBasicMaterial({
      color: definition.color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.wave.rotation.x = -Math.PI / 2; this.wave.position.set(-2.2, .035, -1.5); this.root.add(this.wave);
    this.sparks = new THREE.Group(); this.root.add(this.sparks);
    const geometry = new THREE.OctahedronGeometry(.055), material = new THREE.MeshStandardMaterial({
      color: definition.color, emissive: definition.color, emissiveIntensity: .35, metalness: .4, roughness: .3,
    });
    for (let i = 0; i < 36; i++) this.sparks.add(new THREE.Mesh(geometry, material));
    this.tape = new THREE.Mesh(new THREE.PlaneGeometry(9, .3), new THREE.MeshStandardMaterial({
      map: labelTexture(['POLICE — DO NOT CROSS', 'SHORELINE CLOSED'], '#152035', '#ffd94a'), side: THREE.DoubleSide, roughness: .85,
    }));
    this.tape.position.set(-2.2, 1.05, -3.2); this.root.add(this.tape);
  }
  update(snapshot, source, options = {}) {
    const definition = stageOutcome(snapshot);
    if (!definition) { if (this.key) this.reset(); return null; }
    const key = `${this.stage.generation}:${snapshot.round}:${snapshot.winner}:${snapshot.fighters[snapshot.winner].id}`;
    if (this.key !== key) this.begin(snapshot, source, definition);
    const frame = Math.min(LAKE_OUTCOME_FRAMES, snapshot.phaseFrame + (options.fraction || 0)), t = frame / 60;
    const actors = lakeOutcomeActors(snapshot, this.source, frame), winner = actors[snapshot.winner], loser = actors[1 - snapshot.winner];
    const changed = t >= 4.5;
    if (this.sign) {
      this.sign.rotation.copy(this.signRotation);
      if (!options.reducedMotion) this.sign.rotation.y += Math.PI * 2 * smooth((t - 4.1) / 1.0);
      this.plate.visible = changed;
      for (const [label, visible] of this.labels) label.visible = changed ? false : visible;
    }
    const pulse = Math.max(0, (t - 4) / .7);
    this.wave.visible = !options.reducedMotion && pulse > 0 && pulse < 1;
    this.wave.scale.setScalar(1 + 12 * pulse); this.wave.material.opacity = Math.max(0, .7 * (1 - pulse));
    const burst = t - 4.5;
    this.sparks.visible = !options.reducedMotion && burst > 0 && burst < 2;
    for (const [i, mesh] of this.sparks.children.entries()) {
      const angle = i * 2.39996, radius = .5 + (i % 5) * .2;
      mesh.position.set(-6.5 + Math.cos(angle) * radius * burst, Math.max(.07, 1.8 + (1 + i % 3) * burst - 2.5 * burst * burst), -11 + Math.sin(angle) * radius * burst);
      mesh.rotation.set(burst * 3, angle, burst * 2); mesh.scale.setScalar(Math.max(0, 1 - burst / 2));
    }
    this.tape.visible = winner.id === 'officer_flock' && t >= 4;
    this.tape.scale.x = options.reducedMotion ? 1 : smooth((t - 4) / .8);
    return { definition, actors, frame, shot: lakeOutcomeCamera(frame, winner, loser,
      { ...options, finishedVictim: !!snapshot.finisher || loser.state === 'finished' }) };
  }
  pose(ending, views, snapshot) {
    if (!ending) return;
    for (const [side, actor] of ending.actors.entries()) {
      const view = views[side];
      if (!view?.pivot || !actor.cinematicClip?.startsWith('lakeAmerica')) continue;
      view.root.position.z = actor.z || 0;
      view.pivot.rotation.y = view.definition.facingRotationY - Math.PI / 2 + actor.outcomeYaw;
      // Both Flock reactions use his actual head and arm bones: a salute when
      // winning, a hand to the radio/ear before slumping when defeated.
      const t = ending.frame / 60;
      if (actor.id !== 'officer_flock' || (side === snapshot.winner ? t < 5.2 : t < .6 || t > 2.1)) continue;
      let head, hand;
      view.model.traverse(node => {
        if (node.isBone && /^(head|mixamorig:?Head(?:_\d+)?)$/i.test(node.name)) head = node;
        if (node.isBone && /^(handR|mixamorig:?RightHand(?:_\d+)?)$/i.test(node.name)) hand = node;
      });
      if (!head || !hand) continue;
      view.root.updateWorldMatrix(true, true);
      const target = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(.14, .06, .12));
      const weight = side === snapshot.winner ? smooth((t - 5.2) / .4)
        : smooth((t - .6) / .3) * (1 - smooth((t - 1.8) / .3));
      target.lerp(hand.getWorldPosition(new THREE.Vector3()), 1 - weight);
      const pole = target.clone().add(new THREE.Vector3(.65, -.35, .1));
      this.grips[side].apply(view.model, target, pole, 'R');
    }
  }
}
