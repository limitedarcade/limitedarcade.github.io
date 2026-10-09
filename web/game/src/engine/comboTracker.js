import { routeStepMatches, routesForKit } from './comboRoutes.js';

const DISPLAY_HOLD_FRAMES = 49;

function copySummary(active) {
  return { comboId: active.id, attacker: active.attacker, defender: active.defender,
    combo: active.count, damage: active.damage };
}

export class ComboTracker {
  constructor() {
    this.nextComboId = 0;
    this.reset();
  }

  reset() {
    this.activeByDefender = new Map();
    this.attacks = new Map();
  }

  registerAttack(event) {
    if (!event?.attackId) return;
    this.attacks.set(event.attackId, {
      side: event.side, move: event.move, keys: [...(event.inputKeys || [])],
    });
    if (this.attacks.size > 64) this.attacks.delete(this.attacks.keys().next().value);
  }

  tickDisplay(fighters) {
    for (const fighter of fighters) {
      if (fighter.comboCount > 0) {
        fighter.comboDisplayCount = fighter.comboCount;
        fighter.comboDisplayDamage = fighter.comboDamage;
        fighter.comboDisplayFrames = DISPLAY_HOLD_FRAMES;
      } else if (fighter.comboDisplayFrames > 0) {
        fighter.comboDisplayFrames -= 1;
        if (fighter.comboDisplayFrames === 0) {
          fighter.comboDisplayCount = 0;
          fighter.comboDisplayDamage = 0;
        }
      }
    }
  }

  beforeContacts(fighters, events) {
    for (const [defenderSide, active] of [...this.activeByDefender]) {
      const defender = fighters[defenderSide];
      const attacker = fighters[active.attacker];
      if (!defender || !attacker || defender.isActionable() || attacker.isHelpless())
        this.end(defender, events, 'opportunity');
    }
  }

  juggleLand(defender, events) {
    const active = this.activeByDefender.get(defender.side);
    const summary = active ? copySummary(active) : {
      comboId: null, attacker: 1 - defender.side, defender: defender.side,
      combo: defender.comboCount, damage: defender.comboDamage,
    };
    events.push({ type: 'juggleLand', side: defender.side, x: defender.x, y: 0, ...summary });
    this.end(defender, events, 'landing');
  }

  blocked(attacker, defender, events) {
    const active = this.activeByDefender.get(defender.side);
    if (active?.attacker === attacker.side) this.end(defender, events, 'block');
  }

  recordHit(attacker, defender, hitEvent, events) {
    // A simultaneous trade interrupts the sequence whose attacker was hit,
    // even though both pre-contact hitboxes are still allowed to resolve.
    const interrupted = this.activeByDefender.get(attacker.side);
    if (interrupted) this.end(attacker, events, 'interruption');

    let active = this.activeByDefender.get(defender.side);
    if (!active || active.attacker !== attacker.side) {
      if (active) this.end(defender, events, 'new-attacker');
      const seededCount = defender.comboCount || 0;
      active = {
        id: `${this.nextComboId++}`, attacker: attacker.side, defender: defender.side,
        count: seededCount, damage: defender.comboDamage || 0,
        candidates: [], completed: new Set(),
      };
      this.activeByDefender.set(defender.side, active);
    }

    active.count += 1;
    active.damage += hitEvent.damage;
    defender.comboCount = active.count;
    defender.comboDamage = active.damage;
    defender.comboPeak = Math.max(defender.comboPeak, active.count);
    defender.comboIdle = 0;

    const attack = this.attacks.get(hitEvent.attackId);
    const fact = { ...hitEvent, keys: attack?.side === attacker.side ? attack.keys : [] };
    if (active.count === 1) {
      active.candidates = routesForKit(attacker.kit.id)
        .filter(candidate => routeStepMatches(candidate.steps[0], fact))
        .map(route => ({ route, nextStep: 1 }));
    } else {
      active.candidates = active.candidates.filter(candidate => {
        const step = candidate.route.steps[candidate.nextStep];
        if (!step || !routeStepMatches(step, fact)) return false;
        candidate.nextStep += 1;
        return true;
      });
    }

    for (const candidate of active.candidates) {
      if (candidate.nextStep !== candidate.route.steps.length || active.completed.has(candidate.route.id)) continue;
      active.completed.add(candidate.route.id);
      events.push({ type: 'comboRouteComplete', routeId: candidate.route.id,
        side: attacker.side, comboId: active.id, hitCount: active.count, damage: active.damage,
        specificity: candidate.route.steps.length });
    }

    return { id: active.id, count: active.count, damage: active.damage };
  }

  end(defender, events, reason = 'ended') {
    if (!defender) return null;
    const active = this.activeByDefender.get(defender.side);
    const count = active?.count ?? defender.comboCount;
    const damage = active?.damage ?? defender.comboDamage;
    if (active && count >= 2) events.push({ type: 'comboEnd', ...copySummary(active), reason });
    this.activeByDefender.delete(defender.side);
    defender.comboCount = 0;
    defender.comboIdle = 0;
    defender.comboDamage = 0;
    return active || (count ? { count, damage } : null);
  }
}
