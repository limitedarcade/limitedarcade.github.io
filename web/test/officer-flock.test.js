import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../game/src/vendor/three.module.js';
import { FighterView } from '../game/src/render/fighterView.js';
import { getFighter } from '../game/src/fighters/catalog.js';
import { MOVES } from '../game/src/engine/frameData.js';

test('Officer Flock retains textured geometry, closed hands and every standard move clip', async () => {
  const data = JSON.parse(readFileSync(new URL('../game/public/fighters/officer_flock/model.json', import.meta.url)));
  const definition = getFighter('officer_flock');
  assert.equal(definition.combat.id, 'officer');
  const clips = new Set(data.animations.map(c => c.name));
  for (const move of Object.values(MOVES)) assert.ok(clips.has(move.clip), `Missing ${move.clip}`);
  assert.equal(data.images.length, 9);
  assert.ok(data.materials.some(m => m.normalMap));
  assert.ok(data.materials.some(m => m.roughnessMap));
  assert.equal(data.geometries.reduce((n,g) => n + g.data.index.array.length / 3, 0), 134431);
  for (const clip of data.animations) assert.ok(THREE.AnimationClip.parse(clip).validate());
  // Decode textures without a DOM/GPU: the bounds regression is in the rig.
  const original = THREE.ImageLoader.prototype.load;
  THREE.ImageLoader.prototype.load = function(url,onLoad) { const image={src:url}; queueMicrotask(()=>onLoad?.(image)); return image; };
  try {
    const model = await new THREE.ObjectLoader().parseAsync(data);
    const view = new FighterView(definition,{scene:new THREE.Scene()});
    view.dress(model); view.place(model); model.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y - 1.92) < 0.02, `Height ${size.y}`);
    let curled = 0;
    model.traverse(node => { if (/Hand(Index|Middle|Ring|Pinky)[23]_/.test(node.name) && Math.abs(node.quaternion.x) > .25) curled++; });
    assert.equal(curled, 4); // This rig has one grouped finger chain per hand.

    const head = model.getObjectByName('mixamorigHead_63');
    const rigid = [], body = [];
    model.traverse(node => {
      if (node.isMesh && !node.isSkinnedMesh) rigid.push(node);
      if (node.isSkinnedMesh) body.push(node);
    });
    assert.ok(head && rigid.length === 2);
    for (const mesh of rigid) assert.equal(mesh.parent, head, `${mesh.name} must follow the animated head`);
    const bodyTop = Math.max(...body.map(mesh => new THREE.Box3().setFromObject(mesh).max.y));
    const headBottom = Math.min(...rigid.map(mesh => new THREE.Box3().setFromObject(mesh).min.y));
    assert.ok(bodyTop - headBottom > 0.04, `Head/collar overlap is only ${(bodyTop - headBottom).toFixed(3)}m`);
    view.dispose();
  } finally { THREE.ImageLoader.prototype.load = original; }
});



