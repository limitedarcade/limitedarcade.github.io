// Authored accents belong to named moves. Damage, hit boxes and projectile
// trajectories remain entirely in the simulation.
export class CombatVfx {
  constructor(models) { this.models = models; this.shields = new Map(); this.fighters = []; }

  onHit(event) {
    if (event.finisherId || event.weapon || event.type === 'finisher') return null;
    const fighter = event.attackerId || this.fighters[event.attacker]?.id;
    const common = { x: event.x, y: event.y, z: 0.28, fadeIn: 0, spin: 0, glow: 0.95 };
    if (event.move === 'burstStrike') {
      if (fighter === 'trump') return this.models.spawn('fireball', {
        ...common, size: 0.85, duration: 0.28, color: '#ffb85e', opacity: 0.72, grow: 0.25,
      });
      if (fighter === 'carney') return this.models.spawn('burst', {
        ...common, size: 1.2, duration: 0.36, color: '#9ceaff', opacity: 0.52,
        grow: 0.55, clipStart: 0.08, clipEnd: 0.13,
      });
    }
    if (event.move === 'groundBreaker') return this.models.spawn('burst', {
      ...common, y: 0.06, z: 0, rotation: [0, 0, 0], size: 1.8, duration: 0.42,
      color: fighter === 'carney' ? '#99e5ff' : fighter === 'officer_flock' ? '#8fcbd5' : '#ffca7a',
      opacity: 0.42, grow: 0.6, clipStart: 0.08, clipEnd: 0.14,
    });
    return null;
  }

  onSummon(strike) {
    if (!strike) return null;
    return this.models.spawn('appearance', { x: strike.muzzleX, y: strike.muzzleY, z: 0.15,
      size: 0.85, duration: 0.45, color: '#ffc987', opacity: 0.35, glow: 0.8 });
  }

  sync(snapshot) {
    if (this.round !== snapshot?.round || this.stageId !== snapshot?.stageId) {
      this.clear(); this.round = snapshot?.round; this.stageId = snapshot?.stageId;
    }
    this.fighters = snapshot?.fighters || [];
    const wanted = new Set();
    if (snapshot?.phase === 'fight') for (const fighter of this.fighters) {
      if (fighter.id !== 'officer_flock' || fighter.state !== 'attack'
        || !['bodyCheck', 'hammerRush'].includes(fighter.move) || !fighter.moveData) continue;
      const move = fighter.moveData;
      const start = Math.max(0, move.startup - 5), end = move.startup + move.active + 5;
      if (fighter.moveFrame < start || fighter.moveFrame >= end) continue;
      wanted.add(fighter.side);
      let shield = this.shields.get(fighter.side);
      if (!shield) {
        shield = this.models.spawn('shield', { manual: true, size: 1.18, duration: 1,
          color: '#83d9ed', opacity: 0.58, glow: 1.3, grow: 0.06,
          rotation: [0, fighter.facing * 0.45, 0], fadeIn: 0.15, fadeOut: 0.28 });
        if (shield) this.shields.set(fighter.side, shield);
      }
      // Snapshot progress freezes naturally during pause and hitstop. Visual
      // movement cannot drift ahead of the shield bash's actual contact.
      shield?.seek((fighter.moveFrame - start) / (end - start));
      shield?.setPosition(fighter.x + fighter.facing * 0.62, fighter.y + 1.12, 0.25);
    }
    for (const [side, shield] of this.shields) if (!wanted.has(side)) { shield.stop(); this.shields.delete(side); }
  }

  clear() { for (const shield of this.shields.values()) shield.stop(); this.shields.clear(); this.fighters = []; }
}
