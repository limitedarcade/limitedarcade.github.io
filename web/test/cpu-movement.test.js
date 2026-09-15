import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CpuController } from '../game/src/engine/ai.js';
import { emptyInput } from '../game/src/engine/commands.js';
import { Match, PHASE } from '../game/src/engine/match.js';
import { MATCH } from '../game/src/engine/frameData.js';

function arena() {
  const match = new Match({ roundsToWin: 1, hazardsEnabled: false });
  match.setPhase(PHASE.FIGHT);
  match.fighters.forEach(fighter => { fighter.state = 'idle'; });
  return match;
}

function scene(overrides = {}) {
  const snapshot = arena().snapshot();
  Object.assign(snapshot.fighters[0], overrides);
  return { snapshot: () => snapshot, view: snapshot };
}

test('CPU recovery timing is bounded and all three recovery choices appear on every difficulty', () => {
  for (const [difficulty, min, max] of [['easy', 16, 30], ['normal', 10, 24], ['hard', 6, 16]]) {
    const timings = new Set(), choices = new Set();
    for (let seed = 0; seed < 96; seed++) {
      const cpu = new CpuController({ side: 0, difficulty, seed });
      const match = scene({ state: 'downed', recoveryReady: true, facing: 1 });
      let recovered = false;
      for (let frame = 0; frame <= max; frame++) {
        const input = cpu.poll(match);
        assert.ok(!input.lp && !input.hp && !input.lk && !input.hk && !input.up);
        if (!Object.values(input).some(Boolean)) continue;
        assert.ok(frame >= min, `${difficulty} recovered too early: ${frame}`);
        const choice = input.block ? 'stand' : input.right ? 'forward' : 'back';
        assert.equal(Object.values(input).filter(Boolean).length, 1);
        timings.add(frame);
        choices.add(choice);
        recovered = true;
        break;
      }
      assert.ok(recovered, `${difficulty}/${seed} never recovered`);
    }
    assert.deepEqual([...choices].sort(), ['back', 'forward', 'stand']);
    assert.ok(timings.size >= 5, `${difficulty} repeats the same recovery timing`);
  }
});

test('CPU waits out forced reactions and does not swing during a juggle or back hop', () => {
  const cpu = new CpuController({ side: 0, difficulty: 'hard' });
  for (const state of ['knockdown', 'juggle', 'backHop', 'getUp', 'hitStun', 'grabbed']) {
    const match = scene({ state, airborne: state === 'juggle' || state === 'backHop', y: 0.3 });
    match.view.distance = 0.8;
    cpu.lastY = 1;
    cpu.setAttack('heavyKick');
    for (let frame = 0; frame < 40; frame++) assert.deepEqual(cpu.poll(match), emptyInput(), state);
  }
  const downed = scene({ state: 'downed', recoveryReady: false });
  for (let frame = 0; frame < 60; frame++) assert.deepEqual(cpu.poll(downed), emptyInput());
});

test('CPU recovery directions follow current facing and a new fall gets a fresh delay', () => {
  for (const kind of ['forward', 'back']) {
    const cpu = new CpuController({ side: 0 });
    const match = scene({ state: 'downed', recoveryReady: true, facing: -1 });
    cpu.recoveryPlan = { kind, age: 12, wait: 10 };
    const input = cpu.poll(match);
    assert.equal(input[kind === 'forward' ? 'left' : 'right'], true);
    match.view.fighters[0].state = 'getUp';
    assert.deepEqual(cpu.poll(match), emptyInput());
    match.view.fighters[0].state = 'downed';
    assert.deepEqual(cpu.poll(match), emptyInput(), 'the next knockdown cannot inherit an expired delay');
  }
});

test('CPU dash plans use released double taps while ordinary walking keeps a single hold', () => {
  for (const facing of [1, -1]) for (const kind of ['sprint', 'backHop']) {
    const cpu = new CpuController({ side: 0 });
    const match = scene({ facing });
    match.view.distance = 6;
    cpu.chooseIntent = () => cpu.setIntent(kind, 30);
    const button = (kind === 'sprint') === (facing === 1) ? 'right' : 'left';
    const inputs = Array.from({ length: 7 }, () => cpu.poll(match));
    assert.deepEqual(inputs.map(input => input[button]), [false, true, false, false, true, true, true]);
    for (const input of inputs) assert.equal(Object.values(input).filter(Boolean).length, input[button] ? 1 : 0);
  }
  const cpu = new CpuController({ side: 0 });
  const match = scene({ facing: 1 });
  match.view.distance = 6;
  cpu.chooseIntent = () => cpu.setIntent('approach', 4);
  for (let frame = 0; frame < 24; frame++) assert.equal(cpu.poll(match).right, true);
});

test('CPU sprint stops at striking distance instead of running through the opponent', () => {
  const cpu = new CpuController({ side: 0 });
  const match = scene({ state: 'sprint', facing: 1 });
  match.view.distance = 1.5;
  cpu.setIntent('sprint', 30);
  const input = cpu.poll(match);
  assert.equal(input.block, true);
  assert.equal(input.right, false);
});

