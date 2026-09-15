// Direction presses use simulation frames, shared by every input device and CPU.
// A held direction is one press; a second press must follow a neutral release.
export class DirectionTapBuffer {
  constructor(window = 12) { this.window = window; this.reset(); }
  reset() { this.frame = 0; this.previous = 0; this.lastDirection = 0; this.lastFrame = -Infinity; this.facing = null; }
  step(input, facing, enabled = true) {
    this.frame++;
    const direction = Number(Boolean(input.right)) - Number(Boolean(input.left));
    if (!enabled || input.up || input.down || input.block || (input.left && input.right) || this.facing !== facing) {
      const wasNeutral = this.previous === 0;
      this.lastDirection = 0;
      this.lastFrame = -Infinity;
      this.previous = direction;
      this.facing = facing;
      // The first grounded press after a reset can start a pair.
      if (enabled && wasNeutral && !input.up && !input.down && !input.block && direction && !(input.left && input.right)) {
        this.lastDirection = direction; this.lastFrame = this.frame;
      }
      return null;
    }
    let command = null;
    if (direction && this.previous === 0) {
      if (direction === this.lastDirection && this.frame - this.lastFrame <= this.window) {
        command = direction === facing ? 'sprint' : 'backHop';
        this.lastDirection = 0;
        this.lastFrame = -Infinity;
      } else { this.lastDirection = direction; this.lastFrame = this.frame; }
    } else if (direction && direction !== this.previous) {
      // Crossing directly from one direction to the other is not a double tap.
      this.lastDirection = 0; this.lastFrame = -Infinity;
    }
    this.previous = direction;
    return command;
  }
}
