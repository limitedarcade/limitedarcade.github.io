// Sizes are metres along the asset's longest dimension. Duration is the full
// effect before playback speed is applied; delay is always in world seconds.
export const VFX_PRESETS = Object.freeze({
  fireball: Object.freeze({ label: 'Fireball', asset: 'vfx/fireball.glb', size: 1.25,
    duration: 0.7, color: '#ff9b42', opacity: 0.9, glow: 1.25,
    rotation: [0, 0, 0], spin: 0.65, grow: 0.3, additive: false }),
  laser: Object.freeze({ label: 'Laser', asset: 'vfx/laser.glb', size: 2.4,
    duration: 0.38, color: '#ff6254', opacity: 0.7, glow: 1.15,
    rotation: [0, Math.PI / 2, 0], spin: 0, grow: 0, additive: true }),
  shield: Object.freeze({ label: 'Shield', asset: 'vfx/shield.glb', size: 1.8,
    duration: 1.2, color: '#7ce5ff', opacity: 0.7, glow: 1.4,
    rotation: [0, 0, 0], spin: 0, grow: 0.08, additive: true, rim: true }),
  appearance: Object.freeze({ label: 'Appearance', asset: 'vfx/appearance.glb', size: 2,
    duration: 1.1, color: '#9af3dc', opacity: 0.75, glow: 1.15,
    rotation: [Math.PI / 2, 0, 0], spin: 0, grow: 0, additive: true }),
  burst: Object.freeze({ label: 'Energy burst', asset: 'vfx/burst.glb', size: 2.2,
    duration: 1.3, color: '#ffd18b', opacity: 0.68, glow: 1,
    rotation: [Math.PI / 2, 0, 0], spin: 0, grow: 0, additive: true }),
});
