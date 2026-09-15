import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE } from '../game/src/engine/match.js';

function match() {
  const m = new Match({left:{id:'officer_flock'},right:{id:'carney'}});
  m.phase = PHASE.FIGHT;
  m.left.state = m.right.state = 'idle';
  m.left.x = -2; m.right.x = 2;
  return m;
}
function run(m, frames, input = {}) {
  const events = [];
  for(let i=0;i<frames;i++) events.push(...m.step([{},input]));
  return events;
}
test('Flock projectiles travel before hitting once; both throws share a cooldown', () => {
  const m = match(); m.left.startMove('lungePunch');
  run(m,22); assert.equal(m.right.health,m.right.maxHealth);
  assert.equal(m.projectiles.length,1);
  assert.equal(m.left.startMove('powerStrike'),false);
  const events=run(m,75);
  assert.equal(events.filter(e=>e.type==='hit').length,1);
  assert.equal(m.projectiles.length,0);
  run(m,15); assert.equal(m.left.startMove('powerStrike'),true);
});
test('standing guard stops knives and crouching avoids them, with no chip damage', () => {
  for(const down of [false,true]) {
    const m=match(); m.left.startMove('powerStrike');
    const events=run(m,90,{block:true,down});
    assert.equal(events.filter(e=>e.type==='block').length,down ? 0 : 1);
    assert.equal(m.right.health,m.right.maxHealth);
  }
});
test('crouching avoids shuriken; interruption before release prevents a throw', () => {
  const m=match(); m.left.startMove('lungePunch');
  run(m,95,{down:true}); assert.equal(m.right.health,m.right.maxHealth);
  const n=match(); n.left.startMove('powerStrike'); run(n,10);
  n.left.enterHitStun(20,false); run(n,65);
  assert.equal(n.projectiles.length,0); assert.equal(n.right.health,n.right.maxHealth);
});
test('axe prompt lists grounded actionable fighters in the lake zone only', () => {
  const m = match();
  assert.deepEqual(m.snapshot().axePrompt, []);
  m.left.x = -5;
  assert.deepEqual(m.snapshot().axePrompt, [0]);
  m.left.state = 'crouch';
  assert.deepEqual(m.snapshot().axePrompt, [0]);
  m.left.y = 0.4;
  assert.deepEqual(m.snapshot().axePrompt, []);
  m.left.y = 0; m.left.state = 'hitStun';
  assert.deepEqual(m.snapshot().axePrompt, []);
  m.left.state = 'idle'; m.left.x = -4;
  assert.deepEqual(m.snapshot().axePrompt, []);
  m.left.x = -5; m.right.x = -5.4;
  assert.deepEqual(m.snapshot().axePrompt, [0, 1]);
  m.axeUsed = true;
  assert.deepEqual(m.snapshot().axePrompt, []);
  m.axeUsed = false; m.phase = PHASE.INTRO;
  assert.deepEqual(m.snapshot().axePrompt, []);
  const capitol = new Match({ left: { id: 'officer_flock' }, right: { id: 'carney' }, stageId: 'capitol' });
  capitol.phase = PHASE.FIGHT; capitol.left.state = 'idle'; capitol.left.x = -5;
  assert.deepEqual(capitol.snapshot().axePrompt, []);
});
test('axe requires nearby down + grab, throws once a round, and resets each round', () => {
  const m=match(); m.left.x=-5; m.left.startMove('grab'); m.left.input.down=true;
  m.stepWeapons(); assert.equal(m.axeUsed,true);
  run(m,24); assert.equal(m.projectiles[0].kind,'axe');
  assert.equal(m.projectiles[0].move.hit.level,'mid');
  // Spent for the rest of the round, for either fighter.
  m.projectiles=[]; m.right.x=-5; m.right.startMove('grab'); m.right.input.down=true;
  run(m,30); assert.equal(m.projectiles.length,0);
  m.startRound(); assert.equal(m.axeUsed,false); assert.equal(m.projectiles.length,0);
  const n=match(); n.left.startMove('grab'); n.left.input.down=true;
  n.stepWeapons(); assert.equal(n.axeUsed,false);
});
test('a landed axe reports itself as an axe hit', () => {
  const m=match(); m.left.x=-5; m.right.x=-3;
  const events=[];
  for(let i=0;i<80;i++) events.push(...m.step([{down:true,lp:true,hp:true},{}]));
  const hit=events.find(e=>e.type==='hit'&&e.weapon==='axe');
  assert.ok(hit); assert.equal(hit.move,'stageAxe'); assert.equal(hit.knockdown,true);
});

