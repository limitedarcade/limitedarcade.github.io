import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Match, PHASE } from '../game/src/engine/match.js';
import { CpuController, DIFFICULTIES, TUNABLES } from '../game/src/engine/ai.js';
import { CommandResolver, emptyInput } from '../game/src/engine/commands.js';
import { MOVES } from '../game/src/engine/frameData.js';
import { CLIPS, createRig, sampleClip } from '../fighter-tool/tools/fighterRig.mjs';
import { loadPose } from '../fighter-tool/tools/poseSidecar.mjs';
import { fileURLToPath } from 'node:url';

test('paired inputs produce grab and throw without a stray single attack', () => {
  for (const [first, second, macro] of [['lp', 'hp', 'grab'], ['lk', 'hk', 'throw']]) {
    const commands = new CommandResolver();
    assert.equal(commands.step({ [first]: true }).attack, null);
    commands.step({ [first]: true, [second]: true });
    commands.step({ [first]: true, [second]: true });
    assert.equal(commands.step({ [first]: true, [second]: true }).macro, macro);
    for (let i = 0; i < 5; i++) assert.equal(commands.step(emptyInput()).attack, null);
  }
  assert.equal(new CommandResolver().step({ block: true, hp: true }).macro, 'finisher');
});

test('seeded CPU matches terminate with finite bounded state on all difficulties', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const match = new Match();
    const cpus = [0, 1].map(side => new CpuController({ side, difficulty, seed: 77 }));
    let contacts = 0;
    for (let frame = 0; frame < 40000 && match.phase !== PHASE.MATCH_END; frame++) {
      const events = match.step(cpus.map(cpu => cpu.poll(match)));
      contacts += events.filter(e => e.type === 'hit').length;
      for (const f of match.fighters) {
        assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y));
        assert.ok(f.health >= 0);
      }
    }
    assert.equal(match.phase, PHASE.MATCH_END, difficulty);
    assert.ok(contacts > 0, 'CPU must engage, not wait out every round');
  }
});

test('CPU reaches the whole move list, not just the buttons it can press alone', () => {
  // The CPU regressed to eight moves once already: every chord, both crouch
  // normals and all five meter specials were unreachable because the controller
  // only ever pressed single buttons, and nothing failed. Assert the catalog.
  const started = new Map(Object.keys(MOVES).map(k => [k, 0]));
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (let seed = 1; seed <= 8; seed++) {
      const match = new Match();
      const cpus = [0, 1].map(side => new CpuController({ side, difficulty, seed: seed * 101 }));
      const last = [null, null];
      for (let f = 0; f < 40000 && match.phase !== PHASE.MATCH_END; f++) {
        match.step(cpus.map(cpu => cpu.poll(match)));
        match.fighters.forEach((fighter, i) => {
          if (fighter.move && fighter.move !== last[i]) started.set(fighter.move, started.get(fighter.move) + 1);
          last[i] = fighter.move;
        });
      }
    }
  }
  const unused = [...started].filter(([, n]) => n === 0).map(([id]) => id);
  assert.deepEqual(unused, [], `CPU never used: ${unused.join(', ')}`);

  // Variety, not just coverage: no single move may dominate the CPU's offence,
  // which is what a fallback-to-heavy-punch controller looks like in the data.
  const total = [...started.values()].reduce((a, b) => a + b, 0);
  const [topMove, topCount] = [...started].sort((a, b) => b[1] - a[1])[0];
  assert.ok(topCount / total < 0.3, `${topMove} is ${Math.round(100 * topCount / total)}% of all moves`);
});

test('debug-studio CPU tuning overrides the preset and survives a difficulty change', () => {
  // Every knob the panel shows has to exist on the preset, or a slider is
  // driving a key the AI never reads and nothing anywhere would say so.
  for (const t of TUNABLES) assert.ok(t.key in DIFFICULTIES.normal, `unknown tunable ${t.key}`);

  const cpu = new CpuController({ side: 0, difficulty: 'normal' });
  cpu.setTuning('jumpChance', 0.9);
  assert.equal(cpu.params.jumpChance, 0.9);
  cpu.setDifficulty('easy');
  assert.equal(cpu.params.jumpChance, 0.9, 'override must outlive a difficulty change');
  assert.equal(cpu.params.aggression, DIFFICULTIES.easy.aggression, 'untouched knobs still follow the preset');
  cpu.resetTuning();
  assert.equal(cpu.params.jumpChance, DIFFICULTIES.easy.jumpChance);

  // The override has to actually reach behaviour, not just the params object.
  const jumpsWith = value => {
    const match = new Match();
    const cpus = [0, 1].map(side => new CpuController({ side, difficulty: 'normal', seed: 313 }));
    for (const c of cpus) c.setTuning('jumpChance', value);
    let jumps = 0;
    for (let f = 0; f < 4000 && match.phase !== PHASE.MATCH_END; f++)
      jumps += match.step(cpus.map(c => c.poll(match))).filter(e => e.type === 'jump').length;
    return jumps;
  };
  assert.equal(jumpsWith(0), 0, 'a zeroed jump chance must ground the CPU');
  assert.ok(jumpsWith(0.9) > 5, 'a raised jump chance must show up in the match');
});

