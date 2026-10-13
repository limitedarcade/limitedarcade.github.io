import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import * as T from '../game/src/vendor/three.module.js';
import { FighterDamage } from '../game/src/render/fighterDamage.js';
import { GoreDebris } from '../game/src/render/goreProps.js';
import { Dismemberment } from '../game/src/render/dismemberment.js';
import { decodeModelPack } from '../game/src/render/modelPack.js';
import { decodeModel, buildFighter } from '../game/src/fighters/_shared/meshCodec.js';

// Compare complete cut output with a Git revision, independently of frame
// timing. No browser or GPU noise; all source vertices, UVs and normals count.
const revision = process.argv[2] || 'HEAD';
const baseline = execFileSync('git', ['rev-parse', revision], { encoding: 'utf8' }).trim();
function originalURL(file, overrides = {}) {
  const source = execFileSync('git', ['show', `${baseline}:web/game/src/render/${file}`], { encoding: 'utf8' });
  const absolute = source.replace(/from '([^']+)'/g, (_, name) =>
    `from '${overrides[name] || new URL(name, pathToFileURL(resolve('game/src/render', file))).href}'`);
  return `data:text/javascript;base64,${Buffer.from(absolute).toString('base64')}`;
}
const { FighterDamage: BeforeDamage } = await import(originalURL('fighterDamage.js'));
const { GoreDebris: BeforeDebris } = await import(originalURL('goreProps.js'));
const { Dismemberment: BeforeGore } = await import(originalURL('dismemberment.js', { './stumpFlesh.js': originalURL('stumpFlesh.js') }));
const libraryJSON = JSON.parse(await readFile('game/public/gore/cut-surfaces.json', 'utf8'));
const report = { baseline, cases: [], maxError: 0 };

function compare(a, b, label) {
  if (typeof a === 'number' && typeof b === 'number') {
    assert.ok(Number.isFinite(a) && Number.isFinite(b), label);
    const error = Math.abs(a - b); report.maxError = Math.max(report.maxError, error);
    assert.ok(error <= 1e-6, `${label}: ${a} != ${b}`); return;
  }
  if (Array.isArray(a)) {
    assert.equal(b.length, a.length, `${label}: detail count`);
    for (let i = 0; i < a.length; i++) compare(a[i], b[i], `${label}[${i}]`);
  } else if (a && typeof a === 'object') {
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), label);
    for (const key of Object.keys(a)) compare(a[key], b[key], `${label}.${key}`);
  } else assert.equal(b, a, label);
}
const geometryData = geometry => ({
  attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, attr]) => [key, Array.from(attr.array)])),
  index: geometry.index ? Array.from(geometry.index.array) : null, groups: geometry.groups,
});

for (const fighter of ['carney', 'trump', 'lang', 'officer_flock']) {
  let model, built;
  if (fighter === 'officer_flock') {
    const source = JSON.parse(await readFile('game/public/fighters/officer_flock/model.json', 'utf8'));
    for (const image of source.images || []) image.url = { data: [255,255,255,255], width: 1, height: 1, type: 'Uint8Array' };
    model = new T.ObjectLoader().parse(source);
  } else if (fighter === 'lang') {
    const bytes = await readFile('game/public/fighters/lang/fighter.bin');
    const pack = decodeModelPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    built = buildFighter(T, pack.model, null, pack.rig, { decodedParts: decodeModel(pack.model, pack.stream) }); model = built.group;
  } else {
    const factory = await import(`../game/src/fighters/${fighter}/createFighterModel.js`);
    await factory.prewarm(); built = factory.createFighter(); model = built.group;
  }
  const scene = new T.Scene(); scene.add(model); model.updateMatrixWorld(true);
  model.scale.multiplyScalar(1.9 / new T.Box3().setFromObject(model).getSize(new T.Vector3()).y);
  model.position.set(1.2, .1, -.3);
  model.traverse(node => { if (node.isBone && /arm|leg|fore|thigh|shin|spine/i.test(node.name)) node.rotation.z += .13; });
  for (const facing of [0, Math.PI]) for (const cinematic of [false, true]) {
    model.rotation.y = facing; model.updateMatrixWorld(true);
    const outputs = [];
    for (const [Damage, Debris, Gore] of [[BeforeDamage, BeforeDebris, BeforeGore], [FighterDamage, GoreDebris, Dismemberment]]) {
      const damage = new Damage(model), debris = new Debris(scene);
      const library = new T.ObjectLoader().parse(libraryJSON);
      for (const mesh of library.children) { debris.library.set(mesh.name, mesh.geometry); debris.libraryMaterials.set(mesh.name, mesh.material); }
      const gore = new Gore({ damage, model, debris });
      if (Gore === Dismemberment) debris.warmupMeshes([{ damage, gore }]);
      const cases = [];
      for (const cuts of [['leftArm'], ['rightArm'], ['leftLeg'], ['rightLeg'], ['torso'], ['head'], ['leftArm', 'rightArm', 'head']]) {
        const result = [];
        for (const id of cuts) {
          const cut = gore.sever(id, { cinematic });
          result.push({ id, masks: damage.meshes.map(r => Array.from(r.sever.array)),
            damage: damage.meshes.map(r => Array.from(r.damage.array)), woundCount: damage.woundCount.value, wounds: damage.wounds.slice(0, damage.woundCount.value).map(w => w.toArray()),
            pieces: cut?.pieces.map(p => { const meshes = []; p.mesh.traverse(n => { if (n.isMesh) meshes.push({ name: n.name, geometry: geometryData(n.geometry) }); }); return meshes; }) || [],
            stumps: gore.flesh.stumps.map(s => ({ id: s.regionId, radius: s.worldRadius, samples: s.seam.samples.map(v => [damage.meshes.indexOf(v.record), v.a, v.b, v.t]), strands: s.strands.length })) });
        }
        cases.push(result); debris.resetRound(); gore.resetRound(); damage.resetRound();
      }
      outputs.push(cases); gore.dispose(); damage.dispose(); debris.dispose();
    }
    compare(outputs[0], outputs[1], `${fighter}/${facing}/${cinematic}`);
    report.cases.push({ fighter, facing, cinematic, cuts: 9, match: true });
    console.log(`${fighter}, facing ${facing.toFixed(2)}, cinematic ${cinematic}: all surfaces match`);
  }
  built?.dispose();
}
const out = resolve('artifacts/severance-2026-10-12'); await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'geometry-parity.json'), JSON.stringify(report, null, 2));
console.log(`Verified ${report.cases.length * 9} cuts; maximum numeric difference ${report.maxError}.`);
