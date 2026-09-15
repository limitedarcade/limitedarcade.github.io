import * as THREE from '../vendor/three.module.js';
import { REGIONS, REGION_BY_ID, ORGANS, regionsForHeight } from './goreAtlas.js';
import { StumpFlesh } from './stumpFlesh.js';

// When a fighter comes apart, and into what.
//
// The rule this is built around: a limb is never taken by the health bar alone.
// A region severs when it has been *hit* while the fighter is below that
// region's threshold, so the damage on screen is a record of how the round was
// actually fought. Beating someone to the body opens the torso; headhunting
// takes the head. A fighter who never gets hit in the legs keeps them.
//
// The severance itself is four things happening on one frame -- the geometry
// leaves the body, the limb becomes a prop with the body's momentum, the
// stump starts bleeding, and a meat plug with hanging strands fills the
// sleeve the cut opened -- and all four are driven from the same posed
// skeleton, so they agree about where the cut was.

const origin = new THREE.Vector3();
const velocity = new THREE.Vector3();
const bonePosition = new THREE.Vector3();

// How much of a hit's force is inherited by what it removes. A limb that flies
// off along the blow reads as caused by it; one that drops straight down reads
// as a bug.
const INHERIT = 0.55;

export class Dismemberment {
  constructor({ damage, model, debris, side = 0 }) {
    this.damage = damage;
    this.model = model;
    this.debris = debris;
    this.side = side;
    this.severed = new Set();
    this.pending = [];
    this.enabled = true;
    this.flesh = new StumpFlesh(model, damage);
  }

  get count() { return this.severed.size; }

  has(regionId) { return this.severed.has(regionId); }

  // Locate a region's stump bone on the *posed* skeleton, so the wound is where
  // the limb is now rather than where the bind pose left it.
  stumpPoint(region, out) {
    let found = null;
    this.model.traverse(node => {
      if (found || !node.isBone) return;
      if (region.stump.test(node.name)) found = node;
    });
    if (!found) return null;
    found.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(found.matrixWorld);
  }

  // A hit landed. Decide whether it takes something with it.
  //
  // `healthPct` gates which regions are eligible at all; the hit's height picks
  // which of those it could plausibly have removed. Both have to agree, which
  // is what stops a body blow at 20% health from taking a head off.
  onHit(event, healthPct, { standHeight = 1.86 } = {}) {
    if (!this.enabled || !event || event.type === 'block') return null;
    if (!Number.isFinite(event.y)) return null;
    const fraction = THREE.MathUtils.clamp(event.y / standHeight, 0, 1.4);
    // A thrown axe is an edged weapon arriving at speed: it takes a limb on the
    // hit that lands it, at any health, rather than waiting for the usual
    // attrition thresholds. Height still decides which limb.
    const gate = event.weapon === 'axe' ? 0 : healthPct;
    const candidates = regionsForHeight(fraction)
      .map(id => REGION_BY_ID[id])
      .filter(region => region && !this.severed.has(region.id) && gate <= region.threshold);
    if (!candidates.length) return null;

    // A lethal region is never taken by an ordinary hit -- those are reserved
    // for the KO and the finisher, which call `sever` directly. Otherwise the
    // round would routinely end on a decapitation nobody chose.
    const takeable = candidates.filter(region => !region.lethal);
    if (!takeable.length) return null;

    // Bigger hits take bigger things. Within what is eligible, a heavy blow
    // reaches past the arm for the leg rather than always removing the first
    // match in the table.
    const force = THREE.MathUtils.clamp((event.bloodScale || 1) * (event.knockdown ? 1.5 : 1), 0.4, 4);
    if (force < 1.15) return null;
    const region = takeable[Math.min(takeable.length - 1, Math.floor(Math.random() * takeable.length))];
    return this.sever(region.id, {
      dx: event.push ?? (this.side === 0 ? -1 : 1),
      dy: 0.5 + force * 0.2,
      force,
    });
  }

