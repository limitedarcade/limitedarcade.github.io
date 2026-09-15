import * as THREE from '../vendor/three.module.js';

function aim(bone, child, destination) {
  bone.updateWorldMatrix(true, true);
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const from = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const to = destination.clone().sub(origin).normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(from, to);
  const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parent.multiply(world));
  bone.updateWorldMatrix(false, true);
}

// A temporary two-bone constraint. Restore before the next animation sample;
// it never changes the animation asset, finger bake, or combat skeleton data.
export class CinematicGrip {
  constructor() { this.saved = []; }
  restore() {
    for (const [bone, rotation] of this.saved) bone.quaternion.copy(rotation);
    this.saved.length = 0;
  }
  apply(model, target, pole, side = 'L', limb = 'arm') {
    const find = (canonical, mixamo) => {
      const exact = model.getObjectByName(canonical + side);
      if (exact) return exact;
      let result;
      const pattern = new RegExp(`^mixamorig:?(?:${side === 'L' ? 'Left' : 'Right'})${mixamo}(?:_\\d+)?$`, 'i');
      model.traverse(node => { if (node.isBone && pattern.test(node.name)) result = node; });
      return result;
    };
    const upper = limb === 'leg' ? find('upLeg','UpLeg') : find('upperArm','Arm');
    const lower = limb === 'leg' ? find('leg','Leg') : find('forearm','ForeArm');
    const hand = limb === 'leg' ? find('foot','Foot') : find('hand','Hand');
    if(!upper || !lower || !hand) return false;
    this.saved.push([upper,upper.quaternion.clone()],[lower,lower.quaternion.clone()]);
    model.updateWorldMatrix(true,true);
    const a=upper.getWorldPosition(new THREE.Vector3()), b=lower.getWorldPosition(new THREE.Vector3()), c=hand.getWorldPosition(new THREE.Vector3());
    const l1=a.distanceTo(b),l2=b.distanceTo(c),axis=target.clone().sub(a);
    const distance=THREE.MathUtils.clamp(axis.length(),Math.abs(l1-l2)+.0001,l1+l2-.0001);
    if(l1<.0001 || l2<.0001 || axis.lengthSq()<1e-10) return false;
    axis.normalize();
    const bend=pole.clone().sub(a);bend.addScaledVector(axis,-bend.dot(axis));
    if(bend.lengthSq()<1e-8) bend.set(0,0,1).addScaledVector(axis,-axis.z);
    bend.normalize();
    const along=(l1*l1+distance*distance-l2*l2)/(2*distance);
    const height=Math.sqrt(Math.max(0,l1*l1-along*along));
    const elbow=a.clone().addScaledVector(axis,along).addScaledVector(bend,height);
    const reachable=a.clone().addScaledVector(axis,distance);
    aim(upper,lower,elbow);aim(lower,hand,reachable);
    return true;
  }
}
