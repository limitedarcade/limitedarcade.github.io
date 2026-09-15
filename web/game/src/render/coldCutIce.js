import * as THREE from '../vendor/three.module.js';

const clamp = THREE.MathUtils.clamp;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const UP = new THREE.Vector3(0, 1, 0);

function longAxis(pieces) {
  const points = [];
  for (const piece of pieces) {
    const position = piece.mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i += Math.max(1, Math.floor(position.count / 128))) points.push(new THREE.Vector3().fromBufferAttribute(position, i));
  }
  const mean = points.reduce((a,p)=>a.add(p),new THREE.Vector3()).multiplyScalar(1 / Math.max(1,points.length));
  const covariance = [0,0,0,0,0,0];
  for (const p of points) {
    p.sub(mean); const {x,y,z}=p;
    covariance[0]+=x*x;covariance[1]+=x*y;covariance[2]+=x*z;covariance[3]+=y*y;covariance[4]+=y*z;covariance[5]+=z*z;
  }
  const axis = new THREE.Vector3(1,.7,.3);
  for (let i=0;i<16;i++) {
    const {x,y,z}=axis, [xx,xy,xz,yy,yz,zz]=covariance;
    axis.set(xx*x+xy*y+xz*z,xy*x+yy*y+yz*z,xz*x+yz*y+zz*z).normalize();
  }
  return axis.lengthSq()>.1 ? axis : new THREE.Vector3(0,1,0);
}
export const ARM_BEATS = Object.freeze({ leftArm: { cut: 100, hit: 200, lane: 0.38, x: 0.28 },
  rightArm: { cut: 110, hit: 246, lane: -0.16, x: 0.62 } });

// TEMP: surface limbs still don't read on ice (esp. Trump). Keep false so
// Carney Cold Cut skips the flock arm script — no empty slapshot chase.
export const COLD_CUT_ICE_ARMS = false;

// Absolute simulation frames keep the props, camera and contact together at
// low frame rates, in slow motion, and while the game is paused.
export function iceArmPose(region, frame, origin, facing, spawn) {
  const beat = ARM_BEATS[region], fall = clamp((frame - beat.cut) / 44, 0, 1);
  const travel = clamp((frame - beat.hit) / 60, 0, 1);
  const slide = 1 - (1 - travel) ** 2;
  const x = origin + (beat.x + slide * 4.6) * facing;
  return {
    x: THREE.MathUtils.lerp(spawn.x, x, smooth(fall)),
    y: Math.max(0, spawn.y * (1 - fall * fall)),
    z: THREE.MathUtils.lerp(spawn.z, beat.lane, smooth(fall)),
    rotation: smooth(fall) * Math.PI * 0.5 * facing,
    yaw: travel * Math.PI * 3 * facing,
    flying: frame > beat.hit && travel < 1,
  };
}

export class ColdCutIce {
  constructor(root) {
    this.arms = new Map();
    this.trails = new THREE.Group(); root.add(this.trails);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xb9e6ff, transparent: true, opacity: 0.32,
      depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 2; i++) {
      const trail = new THREE.Mesh(geometry, material); trail.rotation.x = -Math.PI / 2;
      trail.visible = false; this.trails.add(trail);
    }
  }
  reset() {
    for (const arm of this.arms.values()) for (const piece of arm.pieces) piece.scripted = false;
    this.arms.clear(); this.trails.children.forEach(trail => { trail.visible = false; });
  }
  capture(cut) {
    if (!cut?.pieces?.length) return;
    for (const piece of cut.pieces) piece.scripted = true;
    cut.restAxis = longAxis(cut.pieces);
    this.arms.set(cut.region, cut);
  }
  update(frame, origin, facing) {
    let i = 0;
    for (const [region, arm] of this.arms) {
      const pose = iceArmPose(region, frame, origin, facing, arm);
      const fall = smooth((frame - ARM_BEATS[region].cut) / 44);
      const resting = new THREE.Quaternion().setFromUnitVectors(arm.restAxis, new THREE.Vector3(facing,0,0));
      const rotation = new THREE.Quaternion().slerp(resting,fall).premultiply(new THREE.Quaternion().setFromAxisAngle(UP,pose.yaw));
      // Rotate all chunks around the same stump; keep the lowest corner above
      // the ice without flattening the glove or allowing half an arm to sink.
      let lowest = 0;
      for (const piece of arm.pieces) {
        const box = piece.mesh.geometry.boundingBox;
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z])
          lowest = Math.min(lowest, new THREE.Vector3(x, y, z).applyQuaternion(rotation).y);
      }
      for (const piece of arm.pieces) {
        piece.mesh.position.set(pose.x, Math.max(pose.y, 0.025 - lowest), pose.z);
        piece.mesh.quaternion.copy(rotation);
      }
      const trail = this.trails.children[i++], beat = ARM_BEATS[region];
      const start = origin + beat.x * facing, length = Math.abs(pose.x - start);
      trail.visible = frame >= beat.hit && length > 0.01;
      trail.position.set((pose.x + start) / 2, 0.024, pose.z);
      trail.scale.set(Math.max(0.01, length), 0.035, 1);
    }
  }
  subjects() {
    const result={};
    for (const [region,arm] of this.arms) {
      const bounds=new THREE.Box3();
      for(const piece of arm.pieces) {
        piece.mesh.updateMatrixWorld(true);
        bounds.union(piece.mesh.geometry.boundingBox.clone().applyMatrix4(piece.mesh.matrixWorld));
      }
      result[region]=bounds.getCenter(new THREE.Vector3()).toArray();
    }
    return result;
  }
}
