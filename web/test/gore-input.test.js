import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerInput, connectedPads } from '../game/src/input/sources.js';
import { REGIONS, REGION_BY_ID, ORGANS, PROP_SOURCES, regionsForHeight } from '../game/src/render/goreAtlas.js';

// ---- gamepad ---------------------------------------------------------------

// A pad object shaped like the Standard Gamepad mapping an Xbox controller
// reports, with everything at rest unless named.
function xboxPad({ buttons = {}, axes = [0, 0, 0, 0], connected = true } = {}) {
  const list = [];
  for (let i = 0; i < 17; i++) {
    const value = buttons[i];
    list.push(typeof value === 'number'
      ? { pressed: value > 0.9, touched: value > 0.02, value }
      : { pressed: Boolean(value), touched: Boolean(value), value: value ? 1 : 0 });
  }
  return { connected, mapping: 'standard', buttons: list, axes };
}

const navWith = (...pads) => ({ getGamepads: () => pads });

test('a pad that connects late or at a high index is still found', () => {
  const player = new PlayerInput({ padIndex: 0, navigator: navWith(null, null, null) });
  assert.equal(player.connected, false, 'no pads means no pad');

  // The wireless adapter case: the only controller sits at raw index 3.
  player.navigator = navWith(null, null, null, xboxPad({ buttons: { 2: true } }));
  assert.equal(player.connected, true, 'a pad at index 3 must still be player one');
  assert.equal(player.poll().lp, true);
});

test('a disconnected pad hands its slot to the next one', () => {
  const p1 = new PlayerInput({ padIndex: 0 });
  const p2 = new PlayerInput({ padIndex: 1 });
  const first = xboxPad({ buttons: { 2: true } });
  const second = xboxPad({ buttons: { 3: true } });
  p1.navigator = p2.navigator = navWith(first, second);
  assert.equal(p1.poll().lp, true);
  assert.equal(p2.poll().hp, true);

  // Player one's pad sleeps. Player two must not silently lose their inputs.
  p1.navigator = p2.navigator = navWith({ ...first, connected: false }, second);
  assert.equal(p1.poll().hp, true, 'the surviving pad becomes slot zero');
  assert.equal(p2.connected, false);
});

test('analog triggers fire from their value, not only from pressed', () => {
  // Firefox reports a half-pulled trigger as value 0.6 with pressed false.
  const player = new PlayerInput({ padIndex: 0, navigator: navWith(xboxPad({ buttons: { 6: 0.6, 7: 0.7 } })) });
  const out = player.poll();
  assert.equal(out.block, true, 'LT must block at 0.6 travel');
  assert.ok(out.lk && out.hk, 'RT must produce the throw macro at 0.7 travel');

  // A worn trigger resting at 0.08 must not hold the button down forever.
  player.navigator = navWith(xboxPad({ buttons: { 6: 0.08, 7: 0.08 } }));
  const rest = player.poll();
  assert.equal(rest.block, false);
  assert.equal(rest.lk, false);
});

test('the stick deadzone is radial, so diagonals cost the same push as cardinals', () => {
  const player = new PlayerInput({ padIndex: 0 });
  // Below the old per-axis threshold on both axes, but a real diagonal push.
  player.navigator = navWith(xboxPad({ axes: [0.30, 0.30] }));
  const diagonal = player.poll();
  assert.ok(diagonal.right && diagonal.down, 'a diagonal at 0.30/0.30 must register');

  // Genuine rest must stay silent, drift included.
  player.navigator = navWith(xboxPad({ axes: [0.12, -0.09] }));
  const rest = player.poll();
  assert.ok(!rest.left && !rest.right && !rest.up && !rest.down, 'stick drift must not walk');
});

test('opposing directions cancel on both axes', () => {
  const player = new PlayerInput({ padIndex: 0 });
  // D-pad up plus stick down: previously this crouched and jumped at once.
  player.navigator = navWith(xboxPad({ buttons: { 12: true }, axes: [0, 0.9] }));
  const out = player.poll();
  assert.equal(out.up, false);
  assert.equal(out.down, false);
});

