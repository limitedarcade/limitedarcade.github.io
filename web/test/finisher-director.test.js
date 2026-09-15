import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationClock } from '../game/src/engine/simulationClock.js';
import { finisherTimeScale } from '../game/src/engine/finisherTiming.js';
import { coldCutCamera } from '../game/src/render/finisherDirector.js';
import { iceArmPose, ARM_BEATS } from '../game/src/render/coldCutIce.js';
import { Match, PHASE } from '../game/src/engine/match.js';
import { fatalityOf } from '../game/src/engine/fatalities.js';
import * as THREE from '../game/src/vendor/three.module.js';
import { CinematicGrip } from '../game/src/render/cinematicGrip.js';

function replay(hz) {
  const clock = new SimulationClock(), match = new Match({left:{id:'carney'},right:{id:'officer_flock'}});
  match.startFinisher(fatalityOf('carney-cold-cut'),0);
  const contacts=[]; let ticks=0;
  for(let i=0;i<hz*18;i++) clock.advance(1/hz,()=>{
    ticks++;
    for(const event of match.step([{},{}])) if(event.type==='finisherBeat') contacts.push([event.frame,event.effectType]);
  },()=>match.phase===PHASE.FINISHER?finisherTimeScale(match.finisher,match.phaseFrame):1);
  return {ticks,contacts,phase:match.phase,frame:match.phaseFrame};
}
test('ramped finisher has identical event order and progress at 30, 60 and 144 Hz',()=>{
  const expected=replay(60);
  assert.equal(expected.contacts.length,5);
  assert.deepEqual(replay(30),expected); assert.deepEqual(replay(144),expected);
});
test('both pursuit shots track the actual arm trajectory and mirror around the staged origin',()=>{
  for(const [region,start,end] of [['leftArm',203,234],['rightArm',249,290]]) {
    for(let frame=start;frame<=end;frame+=.5){
      const pose=iceArmPose(region,frame,0,1,{x:.58,y:1.3,z:0});
      const right=coldCutCamera(frame,1.4,1),left=coldCutCamera(frame,1.4,-1);
      assert.ok(Math.abs(right.target[0]-1.4-pose.x-.22)<1e-9);
      assert.equal(right.target[2],pose.z);
      assert.ok(Math.abs(right.target[0]+left.target[0]-2.8)<1e-9);
      assert.equal(right.position[1],left.position[1]);
    }
  }
});
test('every cinematic camera is finite and remains above the floor; accessibility keeps a stable wide view',()=>{
  for(let frame=0;frame<=510;frame++){
    const shot=coldCutCamera(frame,0,1);
    assert.ok([...shot.position,...shot.target].every(Number.isFinite));
    assert.ok(shot.position[1]>=.4);
    assert.equal(finisherTimeScale({script:'curtain-call'},frame),1);
    assert.ok(finisherTimeScale({script:'cold-cut-flock'},frame)>=.1);
    assert.deepEqual(coldCutCamera(frame,0,1,{reducedMotion:true}),coldCutCamera(0,0,1,{reducedMotion:true}));
  }
});
test('pause at a review marker stops a catch-up batch immediately',()=>{
  const clock=new SimulationClock();let ticks=0;
  clock.advance(.25,()=>++ticks<3);
  assert.equal(ticks,3);assert.equal(clock.accumulator,0);
});

test('pursuit targets mesh centers on either side and stays with fighters when gore is disabled',()=>{
  for(const facing of [-1,1]) for(const [frame,region] of [[204,'leftArm'],[250,'rightArm']]){
    const center=[2*facing,.37,-.16];
    const shot=coldCutCamera(frame,1.4,facing,{subjects:{[region]:center}});
    assert.ok(Math.abs(shot.target[0]-(center[0]+.08*facing))<1e-9);
    assert.deepEqual(shot.target.slice(1),center.slice(1));
    assert.equal(shot.cut,region);
    assert.equal(coldCutCamera(frame,1.4,facing,{trackLimbs:false}).cut,'master');
  }
});

test('second pursuit holds the settled arms until the authored return beat',()=>{
  const center=[5.1,.18,.1];
  for(const frame of [ARM_BEATS.rightArm.hit+60,315,329]){
    const shot=coldCutCamera(frame,0,1,{subjects:{rightArm:center}});
    assert.equal(shot.cut,'rightArm');
    assert.deepEqual(shot.target,[center[0]+.08,center[1],center[2]]);
  }
  assert.equal(coldCutCamera(330,0,1,{subjects:{rightArm:center}}).cut,'master');
});

test('portrait keeps its wide master but chases the actual severed arms',()=>{
  const wide=coldCutCamera(160,1.4,1,{portrait:true});
  assert.equal(wide.position,undefined);
  assert.equal(wide.z,9);
  for(const facing of [-1,1]) for(const [frame,region] of [[204,'leftArm'],[250,'rightArm']]){
    const center=[2*facing,.37,-.16];
    const shot=coldCutCamera(frame,1.4,facing,{portrait:true,subjects:{[region]:center}});
    assert.equal(shot.cut,region);
    assert.ok(Math.abs(shot.target[0]-(center[0]+.08*facing))<1e-9);
    assert.deepEqual(shot.target.slice(1),center.slice(1));
    assert.equal(shot.fov,46);
  }
});

test('Carney’s supporting hand reaches the shaft without stretching bones or leaking into the next pose',async()=>{
  const factory=await import('../game/src/fighters/carney/createFighterModel.js');
  await factory.prewarm();const built=factory.createFighter(),model=built.group,grip=new CinematicGrip();
  const upper=model.getObjectByName('upperArmL'),lower=model.getObjectByName('forearmL'),hand=model.getObjectByName('handL');
  const saved=[upper.quaternion.clone(),lower.quaternion.clone()];
  for(const facing of [-1,1]){
    model.rotation.y=facing*Math.PI/2;model.updateMatrixWorld(true);
    const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=hand.getWorldPosition(new THREE.Vector3());
    const lengths=[a.distanceTo(b),b.distanceTo(c)];
    const target=a.clone().addScaledVector(new THREE.Vector3(.2*facing,-.28,.17).normalize(),(lengths[0]+lengths[1])*.72);
    for(let repeat=0;repeat<5;repeat++){
      assert.ok(grip.apply(model,target,a.clone().add(new THREE.Vector3(-.5*facing,-.5,.5))));
      const end=hand.getWorldPosition(new THREE.Vector3());
      assert.ok(end.distanceTo(target)<.001);
      assert.ok(Math.abs(upper.getWorldPosition(a).distanceTo(lower.getWorldPosition(b))-lengths[0])<1e-6);
      assert.ok(Math.abs(lower.getWorldPosition(b).distanceTo(hand.getWorldPosition(c))-lengths[1])<1e-6);
      grip.restore();
      assert.ok(upper.quaternion.equals(saved[0]));assert.ok(lower.quaternion.equals(saved[1]));
    }
  }
  built.dispose();
});
