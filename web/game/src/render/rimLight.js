// Silhouette separation: a coloured edge that lifts each fighter off the
// backdrop and says at a glance which side they are.
//
// This is a fresnel term injected into the fighter's own material, not a real
// light, and the difference is deliberate. Two extra lights in the scene would
// be two more lights in *every* material's shader -- the arena, the ice, the
// snow -- for an effect that must land on exactly two models. A per-fighter
// fresnel costs one uniform block on the two materials that want it and
// nothing anywhere else.
//
// It is not a plain fresnel either. A pure one rims the whole outline evenly,
// which reads as a sticker glow. The term is raked by a direction, so the edge
// falls on the outer-back of the silhouette the way a real backlight would,
// and the front of the fighter stays lit by the stage key alone.
//
// The flash channel is the hook for impact: a hit can push a bright rim onto
// the victim for a few frames without touching anything else here.

import * as THREE from '../vendor/three.module.js';
import { PALETTE } from './palette.js';

// Tunable by eye from the console in dev, same as POSE.
export const RIM = {
  strength: 0.72,
  power: 2.8,
  // Rake window over dot(normal, rimDir). Opening the low end wraps the edge
  // further around the front; closing it pins the rim to the back.
  rakeMin: -0.2,
  rakeMax: 0.8,
  // Downward-ish and behind, matching a backlight above and off to the side.
  height: 0.35,
  flashDecay: 7.5,
};

// Side identity, straight from the colour bible: P1 red, P2 blue.
const SIDE_COLOR = [PALETTE.red, PALETTE.blue];

export class FighterRim {
  constructor(side) {
    this.side = side;
    this.flash = 0;
    this.uniforms = {
      uRimColor: { value: new THREE.Color(SIDE_COLOR[side] || SIDE_COLOR[0]) },
      uRimStrength: { value: RIM.strength },
      uRimPower: { value: RIM.power },
      uRimRake: { value: new THREE.Vector2(RIM.rakeMin, RIM.rakeMax) },
      uRimDir: { value: new THREE.Vector3(0, RIM.height, -1).normalize() },
      uRimFlash: { value: 0 },
      uRimFlashColor: { value: new THREE.Color(0xffffff) },
    };
    this.setFacing(side ? -1 : 1);
  }

  // The rim is tied to facing rather than to the side index, so it survives a
  // cross-up: whichever way a fighter turns, the edge stays on their back.
  setFacing(facing) {
    this.uniforms.uRimDir.value.set(-Math.sign(facing || 1), RIM.height, -1).normalize();
  }

  // Called by impact so a struck fighter's edge blows out for a few frames.
  hit(colorHex, amount) {
    this.uniforms.uRimFlashColor.value.setHex(colorHex);
    this.flash = Math.max(this.flash, amount);
  }

  update(dt) {
    // Held at zero dt during hitstop, so the flash stays lit for the freeze --
    // the same rule the stage's impact light follows.
    if (dt > 0 && this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * RIM.flashDecay);
    }
    this.uniforms.uRimFlash.value = this.flash;
    // Picked up live so the console can retune without a reload.
    this.uniforms.uRimStrength.value = RIM.strength;
    this.uniforms.uRimPower.value = RIM.power;
    this.uniforms.uRimRake.value.set(RIM.rakeMin, RIM.rakeMax);
  }

  // Shares this fighter's uniform objects into the material's compiled shader,
  // so setting one here reaches every mesh of the model at once.
  attach(material) {
    // Chained, not assigned: fighterDamage.js extends these same materials, and
    // whichever attached second would otherwise silently drop the other's
    // injection. Composing here means the two are order-independent.
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      previous?.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Both view space: normal, from normal_fragment_maps above, and
          // vViewPosition, which the physical shader always declares.
          vec3 rimN = normalize( normal );
          float rimF = pow( 1.0 - clamp( dot( rimN, normalize( vViewPosition ) ), 0.0, 1.0 ), uRimPower );
          vec3 rimD = normalize( ( viewMatrix * vec4( uRimDir, 0.0 ) ).xyz );
          float rake = smoothstep( uRimRake.x, uRimRake.y, dot( rimN, rimD ) );
          totalEmissiveRadiance += uRimColor * ( rimF * rake * uRimStrength );
          // The impact flash ignores the rake: a blow should light the whole
          // edge, not just the half that happens to face the backlight.
          totalEmissiveRadiance += uRimFlashColor * ( rimF * uRimFlash );
        }`);
      shader.fragmentShader = `
        uniform vec3 uRimColor;
        uniform float uRimStrength;
        uniform float uRimPower;
        uniform vec2 uRimRake;
        uniform vec3 uRimDir;
        uniform float uRimFlash;
        uniform vec3 uRimFlashColor;
      ` + shader.fragmentShader;
    };
    // three's program cache does not know about onBeforeCompile edits, so
    // without this a rimmed material could be handed a cached program compiled
    // from an identical-looking material that never had the injection.
    material.customProgramCacheKey = () => `${previousKey?.call(material) || ''}|rim${this.side}`;
    // Findable from the scene graph, so the rim can be inspected or A/B'd
    // without reaching back through the view that owns it.
    material.userData.rim = this.uniforms;
  }
}