test('a hat-axis d-pad works where buttons 12-15 are absent', () => {
  const player = new PlayerInput({ padIndex: 0 });
  // Hat resting is outside [-1, 1] and must be ignored entirely.
  player.navigator = navWith(xboxPad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 3.29] }));
  const rest = player.poll();
  assert.ok(!rest.up && !rest.down && !rest.left && !rest.right);

  // Eighth 2 of 7 is due right.
  player.navigator = navWith(xboxPad({ axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1 + (2 / 7) * 2] }));
  assert.equal(player.poll().right, true);
});

test('connectedPads skips the null holes a disconnect leaves behind', () => {
  const pad = xboxPad();
  assert.equal(connectedPads(navWith(null, pad, null)).length, 1);
  assert.equal(connectedPads(navWith(null, null)).length, 0);
});

// ---- gore atlas ------------------------------------------------------------

test('every region names bones that exist on both rig conventions', () => {
  // The project rig from fighterRig.mjs, and the Source biped an imported
  // model such as Gib arrives on. A region matching neither is unreachable.
  const projectRig = ['head', 'neck', 'chest', 'spine', 'hips', 'upperArmL', 'forearmL', 'handL',
    'upperArmR', 'forearmR', 'handR', 'upLegL', 'legL', 'footL', 'upLegR', 'legR', 'footR'];
  const sourceRig = ['ValveBiped.Bip01_Head1', 'ValveBiped.Bip01_Neck1', 'ValveBiped.Bip01_Spine4',
    'ValveBiped.Bip01_Spine1', 'ValveBiped.Bip01_Pelvis', 'ValveBiped.Bip01_L_UpperArm',
    'ValveBiped.Bip01_L_ForeArm', 'ValveBiped.Bip01_L_Hand', 'ValveBiped.Bip01_R_UpperArm',
    'ValveBiped.Bip01_R_ForeArm', 'ValveBiped.Bip01_R_Hand', 'ValveBiped.Bip01_L_Thigh',
    'ValveBiped.Bip01_L_Calf', 'ValveBiped.Bip01_L_Foot', 'ValveBiped.Bip01_R_Thigh',
    'ValveBiped.Bip01_R_Calf', 'ValveBiped.Bip01_R_Foot'];
  const mixamoRig = ['mixamorigHead_62', 'mixamorigNeck_63', 'mixamorigSpine2_91',
    'mixamorigSpine_90', 'mixamorigHips_102', 'mixamorigLeftArm_75',
    'mixamorigLeftForeArm_74', 'mixamorigLeftHand_73', 'mixamorigRightArm_87',
    'mixamorigRightForeArm_86', 'mixamorigRightHand_85', 'mixamorigLeftUpLeg_96',
    'mixamorigLeftLeg_95', 'mixamorigLeftFoot_94', 'mixamorigRightUpLeg_101',
    'mixamorigRightLeg_100', 'mixamorigRightFoot_99'];

  for (const rig of [projectRig, sourceRig, mixamoRig]) {
    for (const region of REGIONS) {
      if (region.id === 'jaw') continue; // Facial bones are model-specific.
      assert.ok(region.chain.some(pattern => rig.some(bone => pattern.test(bone))),
        `${region.id} matches no bone in ${rig[0]}`);
      assert.ok(rig.some(bone => region.stump.test(bone)),
        `${region.id} has no stump bone in ${rig[0]}`);
    }
  }
});

test('a region never claims the bone it hangs from', () => {
  // If the stump were inside the chain, severing an arm would take the shoulder
  // with it and leave the wound floating where the body no longer is.
  for (const region of REGIONS) {
    const stumpBones = ['head', 'chest', 'spine', 'upperArmL', 'upperArmR', 'upLegL', 'upLegR'];
    const claimed = stumpBones.filter(bone => region.chain.some(p => p.test(bone)));
    assert.ok(!claimed.some(bone => region.stump.test(bone)),
      `${region.id} severs its own stump`);
  }
});

test('lethal regions sit below every survivable one', () => {
  const lethal = REGIONS.filter(r => r.lethal);
  const survivable = REGIONS.filter(r => !r.lethal);
  assert.ok(lethal.length >= 2, 'the head and the torso are the lethal pair');
  for (const l of lethal) {
    for (const s of survivable) {
      assert.ok(l.threshold <= s.threshold,
        `${l.id} must not be reachable before ${s.id}`);
    }
  }
});

