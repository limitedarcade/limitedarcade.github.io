import { MOVEMENT_LESSONS } from '../game/practice.js';
import { fillPracticeCommands, fillCompactCommand } from './commandIcons.js';
import './practice.css';

const TABS = Object.freeze(['Fundamentals', 'Combos', 'Basics', 'Specials', 'Supers', 'Finishers']);
const TAB_LABEL = Object.freeze({ Fundamentals: 'Learn', Combos: 'Combos', Basics: 'Basics', Specials: 'Specials', Supers: 'Supers', Finishers: 'Finishers' });

const LEVEL_COPY = Object.freeze({ mid: 'Mid', low: 'Low', overhead: 'Overhead', throw: 'Throw' });

const el = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
const node = (tag, className, text) => { const n = el(tag, text); n.className = className; return n; };

// The badges a player scans a move list for: what it costs, whether it has to
// be blocked a particular way, and what it takes off. Frame data lives in the
// detail pane below, because nobody picks a move off a startup number.
function badgesFor(entry) {
  const out = [];
  if (entry.cost) out.push(['cost', `${entry.cost} stock${entry.cost > 1 ? 's' : ''}`]);
  const level = entry.hit?.level;
  if (level === 'overhead') out.push(['overhead', 'Overhead']);
  if (level === 'low') out.push(['low', 'Low']);
  if (level === 'throw') out.push(['throw', 'Throw']);
  if (entry.projectile) out.push(['ranged', 'Ranged']);
  if (entry.overwatch) out.push(['ranged', 'Summon']);
  if (entry.hit?.knockdown) out.push(['knockdown', 'Knockdown']);
  if (entry.hit?.damage) out.unshift(['damage', `${entry.hit.damage} dmg`]);
  return out;
}

