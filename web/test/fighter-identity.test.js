import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE } from '../game/src/engine/match.js';
import { Fighter } from '../game/src/engine/fighter.js';
import { CpuController } from '../game/src/engine/ai.js';
import { MATCH, MOVES, moveOf } from '../game/src/engine/frameData.js';
import { combatKitFor } from '../game/src/fighters/combatKits.js';
import { FATALITY_REGISTRY, FINISHER_SCRIPTS, BRUTALITY, fatalitiesFor, FinisherCommandBuffer,
  finisherCinematicAt } from '../game/src/engine/fatalities.js';
import { endCard, reelAt } from '../game/src/engine/reelTimeline.js';
import { CHORDS, DIRECTIONAL } from '../game/src/engine/moveList.js';

function setupWindow(id = 'trump', side = 0, distance = 1, stageId = 'lake-america') {
  const opponent = id === 'trump' ? 'carney' : 'trump';
  const m = new Match({ left: { id: side === 0 ? id : opponent }, right: { id: side === 1 ? id : opponent }, roundsToWin: 1, stageId });
  m.roundWinner = side;
  m.fighters[side].roundsWon = 1;
  m.fighters.forEach((f, i) => { f.x = (i ? 1 : -1) * distance / 2; f.state = 'idle'; });
  m.fighters[1 - side].health = 0;
  m.fighters[1 - side].enterDizzy();
  m.setPhase(PHASE.FINISHER_WINDOW);
  return m;
}

function typeCommand(match, side, command) {
  let events = [];
  for (const token of command) {
    const facing = match.fighters[side].facing;
    const key = token === 'forward' ? (facing > 0 ? 'right' : 'left') : token === 'back' ? (facing > 0 ? 'left' : 'right') : token;
    const inputs = [{}, {}]; inputs[side] = { [key]: true };
    events.push(...match.step(inputs));
    if (match.phase === PHASE.FINISHER) break;
    events.push(...match.step([{}, {}]));
  }
  return events;
}

test('arcade loadouts own their overrides without mutating the universal move table', () => {
  const breaker = combatKitFor('trump'), strider = combatKitFor('carney');
  assert.equal(breaker.maxHealth, strider.maxHealth, 'life bar capacity is universal');
  assert.equal(Object.keys(breaker.moves).length, Object.keys(MOVES).length);
  assert.deepEqual(Object.keys(strider.moves).filter(id => !MOVES[id]), ['spinKick']);
  assert.notEqual(breaker.moves.hammerRush.name, strider.moves.hammerRush.name);
  assert.notEqual(breaker.moves.heavyPunch.startup, strider.moves.heavyPunch.startup);
  assert.notEqual(breaker.physics.walkBack, strider.physics.walkBack);
  assert.equal(MOVES.heavyPunch.startup, 9);
  assert.equal(moveOf('heavyPunch'), MOVES.heavyPunch);
  assert.equal(moveOf('heavyPunch', breaker), breaker.moves.heavyPunch);
  for (const kit of [breaker, strider]) for (const move of Object.values(kit.moves)) {
    assert.ok(Object.isFrozen(move) && Object.isFrozen(move.hit.box));
    assert.ok(move.startup >= 1 && move.active >= 1 && move.recovery >= 1);
  }
});

test('fighter timing, movement and contact resolve from its selected loadout', () => {
  const m = new Match({ left: { id: 'trump' }, right: { id: 'carney' } });
  m.setPhase(PHASE.FIGHT); m.fighters.forEach(f => { f.state = 'idle'; });
  const before = m.fighters.map(f => f.x);
  m.step([{ left: true }, { right: true }]);
  m.fighters.forEach((f, side) => assert.ok(Math.abs(Math.abs(f.x - before[side]) - f.physics.walkBack / 60) < 1e-8));
  m.left.x = -0.4; m.right.x = 0.4;
  m.left.startMove('heavyPunch'); m.right.state = 'idle';
  m.left.moveFrame = MOVES.heavyPunch.startup - 1;
  assert.ok(!m.step([{}, {}]).some(e => e.type === 'hit'), 'base startup must not leak into the slower kit');
  m.left.moveFrame = m.left.moveOf().startup - 1;
  const events = m.step([{}, {}]);
  const hit = events.find(e => e.type === 'hit');
  assert.equal(hit.damage, m.left.moves.heavyPunch.hit.damage);
  assert.equal(hit.moveName, m.left.moves.heavyPunch.name);
  assert.equal(m.snapshot().fighters[0].moveData.startup, m.left.moves.heavyPunch.startup);
  const custom = new Fighter({ id: 'practice', side: 0, combatKit: 'strider' });
  assert.equal(custom.moveOf('lightPunch'), combatKitFor('carney').moves.lightPunch);
});

