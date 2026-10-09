const CAPABLE_KITS = Object.freeze(['standard', 'breaker', 'strider', 'officer']);

function timings(kits, transitions) {
  return Object.freeze(Object.fromEntries(kits.map(kit => [kit, Object.freeze({
    transitions: Object.freeze(transitions.map(transition => Object.freeze({ ...transition,
      window: Object.freeze([...transition.window]),
    }))),
  })])));
}

function route(definition) {
  return Object.freeze({ ...definition,
    kits: Object.freeze([...definition.kits]),
    steps: Object.freeze(definition.steps.map(step => Object.freeze({ ...step,
      keys: Object.freeze([...step.keys]),
    }))),
    setup: Object.freeze({ ...definition.setup }),
  });
}

const CANCEL = Object.freeze({ gate: 'contact', window: Object.freeze([0, 3]), timeout: 36 });
const LINK = Object.freeze({ gate: 'recovery', window: Object.freeze([0, 3]), timeout: 72 });

export const COMBO_ROUTES = Object.freeze([
  route({
    id: 'basic-one-two', name: 'One-Two', kind: 'ground', kits: CAPABLE_KITS,
    steps: [
      { keys: ['lp'], expectedMove: 'lightPunch', contact: 'ground' },
      { keys: ['hp'], expectedMove: 'heavyPunch', contact: 'ground' },
    ],
    timingByKit: timings(CAPABLE_KITS, [CANCEL]),
    setup: { distance: 0.85, stocks: 0, dummy: 'idle' }, expectedHits: 2,
    description: 'Confirm a light punch into a heavy punch.',
    tips: 'Tap HP as the first punch connects.', demoEligible: true,
  }),
  route({
    id: 'basic-three-hit', name: 'Three-Hit String', kind: 'ground', kits: CAPABLE_KITS,
    steps: [
      { keys: ['lp'], expectedMove: 'lightPunch', contact: 'ground' },
      { keys: ['lk'], expectedMove: 'lightKick', contact: 'ground' },
      { keys: ['hk'], expectedMove: 'heavyKick', contact: 'ground' },
    ],
    timingByKit: timings(CAPABLE_KITS, [CANCEL, CANCEL]),
    setup: { distance: 0.85, stocks: 0, dummy: 'idle' }, expectedHits: 3,
    description: 'Chain three distinct grounded strikes.',
    tips: 'Release each button before tapping the next.', demoEligible: true,
  }),
  route({
    id: 'juggle-first', name: 'First Juggle', kind: 'juggle', kits: CAPABLE_KITS,
    steps: [
      { keys: ['down', 'hp'], expectedMove: 'uppercut', contact: 'launch' },
      { keys: ['lp'], expectedMove: 'lightPunch', contact: 'air' },
    ],
    timingByKit: timings(CAPABLE_KITS, [LINK]),
    setup: { distance: 0.85, stocks: 0, dummy: 'idle' }, expectedHits: 2,
    description: 'Launch, recover, then catch the airborne opponent with LP.',
    tips: 'Wait for the uppercut recovery before pressing LP.', demoEligible: true,
  }),
  route({
    id: 'juggle-three-hit', name: 'Three-Hit Juggle', kind: 'juggle', kits: CAPABLE_KITS,
    steps: [
      { keys: ['down', 'hp'], expectedMove: 'uppercut', contact: 'launch' },
      { keys: ['lp'], expectedMove: 'lightPunch', contact: 'air' },
      { keys: ['hp'], expectedMove: 'heavyPunch', contact: 'air' },
    ],
    timingByKit: timings(CAPABLE_KITS, [LINK, CANCEL]),
    setup: { distance: 0.85, stocks: 0, dummy: 'idle' }, expectedHits: 3,
    description: 'Launch and land two airborne follow-ups.',
    tips: 'Link the jab after recovery, then cancel it into HP.', demoEligible: true,
  }),
  route({
    id: 'easy-carney-roundhouse', name: 'Quick Edit', kind: 'assisted', kits: ['strider'],
    steps: [
      { keys: ['lp'], expectedMove: 'lightPunch', contact: 'ground' },
      { keys: ['lp'], expectedMove: 'bodyCheck', contact: 'ground' },
      { keys: ['lp'], expectedMove: 'heavyKick', contact: 'ground' },
    ],
    timingByKit: timings(['strider'], [CANCEL, CANCEL]),
    setup: { distance: 0.85, stocks: 0, dummy: 'idle' }, expectedHits: 3,
    description: 'Carney\'s three-tap roundhouse chain.',
    tips: 'Release LP between every tap.', demoEligible: true,
  }),
  route({
    id: 'easy-carney-axe', name: 'Ice Pick Chain', kind: 'assisted', kits: ['strider'],
    steps: [
      { keys: ['lp'], expectedMove: 'lightPunch', contact: 'ground' },
      { keys: ['lk'], expectedMove: 'lightKick', contact: 'ground' },
      { keys: ['lk'], expectedMove: 'heelDrop', contact: 'ground' },
    ],
    timingByKit: timings(['strider'], [CANCEL, CANCEL]),
    setup: { distance: 0.85, stocks: 0, dummy: 'idle' }, expectedHits: 3,
    description: 'Carney\'s light kick branch into an overhead.',
    tips: 'Use three separate taps; do not hold LK.', demoEligible: true,
  }),
  route({
    id: 'easy-carney-spin', name: 'Polar Reversal Chain', kind: 'assisted', kits: ['strider'],
    steps: [
      { keys: ['lp'], expectedMove: 'lightPunch', contact: 'ground' },
      { keys: ['lp'], expectedMove: 'bodyCheck', contact: 'ground' },
      { keys: ['hk'], expectedMove: 'spinKick', contact: 'ground' },
    ],
    timingByKit: timings(['strider'], [CANCEL, CANCEL]),
    setup: { distance: 0.85, stocks: 1, dummy: 'idle' }, expectedHits: 3,
    description: 'Carney\'s one-stock assisted finisher.',
    tips: 'Bank one stock before the final HK tap.', demoEligible: true,
  }),
]);