  // Take a region off. Safe to call for something already gone.
  sever(regionId, { dx = 0, dy = 1, force = 1.6, cinematic = false } = {}) {
    let region = REGION_BY_ID[regionId];
    if (!region || this.severed.has(regionId) || !this.enabled) return null;
    if (cinematic && /Arm$/.test(regionId)) region = { ...region, chain: [...region.chain, region.stump] };
    if (cinematic && regionId === 'head') region = { ...region, chain: [region.chain[0]], stump: region.chain[1] };
    // Authored six-part fighters have an explicit Head mesh. Their face can
    // retain chest weights near the neck; the entire named part must detach.
    const removed = this.damage.severByBones(region.chain, {
      wholeMeshes: cinematic && regionId === 'head' ? [/^Head(?:_\d+)?$/i] : [],
    });
    // No geometry answered to those bones: this model does not have that part
    // rigged separately, so there is nothing to take. Recording it as severed
    // anyway would silently retire the region for the rest of the match.
    if (!removed || !removed.length) return null;
    this.severed.add(regionId);

    const point = this.stumpPoint(region, origin);
    if (!point) origin.set(0, 1, 0).applyMatrix4(this.model.matrixWorld);

    const direction = Math.sign(dx) || (this.side === 0 ? -1 : 1);
    const pieces = [];
    for (const chunk of removed) {
      const { positions } = chunk;
      velocity.set(
        direction * (1.6 + force * 1.5) * INHERIT + (Math.random() - 0.5) * 1.2,
        (dy + 1.4) * (0.8 + force * 0.25),
        (Math.random() - 0.5) * 1.8,
      );
      const piece = cinematic
        ? this.debris?.addSurfaceLimb(chunk, origin, velocity, { mass: region.mass })
        : this.debris?.addLimb(positions, origin, velocity, { mass: region.mass });
      if (piece) pieces.push(piece);
    }

    // Organs follow the cut, thrown a little more softly than the limb so they
    // trail behind it instead of arriving together in a clump.
    for (const kind of cinematic ? [] : region.organs) {
      if (!ORGANS[kind]) continue;
      velocity.set(
        direction * (0.9 + force) * INHERIT + (Math.random() - 0.5) * 2.4,
        dy + 0.8 + Math.random() * 1.9,
        (Math.random() - 0.5) * 2.2,
      );
      this.debris?.addOrgan(kind, origin, velocity);
    }

    this.damage.bleedStump(origin, region.spurt);
    this.flesh.attach(region, { force, dx, dy, debris: this.debris });
    // Queued rather than returned into the caller's frame: the renderer wants
    // to run its own spray, shake and sound off this, and doing that inside a
    // hit handler would put VFX ordering inside the gore system.
    const record = { region: region.id, x: origin.x, y: origin.y, z: origin.z, force, lethal: region.lethal, pieces };
    this.pending.push(record);
    return record;
  }

  // Everything at once, for a finisher. Ordered so the body falls apart from
  // the extremities inward rather than the head simply vanishing first.
  explode({ force = 3.2 } = {}) {
    const order = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'jaw', 'torso', 'head'];
    const results = [];
    for (const id of order) {
      const result = this.sever(id, {
        dx: (Math.random() - 0.5) * 2,
        dy: 1.2 + Math.random(),
        force: force * (0.7 + Math.random() * 0.6),
      });
      if (result) results.push(result);
    }
    return results;
  }

  // Drain the queue of severance events for the frame.
  drain() {
    if (!this.pending.length) return null;
    const events = this.pending;
    this.pending = [];
    return events;
  }

  update(dt) {
    this.flesh.update(dt);
  }

  resetRound() {
    this.severed.clear();
    this.pending.length = 0;
    this.flesh.reset();
  }

  dispose() {
    this.resetRound();
    this.flesh.dispose();
  }
}

export { REGIONS, REGION_BY_ID };