test('every fighter secret works on either side and locks the authored cinematic immediately', () => {
  for (const id of ['trump', 'carney']) for (const side of [0, 1]) {
    assert.equal(FATALITY_REGISTRY[id].length, 2);
    for (const definition of FATALITY_REGISTRY[id]) {
      const m = setupWindow(id, side, (definition.range.min + definition.range.max) / 2);
      const events = typeCommand(m, side, definition.command);
      assert.equal(m.phase, PHASE.FINISHER, `${definition.id} side ${side}`);
      assert.equal(m.finisher.id, definition.id);
      assert.deepEqual(m.inputGate().allowInput, [false, false]);
      assert.ok(events.some(e => e.type === 'finisherStart' && e.finisherId === definition.id));
      assert.equal(m.fatality, true);
    }
  }
});

test('stage secrets and joke share real input handling and keep distinct outcomes', () => {
  for (const stageId of ['lake-america', 'capitol', 'palm-resort', 'executive-lawn']) {
    const m = setupWindow('carney', 0, 2.2, stageId);
    const definition = fatalitiesFor('carney', stageId).find(f => f.kind === 'stage');
    typeCommand(m, 0, definition.command);
    assert.equal(m.finisher.kind, 'stage'); assert.equal(m.finisher.stageId, stageId);
    assert.equal(endCard(m.snapshot()).title, 'STAGE FATALITY');
  }
  const m = setupWindow();
  typeCommand(m, 0, ['down', 'down', 'lp']);
  assert.equal(m.finisher.kind, 'friendship'); assert.equal(m.fatality, false);
  assert.equal(endCard(m.snapshot()).kind, 'friendship');
  const finalEvents = [];
  while (m.phase !== PHASE.MATCH_END) finalEvents.push(...m.step([{}, {}]));
  assert.equal(finalEvents.find(e => e.type === 'finisher').bloodScale, 0);
  assert.equal(m.right.state, 'defeat');
});

test('finisher command rejects wrong range, stale directions, held repeats and input outside its window', () => {
  const m = setupWindow('trump', 0, 3.8);
  const events = typeCommand(m, 0, FATALITY_REGISTRY.trump[0].command);
  assert.equal(m.phase, PHASE.FINISHER_WINDOW);
  assert.ok(events.some(e => e.type === 'finisherRange'));
  assert.equal(m.left.move, null, 'rejected final button must not produce an ordinary punch');
  const buffer = new FinisherCommandBuffer(), joke = fatalitiesFor('trump').at(-1);
  buffer.step({ down: true }); buffer.step({ down: true }); buffer.step({ lp: true });
  assert.equal(buffer.match([joke], 1), null, 'holding down is only one edge');
  buffer.reset(); buffer.step({ down: true }); buffer.step({});
  for (let i = 0; i < 91; i++) buffer.step({});
  buffer.step({ down: true }); buffer.step({}); buffer.step({ lp: true });
  assert.equal(buffer.match([joke], 1), null, 'old direction cannot complete a secret');
  m.setPhase(PHASE.FIGHT); m.left.state = 'idle'; m.right.state = 'idle'; m.right.health = m.right.maxHealth;
  typeCommand(m, 0, FATALITY_REGISTRY.trump[0].command);
  assert.equal(m.finisher, null);
});

test('cinematic beats are deterministic, finite, one-shot and terminate in match results', () => {
  for (const id of ['trump', 'carney']) for (const definition of FATALITY_REGISTRY[id]) {
    const m = setupWindow(id, 0, (definition.range.min + definition.range.max) / 2);
    typeCommand(m, 0, definition.command);
    const script = FINISHER_SCRIPTS[m.finisher.script];
    let finalCount = 0; const beats = [], cuts = new Set();
    for (let frame = 0; frame < script.duration && m.phase !== PHASE.MATCH_END; frame++) {
      const edit = finisherCinematicAt(m.finisher, m.phaseFrame);
      cuts.add(edit.cut);
      for (const actor of [edit.attacker, edit.victim])
        for (const key of ['x', 'y', 'turn', 'clipTime']) assert.ok(Number.isFinite(actor[key]));
      for (const event of m.step([{ lp: true, right: true }, { hp: true, left: true }])) {
        if (event.type === 'finisher') finalCount++;
        if (event.type === 'finisherBeat') beats.push(event.effectType);
      }
    }
    assert.equal(m.phase, PHASE.MATCH_END);
    assert.equal(finalCount, 1); assert.equal(cuts.size, script.cameraMotion ? 1 : script.shots.length);
    assert.deepEqual(beats, script.beats.map(b => b.type));
    assert.equal(m.winner, 0);
  }
});