test('height buckets cover the body and only name real regions', () => {
  for (const fraction of [0.05, 0.3, 0.5, 0.6, 0.8, 0.95, 1.2]) {
    const ids = regionsForHeight(fraction);
    assert.ok(ids.length > 0, `nothing is hittable at ${fraction}`);
    for (const id of ids) assert.ok(REGION_BY_ID[id], `unknown region ${id}`);
  }
  assert.ok(regionsForHeight(0.95).includes('head'), 'a high blow reaches the head');
  assert.ok(regionsForHeight(0.2).some(id => id.endsWith('Leg')), 'a low blow reaches the legs');
  assert.ok(!regionsForHeight(0.2).includes('head'), 'a sweep must not decapitate');
});

test('every organ a region spills is a defined organ', () => {
  for (const region of REGIONS) {
    for (const kind of region.organs) {
      assert.ok(ORGANS[kind], `${region.id} spills unknown organ ${kind}`);
      assert.ok(ORGANS[kind].span > 0 && ORGANS[kind].mass > 0);
    }
  }
  // The torso is the payoff: it has to be the one that empties out.
  assert.ok(REGION_BY_ID.torso.organs.length >= 4);
});

// ---- the viscera library ---------------------------------------------------

test('every organ the atlas spills has a built prop, at the size it declares', async () => {
  const { readFile } = await import('node:fs/promises');
  const built = JSON.parse(await readFile(new URL('../game/public/gore/viscera.json', import.meta.url)));
  const names = new Set(built.object.children.map(child => child.name));

  // Every organ any region spills must exist in the built library, or it
  // silently falls back to a blob and nobody notices the art never shipped.
  const spilled = new Set(REGIONS.flatMap(region => region.organs));
  for (const kind of spilled) {
    assert.ok(names.has(kind), `no built prop for ${kind}`);
  }

  // And every source the atlas lists must have produced one.
  for (const spec of PROP_SOURCES) {
    assert.ok(names.has(spec.id), `build dropped ${spec.id}`);
    assert.equal(spec.span, ORGANS[spec.id].span,
      `${spec.id} span disagrees between PROP_SOURCES and ORGANS`);
  }

  // Geometry is stripped to what a tumbling prop needs. A stray uv or skinning
  // channel is pure download weight for something the size of a fist.
  const geometries = new Map(built.geometries.map(g => [g.uuid, g]));
  for (const child of built.object.children) {
    const attributes = geometries.get(child.geometry)?.data?.attributes || {};
    assert.deepEqual(Object.keys(attributes).sort(), ['normal', 'position'],
      `${child.name} carries attributes it does not need`);
  }
});

test('a prop is the real-world size the atlas claims', async () => {
  const { readFile } = await import('node:fs/promises');
  const built = JSON.parse(await readFile(new URL('../game/public/gore/viscera.json', import.meta.url)));
  const geometries = new Map(built.geometries.map(g => [g.uuid, g]));

  for (const child of built.object.children) {
    const position = geometries.get(child.geometry).data.attributes.position.array;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < position.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], position[i + axis]);
        max[axis] = Math.max(max[axis], position[i + axis]);
      }
    }
    const longest = Math.max(...max.map((v, axis) => v - min[axis]));
    const span = ORGANS[child.name].span;
    assert.ok(Math.abs(longest - span) < 0.002,
      `${child.name} is ${longest.toFixed(3)}m on its longest axis, atlas says ${span}m`);
    // Centred on its own bounds, so it tumbles about itself rather than
    // orbiting a point somewhere off in the donor body's coordinate space.
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(min[axis] + max[axis]) < 0.01, `${child.name} is not centred`);
    }
  }
});

test('debris falls back to generated props when the library is absent', async () => {
  // Headless has no fetch target and no WebGL; the pool must still work, which
  // is what keeps a missing asset a downgrade rather than a broken match.
  const { GoreDebris } = await import('../game/src/render/goreProps.js');
  const scene = { add() {}, remove() {} };
  const pool = new GoreDebris(scene, { stage: null });
  assert.equal(pool.library.size, 0);
  const geometry = pool.geometryFor('heart');
  assert.ok(geometry?.attributes?.position, 'a generated heart must still be geometry');

  // The generated stand-in is the size the real mesh would have been.
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.max.y - geometry.boundingBox.min.y;
  assert.ok(size > 0 && size <= ORGANS.heart.span + 0.02,
    `generated heart is ${size.toFixed(3)}m against a ${ORGANS.heart.span}m span`);
});
