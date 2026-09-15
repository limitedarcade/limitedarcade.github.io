// Read-only production audit. No exports, asset regeneration, browser or GPU.
// Run: node tools/audit-carney.mjs [--json]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { carneyFighter } from '../game/src/fighters/carney.js';
import { FighterView, clipForState } from '../game/src/render/fighterView.js';
import { CONTACT_MARKERS } from '../game/src/render/clipTiming.js';
import { decodeClips } from '../game/src/render/binaryClips.js';
import { SPECIAL_CLIPS } from '../fighter-tool/tools/specialClips.mjs';

if (process.argv.slice(2).some(arg => arg !== '--json')) {
  throw new Error('Usage: node tools/audit-carney.mjs [--json]');
}
const read = path => readFileSync(new URL(`../${path}`, import.meta.url));
const glbPath = `game/public/${carneyFighter.runtimeAsset}`;
const packPath = 'game/public/fighters/carney/combat.bin';
const bytes = read(glbPath);
if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(16) !== 0x4e4f534a) {
  throw new Error('Expected a GLB with a JSON first chunk');
}
const glb = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const binary = read(packPath);
const extras = carneyFighter.extraClips === false ? [] : decodeClips(
  binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
const clips = Object.fromEntries(glb.animations.map(clip => [clip.name, {
  duration: Math.max(...clip.samplers.map(s => glb.accessors[s.input].max[0])),
  source: 'GLB',
}]));
for (const clip of extras) clips[clip.name] = { duration: clip.duration, source: 'combat.bin' };
const available = Object.keys(clips);
const resolve = key => FighterView.prototype.resolveClip.call({ actions: clips, available }, key);
const round = value => Math.round(value * 1000) / 1000;
const phases = Object.fromEntries(SPECIAL_CLIPS.map(clip => [clip.name, {
  contact: clip.keys[2][0], release: clip.keys[3][0], duration: clip.keys.at(-1)[0],
}]));

const moves = Object.values(carneyFighter.combat.moves).map(move => {
  // Same move-id precedence as FighterView.apply; resolveClip itself is reused.
  const selected = resolve(clips[move.id] ? move.id : clipForState({ state: 'attack', moveData: move }));
  const clip = clips[selected];
  const markers = carneyFighter.contactMarkers?.[selected] || CONTACT_MARKERS[selected];
  const authored = phases[selected];
  const total = move.startup + move.active + move.recovery;
  const result = {
    id: move.id, name: move.name, declaredClip: move.clip, selectedClip: selected,
    source: clip.source, frames: [move.startup, move.active, move.recovery],
    sampling: markers ? 'phase markers' : 'whole duration',
  };
  if (markers) result.markersSeconds = markers;
  // These are authored phase timestamps, NOT measured limb/opponent contact.
  // Only compare this canonical exporter when the packed duration agrees.
  if (authored && clip.source === 'combat.bin' && Math.abs(authored.duration - clip.duration) < 1e-5) {
    result.authoredPhaseSeconds = [round(authored.contact), round(authored.release)];
    if (!markers) {
      result.phaseDriftFrames = [round(authored.contact / clip.duration * total - move.startup),
        round(authored.release / clip.duration * total - move.startup - move.active)];
    }
  }
  return result;
});
const fingerprints = Object.fromEntries([
  glbPath, packPath, 'game/src/fighters/carney.js', 'game/src/fighters/carney/moves.js',
  'game/src/render/fighterView.js', 'game/src/render/clipTiming.js',
  'game/src/render/movementPose.js', 'fighter-tool/tools/specialClips.mjs',
].map(path => [path, createHash('sha256').update(read(path)).digest('hex')]));
const report = {
  generatedAt: new Date().toISOString(), fighter: 'carney',
  evidence: 'Source and exported-asset audit; no visual review or performance measurement.',
  asset: { path: glbPath, bytes: bytes.length, skinBones: glb.skins[0].joints.map(i => glb.nodes[i].name),
    meshes: glb.meshes.length, images: glb.images?.length || 0,
    morphTargetPrimitives: glb.meshes.flatMap(m => m.primitives).filter(p => p.targets?.length).length },
  baseClips: glb.animations.map(c => c.name), extraClips: extras.map(c => c.name),
  movement: ['guard', 'walkF', 'walkB', 'sprint', 'backHop', 'jump', 'land', 'juggle', 'getUp']
    .map(state => ({ state, clip: resolve(state), dedicated: Boolean(clips[state]) })),
  moves, fingerprints,
};
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Carney: ${report.asset.skinBones.length} bones, ${report.baseClips.length} base + ${extras.length} packed clips, ${(bytes.length / 1024 / 1024).toFixed(2)} MiB GLB`);
  console.log(report.evidence);
  console.log(`Movement fallbacks: ${report.movement.filter(m => !m.dedicated).map(m => `${m.state} -> ${m.clip}`).join(', ') || 'none'}`);
  console.log(`Phase-marked attacks: ${moves.filter(m => m.sampling === 'phase markers').length}/${moves.length}`);
  console.log('Special phase drift: contact / release in simulation frames (+ late, - early).');
  for (const move of moves.filter(m => m.phaseDriftFrames)) {
    console.log(`  ${move.id}: ${move.phaseDriftFrames.join(' / ')}; selected ${move.selectedClip}, declared ${move.declaredClip}`);
  }
  console.log('Use --json for complete move mapping and SHA-256 fingerprints.');
}