test('third-hit uppercut on match point earns brutality, while a double KO cannot', () => {
  for (const double of [false, true]) {
    const m = new Match({ roundsToWin: 1 }); m.setPhase(PHASE.FIGHT);
    m.left.x = -0.4; m.right.x = 0.4;
    m.right.health = 1; m.right.comboCount = 2; m.right.state = 'hitStun'; m.right.stunFrames = 50;
    m.left.startMove('uppercut'); m.left.moveFrame = MOVES.uppercut.startup - 1;
    if (double) { m.left.health = 1; m.left.comboCount = 2; m.right.startMove('uppercut'); m.right.moveFrame = MOVES.uppercut.startup - 1; }
    m.step([{}, {}]);
    assert.equal(m.brutality, !double);
    if (double) { assert.equal(m.roundReason, 'double'); assert.equal(m.pendingBrutality, null); continue; }
    for (let i = 0; i < 100; i++) m.step([{}, {}]);
    assert.equal(m.phase, PHASE.FINISHER); assert.equal(m.finisher.id, BRUTALITY.id);
    assert.equal(endCard(m.snapshot()).kind, 'brutality');
  }
});

test('CPU uses the same range and sequence rules for both named fighters', () => {
  for (const id of ['trump', 'carney']) for (const side of [0, 1]) for (let seed = 1; seed <= 5; seed++) {
    const m = setupWindow(id, side, 3.6);
    const cpu = new CpuController({ side, seed });
    for (let frame = 0; frame < MATCH.finisherWindowFrames && m.phase === PHASE.FINISHER_WINDOW; frame++) {
      const inputs = [{}, {}]; inputs[side] = cpu.poll(m); m.step(inputs);
    }
    assert.equal(m.phase, PHASE.FINISHER, `${id}, side ${side}, seed ${seed}`);
  }
});

test('nonfinal round interstitial does not replace the final result; timeout stays animated', () => {
  const m = new Match(); m.left.health -= 10; m.endRound(0, 'timeout');
  const early = reelAt(m.snapshot());
  assert.equal(early.voice, 'suddenDeath'); assert.equal(early.scale, 1);
  m.phaseFrame = 190;
  assert.equal(reelAt(m.snapshot()).stage, 'intermission');
  assert.equal(reelAt(m.snapshot()).text, 'ROUND 2');
  m.left.roundsWon = m.roundsToWin;
  assert.equal(reelAt(m.snapshot()).stage, 'roundVictory');
});

test('both named fighters retain every ordinary chord and mirrored directional move', () => {
  for (const id of ['trump', 'carney']) for (const side of [0, 1]) {
    for (const command of CHORDS) {
      const fighter = new Fighter({ id, side }); fighter.state = 'idle';
      fighter.meter = MATCH.meterMax * MATCH.meterUnitsPerStock;
      const input = Object.fromEntries(command.buttons.map(key => [key, true]));
      for (let frame = 0; frame < 4; frame++) fighter.step({ input, allowInput: true, allowFinisher: false, events: [] });
      assert.equal(fighter.move, command.move, `${id}/${side}: ${command.move}`);
    }
    for (const command of DIRECTIONAL) {
      const fighter = new Fighter({ id, side }); fighter.state = 'idle';
      const direction = command.direction === 'down' ? 'down'
        : (command.direction === 'forward') === (fighter.facing > 0) ? 'right' : 'left';
      for (let frame = 0; frame < 4; frame++) fighter.step({ input: { [direction]: true, [command.button]: true },
        allowInput: true, allowFinisher: false, events: [] });
      assert.equal(fighter.move, command.move, `${id}/${side}: ${command.move}`);
    }
  }
});

test('named CPU fighters finish matches across every arena with bounded legal state', () => {
  let contacts = 0;
  for (const stageId of ['lake-america', 'capitol', 'palm-resort', 'executive-lawn'])
    for (const difficulty of ['easy', 'normal', 'hard']) for (const reversed of [false, true]) {
      const ids = reversed ? ['carney', 'trump'] : ['trump', 'carney'];
      const m = new Match({ left: { id: ids[0] }, right: { id: ids[1] }, stageId, roundsToWin: 1 });
      const cpus = [0, 1].map(side => new CpuController({ side, difficulty, seed: 491 + (reversed ? 31 : 0) }));
      let started = 0;
      for (let frame = 0; frame < 16000 && m.phase !== PHASE.MATCH_END; frame++) {
        const events = m.step(cpus.map(cpu => cpu.poll(m)));
        contacts += events.filter(e => e.type === 'hit').length;
        started += events.filter(e => e.type === 'attack').length;
        for (const fighter of m.fighters) {
          assert.ok(Number.isFinite(fighter.x) && Number.isFinite(fighter.y));
          assert.ok(fighter.health >= 0 && fighter.health <= fighter.maxHealth);
          assert.ok(fighter.meter >= 0 && fighter.meter <= MATCH.meterMax * MATCH.meterUnitsPerStock);
        }
      }
      assert.equal(m.phase, PHASE.MATCH_END, `${stageId}, ${difficulty}, ${ids.join('/')}`);
      assert.ok(started > 3, 'match has active offence');
      assert.equal(m.snapshot().stageId, stageId);
    }
  assert.ok(contacts > 100);
});