test('CPU jumps in, grabs and throws often enough to be seen playing', () => {
  // Coverage above only proves a move is reachable. These three were reachable
  // and still effectively absent from matches: the jump-in intent expired
  // mid-air before the swing, and the grapple branches were reading the
  // leftovers of a roll the specials had already consumed. Assert a rate.
  let jumps = 0;
  const started = { jumpAttack: 0, grab: 0, throw: 0 };
  let rounds = 0;
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (let seed = 1; seed <= 6; seed++) {
      const match = new Match();
      const cpus = [0, 1].map(side => new CpuController({ side, difficulty, seed: seed * 101 }));
      const last = [null, null];
      rounds += 1;
      for (let f = 0; f < 40000 && match.phase !== PHASE.MATCH_END; f++) {
        jumps += match.step(cpus.map(cpu => cpu.poll(match))).filter(e => e.type === 'jump').length;
        match.fighters.forEach((fighter, i) => {
          if (fighter.move && fighter.move !== last[i] && fighter.move in started) started[fighter.move] += 1;
          last[i] = fighter.move;
        });
      }
    }
  }
  assert.ok(jumps / rounds >= 4, `only ${(jumps / rounds).toFixed(1)} jumps per match`);
  for (const [move, floor] of [['jumpAttack', 3], ['grab', 3], ['throw', 3]]) {
    assert.ok(started[move] / rounds >= floor,
      `${move}: ${(started[move] / rounds).toFixed(1)} per match, want ${floor}`);
  }
});

for (const id of ['trump', 'carney']) {
  test(`${id} runtime includes every combat clip and a skin`, () => {
    const buf = readFileSync(new URL(`../game/public/fighters/${id}/${id}-rigged.glb`, import.meta.url));
    const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
    const names = new Set(gltf.animations.map(a => a.name));
    for (const clip of CLIPS) assert.ok(names.has(clip.name), `Missing ${clip.name}`);
    for (const move of Object.values(MOVES)) assert.ok(names.has(move.clip));
    assert.ok(gltf.skins[0].joints.length >= 25);
  });

  test(`${id} baked body joints stay above the floor across every clip`, () => {
    const path = fileURLToPath(new URL(`../fighter-tool/build/${id}/${id}_joints.json`, import.meta.url));
    const meas = JSON.parse(readFileSync(path));
    const rig = createRig(meas.joints, meas.bounds, loadPose(path));
    for (const clip of CLIPS.filter(c => !c.bind)) {
      for (const [t, pose] of sampleClip(clip, rig)) {
        for (const n of rig.fk(pose).list.slice(1)) {
          const y = rig.toView(n.pos)[1];
          assert.ok(Number.isFinite(y) && y >= 0.0139, `${clip.name} at ${t}: ${y}`);
        }
      }
    }
  });
}

// The CPU going quiet on most of the move list is a silent failure: the match
// still plays, it just plays the same three answers. This walks real matches
// and asserts the whole kit shows up, so a move added to moveList.js that the
// CPU cannot reach fails here rather than going unnoticed for a release.
test('the CPU exercises the whole move list, including kit projectiles', () => {
  const expected = ['lightPunch', 'heavyPunch', 'lightKick', 'heavyKick', 'crouchPunch',
    'crouchKick', 'uppercut', 'lungePunch', 'retreatKick', 'bodyCheck', 'heelDrop',
    'risingKnee', 'powerStrike', 'hammerRush', 'meteorKick', 'cyclone', 'groundBreaker',
    'grab', 'throw', 'jumpAttack'];
  const seen = new Set();
  const rangedFrom = new Map();
  for (let seed = 0; seed < 16; seed++) {
    const left = seed % 2 ? 'officer_flock' : 'trump';
    const match = new Match({ left: { id: left }, right: { id: 'carney' } });
    const cpus = [new CpuController({ side: 0, difficulty: 'hard', seed: seed * 31 + 1 }),
      new CpuController({ side: 1, difficulty: 'normal', seed: seed * 77 + 5 })];
    const prev = [null, null];
    for (let f = 0; f < 7200 && !match.snapshot().winner; f++) {
      match.step(cpus.map(c => c.poll(match)));
      const snap = match.snapshot();
      snap.fighters.forEach((fighter, i) => {
        if (fighter.move && fighter.move !== prev[i]) {
          seen.add(fighter.move);
          // Where the officer's throws are started from: the point of a ranged
          // move is that it is thrown from outside melee, not walked into.
          if (left === 'officer_flock' && i === 0 && (fighter.move === 'lungePunch' || fighter.move === 'powerStrike')) {
            rangedFrom.set(fighter.move, Math.max(rangedFrom.get(fighter.move) || 0, snap.distance));
          }
        }
        prev[i] = fighter.move;
      });
    }
  }
  for (const move of expected) assert.ok(seen.has(move), `CPU never used ${move}`);
  for (const move of ['lungePunch', 'powerStrike']) {
    assert.ok((rangedFrom.get(move) || 0) > 2.6, `Flock threw ${move} only from melee range`);
  }
});
