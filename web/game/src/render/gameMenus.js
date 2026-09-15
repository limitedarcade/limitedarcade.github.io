import { MOVES, STAGE_AXE, STAGE_RING } from '../engine/frameData.js';
import { CHORDS, DIRECTIONAL } from '../engine/moveList.js';
import { TUNABLES } from '../engine/ai.js';
import { POSE_TUNABLES, getPose, setPose, resetPose } from './poseAmp.js';
import { ProductMenus } from './productMenus.js';
import { fillBindingLegend, renderTokens, notationTokens, tokensFromActions } from './commandIcons.js';

const make = (tag, className, content) => {
  const el = document.createElement(tag); el.className = className || '';
  if (content !== undefined) el.textContent = content;
  return el;
};

export class GameMenus {
  constructor({ audio, cpu, onDebugOpen, onDebugClose, onModel, onRestart, onPreview, onSpeed, onWireframe, onBoxes,
    options, profile, onOptionsChange, getFighters = () => [], getFinishers = () => [] }) {
    this.cpu = cpu;
    this.audio = audio;
    this.product = new ProductMenus({ audio, options, profile, onOptionsChange, getFinishers });
    this.getFighters = getFighters; this.getFinishers = getFinishers; this.moveFighterId = null;
    this.moves = make('dialog', 'game-dialog move-dialog');
    this.moves.setAttribute('aria-label', 'Move list');
    const heading = make('header', 'dialog-header');
    heading.append(make('div', '', 'COMMAND ARCHIVE'), this.closeButton(this.moves));
    const title = make('h2', 'dialog-title', 'Move list');
    const help = make('p', 'dialog-help', 'Forward and Back follow your opponent. Hold a direction while pressing the attack. “+” means together; chords allow a short finger-roll window.');
    const mapping = make('div', 'input-legend'); this.moveMapping = mapping;
    this.fighterTabs = make('nav', 'move-fighter-select'); this.fighterTabs.setAttribute('aria-label', 'Fighter move sets');
    const tabs = make('nav', 'move-tabs'); tabs.setAttribute('aria-label', 'Move categories');
    this.moveRows = make('div', 'move-rows');
    const groups = {
      Basics: [
        ['lightPunch', 'LP', 'Quick standing jab. Can link into a heavier move after a hit.'],
        ['heavyPunch', 'HP', 'Rear cross. Stronger, with a longer commitment.'],
        ['lightKick', 'LK', 'Quick mid kick; a useful combination starter.'],
        ['heavyKick', 'HK', 'Long heavy kick that knocks down.'],
        ['crouchPunch', '↓ + LP', 'Crouching punch.'], ['crouchKick', '↓ + LK / HK', 'Low sweep.'],
        ['jumpAttack', '↑ then any attack', 'Jump-in overhead. Add left or right for a diagonal jump.'],
        [null, '← / →', 'Walk either direction. Back retreats and guards against mid attacks.'],
        [null, '↑ · ↓', 'Jump / crouch. There is no depth lane in this side-view arena.'],
        [null, 'BLOCK · ↓ + BLOCK', 'Standing / crouching guard. Explicit block holds your position.'],
      ],
      Chords: CHORDS.map(c => [c.move, c.buttons.map(b => b.toUpperCase()).join(' + '), c.note]),
      Directional: DIRECTIONAL.map(c => [c.move, c.input, c.note]),
      Arena: [['stageRing', 'Down + LP + HP', 'Lake America: throw the rescue ring from the right station. Either fighter can claim it once per round, independently of the axe. Blockable; returns next round.'], ['stageAxe', 'Down + LP + HP', 'Lake America: stand beside the axe on the left, then hold Down + LP + HP to throw it. Either fighter can claim it once per round. Blockable; returns next round.']],
      Finish: [[null, 'SECRET COMMANDS', 'During FINISH IT, enter a complete command in order. Forward and Back follow your opponent. Check the required distance before the last button.'],
        ['throw', 'Grab → LK + HK', 'During combat, convert a successful grab into a throw before the hold ends.']],
    };
    for (const [group, rows] of Object.entries(groups)) {
      const button = make('button', '', group); button.type = 'button';
      button.addEventListener('click', () => {
        this.activeMoveTab = button;
        for (const b of tabs.children) b.setAttribute('aria-pressed', String(b === button));
        const fighter = this.getFighters().find(f => f.id === this.moveFighterId);
        // A kit's own commands belong on this page next to the universal ones,
        // and only for the fighter that has them -- the list is rebuilt per
        // selection anyway, so it costs nothing to ask the kit each time.
        const shown = group === 'Directional'
          ? [...rows, ...(fighter?.combat?.commands || []).map(c => [c.move, c.input, c.note])]
          : rows;
        this.moveRows.replaceChildren(...shown.map(([id, input, note]) => {
          const row = make('article', 'move-row');
          const move = fighter?.combat?.moves?.[id] || fighter?.moves?.[id] || MOVES[id] || (id === 'stageAxe' ? STAGE_AXE : id === 'stageRing' ? STAGE_RING : null), name = move?.name || (input === 'SECRET COMMANDS' ? 'The finishing window' : input.includes('BLOCK') ? 'Guard' : 'Movement');
          const body = make('div'); body.append(make('h3', '', name), make('p', '', move?.description || note));
          if (move?.cost) body.append(make('span', 'cost-tag', `${move.cost} METER STOCK${move.cost > 1 ? 'S' : ''}`));
          if (move) body.append(make('span', 'move-frame-data', `Startup ${move.startup}f  ·  Active ${move.active}f  ·  Recovery ${move.recovery}f  ·  Damage ${move.hit?.damage || 0}`));
          const kbd = make('kbd', 'move-input cmd-notation');
          renderTokens(kbd, notationTokens(input));
          row.append(kbd, body); return row;
        }));
        if (group === 'Finish') {
          const entries = this.getFinishers(fighter?.id) || [];
          for (const entry of entries) {
            const row = make('article', 'move-row'); const body = make('div');
            body.append(make('h3', '', entry.name || entry.label), make('p', '', entry.requirement || `${entry.range?.label || 'Close'} · ${entry.tagline || 'Enter during the finishing window.'}`));
            const kbd = make('kbd', 'move-input cmd-notation');
            const sequence = entry.command || entry.sequence;
            renderTokens(kbd, sequence?.length ? tokensFromActions(sequence, '→') : notationTokens('COMBO END'));
            row.append(kbd, body); this.moveRows.append(row);
          }
        }
      });
      tabs.append(button);
    }
    this.moves.append(heading, title, help, mapping, this.fighterTabs, tabs, this.moveRows);
    document.body.append(this.moves); tabs.firstChild.click();
    this.moves.addEventListener('close', () => document.querySelector('#moves-button')?.focus());

    this.debug = make('dialog', 'game-dialog debug-dialog'); this.debug.setAttribute('aria-label', 'Debug studio');
    const top = make('header', 'dialog-header'); top.append(make('div', '', 'DEVELOPER STUDIO'), this.closeButton(this.debug));
    this.debug.append(top, make('h2', 'dialog-title', 'Debug studio'), make('p', 'dialog-help', 'Backtick opens this panel. The match pauses while you inspect or change the scene.'));
    const models = make('div', 'debug-grid');
    for (const side of [0, 1]) {
      const field = make('label', 'debug-field'); field.append(make('span', '', `Fighter ${side + 1} model`));
      const select = make('select');
      for (const [value, label] of [['threejs', 'Packed Three.js'], ['glb', 'Rigged GLB']]) {
        const option = make('option', '', label); option.value = value; select.append(option);
      }
      select.addEventListener('change', async () => {
        select.disabled = true; this.debugStatus.textContent = 'Loading model…';
        try { await onModel(side, select.value); this.debugStatus.textContent = 'Model ready. Match state preserved.'; }
        catch (e) { select.value = select.value === 'glb' ? 'threejs' : 'glb'; this.debugStatus.textContent = `Model unchanged: ${e.message}`; }
        finally { select.disabled = false; }
      });
      field.append(select); models.append(field);
    }
    this.debug.append(models);
    const speed = this.range('Simulation speed', 1, onSpeed, 0.25, 1.5, 0.25);
    const checks = make('div', 'debug-grid');
    for (const [label, fn] of [['Wireframe', onWireframe], ['Collision boxes', onBoxes]]) {
      const field = make('label', 'debug-check'), input = make('input'); input.type = 'checkbox';
      input.addEventListener('change', () => fn(input.checked)); field.append(input, document.createTextNode(label)); checks.append(field);
    }
    this.debug.append(speed, checks);

    // CPU behaviour. These were constants in ai.js, which meant retuning the
    // opponent was an edit-reload-fight loop; here they are live, and the panel
    // is generated from TUNABLES so it cannot drift out of step with the AI.
    // Changes apply to both CPU sides -- a lopsided pair is a different feature.
    const cpuGrid = make('div', 'debug-grid cpu-grid');
    this.cpuRows = TUNABLES.map(t => {
      const row = this.range(t.label, cpu.get(t.key), value => { cpu.set(t.key, value); this.debugStatus.textContent = `CPU ${t.label.toLowerCase()} set for both sides. Difficulty presets no longer apply to it.`; },
        t.min, t.max, t.step, t.unit);
      row.title = t.hint;
      cpuGrid.append(row);
      return { ...t, row };
    });
    const cpuReset = make('button', 'btn btn-ghost', 'Reset to difficulty preset'); cpuReset.type = 'button';
    cpuReset.addEventListener('click', () => { cpu.reset(); this.refreshCpu(); this.debugStatus.textContent = 'CPU behaviour back to the selected difficulty.'; });
    this.debug.append(make('h3', '', 'CPU behaviour · both sides'), cpuGrid, cpuReset);

    // Pose amplification. The panel pauses the match, and the views are still
    // re-sampled every frame at dt 0, so a slider dragged here reshapes the
    // frozen fighters live -- drop Simulation speed to 0.25 and restart to
    // judge a punch rather than an idle.
    const poseGrid = make('div', 'debug-grid cpu-grid');
    this.poseRows = POSE_TUNABLES.map(t => {
      const row = this.range(t.label, getPose(t.key), value => {
        setPose(t.key, value);
        this.debugStatus.textContent = `${t.label} at ${Math.round(value * 100)}% of the authored pose. Saved for next launch.`;
      }, t.min, t.max, t.step, t.unit);
      row.title = t.hint;
      poseGrid.append(row);
      return { ...t, row };
    });
    const poseReset = make('button', 'btn btn-ghost', 'Reset to authored pose'); poseReset.type = 'button';
    poseReset.addEventListener('click', () => { resetPose(); this.refreshPose(); this.debugStatus.textContent = 'Amplification off; clips play at the amplitude they were exported with.'; });
    this.debug.append(make('h3', '', 'Pose amplification · both fighters'), poseGrid, poseReset);

    const preview = make('div', 'debug-actions');
    for (const [label, value] of [['Intro reel', 'intro'], ['K.O.', 'ko'], ['Flawless', 'flawless'], ['Double K.O.', 'double'], ['Fatality', 'fatality']]) {
      const button = make('button', 'btn btn-ghost', label); button.type = 'button';
      button.addEventListener('click', async () => { await onPreview(value); this.debug.close(); }); preview.append(button);
    }
    const restart = make('button', 'btn btn-primary', 'Restart match'); restart.type = 'button';
    restart.addEventListener('click', async () => { await onRestart(); this.debug.close(); });
    this.debugStatus = make('p', 'debug-status', 'Switch formats to compare the converted fighters with their source rigs.');
    this.stats = make('pre', 'debug-stats');
    this.debug.append(make('h3', '', 'Reel previews · resets match'), preview, restart, this.debugStatus, this.stats);
    document.body.append(this.debug);
    this.onDebugOpen = onDebugOpen;
    this.debug.addEventListener('close', onDebugClose);
    for (const panel of [this.moves, this.debug]) panel.addEventListener('keydown', e => e.stopPropagation());
    this.debug.addEventListener('keydown', e => { if (e.code === 'Backquote') { e.preventDefault(); this.debug.close(); } });

    const sound = document.querySelector('#audio-settings');
    for (const [key, label] of [['master', 'Master'], ['music', 'Music'], ['effects', 'Effects'], ['voice', 'Announcer']])
      sound?.append(this.range(label, audio.settings[key], value => audio.set(key, value)));
    // Keep the title and pause screens useful without requiring HTML hooks.
    for (const [target, className] of [['#screen-pause .screen-inner', 'pause-product-actions'], ['#screen-title .screen-inner', 'title-product-actions']]) {
      const host = document.querySelector(target); if (!host) continue;
      const actions = make('div', className);
      const items = [['Options', () => this.showOptions()]];
      // The title menu stays lean; the archive remains reachable from pause.
      if (target.includes('pause')) items.push(['Profile', () => this.showProfile()]);
      for (const [label, fn] of items) {
        const b = make('button', target.includes('pause') ? 'btn btn-ghost' : 'menu-text-button', label); b.type = 'button'; b.addEventListener('click', fn); actions.append(b);
      }
      const quit = host.querySelector('#quit-button'); if (quit) host.insertBefore(actions, quit); else host.append(actions);
    }
  }
  closeButton(dialog) {
    const button = make('button', 'dialog-close', '×'); button.type = 'button'; button.setAttribute('aria-label', 'Close');
    button.addEventListener('click', () => dialog.close()); return button;
  }
  range(label, value, onInput, min = 0, max = 1, step = 0.05, unit = null) {
    const text = v => (unit ? `${Math.round(v)}${unit}` : `${Math.round(v * 100)}%`);
    const row = make('label', 'audio-range'), input = make('input'), output = make('output', '', text(value));
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
    input.addEventListener('input', () => { output.textContent = text(input.value); onInput(Number(input.value)); });
    row.append(make('span', '', label), input, output);
    // The panel is rebuilt from live values whenever it opens, so the slider
    // needs to be settable from outside without re-firing its own handler.
    row.setValue = v => { input.value = v; output.textContent = text(v); };
    return row;
  }

