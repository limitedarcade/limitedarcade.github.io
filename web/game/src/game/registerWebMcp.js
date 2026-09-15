// Optional browser-agent tools.
//
// These expose the same snapshot the HUD reads and the same buttons a player
// presses -- an agent gets no private channel into the match. The built-in CPU
// is the supported opponent; this exists so the fight can be driven and read
// from outside for testing and demos.

const BUTTONS = Object.freeze(['left', 'right', 'up', 'down', 'lp', 'hp', 'lk', 'hk', 'block']);

export function registerFightTools(context, api, signal) {
  if (!context?.registerTool) return false;
  const options = signal ? { signal } : undefined;

  context.registerTool({
    name: 'press_fight_button',
    title: 'Press a fight button',
    description: 'Hold one Player 1 button for a number of frames. Grab is lp+hp, throw is lk+hk.',
    inputSchema: {
      type: 'object',
      properties: {
        button: { type: 'string', enum: BUTTONS },
        frames: { type: 'integer', minimum: 1, maximum: 60 },
      },
      required: ['button'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!input || !BUTTONS.includes(input.button)) {
        throw new TypeError(`button must be one of: ${BUTTONS.join(', ')}`);
      }
      const frames = Math.max(1, Math.min(60, Number(input.frames) || 3));
      api.press(input.button, frames);
      return { button: input.button, frames, status: 'accepted' };
    },
  }, options);

  context.registerTool({
    name: 'read_fight_state',
    title: 'Read fight state',
    description: 'Read the current match state: phase, timer, health, meter and both fighters.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute() {
      return api.read();
    },
  }, options);

  return true;
}

export { BUTTONS };
