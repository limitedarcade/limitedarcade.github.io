const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function impactProfile(event) {
  const power = clamp(event.bloodScale ?? 1, 0.2, 4);
  const ko = Boolean(event.ko || event.type === 'finisher');
  const block = event.type === 'block';
  const heavy = ko || (!block && (power >= 1.2 || event.damage >= 90 || Boolean(event.counter)));
  // A laser cuts; it does not club. Grouping it with the blades gets it the
  // pale crescent and the cleaner spray rather than a blunt fracture burst.
  const slash = ['knife', 'shuriken', 'axe', 'laser'].includes(event.weapon) || /kick|knee|heel|sweep|cyclone/i.test(event.move || '');
  return { power, ko, block, heavy, type: ko ? 'ko' : block ? 'block' : event.counter ? 'counter' : slash ? 'slash' : 'blunt',
    pause: ko ? 12 : block ? 4 : clamp(Math.round(4 + power * 2 + (event.counter ? 2 : 0)), 4, 11),
    dolly: heavy ? 0.4 : 0, slow: event.counter && !ko ? 0.18 : 0,
    grade: heavy ? 3 : 0, recoil: block ? 0.25 : clamp(power * 0.55, 0.3, 1.3) };
}

// Cosmetic holds use elapsed seconds; gameplay hitstop belongs exclusively to Match.
export class ImpactClock {
  constructor() { this.reset(); }
  reset() { this.hold = 0; this.grade = 0; this.slow = 0; this.ko = 0; }
  hit(profile) {
    this.hold = Math.max(this.hold, profile.pause);
    this.grade = Math.max(this.grade, profile.grade);
    this.slow = profile.ko || this.ko > 0 ? 0 : Math.max(this.slow, profile.slow);
    if (profile.ko) this.ko = 12;
  }
  get frozen() { return this.hold > 0; }
  get scale() { return this.slow > 0 ? 0.35 + 0.65 * (1 - this.slow / 0.18) : 1; }
  rendered(dt) {
    const ticks = Math.max(0, dt) * 60;
    const previousHold = this.hold;
    this.hold = Math.max(0, this.hold - ticks);
    this.slow = Math.max(0, this.slow - Math.max(0, ticks - previousHold) / 60);
    this.grade = Math.max(0, this.grade - ticks);
    this.ko = Math.max(0, this.ko - ticks);
  }
}

export function rumble(pad, profile, strength = 1) {
  const actuator = pad?.vibrationActuator || pad?.hapticActuators?.[0];
  if (!actuator) return;
  const strongMagnitude = clamp(profile.power * (profile.block ? 0.12 : 0.3) * strength, 0, 1);
  const duration = profile.ko ? 280 : profile.heavy ? 140 : 65;
  try {
    const result = actuator.playEffect ? actuator.playEffect('dual-rumble', {
      duration, startDelay: 0, strongMagnitude, weakMagnitude: clamp(strongMagnitude * 1.6, 0, 1),
    }) : actuator.pulse?.(strongMagnitude, duration);
    Promise.resolve(result).catch(() => {});
  } catch { /* Unsupported actuators must never interrupt combat. */ }
}

export function stopRumble(pads) {
  for (const pad of pads || []) {
    const a = pad?.vibrationActuator || pad?.hapticActuators?.[0];
    try { Promise.resolve(a?.reset?.() ?? a?.pulse?.(0, 0)).catch(() => {}); } catch {}
  }
}
