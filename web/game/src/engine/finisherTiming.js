// Editorial speed, expressed against the existing deterministic contact frames.
// Never reaches zero: contact holds resolve without a second timer or deadlock.
const RAMP = [[0, 1], [78, 1], [94, .5], [100, .13], [103, .38],
  [110, .15], [115, .65], [135, 1.25], [178, 1], [194, .6],
  [200, .16], [205, .3], [221, .8], [234, 1.2], [242, .65],
  [246, .16], [252, .3], [270, .75], [288, 1.25], [328, 1],
  [374, 1], [386, .45], [391, .1], [396, .25], [408, .8], [432, 1], [510, 1]];

export function finisherTimeScale(finisher, frame) {
  if (finisher?.script !== 'cold-cut-flock') return 1;
  for (let i = 1; i < RAMP.length; i++) if (frame < RAMP[i][0]) {
    const [a, x] = RAMP[i - 1], [b, y] = RAMP[i];
    const t = Math.max(0, (frame - a) / (b - a)), smooth = t * t * (3 - 2 * t);
    return x + (y - x) * smooth;
  }
  return 1;
}