  // Difficulty can change between openings, and reset clears overrides, so the
  // sliders are re-read from the controller rather than trusted to be current.
  refreshCpu() { for (const t of this.cpuRows) t.row.setValue(this.cpu.get(t.key)); }

  // Reset and the persisted values both change POSE from outside the sliders.
  refreshPose() { for (const t of this.poseRows) t.row.setValue(getPose(t.key)); }
  showMoves() {
    const fighters = [...new Map(this.getFighters().map(f => [f.id, f])).values()];
    if (!fighters.some(f => f.id === this.moveFighterId)) this.moveFighterId = fighters[0]?.id;
    this.fighterTabs.replaceChildren(...fighters.map(fighter => {
      const b = make('button', '', fighter.label); b.type = 'button'; b.setAttribute('aria-pressed', String(fighter.id === this.moveFighterId));
      b.onclick = () => { this.moveFighterId = fighter.id; this.showMoves(); }; return b;
    }));
    fillBindingLegend(this.moveMapping, this.product.options.bindings);
    this.activeMoveTab?.click();
    if (!this.moves.open) this.moves.showModal();
  }
  showOptions() { this.product.showOptions(); }
  showProfile() { this.product.showProfile(); }
  toggleDebug() { if (this.debug.open) this.debug.close(); else { this.onDebugOpen(); this.refreshCpu(); this.refreshPose(); this.debug.showModal(); } }
  updateStats(text) { if (this.debug.open) this.stats.textContent = text; }
}
