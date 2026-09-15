// The screen stack: everything that happens to the picture after the arena is
// drawn but before it reaches the canvas.
//
// Three passes, in the only order that composes correctly:
//
//   RenderPass  -> scene into a half-float HDR target. Tone mapping is skipped
//                  automatically here, because three only applies
//                  `renderer.toneMapping` when the destination is the canvas.
//   Bloom       -> run on those linear HDR values, which is the whole reason
//                  the target is half-float. Thresholded high (see BLOOM) so it
//                  behaves like selective bloom without the cost of one.
//   Grade       -> vignette, grain, colour grade, chromatic aberration and
//                  radial blur, folded into a single fragment shader. Four
//                  separate passes would mean four full-screen resolves for
//                  effects that all want the same texture read.
//   OutputPass  -> ACES + sRGB, terminal. Nothing may run after it, or the
//                  grade applies twice.
//
// Why one shader instead of a LUT: a per-stage `.cube` needs a LUT texture, an
// asset pipeline and a loader for a result this reproduces parametrically and
// can tune live. If a hand-authored LUT ever arrives, it drops in as a fourth
// pass ahead of OutputPass without disturbing any of this.

import * as THREE from '../vendor/three.module.js';
import { EffectComposer } from '../vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/postprocessing/OutputPass.js';

// Threshold sits above anything lit by the stage's key light, so fighters and
// backdrop never bloom. The additive hitsparks in vfx.js and the
// `toneMapped: false` emissives in stage.js sail past it, which is exactly the
// selective set the effect wants.
const BLOOM = { strength: 0.58, radius: 0.55, threshold: 0.86 };
const BLOOM_MOBILE = { strength: 0.46, radius: 0.6, threshold: 0.9 };

// Per-stage grade. Lift is added in shadow, gain multiplies, both in linear
// space ahead of the tonemapper -- the same order a film pipeline grades in.
export const GRADES = {
  neutral: { lift: [0, 0, 0], gain: [1, 1, 1], saturation: 1, contrast: 1 },
  capitol: { lift: [-0.006, 0, 0.008], gain: [1.08, 1.02, 0.98], saturation: 0.88, contrast: 1.08 },
  palms: { lift: [0.014, -0.005, 0.013], gain: [1.09, 0.98, 1.01], saturation: 1.06, contrast: 1.04 },
  lawn: { lift: [-0.008, 0.013, 0.01], gain: [0.96, 1.04, 1.01], saturation: 0.92, contrast: 1.05 },
  // Blue ice and steel shadows under an amber winter sunset.
  lakeAmerica: {
    lift: [0.001, 0.003, 0.006],
    gain: [1.025, 1.01, 1.025],
    saturation: .96,
    contrast: 1.045,
  },
};

