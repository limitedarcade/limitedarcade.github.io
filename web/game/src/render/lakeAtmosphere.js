import * as THREE from '../vendor/three.module.js';

const AMBIENT_COUNT = 112, BURST_COUNT = 48;
const fract = value => value - Math.floor(value);
const seed = index => fract(Math.sin(index * 127.1 + 73.19) * 43758.5453);

// A single draw for low shoreline spindrift and pooled impact powder. Analytic
// wind motion is repeatable at any frame rate; no allocation occurs in update.
export class LakeAtmosphere {
  constructor(root) {
    this.time = 0;
    this.burstAge = 2;
    this.burstX = 0;
    this.burstStrength = 0;
    const count = AMBIENT_COUNT + BURST_COUNT;
    this.positions = new Float32Array(count * 3);
    this.alpha = new Float32Array(count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), fog: true,
      vertexShader: `attribute float aAlpha; varying float vAlpha;
        #include <fog_pars_vertex>
        void main(){vAlpha=aAlpha; vec4 mvPosition=modelViewMatrix*vec4(position,1.);
          gl_Position=projectionMatrix*mvPosition;
          gl_PointSize=clamp(46./max(1.,-mvPosition.z),1.,4.);
          #include <fog_vertex>
        }`,
      fragmentShader: `varying float vAlpha;
        #include <fog_pars_fragment>
        void main(){float r=length(gl_PointCoord-.5)*2.;
          float a=(1.-smoothstep(.15,1.,r))*vAlpha;
          if(a<.015)discard; gl_FragColor=vec4(.72,.85,.94,a);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.name = 'lake-america-spindrift';
    this.points.frustumCulled = false;
    root.add(this.points);
    this.update(0, false);
  }

  impact(x, strength) {
    if (!Number.isFinite(x) || !Number.isFinite(strength) || strength <= 0) return;
    this.burstX = THREE.MathUtils.clamp(x, -8, 8);
    this.burstStrength = THREE.MathUtils.clamp(strength, 0, 1);
    this.burstAge = 0;
  }

  resetRound() {
    this.burstAge = 2;
    this.alpha.fill(0, AMBIENT_COUNT);
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }

  update(dt, reducedMotion) {
    this.points.visible = !reducedMotion;
    if (reducedMotion) return;
    this.time += Math.max(0, dt);
    this.burstAge += Math.max(0, dt);
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      const cycle = fract(seed(i) + this.time * (.011 + seed(i + 600) * .012));
      const z = i % 4 ? -3 - seed(i + 100) * 6 : 4 + seed(i + 100) * 5;
      this.positions[i * 3] = cycle * 42 - 21;
      this.positions[i * 3 + 1] = .09 + seed(i + 200) * .44 + Math.sin(this.time * .7 + i) * .06;
      this.positions[i * 3 + 2] = z + Math.sin(this.time * .25 + i) * .25;
      this.alpha[i] = Math.sin(cycle * Math.PI) * (.13 + seed(i + 300) * .24);
    }
    const age = Math.min(1.4, this.burstAge), strength = this.burstStrength;
    for (let i = 0; i < BURST_COUNT; i++) {
      const index = AMBIENT_COUNT + i, angle = seed(i + 900) * Math.PI * 2;
      const distance = age * (.4 + seed(i + 1100) * 1.7) * strength;
      this.positions[index * 3] = this.burstX + Math.cos(angle) * distance;
      this.positions[index * 3 + 1] = .06 + Math.max(0, Math.sin(age / 1.4 * Math.PI)) * seed(i + 1200) * .65 * strength;
      this.positions[index * 3 + 2] = -.15 + Math.sin(angle) * distance * .45;
      this.alpha[index] = Math.max(0, 1 - age / 1.4) * .6 * strength;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