test('raw CPU movement plans trigger both engine movement states on either side', () => {
  for (const side of [0, 1]) for (const kind of ['sprint', 'backHop']) {
    const match = arena();
    match.fighters[0].x = -3;
    match.fighters[1].x = 3;
    const cpu = new CpuController({ side });
    cpu.chooseIntent = () => cpu.setIntent(kind, 30);
    let executed = false;
    for (let frame = 0; frame < 12; frame++) {
      const inputs = [emptyInput(), emptyInput()];
      inputs[side] = cpu.poll(match);
      match.step(inputs);
      executed ||= match.fighters[side].state === kind;
    }
    assert.ok(executed, `${kind} did not execute for side ${side}`);
  }
});

test('hitstop preserves CPU double-tap pulses until the simulation resumes', () => {
  for (const kind of ['sprint', 'backHop']) for (const freezeAt of [0, 2, 4]) {
    const match = arena();
    match.left.x = -3;
    match.right.x = 3;
    const cpu = new CpuController({ side: 0 });
    cpu.chooseIntent = () => cpu.setIntent(kind, 30);
    const events = [];
    for (let frame = 0; frame < 18; frame++) {
      if (frame === freezeAt) match.hitStop = 8;
      const frozen = match.hitStop > 0;
      const cooldown = cpu.cooldown;
      const input = cpu.poll(match);
      if (frozen) {
        assert.deepEqual(input, emptyInput());
        assert.equal(cpu.cooldown, cooldown, 'hitstop cannot advance an input plan');
      }
      events.push(...match.step([input, emptyInput()]));
    }
    assert.equal(events.filter(event => event.type === kind).length, 1,
      `${kind} lost a pulse when frozen at frame ${freezeAt}`);
  }
});

test('on match point the CPU banks the gauge and spends no metered move', () => {
  const cpu = new CpuController({ side: 0, difficulty: 'hard' });
  // Not the deciding round yet: metered moves stay on the table.
  let match = scene({ roundsWon: 0, stocks: 3, state: 'blockStand' });
  match.view.fighters[1].state = 'blockStand';
  match.view.roundsToWin = 2;
  assert.equal(cpu.shouldBank(match.view.fighters[0], match.view.fighters[1], match.view), false);

  // Match point with a stock in hand: the gauge is held for FINISH HIM, so
  // choose() must never hand back a cost move even when one would fit.
  match = scene({ roundsWon: 1, stocks: 3, state: 'idle', facing: 1 });
  match.view.roundsToWin = 2;
  match.view.distance = 1.1;
  cpu.poll(match);
  assert.equal(cpu.banking, true);
  for (let i = 0; i < 200; i++) {
    const pick = cpu.choose(['burstStrike', 'hammerRush', 'meteorKick', 'cyclone', 'heavyPunch'],
      match.view.fighters[0], 'heavyPunch');
    assert.ok(!['burstStrike', 'hammerRush', 'meteorKick', 'cyclone'].includes(pick), pick);
  }
});

test('the CPU winner banks two stocks and executes the finisher when the window opens', () => {
  let executed = 0;
  for (const seed of [1, 7, 42, 99, 1337]) {
    const m = new Match({ roundsToWin: 1, hazardsEnabled: false });
    m.fighters[0].id = 'trump';
    m.fighters[1].id = 'carney';
    m.roundWinner = 0;
    m.roundReason = 'ko';
    m.fighters[1].health = 0;
    m.fighters[0].x = -1.5;
    m.fighters[1].x = 1.5;
    m.setPhase(PHASE.FINISHER_WINDOW);
    m.finishCommands.reset();
    const cpu = new CpuController({ side: 0, difficulty: 'normal', seed });
    for (let frame = 0; frame < MATCH.finisherWindowFrames; frame++) {
      m.step([cpu.poll(m), emptyInput()]);
      if (m.phase === PHASE.FINISHER) { executed += 1; break; }
    }
  }
  assert.equal(executed, 5, 'the CPU left at least one finisher window unused');
});

test('CPU recovers from a real knockdown and resumes fighting on every difficulty', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const match = arena();
    const cpu = new CpuController({ side: 0, difficulty });
    match.fighters[0].enterHitStun(20, true);
    let downed = false, recovered = false;
    for (let frame = 0; frame < 240; frame++) {
      const input = cpu.poll(match);
      const state = match.fighters[0].state;
      if (state === 'downed') {
        downed = true;
        assert.ok(!input.lp && !input.hp && !input.lk && !input.hk);
      }
      match.step([input, emptyInput()]);
      if (downed && match.fighters[0].state === 'getUp') recovered = true;
    }
    assert.ok(downed && recovered, `${difficulty} failed the knockdown/recovery sequence`);
    assert.ok(!['downed', 'getUp', 'knockdown'].includes(match.fighters[0].state));
  }
});