const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uVignette: { value: 0.22 },
    uGrain: { value: 0.012 },
    uAberration: { value: 0 },
    uRadial: { value: 0 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec2 uCenter;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uRadial;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform float uSaturation;
    uniform float uContrast;
    varying vec2 vUv;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 dir = vUv - uCenter;
      vec3 color;

      // Both of these are zero except during a heavy hit or the KO freeze, and
      // the branch is uniform across the draw, so the common frame pays for one
      // texture read rather than TAPS * 3.
      if (uRadial > 0.0001 || uAberration > 0.0001) {
        color = vec3(0.0);
        float total = 0.0;
        for (int i = 0; i < TAPS; i++) {
          float t = float(i) / float(TAPS - 1);
          // Taps march back toward the contact point: a zoom blur, not a
          // uniform smear, so the hit stays the sharp thing on screen.
          vec2 base = uCenter + dir * (1.0 - uRadial * t);
          vec2 ca = dir * uAberration;
          float w = 1.0 - t * 0.55;
          color.r += texture2D(tDiffuse, base + ca).r * w;
          color.g += texture2D(tDiffuse, base).g * w;
          color.b += texture2D(tDiffuse, base - ca).b * w;
          total += w;
        }
        color /= total;
      } else {
        color = texture2D(tDiffuse, vUv).rgb;
      }

      color = color * uGain + uLift;
      float luma = dot(color, LUMA);
      color = mix(vec3(luma), color, uSaturation);
      color = (color - 0.5) * uContrast + 0.5;

      // Aspect-corrected so the falloff is round on a phone and on an
      // ultrawide, instead of pinching the sides of one and the top of the other.
      vec2 vd = vUv - 0.5;
      vd.x *= uResolution.x / max(uResolution.y, 1.0);
      float vig = smoothstep(0.34, 0.94, length(vd));
      color *= mix(1.0, 1.0 - uVignette, vig);

      // Weighted toward shadow, the way film grain actually sits.
      float g = hash(gl_FragCoord.xy + uTime) - 0.5;
      color += g * uGrain * (0.4 + 0.6 * (1.0 - clamp(luma, 0.0, 1.0)));

      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

export class PostFx {
  constructor(renderer, scene, camera, { reducedMotion = false, lowPower = false, grade = 'neutral' } = {}) {
    this.renderer = renderer;
    this.reducedMotion = reducedMotion;
    this.lowPower = lowPower;
    this.time = 0;
    this.radial = 0;
    this.chroma = 0;
    this.heavy = 0;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    const bloom = lowPower ? BLOOM_MOBILE : BLOOM;
    this.bloom = new UnrealBloomPass(
      // Half-res bloom on the low-power path. The effect is a blur; nobody has
      // ever noticed it being computed at half resolution, and it is the single
      // most fill-rate hungry thing in the stack.
      new THREE.Vector2(size.x * (lowPower ? 0.5 : 1), size.y * (lowPower ? 0.5 : 1)),
      bloom.strength, bloom.radius, bloom.threshold,
    );
    this.composer.addPass(this.bloom);

    this.gradePass = new ShaderPass(GradeShader);
    this.gradePass.material.defines.TAPS = lowPower ? 4 : 7;
    this.composer.addPass(this.gradePass);

    this.composer.addPass(new OutputPass());

    this.setGrade(grade);
    if (reducedMotion) {
      // Grain still moves per frame; a static grain plate is worse than none.
      // What goes is everything that implies camera motion.
      this.gradePass.uniforms.uGrain.value = 0.018;
      this.gradePass.uniforms.uVignette.value = 0.34;
    }
  }

  setGrade(name) {
    const preset = GRADES[name] || GRADES.neutral;
    this.preset = preset;
    const u = this.gradePass.uniforms;
    u.uLift.value.fromArray(preset.lift);
    u.uGain.value.fromArray(preset.gain);
    u.uSaturation.value = preset.saturation;
    u.uContrast.value = preset.contrast;
  }

  setSize(width, height) {
    // Takes CSS pixels: the composer multiplies by the renderer's pixel ratio
    // itself, so this mirrors `renderer.setSize(width, height, false)` exactly.
    this.composer.setSize(width, height);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // composer.setSize hands every pass the full drawing-buffer size, which
    // would undo the half-res bloom chosen in the constructor. Put it back.
    if (this.lowPower) this.bloom.setSize(size.x * 0.5, size.y * 0.5);
    this.gradePass.uniforms.uResolution.value.set(size.x, size.y);
  }

  // `x`/`y` are world-space contact coordinates already converted to screen by
  // the caller, in the HUD's y-down convention -- flipped here because UV is up.
  pulse(profile, sx = 0.5, sy = 0.5) {
    if (this.reducedMotion) return;
    this.gradePass.uniforms.uCenter.value.set(sx, 1 - sy);
    const amount = profile.ko ? 1 : profile.heavy ? 0.55 : 0;
    if (amount <= 0) return;
    this.radial = Math.max(this.radial, 0.05 * amount);
    this.chroma = Math.max(this.chroma, 0.0035 * amount);
  }

  // Driven from the real frame delta, not the sim delta: the blur should hold
  // through hitstop and only release once time resumes, which is what makes a
  // freeze read as a freeze rather than a dropped frame.
  update(realDt, { frozen = false, grade = 0 } = {}) {
    this.time = (this.time + realDt * 60) % 1000;
    this.gradePass.uniforms.uTime.value = this.time;
    if (!frozen) {
      const decay = Math.pow(0.0009, realDt);
      this.radial *= decay;
      this.chroma *= decay;
      if (this.radial < 0.0005) this.radial = 0;
      if (this.chroma < 0.00005) this.chroma = 0;
    }
    this.gradePass.uniforms.uRadial.value = this.radial;
    this.gradePass.uniforms.uAberration.value = this.chroma;

    // Replaces the CSS `filter` that used to sit on the canvas element. Same
    // punch-up on a heavy connect, except it no longer forces the compositor to
    // promote and re-composite the whole canvas on every heavy hit.
    this.heavy = this.reducedMotion || grade <= 0 ? 0 : 1;
    const p = this.preset;
    this.gradePass.uniforms.uContrast.value = p.contrast * (1 + this.heavy * 0.24);
    this.gradePass.uniforms.uSaturation.value = p.saturation * (1 + this.heavy * 0.3);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
  }
}
