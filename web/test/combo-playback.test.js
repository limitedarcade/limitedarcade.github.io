import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE, MATCH } from '../game/src/engine/match.js';
import { ComboPlayback } from '../game/src/engine/comboPlayback.js';
import { comboRoute } from '../game/src/engine/comboRoutes.js';
import { SimulationClock } from '../game/src/engine/simulationClock.js';
import { emptyInput } from '../game/src/engine/commands.js';

const FIGHTER_FOR_KIT = { standard: 'training', breaker: 'trump', strider: 'carney', officer: 'officer_flock' };

function ready(route, kitId, side = 0, gap = route.setup.distance) {
  const actor = { id: FIGHTER_FOR_KIT[kitId], combatKit: kitId };
  const other = { id: 'training-dummy', combatKit: 'standard' };
  const match = new Match(side === 0 ? { left: actor, right: other, hazards: false }
    : { left: other, right: actor, hazards: false });
  match.setPhase(PHASE.FIGHT);
  match.fighters.forEach((fighter, index) => {
    fighter.state = 'idle';
    fighter.x = (index ? 1 : -1) * gap / 2;
  });
  match.fighters[side].meter = route.setup.stocks * MATCH.meterUnitsPerStock;
  return match;
}

function replay({ routeId, kitId, side = 0, gap, maxTicks = 360 }) {
  const route = comboRoute(routeId);
  const match = ready(route, kitId, side, gap);
  const playback = new ComboPlayback({ route, actorSide: side, kitId });
  const trace = [];
  for (let tick = 0; tick < maxTicks && !playback.done; tick++) {
    const inputs = [{}, {}];
    inputs[side] = playback.poll(match.snapshot());
    const events = match.step(inputs);
    trace.push(...events.map(event => ({ ...event, tick })));
    playback.observe(events, match.snapshot());
  }
  return { match, playback, trace };
}

for (const kitId of ['standard', 'breaker', 'strider', 'officer']) {
  for (const routeId of ['basic-one-two', 'basic-three-hit', 'juggle-first', 'juggle-three-hit']) {
    for (const side of [0, 1]) {
      test(`${routeId} plays through raw ${kitId} inputs on side ${side}`, () => {
        const result = replay({ routeId, kitId, side });
        assert.equal(result.playback.state, 'finished', result.playback.reason);
        const completion = result.trace.find(event => event.type === 'comboRouteComplete' && event.routeId === routeId);
        assert.ok(completion, `${routeId} lacked its authoritative completion event`);
      });
    }
  }
}

for (const routeId of ['easy-carney-roundhouse', 'easy-carney-axe', 'easy-carney-spin']) {
  test(`${routeId} preserves Carney's real assisted chain`, () => {
    const result = replay({ routeId, kitId: 'strider' });
    assert.equal(result.playback.state, 'finished', result.playback.reason);
    assert.ok(result.trace.some(event => event.type === 'comboRouteComplete' && event.routeId === routeId));
  });
}

test('playback aborts without mutating combat outcomes when the opener is blocked', () => {
  const route = comboRoute('basic-one-two');
  const match = ready(route, 'standard');
  const playback = new ComboPlayback({ route, actorSide: 0, kitId: 'standard' });
  for (let tick = 0; tick < 100 && !playback.done; tick++) {
    const inputs = [playback.poll(match.snapshot()), { block: true }];
    const events = match.step(inputs);
    playback.observe(events, match.snapshot());
  }
  assert.equal(playback.state, 'aborted');
  assert.equal(playback.reason, 'blocked');
  assert.equal(match.right.comboCount, 0);
});

test('playback releases during hitstop and freezes combat deadlines', () => {
  const result = replay({ routeId: 'basic-three-hit', kitId: 'strider' });
  const hits = result.trace.filter(event => event.type === 'hit');
  assert.equal(hits.length, 3);
  assert.ok(hits.some(event => event.tick > 0));
  assert.equal(result.playback.state, 'finished');
});

function clockReplay(hz, speed) {
  const route = comboRoute('juggle-three-hit');
  const match = ready(route, 'standard');
  const playback = new ComboPlayback({ route, actorSide: 0, kitId: 'standard' });
  const clock = new SimulationClock();
  const trace = [];
  let simulationTick = 0;
  for (let render = 0; render < hz * 20 && !playback.done; render++) {
    clock.advance(1 / hz, () => {
      const events = match.step([playback.poll(match.snapshot()), {}]);
      trace.push(...events.filter(event => ['attack', 'hit', 'comboRouteComplete'].includes(event.type))
        .map(event => ({ tick: simulationTick, type: event.type, move: event.move,
          routeId: event.routeId, damage: event.damage, combo: event.combo })));
      playback.observe(events, match.snapshot());
      simulationTick += 1;
    }, () => speed);
  }
  return { state: playback.state, reason: playback.reason, trace,
    health: match.right.health, meter: match.left.meter };
}

test('playback combat trace is invariant at 30/60/144 Hz and quarter/half speed', () => {
  const expected = clockReplay(60, 1);
  assert.equal(expected.state, 'finished');
  for (const hz of [30, 60, 144]) for (const speed of [0.25, 0.5, 1])
    assert.deepEqual(clockReplay(hz, speed), expected, `${hz} Hz at ${speed} speed`);
});

test('polling does not mutate the public snapshot or combat state', () => {
  const route = comboRoute('basic-one-two');
  const match = ready(route, 'standard');
  const playback = new ComboPlayback({ route, actorSide: 0, kitId: 'standard' });
  const before = JSON.stringify(match.snapshot());
  const input = playback.poll(match.snapshot());
  assert.equal(JSON.stringify(match.snapshot()), before);
  assert.equal(input.lp, true);
  playback.abort('reset');
  assert.deepEqual(playback.poll(match.snapshot()), emptyInput());
});

test('playback preflight rejects missing route stock', () => {
  const route = comboRoute('easy-carney-spin');
  const match = ready(route, 'strider');
  match.left.meter = 0;
  const playback = new ComboPlayback({ route, actorSide: 0, kitId: 'strider' });
  assert.deepEqual(playback.poll(match.snapshot()), emptyInput());
  assert.equal(playback.state, 'aborted');
  assert.equal(playback.reason, 'resource');
});

export { replay };
