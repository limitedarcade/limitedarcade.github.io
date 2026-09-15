import test from 'node:test';
import assert from 'node:assert/strict';
import { AttractDirector, AttractIdle, demoPair, showcaseDeck, DEMO_CANNOT_WIN } from '../game/src/game/attract.js';
import { Match, PHASE } from '../game/src/engine/match.js';
import { STAGES } from '../game/src/render/stageRegistry.js';
import { assignFighter } from '../game/src/render/fighterPick.js';

const roster = ['trump', 'carney', 'officer_flock'].map(id => ({ id }));

for (const side of [0,1]) for (const opponent of ['trump','officer_flock','lang'])
test(`Carney's exhibition always performs Cold Cut and holds the beaver ending: side ${side}, ${opponent}`, () => {
  const match = new Match({ left: { id: side ? opponent : 'carney' }, right: { id: side ? 'carney' : opponent }, roundsToWin: 1, stageId: 'lake-america' });
  const director = new AttractDirector(); director.begin(match);
  const finishers = [];
  for (let i=0; i<7500 && !director.ready(match); i++) {
    const input = [director.input(0,match),director.input(1,match)];
    director.beforeStep(match);
    for (const event of match.step(input))
      if (event.type === 'finisherStart') finishers.push(event.finisherId);
    director.afterStep(match);
    if (match.phase === PHASE.FINISHER) assert.equal(director.ready(match),false);
  }
  assert.deepEqual(finishers,['carney-cold-cut']);
  assert.equal(match.winner,side); assert.equal(match.phase,PHASE.MATCH_END);
  assert.ok(match.phaseFrame >= 210);
});

test('unconfirmed default fighters reserve neither slot; confirmed picks reserve only their owner', () => {
  const first = assignFighter(['trump', 'carney'], 0, 'carney', [false, false]);
  assert.equal(first.accepted, true);
  assert.equal(first.side, 1);
  assert.equal(assignFighter(first.fighters, 1, 'carney', [true, false]).accepted, false);
  const second = assignFighter(first.fighters, 1, 'trump', [true, false]);
  assert.deepEqual(second.fighters, ['carney', 'trump']);
});

test('idle timeout requires 30 seconds of eligible menu time and resets for activity or a dialog', () => {
  const idle = new AttractIdle();
  for (let i = 0; i < 119; i++) assert.equal(idle.advance(250, true), false);
  assert.equal(idle.seconds, 1);
  assert.equal(idle.advance(250, true), true);
  idle.reset(); assert.equal(idle.seconds, 30);
  idle.advance(250, true); idle.advance(250, false);
  assert.equal(idle.elapsed, 0);
  assert.equal(idle.advance(120000, true), false, 'a suspended frame cannot trigger attract mode');
});

test('a drawn timeout still reserves the Carney exhibition finale', () => {
  const match = new Match({ left: { id: 'officer_flock' }, right: { id: 'carney' }, roundsToWin: 1 });
  const director = new AttractDirector(); director.begin(match);
  match.phase = PHASE.FIGHT; match.phaseFrame = 0;
  match.timer = 0; match.fighters.forEach(f => { f.health = f.maxHealth; });
  match.step([{},{}]); assert.equal(match.roundWinner,null);
  assert.equal(match.phase, PHASE.ROUND_END);
  director.beforeStep(match);
  assert.equal(match.roundWinner,1); assert.equal(match.pendingFinisher,true);
});

test(`every menu fight features Carney on both sides of each matchup`, () => {
  const menuRoster = [...roster, { id: 'lang' }];
  const pairs = Array.from({ length: 6 }, (_, i) => demoPair(menuRoster, STAGES, i));
  assert.equal(new Set(pairs.map(p => p.fighters.join(','))).size, 6);
  for (const pair of pairs) {
    assert.ok(pair.fighters.includes('carney'));
    assert.equal(pair.stage, 'lake-america');
  }
  assert.deepEqual(pairs.map(pair => pair.fighters), [
    ['trump', 'carney'], ['officer_flock', 'carney'], ['lang', 'carney'],
    ['carney', 'trump'], ['carney', 'officer_flock'], ['carney', 'lang'],
  ]);
  assert.equal(demoPair(roster, [{ id: 'locked', comingSoon: true }], 0), null);
  assert.deepEqual([0, 1].map(i => demoPair(roster, [{ id: 'a' }, { id: 'b' }], i).stage), ['a', 'b']);
});

test('attract stays CPU vs CPU — no move-showcase reel', () => {
  const director = new AttractDirector();
  const match = new Match({ left: { id: 'carney' }, right: { id: 'officer_flock' }, roundsToWin: 1, hazards: true });
  director.begin(match);
  assert.equal(director.label, 'Exhibition · CPU vs CPU');
  const attacks = new Set();
  for (let f = 0; f < 7500 && !director.ready(match); f++) {
    director.beforeStep(match);
    for (const e of match.step([director.input(0, match), director.input(1, match)])) {
      if (e.type === 'attack') attacks.add(e.move);
      if (e.type === 'finisherStart') assert.equal(e.finisherId, 'carney-cold-cut');
    }
    director.afterStep(match);
    assert.equal(director.entry, undefined);
  }
  assert.equal(match.phase, PHASE.MATCH_END);
  assert.ok(attacks.size >= 4, `${attacks.size} moves is too repetitive`);
  assert.equal(director.next(match), false, 'next matchup starts a fresh demo pair');
  assert.equal(director.pairIndex, 1);
});

test('Trump never wins an exhibition, by KO, timeout or staged finisher', () => {
  const trumpDeck = showcaseDeck(new Match({ left: { id: 'trump' }, right: { id: 'carney' } }).left, 'lake-america');
  assert.ok(trumpDeck.length && !trumpDeck.some(m => m.group === 'Finishers'));
  assert.ok(DEMO_CANNOT_WIN.includes('trump'));
  for (const [left, right] of [['trump', 'carney'], ['officer_flock', 'trump'], ['trump', 'officer_flock']]) {
    const director = new AttractDirector();
    const match = new Match({ left: { id: left }, right: { id: right }, roundsToWin: 1, hazards: true });
    director.begin(match);
    for (let f = 0; f < 7500 && match.phase !== PHASE.MATCH_END; f++) {
      director.beforeStep(match);
      match.step([director.input(0, match), director.input(1, match)]);
      director.afterStep(match);
    }
    assert.equal(match.phase, PHASE.MATCH_END);
    assert.notEqual(match.fighters[match.winner]?.id, 'trump', `${left} vs ${right}`);
  }
  const director = new AttractDirector();
  const match = new Match({ left: { id: 'trump' }, right: { id: 'carney' }, roundsToWin: 1 });
  director.begin(match);
  match.phase = PHASE.FIGHT; match.right.health = 5; match.timer = 0;
  match.step([{}, {}]);
  assert.equal(match.roundWinner, 1, 'a timeout Trump leads on health still goes to his opponent');
});

test('every round end in attract forces Carney Cold Cut', () => {
  const match = new Match({ left: { id: 'carney' }, right: { id: 'lang' }, roundsToWin: 2 });
  const director = new AttractDirector(); director.begin(match);
  match.endRound(0, 'ko');
  assert.equal(match.pendingFinisher, false, 'live rules: mid-match KO does not open a finisher yet');
  director.beforeStep(match);
  assert.equal(match.pendingFinisher, true);
  assert.equal(match.roundWinner, 0);
});
