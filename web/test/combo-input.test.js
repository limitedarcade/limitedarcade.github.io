import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE, MATCH } from '../game/src/engine/match.js';
import { comboRoute } from '../game/src/engine/comboRoutes.js';
import { emptyInput } from '../game/src/engine/commands.js';

const FIGHTER_FOR_KIT = { standard: 'training', breaker: 'trump', strider: 'carney', officer: 'officer_flock' };

function setup(route, kitId, side, gap) {
  const actor = { id: FIGHTER_FOR_KIT[kitId], combatKit: kitId };
  const dummy = { id: 'dummy', combatKit: 'standard' };
  const match = new Match(side ? { left: dummy, right: actor, hazards: false }
    : { left: actor, right: dummy, hazards: false });
  match.setPhase(PHASE.FIGHT);
  match.fighters.forEach((fighter, index) => {
    fighter.state = 'idle';
    fighter.x = (index ? 1 : -1) * gap / 2;
  });
  match.fighters[side].meter = route.setup.stocks * MATCH.meterUnitsPerStock;
  return match;
}

function rawRoute({ routeId, kitId, side = 0, gap = 0.85, delay = 0, limit = 360 }) {
  const route = comboRoute(routeId);
  const match = setup(route, kitId, side, gap);
  let index = 0, state = 'press', wait = 0;
  const trace = [];
  for (let tick = 0; tick < limit && index < route.steps.length; tick++) {
    let input = emptyInput();
    const actor = match.fighters[side];
    if (state === 'wait-recovery' && actor.isActionable()) { state = 'delay'; wait = delay; }
    if (state === 'delay') {
      if (wait-- <= 0) state = 'press';
    }
    if (state === 'press') {
      input = emptyInput();
      for (const key of route.steps[index].keys) input[key] = true;
      state = 'release';
    } else if (state === 'release') state = 'wait-contact';

    const inputs = [{}, {}]; inputs[side] = input;
    const events = match.step(inputs);
    trace.push(...events.map(event => ({ ...event, tick })));
    const hit = events.find(event => event.type === 'hit' && event.attacker === side);
    if (hit) {
      assert.equal(hit.move, route.steps[index].expectedMove);
      index += 1;
      if (index < route.steps.length) {
        const transition = route.timingByKit[kitId].transitions[index - 1];
        if (transition.gate === 'recovery') state = 'wait-recovery';
        else { state = 'delay'; wait = delay; }
      }
    }
  }
  return { match, route, trace, completed: index === route.steps.length };
}

for (const gap of [0.75, 0.85, 1.0]) {
  for (const kitId of ['standard', 'breaker', 'strider', 'officer']) {
    for (const side of [0, 1]) {
      test(`four-tick route window: ${kitId}, side ${side}, gap ${gap}`, () => {
        for (const routeId of ['basic-one-two', 'basic-three-hit', 'juggle-first', 'juggle-three-hit']) {
          for (let delay = 0; delay < 4; delay++) {
            const result = rawRoute({ routeId, kitId, side, gap, delay });
            assert.equal(result.completed, true, `${routeId} failed at delay ${delay}`);
            const hits = result.trace.filter(event => event.type === 'hit' && event.attacker === side);
            assert.equal(hits.length, result.route.expectedHits);
            assert.ok(hits.at(-1).combo === result.route.expectedHits,
              `${routeId} delay ${delay} contained an escapable gap`);
            assert.ok(hits.at(-1).comboDamage < (result.route.setup.stocks ? 350 : 300));
          }
        }
      });
    }
  }
}

test('direction intent survives release before and after command commit', () => {
  for (const releaseAfter of [1, 5]) {
    const match = setup(comboRoute('juggle-first'), 'standard', 0, 0.85);
    const trace = [];
    for (let tick = 0; tick < 20; tick++) {
      const input = tick < releaseAfter ? { down: true, hp: true } : {};
      trace.push(...match.step([input, {}]));
    }
    assert.equal(trace.find(event => event.type === 'attack')?.move, 'uppercut');
    assert.deepEqual(trace.find(event => event.type === 'attack')?.inputKeys, ['down', 'hp']);
  }
});

test('three-frame chord boundary is inclusive and the six-frame action buffer expires exactly', () => {
  for (let partnerTick = 0; partnerTick <= 4; partnerTick++) {
    const match = setup(comboRoute('basic-one-two'), 'standard', 0, 4);
    const attacks = [];
    for (let tick = 0; tick < 14; tick++) {
      const input = tick === 0 ? { lp: true }
        : tick === partnerTick && partnerTick > 0 ? { hp: true } : {};
      attacks.push(...match.step([input, {}]).filter(event => event.type === 'attack'));
    }
    if (partnerTick <= 3) assert.equal(attacks[0]?.move, partnerTick === 0 ? 'lightPunch' : 'grab');
    else assert.deepEqual(attacks.slice(0, 2).map(event => event.move), ['lightPunch'],
      'the later HP is buffered during LP recovery, not folded into the expired chord');
  }

  const match = setup(comboRoute('basic-one-two'), 'standard', 0, 4);
  assert.equal(match.left.startMove('heavyPunch'), true);
  for (let tick = 0; tick < 4; tick++) match.step([tick === 0 ? { lp: true } : {}, {}]);
  assert.equal(match.left.bufferedAction?.frames, 6);
  for (let tick = 0; tick < 5; tick++) match.step([{}, {}]);
  assert.equal(match.left.bufferedAction?.frames, 1);
  match.step([{}, {}]);
  assert.equal(match.left.bufferedAction, null);
});

test('chord priority, holds, blocks, whiffs, and stock checks cannot create a route', () => {
  const chord = setup(comboRoute('basic-one-two'), 'standard', 0, 0.85);
  const chordEvents = [];
  for (let tick = 0; tick < 20; tick++)
    chordEvents.push(...chord.step([tick === 0 ? { lp: true } : tick === 1 ? { lp: true, hp: true } : {}, {}]));
  assert.equal(chordEvents.find(event => event.type === 'attack')?.move, 'grab');
  assert.equal(chordEvents.some(event => event.type === 'comboRouteComplete'), false);

  for (const [gap, defender] of [[4, {}], [0.85, { block: true }]]) {
    const match = setup(comboRoute('basic-one-two'), 'standard', 0, gap);
    const events = [];
    for (let tick = 0; tick < 90; tick++) events.push(...match.step([{ lp: true }, defender]));
    assert.equal(events.some(event => event.type === 'comboRouteComplete'), false);
  }

  const spin = setup(comboRoute('easy-carney-spin'), 'strider', 0, 0.85);
  spin.left.meter = 0;
  const presses = [0, 8, 16];
  const events = [];
  for (let tick = 0; tick < 90; tick++) {
    const input = presses.includes(tick) ? { [tick === 16 ? 'hk' : 'lp']: true } : {};
    events.push(...spin.step([input, {}]));
  }
  assert.equal(events.some(event => event.type === 'comboRouteComplete' && event.routeId === 'easy-carney-spin'), false);
  assert.equal(events.some(event => event.type === 'meterRequired'), false,
    'a failed buffered cancel must not silently start the metered ending after recovery');
});
