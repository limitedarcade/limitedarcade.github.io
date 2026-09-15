// Optional, deterministic arena rules. The visible warning uses the same zone
// and countdown as the contact check: no hidden targeting or random damage.
export const HAZARD_RULES = Object.freeze({
  interval: 600, warningFrames: 50, radius: 0.8, damage: 40, hitStun: 14,
  positions: Object.freeze([-2.6, 2.6, 0]),
});

export const STAGE_HAZARD_KINDS = Object.freeze({
  'lake-america': 'ice', capitol: 'masonry', 'palm-resort': 'urn', 'executive-lawn': 'fountain',
});

export class StageHazards {
  constructor({ stageId = 'lake-america', enabled = false } = {}) {
    this.stageId = stageId;
    this.enabled = Boolean(enabled);
    this.kind = STAGE_HAZARD_KINDS[stageId] || 'ice';
    this.reset();
  }

  reset() { this.ticks = 0; this.cycle = 0; this.warning = null; }

  snapshot(phase) {
    return this.enabled && phase === 'fight' && this.warning ? { ...this.warning } : null;
  }

  step({ phase, fighters, events }) {
    if (!this.enabled || phase !== 'fight') return;
    this.ticks += 1;
    if (this.warning) {
      this.warning.remaining -= 1;
      if (this.warning.remaining <= 0) {
        const zone = this.warning;
        this.warning = null;
        events.push({ type: 'hazardBurst', stageId: this.stageId, kind: this.kind,
          x: zone.x, y: 0.15, radius: zone.radius, bloodScale: 0 });
        for (const fighter of fighters) {
          if (fighter.health <= 0 || fighter.airborne || fighter.y > 0.02
            || Math.abs(fighter.x - zone.x) > zone.radius) continue;
          const damage = Math.min(HAZARD_RULES.damage, Math.max(0, fighter.health - (fighter.healthFloor || 0)));
          fighter.health -= damage;
          fighter.enterHitStun(HAZARD_RULES.hitStun, false);
          events.push({ type: 'hazardHit', stageId: this.stageId, kind: this.kind,
            defender: fighter.side, damage, x: fighter.x, y: 0.65,
            bloodScale: 0.7, power: 0.7, level: 'low', ko: fighter.health <= 0,
            facing: Math.sign(fighter.x - zone.x) || (fighter.side === 0 ? -1 : 1) });
          if (fighter.health <= 0) events.push({ type: 'ko', loser: fighter.side, source: 'stage',
            x: fighter.x, y: 0.65 });
        }
      }
    }
    if (!this.warning && this.ticks % HAZARD_RULES.interval === 0) {
      const x = HAZARD_RULES.positions[this.cycle++ % HAZARD_RULES.positions.length];
      this.warning = { x, radius: HAZARD_RULES.radius, remaining: HAZARD_RULES.warningFrames,
        kind: this.kind, stageId: this.stageId };
      events.push({ type: 'hazardWarning', ...this.warning });
    }
  }
}