export function comboRoute(id) {
  return COMBO_ROUTES.find(candidate => candidate.id === id) || null;
}

export function routesForKit(kitId, { demoOnly = false } = {}) {
  return COMBO_ROUTES.filter(candidate => candidate.kits.includes(kitId)
    && (!demoOnly || candidate.demoEligible));
}

function sameKeys(a, b) {
  return a.length === b.length && a.every(key => b.includes(key));
}

export function routeStepMatches(step, { move, keys, launched = false, juggle = false, grounded = false }) {
  if (step.expectedMove !== move || !sameKeys(step.keys, keys || [])) return false;
  if (step.contact === 'launch') return launched;
  if (step.contact === 'air') return juggle && !launched && !grounded;
  return !juggle && !grounded;
}

export function validateComboRoutes(routes = COMBO_ROUTES, fighterOrKit = null) {
  const errors = [];
  const ids = new Set();
  for (const candidate of routes) {
    if (!candidate.id || ids.has(candidate.id)) errors.push(`duplicate or missing route id: ${candidate.id || '<empty>'}`);
    ids.add(candidate.id);
    if (!candidate.steps?.length || candidate.expectedHits !== candidate.steps.length)
      errors.push(`${candidate.id}: expectedHits must equal its step count`);
    if (!candidate.kits?.length) errors.push(`${candidate.id}: no supported kits`);
    if (candidate.kits.includes('flincher')) errors.push(`${candidate.id}: Lang cannot be assigned combo routes`);
    for (const kitId of candidate.kits || []) {
      const timing = candidate.timingByKit?.[kitId];
      if (!timing?.transitions || timing.transitions.length !== candidate.steps.length - 1) {
        errors.push(`${candidate.id}/${kitId}: missing transition timings`);
        continue;
      }
      timing.transitions.forEach((transition, index) => {
        if (!['contact', 'recovery'].includes(transition.gate)) errors.push(`${candidate.id}/${kitId}/${index}: bad gate`);
        if (!Array.isArray(transition.window) || transition.window.length !== 2
          || transition.window[0] < 0 || transition.window[1] < transition.window[0]
          || transition.window[1] - transition.window[0] + 1 < 4)
          errors.push(`${candidate.id}/${kitId}/${index}: timing window must contain at least four ticks`);
        if (!(transition.timeout > transition.window[1])) errors.push(`${candidate.id}/${kitId}/${index}: timeout must exceed window`);
      });
    }
  }

  if (fighterOrKit) {
    const kit = fighterOrKit.kit || fighterOrKit;
    const moves = fighterOrKit.moves || kit.moves;
    for (const candidate of routes.filter(value => value.kits.includes(kit.id))) {
      candidate.steps.forEach((step, index) => {
        const move = moves?.[step.expectedMove];
        if (!move) { errors.push(`${candidate.id}: missing move ${step.expectedMove}`); return; }
        if (step.contact === 'launch' && !(move.hit.launch > 0)) errors.push(`${candidate.id}: ${move.id} cannot launch`);
        if (step.contact === 'air' && move.hit.juggle === false) errors.push(`${candidate.id}: ${move.id} cannot juggle`);
        if (index === 0) return;
        const transition = candidate.timingByKit?.[kit.id]?.transitions?.[index - 1];
        if (!transition) return;
        if (transition.gate !== 'contact') return;
        const previous = moves[candidate.steps[index - 1].expectedMove];
        if (!previous) return;
        const assisted = kit.easyChains?.[previous.id]?.[step.keys.find(key => ['lp', 'hp', 'lk', 'hk'].includes(key))];
        if (!previous.cancelInto.includes(move.id) && assisted !== move.id)
          errors.push(`${candidate.id}: ${previous.id} cannot cancel into ${move.id}`);
      });
      const required = candidate.steps.reduce((total, step) => total + (moves[step.expectedMove]?.cost || 0), 0);
      if (candidate.setup.stocks !== required) errors.push(`${candidate.id}: setup declares ${candidate.setup.stocks} stocks, needs ${required}`);
    }
  }
  return errors;
}