test('either player can claim the axe and throw toward an opponent on either side', () => {
  for (const side of [0, 1]) for (const facing of [-1, 1]) {
    const m = match(), attacker = m.fighters[side], defender = m.fighters[1 - side];
    attacker.x = -5; defender.x = attacker.x + facing * 1.8;
    attacker.facing = facing; defender.facing = -facing;
    const input = [{}, {}]; input[side] = { down: true, lp: true, hp: true };
    const events = [];
    for (let frame = 0; frame < 95; frame++) events.push(...m.step(input));
    const hits = events.filter(event => event.type === 'hit' && event.weapon === 'axe');
    assert.equal(hits.length, 1, `P${side + 1}, facing ${facing}`);
    assert.equal(hits[0].attacker, side);
    assert.equal(m.axeUsed, true);
  }
});

test('standing and crouching guard both block the stage axe without chip damage', () => {
  for (const side of [0, 1]) for (const down of [false, true]) {
    const m = match(), attacker = m.fighters[side], defender = m.fighters[1 - side];
    attacker.x = -5; defender.x = -2.8; attacker.facing = 1; defender.facing = -1;
    const input = [{}, {}]; input[side] = { down: true, lp: true, hp: true };
    input[1 - side] = { block: true, down };
    const events = [];
    for (let frame = 0; frame < 100; frame++) events.push(...m.step(input));
    assert.equal(events.filter(event => event.type === 'block' && event.weapon === 'axe').length, 1);
    assert.equal(defender.health, defender.maxHealth); assert.equal(m.axeUsed, true);
  }
});

test('rescue ring mirrors axe access, hits once from either side, and has independent round stock', () => {
  for (const side of [0, 1]) for (const facing of [-1, 1]) {
    const m = match(), attacker = m.fighters[side], defender = m.fighters[1-side];
    attacker.x = 5; defender.x = 5 + facing * 1.8;
    attacker.facing = facing; defender.facing = -facing;
    assert.deepEqual(m.snapshot().ringPrompt, [side]);
    const input = [{}, {}]; input[side] = { down: true, lp: true, hp: true };
    const events = [];
    for (let frame = 0; frame < 95; frame++) events.push(...m.step(input));
    const hits = events.filter(e => e.type === 'hit' && e.weapon === 'rescueRing');
    assert.equal(hits.length, 1); assert.equal(hits[0].move, 'stageRing');
    assert.equal(hits[0].damage, 110); assert.equal(hits[0].knockdown, true);
    assert.equal(m.ringUsed, true); assert.equal(m.axeUsed, false);
    assert.deepEqual(m.snapshot().ringPrompt, []);
    m.startRound(); assert.equal(m.ringUsed, false); assert.equal(m.projectiles.length, 0);
  }
});

test('rescue ring obeys block, interruption, range and stage restrictions', () => {
  for (const down of [false, true]) {
    const m = match(); m.right.x = 5; m.left.x = 2.8;
    const events = [];
    for (let i = 0; i < 100; i++) events.push(...m.step([{block:true,down},{down:true,lp:true,hp:true}]));
    assert.equal(events.filter(e => e.type === 'block' && e.weapon === 'rescueRing').length, 1);
    assert.equal(m.left.health, m.left.maxHealth);
  }
  const m = match(); m.right.x = 5; m.right.startMove('grab'); m.right.input.down = true;
  m.stepWeapons(); assert.equal(m.ringUsed, true);
  m.right.enterHitStun(20, false); run(m, 65);
  assert.equal(m.projectiles.length, 0); assert.equal(m.left.health, m.left.maxHealth);
  for (const [stageId, x, airborne] of [['capitol',5,false],['lake-america',4,false],['lake-america',5,true]]) {
    const n = match(); n.stageId = stageId; n.right.x = x; n.right.y = airborne ? .4 : 0;
    assert.deepEqual(n.snapshot().ringPrompt, []);
  }
});
