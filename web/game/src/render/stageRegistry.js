// Fictional arcade interpretations. These describe atmosphere and game props,
// rather than making claims about the real locations that inspired them.
export const STAGES = Object.freeze([
  Object.freeze({
    id: 'lake-america', name: 'Lake America', subtitle: 'THE DEEP FREEZE',
    description: 'Winter sun. A frozen fighting shelf. Toronto across the blue water.',
    accent: '#80dbff', gradient: 'linear-gradient(145deg, #071d45, #466b95 55%, #c6e7ff)',
    palette: { sky: 0x69b4e5, fog: 0xbed5df, key: 0xfff1d4, fill: 0xa2c9eb, ground: 0x708a9b },
    ambient: { kind: 'ice', wind: 0.11, water: 0.025, pitch: 170 },
    hazard: { name: 'Thin Ice', description: 'Heavy impacts fracture the ice beneath the fight.', type: 'fracture' },
    music: 'Stage Two_ Odd Odds.mp3', thumbnail: 'stages/lake-america-3d/preview.png',
  }),
  Object.freeze({
    id: 'capitol', name: 'Capitol After Dark', subtitle: 'MARBLE & THUNDER', comingSoon: true,
    description: 'A storm-lit dome above a battered marble courtyard.',
    accent: '#ffe1a1', gradient: 'linear-gradient(145deg, #0b152a, #68728a 54%, #e4bd73)',
    palette: { sky: 0x060d20, fog: 0x172338, key: 0xffd9a1, fill: 0x729ccc, ground: 0x767f87 },
    ambient: { kind: 'storm', wind: 0.14, water: 0.055, pitch: 100 },
    hazard: { name: 'Falling Masonry', description: 'Heavy hits shake loose chips from the courtyard pillars.', type: 'masonry' },
    music: 'Stage Two_ Odd Odds.mp3',
  }),
  Object.freeze({
    id: 'palm-resort', name: 'Reflecting Pool', subtitle: 'NO REFUNDS', comingSoon: true,
    description: 'Violet dusk, gold trim, and a poolside reservation for two.',
    accent: '#ffbb7b', gradient: 'linear-gradient(145deg, #251538, #a34461 53%, #efba75)',
    palette: { sky: 0x291b3a, fog: 0x553955, key: 0xffc08a, fill: 0xb089d9, ground: 0x9a7881 },
    ambient: { kind: 'water', wind: 0.045, water: 0.12, pitch: 320 },
    hazard: { name: 'Poolside Service', description: 'A heavy impact shatters nearby decorative urns.', type: 'urn' },
    music: 'Stage Two_ Odd Odds.mp3',
  }),
  Object.freeze({
    id: 'executive-lawn', name: 'Executive Lawn', subtitle: 'AFTER HOURS', comingSoon: true,
    description: 'Moonlit colonnades, clipped hedges, and a fountain under pressure.',
    accent: '#a6e6c1', gradient: 'linear-gradient(145deg, #071c25, #426d64 55%, #d7e7bd)',
    palette: { sky: 0x071823, fog: 0x163c40, key: 0xe2efd2, fill: 0x7eafd0, ground: 0x3c554b },
    ambient: { kind: 'garden', wind: 0.075, water: 0.08, pitch: 250 },
    hazard: { name: 'Pressure Drop', description: 'Heavy hits send a fountain jet across the background.', type: 'fountain' },
    music: 'Stage Two_ Odd Odds.mp3',
  }),
]);

export function stageById(id) { return STAGES.find(stage => stage.id === id) || STAGES[0]; }

// Decoration reacts to hits without changing competitive frame data.
export function stageImpactStrength(event = {}, profile = {}) {
  if (event.type === 'block' || profile.type === 'block') return 0;
  const power = Math.max(0, Number(profile.power ?? event.bloodScale ?? 1) || 0);
  return event.ko || profile.type === 'ko' ? 1 : Math.min(1, Math.max(0, (power - 1) / 1.7));
}
