import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimulationClock } from '../game/src/engine/simulationClock.js';
import { Match, PHASE } from '../game/src/engine/match.js';
import { attackClipTime, CONTACT_MARKERS } from '../game/src/render/clipTiming.js';

function replay(hz) {
  const clock = new SimulationClock(), match = new Match({ hazards: false });
  match.setPhase(PHASE.FIGHT);
  match.fighters.forEach((f,i)=>{f.x=i?.45:-.45;f.state='idle';});
  let tick=0, freezes=0; const hits=[];
  for(let render=0;render<hz*4;render++) clock.advance(1/hz,()=>{
    freezes+=Number(match.hitStop>0);
    const events=match.step([{lp:tick%40===0},{}]);
    hits.push(...events.filter(e=>e.type==='hit').map(e=>({tick,damage:e.damage})));
    tick++;
  });
  return {tick,freezes,hits,health:match.right.health,timer:match.timer,state:match.left.state};
}
test('real combat and hitstop replay identically at 30, 60, and 144 Hz',()=>{
  const expected=replay(60);
  assert.equal(expected.tick,240);assert.ok(expected.hits.length>0);assert.ok(expected.freezes>0);
  assert.deepEqual(replay(30),expected);assert.deepEqual(replay(144),expected);
});
test('suspension catch-up is bounded and reset drops stale elapsed time',()=>{
  const clock=new SimulationClock();let count=0;
  assert.equal(clock.advance(10,()=>count++),15);
  clock.advance(1/120,()=>count++);clock.reset();
  assert.equal(clock.advance(1/120,()=>count++),0);
  assert.equal(count,15);
});
test('contact and release stay aligned when a fighter changes move speed',()=>{
  for(const move of [{startup:3,active:3,recovery:6},{startup:15,active:8,recovery:21}]){
    const markers=CONTACT_MARKERS.heavyPunch;
    assert.equal(attackClipTime(0,move,.74,markers),0);
    assert.equal(attackClipTime(move.startup,move,.74,markers),.26);
    assert.equal(attackClipTime(move.startup+move.active,move,.74,markers),.36);
    assert.equal(attackClipTime(move.startup+move.active+move.recovery,move,.74,markers),.74);
    let previous=-1;
    for(let frame=0;frame<50;frame++){
      const sample=attackClipTime(frame,move,.74,markers);
      assert.ok(sample>=previous&&sample<=.74);previous=sample;
    }
  }
});
