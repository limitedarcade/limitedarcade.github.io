export const PROFILE_KEY = 'bfi.profile.v1';
export const ACHIEVEMENTS = Object.freeze([
  { id: 'first-bell', title: 'First bell', note: 'Complete your first match.', earned: s => s.matches >= 1, reward: 'Archive badge' },
  { id: 'clean-slate', title: 'Clean slate', note: 'Win a round without taking damage.', earned: s => s.flawless >= 1, reward: 'Gold profile accent' },
  { id: 'after-hours', title: 'After hours', note: 'Complete ten matches.', earned: s => s.matches >= 10, reward: 'Midnight profile accent' },
  { id: 'secret-menu', title: 'Secret menu', note: 'Discover a finisher.', earned: s => s.discoveries.length >= 1, reward: 'Finisher archive entry' },
  { id: 'tour-of-duty', title: 'Grand tour', note: 'Finish matches in three arenas.', earned: s => s.stages.length >= 3, reward: 'Arena explorer badge' },
  { id: 'combo-lab', title: 'Combo lab', note: 'Connect a five-hit combo.', earned: s => s.bestCombo >= 5, reward: 'Combo archive badge' },
]);
const fresh = () => ({ matches: 0, wins: 0, losses: 0, draws: 0, rounds: 0, flawless: 0, knockouts: 0, bestCombo: 0, totalDamage: 0, playSeconds: 0, discoveries: [], stages: [], unlocks: [], recent: [] });
const browserStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
const natural = n => Number.isFinite(n) ? Math.max(0, Math.min(1e9, Math.floor(n))) : 0;
const ids = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id)))].slice(0, 100) : [];

export class PlayerProfile {
  constructor(storage = browserStorage()) {
    this.storage = storage; this.listeners = new Set(); this.data = fresh(); this.active = null;
    try {
      const saved = JSON.parse(storage?.getItem(PROFILE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        for (const key of Object.keys(this.data)) {
          if (typeof this.data[key] === 'number') this.data[key] = natural(saved[key]);
          else if (key !== 'recent') this.data[key] = ids(saved[key]);
        }
        this.data.recent = Array.isArray(saved.recent) ? saved.recent.filter(x => x && ['win', 'loss', 'draw', 'watched'].includes(x.outcome) && typeof x.stage === 'string').slice(-8).map(x => ({ outcome: x.outcome, stage: x.stage.slice(0, 80), at: Number.isFinite(x.at) ? Math.max(0, Math.floor(x.at)) : 0 })) : [];
        this.data.unlocks = this.data.unlocks.filter(id => ACHIEVEMENTS.some(a => a.id === id));
      }
    } catch { /* An invalid save does not block startup. */ }
    this.award();
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  save() {
    this.award();
    try { this.storage?.setItem(PROFILE_KEY, JSON.stringify(this.data)); } catch { /* Play can continue without storage. */ }
    for (const listener of this.listeners) listener(this.data);
  }
  award() {
    for (const achievement of ACHIEVEMENTS) if (achievement.earned(this.data) && !this.data.unlocks.includes(achievement.id)) this.data.unlocks.push(achievement.id);
  }
  begin({ humanSides = [0], stage = 'lake-america' } = {}) {
    this.active = { humanSides: [...humanSides], stage, rounds: new Set(), finished: false };
  }
  tick(seconds) { if (this.active && !this.active.finished && Number.isFinite(seconds) && seconds > 0) this.data.playSeconds += Math.min(seconds, 1); }
  event(event, snapshot = {}) {
    if (!this.active || this.active.finished) return;
    const human = this.active.humanSides;
    if (event.type === 'hit' && human.includes(event.attacker)) {
      this.data.totalDamage += natural(event.damage);
      this.data.bestCombo = Math.max(this.data.bestCombo, natural(event.combo));
    }
    if (event.type === 'roundEnd') {
      const round = snapshot.round || event.round || this.data.rounds + 1;
      if (!this.active.rounds.has(round)) {
        this.active.rounds.add(round); this.data.rounds++;
        if (human.includes(event.winner ?? snapshot.roundWinner)) {
          if (event.reason === 'ko' || snapshot.roundReason === 'ko') this.data.knockouts++;
          if (event.flawless || snapshot.flawless) this.data.flawless++;
        }
        this.save();
      }
    }
    if (event.type === 'finisher' && human.includes(event.attacker)) {
      const id = event.finisherId || event.fatalityId || event.finisher?.id;
      if (id) this.discover(id);
    }
  }
  discover(id) {
    if (ids([id]).length && !this.data.discoveries.includes(id)) { this.data.discoveries.push(id); this.save(); }
  }
  complete(snapshot = {}) {
    if (!this.active || this.active.finished) return false;
    this.active.finished = true;
    const human = this.active.humanSides;
    const winner = Object.hasOwn(snapshot, 'winner') ? snapshot.winner : snapshot.matchWinner ?? snapshot.roundWinner;
    const outcome = human.length !== 1 ? 'watched' : winner === null || winner === undefined || winner < 0 ? 'draw' : human.includes(winner) ? 'win' : 'loss';
    this.data.matches++;
    if (outcome !== 'watched') this.data[{ win: 'wins', loss: 'losses', draw: 'draws' }[outcome]]++;
    if (!this.data.stages.includes(this.active.stage)) this.data.stages.push(this.active.stage);
    this.data.recent.push({ outcome, stage: this.active.stage, at: Date.now() }); this.data.recent = this.data.recent.slice(-8);
    this.save(); return true;
  }
  abandon() { this.active = null; this.save(); }
  reset() { this.data = fresh(); this.active = null; this.save(); }
}