export class PracticePanel {
  constructor({ roster, stages, preferences, defaults, onLaunch, onAction, onSettings }) {
    Object.assign(this, { preferences, onAction, onLaunch });
    this.dialog = el('dialog'); this.dialog.className = 'game-dialog practice-picker';
    this.dialog.setAttribute('aria-label', 'Start practice');
    const title = el('h2', 'Enter the practice arena');
    const intro = el('p', 'Every move unlocked. No clock. No pressure. Watch it, then make it yours.');
    // A preset that names a fighter or arena the build does not ship would
    // silently fall back to the first option, so it only applies when the
    // entry is actually present.
    const select = (label, items, preset) => {
      const field = el('label', label); const s = el('select');
      for (const item of items) { const o = el('option', item.label || item.name); o.value = item.id; s.append(o); }
      if (preset && items.some(item => item.id === preset)) s.value = preset;
      field.append(s); this.dialog.append(field); return s;
    };
    this.dialog.append(title, intro);
    this.fighter = select('Your fighter', roster, defaults?.fighter);
    this.opponent = select('Training partner', roster, defaults?.opponent);
    if (!defaults?.opponent) this.opponent.selectedIndex = Math.min(1, roster.length - 1);
    this.stage = select('Arena', stages.filter(stage => !stage.comingSoon), defaults?.stage);
    this.launch = el('button', 'Start practice'); this.launch.className = 'btn btn-primary';
    this.launch.onclick = async () => { this.launch.disabled = true; try { if (await onLaunch(this.fighter.value, this.opponent.value, this.stage.value) !== false) this.dialog.close(); } catch (e) { intro.textContent = `Could not start practice: ${e.message}`; } finally { this.launch.disabled = false; } };
    const close = el('button', 'Cancel'); close.onclick = () => this.dialog.close();
    this.dialog.append(this.launch, close); document.body.append(this.dialog);

    this.root = el('aside'); this.root.className = 'practice-panel'; this.root.hidden = true;
    const head = el('header');
    this.heading = node('span', 'practice-heading', 'PRACTICE');
    const fold = node('button', 'practice-fold', 'Hide');
    this.fold = fold;
    fold.onclick = () => {
      if (this.body.hidden) this.body.hidden = false;
      else if (this.root.classList.contains('is-previewing')) this.root.classList.remove('is-previewing');
      else this.body.hidden = true;
      this.updateFold();
    };
    head.append(this.heading, fold);

    this.body = el('div'); this.body.className = 'practice-body';
    this.tabs = el('nav'); this.tabs.className = 'practice-tabs'; this.tabs.setAttribute('role', 'tablist');
    this.tabButtons = new Map();
    for (const group of TABS) {
      const b = node('button', 'practice-tab', TAB_LABEL[group]);
      b.type = 'button'; b.setAttribute('role', 'tab');
      b.onclick = () => { this.showTab(group); b.blur(); };
      this.tabButtons.set(group, b); this.tabs.append(b);
    }
    this.list = el('div'); this.list.className = 'practice-list';
    this.list.setAttribute('role', 'listbox'); this.list.setAttribute('aria-label', 'Choose a move or lesson');

    this.detail = el('div'); this.detail.className = 'practice-detail';
    this.title = el('h2'); this.copy = el('p');
    this.keys = el('div'); this.keys.className = 'practice-keys';
    this.frames = node('p', 'practice-frames');
    this.status = el('p', 'Choose a move. Watch the demonstration or try the inputs.'); this.status.setAttribute('role', 'status');
    const actions = el('div'); actions.className = 'practice-actions';
    for (const [label, action] of [['Watch move', 'watch'], ['Try it', 'try'], ['Reset positions', 'reset']]) {
      const b = el('button', label); b.onclick = () => {
        if (action === 'watch') this.setPreviewing(true);
        onAction(action, this.entry); b.blur();
      }; actions.append(b);
    }
    this.stats = node('p', 'practice-stats');
    this.history = node('p', 'practice-history');
    this.steps = node('ol', 'practice-steps');
    this.detail.append(this.title, this.copy, this.keys, this.frames, this.steps, actions, this.status, this.stats, this.history);

    const settings = el('div'); settings.className = 'practice-settings';
    const dummy = el('select'); dummy.setAttribute('aria-label', 'Training partner behavior');
    for (const [v, t] of [['idle', 'Dummy: stand'], ['block', 'Dummy: block'], ['crouch', 'Dummy: crouch block'], ['attack', 'Dummy: repeat jab']]) { const o = el('option', t); o.value = v; dummy.append(o); }
    dummy.onchange = () => { onSettings('dummy', dummy.value); dummy.blur(); };
    const speed = el('select'); speed.setAttribute('aria-label', 'Practice speed');
    for (const [v, t] of [['1', 'Speed: normal'], ['0.5', 'Speed: half'], ['0.25', 'Speed: quarter']]) { const o = el('option', t); o.value = v; speed.append(o); }
    speed.onchange = () => { onSettings('speed', Number(speed.value)); speed.blur(); };
    const boxes = node('label', 'practice-toggle', 'Contact boxes');
    const check = el('input'); check.type = 'checkbox'; check.onchange = () => onSettings('boxes', check.checked); boxes.prepend(check);
    const resource = el('select'); resource.setAttribute('aria-label', 'Practice meter mode');
    for (const [v, t] of [['free', 'Meter: unlimited'], ['cost', 'Meter: route cost']]) { const o = el('option', t); o.value = v; resource.append(o); }
    resource.onchange = () => { onSettings('resources', resource.value); resource.blur(); };
    const swap = el('button', 'Swap arena side'); swap.type = 'button'; swap.onclick = () => { onSettings('side', 'swap'); swap.blur(); };
    settings.append(dummy, speed, resource, swap, boxes);
    const more = el('a', 'How this game was made ↗'); more.href = 'made.html'; more.target = '_blank'; more.rel = 'noopener';

    this.body.append(this.tabs, this.list, this.detail, settings, more);
    this.root.append(head, this.body); document.body.append(this.root); this.updateFold();
  }
  open() { this.dialog.showModal(); }
  updateFold() {
    this.fold.textContent = this.body.hidden ? 'Show panel'
      : this.root.classList.contains('is-previewing') ? 'Show moves' : 'Hide panel';
  }
  setPreviewing(previewing) {
    this.root.classList.toggle('is-previewing', previewing);
    this.updateFold();
  }
  label(fighter, opponent) { this.heading.textContent = `PRACTICE · ${fighter} vs ${opponent}`; }
  populate(entries) {
    this.entries = [
      { id: 'lesson-move', name: '01 · Find your feet', group: 'Fundamentals', sub: 'First steps', keys: ['left', 'right'], description: 'Walk both ways. Keep your opponent in front of you; forward and back follow the side they are on.' },
      { id: 'lesson-jump', name: '02 · Jump and crouch', group: 'Fundamentals', sub: 'First steps', keys: ['up', 'down'], description: 'Jump, then crouch. Jumping commits you to the air; crouching makes you a smaller target.' },
      { id: 'lesson-block', name: '03 · Hold your ground', group: 'Fundamentals', sub: 'First steps', keys: ['block'], description: 'Hold block to stop the incoming jab. Low sweeps need crouching guard; overhead attacks need standing guard.' },
      ...MOVEMENT_LESSONS.filter(lesson => lesson.id !== 'lesson-juggle'), ...entries];
    this.entry = null;
    this.rows = new Map();
    this.list.replaceChildren();
    for (const group of TABS) {
      const members = this.entries.filter(e => e.group === group);
      this.tabButtons.get(group).hidden = !members.length;
      let sub = null;
      for (const entry of members) {
        if (entry.sub && entry.sub !== sub) { sub = entry.sub; const h = node('h3', 'practice-sub', sub); h.dataset.group = group; this.list.append(h); }
        const row = node('button', 'practice-row'); row.type = 'button';
        row.dataset.group = group; row.setAttribute('role', 'option');
        row.append(node('span', 'practice-row-name', entry.name));
        fillCompactCommand(row.appendChild(el('span')), { keys: entry.keys, steps: entry.steps, join: this.joinFor(entry) });
        const badges = node('span', 'practice-badges');
        for (const [tone, text] of badgesFor(entry)) badges.append(node('span', `practice-badge is-${tone}`, text));
        if (badges.childElementCount) row.append(badges);
        row.onclick = () => { this.select(entry.id); row.blur(); };
        this.rows.set(entry.id, row); this.list.append(row);
      }
    }
    this.showTab(TABS.find(group => this.entries.some(e => e.group === group)));
  }
  joinFor(entry) {
    return entry.group === 'Finishers' && entry.kind !== 'brutality' ? '→'
      : entry.group === 'Fundamentals' || entry.id === 'jumpAttack' ? 'then' : '+';
  }
  showTab(group) {
    this.tab = group;
    for (const [name, button] of this.tabButtons) {
      button.classList.toggle('is-active', name === group);
      button.setAttribute('aria-selected', String(name === group));
    }
    for (const child of this.list.children) child.hidden = child.dataset.group !== group;
    this.list.scrollTop = 0;
    const first = this.entries.find(e => e.group === group);
    if (first && this.entry?.group !== group) this.select(first.id);
  }
  select(id) {
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return;
    this.setPreviewing(false);
    this.entry = entry;
    for (const [key, row] of this.rows) {
      row.classList.toggle('is-selected', key === id);
      row.setAttribute('aria-selected', String(key === id));
    }
    this.title.textContent = entry.name;
    this.copy.textContent = entry.description || entry.requirement || (entry.group === 'Finishers'
      ? `${entry.range.label}. Enter each input in order. The finishing window stays open while you learn.`
      : `${LEVEL_COPY[entry.hit?.level] || 'Mid'} attack. ${entry.cost ? `Costs ${entry.cost} meter stock${entry.cost > 1 ? 's' : ''}; practice keeps your meter full.` : 'Try it close to your partner, then experiment with spacing.'}`);
    fillPracticeCommands(this.keys, { keys: entry.keys, steps: entry.steps, bindings: this.preferences.bindings, join: this.joinFor(entry) });
    this.frames.textContent = entry.endsName ? `Chain ends in ${entry.endsName}`
      : entry.group === 'Combos' ? `${entry.expectedHits} confirmed hits · start ${entry.setup.distance.toFixed(2)} m · route cost ${entry.setup.stocks} stock${entry.setup.stocks === 1 ? '' : 's'}`
      : entry.startup === undefined ? ''
      : `Startup ${entry.startup} · active ${entry.active} · recovery ${entry.recovery} frames`;
    this.frames.hidden = !this.frames.textContent;
    this.steps.replaceChildren();
    for (const [index, step] of (entry.route?.steps || []).entries()) {
      const item = el('li', `${index + 1}. ${entry.moveNames?.[index] || step.expectedMove} · ${step.contact}`);
      item.dataset.step = String(index); this.steps.append(item);
    }
    this.steps.hidden = !entry.route;
    this.onAction('try', entry);
  }
  progress(session) {
    for (const item of this.steps.children) {
      const index = Number(item.dataset.step);
      item.classList.toggle('is-pressed', index < (session?.pressedSteps || 0));
      item.classList.toggle('is-confirmed', index < (session?.confirmedSteps || 0));
      item.classList.toggle('is-current', index === (session?.confirmedSteps || 0) && !session?.done);
    }
  }
  // Kept for callers that re-run the current entry rather than picking a new one.
  choose() { this.select(this.entry?.id || this.entries?.[0]?.id); }
}
