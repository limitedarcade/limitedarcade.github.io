import test from 'node:test';
import assert from 'node:assert/strict';
import { CpuController } from '../game/src/engine/ai.js';
import { comboRoute } from '../game/src/engine/comboRoutes.js';
import { Match } from '../game/src/engine/match.js';
import { preparePractice } from '../game/src/game/practice.js';
import { AttractDirector, demoPair } from '../game/src/game/attract.js';
import { STAGES } from '../game/src/render/stageRegistry.js';

for (const routeId of ['basic-one-two', 'juggle-first']) test(`CPU route intent completes ${routeId} through public input and events`, () => {
  const match = new Match({ left: { id: 'trump' }, right: { id: 'carney' }, hazards: false });
  const route = comboRoute(routeId); preparePractice(match, { ...route, group: 'Combos' });
  const cpu = new CpuController({ side: 0, difficulty: 'hard', seed: 19, comboRoutes: true });
  cpu.kit = match.left.kit; assert.equal(cpu.beginCombo(route, match.left.kit.id), true);
  const completed = [];
  for (let frame = 0; frame < 300 && !completed.length; frame++) {
    const events = match.step([cpu.poll(match), {}]);
    cpu.observe(events, match.snapshot());
    completed.push(...events.filter(event => event.type === 'comboRouteComplete' && event.routeId === routeId));
  }
  assert.equal(completed.length, 1);
  assert.equal(cpu.comboStats.confirmations, 1);
});

test('CPU route intent aborts honestly on a blocking opponent', () => {
  const match = new Match({ left: { id: 'trump' }, right: { id: 'carney' }, hazards: false });
  const route = comboRoute('basic-one-two'); preparePractice(match, { ...route, group: 'Combos' });
  const cpu = new CpuController({ side: 0, difficulty: 'hard', seed: 2, comboRoutes: true });
  cpu.kit = match.left.kit; cpu.beginCombo(route, match.left.kit.id);
  for (let frame = 0; frame < 100 && !cpu.comboRunner.done; frame++) {
    const events = match.step([cpu.poll(match), { block: true, left: true }]);
    cpu.observe(events, match.snapshot());
  }
  assert.equal(cpu.comboRunner.state, 'aborted');
  assert.equal(cpu.comboStats.confirmations, 0);
});

test('fixed six-match exhibition cycle covers ground and juggle routes for every eligible fighter', () => {
  const roster = ['trump', 'carney', 'officer_flock', 'lang'].map(id => ({ id }));
  const coverage = new Map();
  for (let index = 0; index < 6; index++) {
    const pair = demoPair(roster, STAGES, index);
    const match = new Match({ left: { id: pair.fighters[0] }, right: { id: pair.fighters[1] },
      roundsToWin: 1, stageId: pair.stage });
    const director = new AttractDirector(); director.pairIndex = index; director.begin(match);
    for (let frame = 0; frame < 7500 && !director.ready(match); frame++) {
      director.beforeStep(match);
      const events = match.step([director.input(0, match), director.input(1, match)]);
      director.afterStep(match, events, match.snapshot());
      for (const event of events.filter(value => value.type === 'comboRouteComplete')) {
        const fighter = match.fighters[event.side].id;
        if (!coverage.has(fighter)) coverage.set(fighter, new Set());
        coverage.get(fighter).add(event.routeId.startsWith('juggle') ? 'juggle' : 'ground');
      }
    }
  }
  for (const fighter of ['trump', 'carney', 'officer_flock'])
    assert.deepEqual([...coverage.get(fighter)].sort(), ['ground', 'juggle'], fighter);
  assert.equal(coverage.has('lang'), false, 'Lang keeps his intentionally combo-ineligible kit');
});
