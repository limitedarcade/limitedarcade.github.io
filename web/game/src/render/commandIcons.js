import { ACTION, DIR, keyCapText, notationTokens, tokensFromActions } from './commandNotation.js';
import './commandIcons.css';

export { keyCapText, notationTokens, tokensFromActions };

const node = (tag, className, text) => {
  const el = document.createElement(tag);
  el.className = className || '';
  if (text !== undefined) el.textContent = text;
  return el;
};

export function glyph(type, value) {
  if (type === 'action') {
    const meta = ACTION[value] || { label: String(value).toUpperCase(), tone: 'lp' };
    const el = node('span', `cmd-btn cmd-${meta.tone}`, meta.label);
    el.setAttribute('aria-label', meta.label === 'BLK' ? 'Block' : meta.label);
    return el;
  }
  if (type === 'key') {
    const el = node('kbd', 'cmd-key', keyCapText(value));
    if (/^Numpad/.test(value || '')) el.classList.add('cmd-key-num');
    if (value === 'Space') el.classList.add('cmd-key-wide');
    el.setAttribute('aria-label', keyCapText(value));
    return el;
  }
  if (type === 'pad') {
    const meta = ACTION[value] || { pad: value, padName: String(value).toUpperCase() };
    const el = node('span', `cmd-pad cmd-pad-${meta.pad}`, meta.padName);
    el.setAttribute('aria-label', `Pad ${meta.padName}`);
    return el;
  }
  if (type === 'dir') {
    const el = node('span', 'cmd-dir', DIR[value] || value);
    el.setAttribute('aria-label', String(value));
    return el;
  }
  if (type === 'join') return node('span', 'cmd-join', value === 'then' ? 'then' : value);
  return node('span', 'cmd-text', value);
}

export function renderTokens(host, tokens) {
  host.replaceChildren(...tokens.map(([type, value]) => glyph(type, value)));
  return host;
}

export function commandLine(tokens, label) {
  const row = node('div', 'cmd-line');
  if (label) row.append(node('span', 'cmd-line-label', label));
  const strip = node('span', 'cmd-strip');
  renderTokens(strip, tokens);
  row.append(strip);
  return row;
}

export function fillBindingLegend(host, bindings) {
  host.className = 'input-legend cmd-legend';
  host.replaceChildren();
  for (const [side, title] of [[0, 'P1'], [1, 'P2']]) {
    const row = node('div', `cmd-legend-row cmd-legend-${side}`);
    row.append(node('span', 'cmd-legend-side', title));
    for (const id of ['lp', 'hp', 'lk', 'hk', 'block']) {
      const pair = node('span', 'cmd-pair');
      pair.append(glyph('action', id), glyph('key', bindings[side][id]));
      row.append(pair);
    }
    host.append(row);
  }
  const pad = node('div', 'cmd-legend-row cmd-legend-pad');
  pad.append(node('span', 'cmd-legend-side', 'PAD'));
  for (const id of ['lp', 'hp', 'lk', 'hk', 'block']) {
    const pair = node('span', 'cmd-pair');
    pair.append(glyph('action', id), glyph('pad', id));
    pad.append(pair);
  }
  host.append(pad);
  const note = node('p', 'cmd-legend-note');
  note.append(glyph('dir', 'forward'), node('span', '', 'forward'), glyph('dir', 'back'), node('span', '', 'back · relative to your opponent'));
  host.append(note);
}

export function fillAxePromptCommands(arcadeHost, keysHost, { bindings, side } = {}) {
  renderTokens(arcadeHost, tokensFromActions(['down', 'lp', 'hp']));
  if (!keysHost) return;
  if (bindings?.[side]) {
    keysHost.hidden = false;
    keysHost.replaceChildren(
      glyph('key', bindings[side].down),
      glyph('join', '+'),
      glyph('key', bindings[side].lp),
      glyph('join', '+'),
      glyph('key', bindings[side].hp),
    );
  } else {
    keysHost.hidden = true;
    keysHost.replaceChildren();
  }
}

// The one-line arcade notation used in the move list, where a full keyboard and
// pad pair per row would drown the names it sits beside.
export function fillCompactCommand(host, { keys = [], steps, join = '+' }) {
  const tokens = [];
  for (const [s, seq] of (steps || [keys]).entries()) {
    if (s) tokens.push(['join', 'then']);
    for (const [i, id] of seq.entries()) {
      if (i) tokens.push(['join', join]);
      const key = String(id).toLowerCase();
      tokens.push(DIR[key] !== undefined ? ['dir', key] : ACTION[key] ? ['action', key] : ['text', id]);
    }
  }
  host.className = 'cmd-strip cmd-mini';
  return renderTokens(host, tokens);
}

export function fillPracticeCommands(host, { keys = [], steps, bindings, join = '+' }) {
  const sequences = steps || [keys];
  const keyboard = [];
  const pad = [];
  for (const [s, seq] of sequences.entries()) {
    if (s) { keyboard.push(['join', 'then']); pad.push(['join', 'then']); }
    for (const [i, id] of seq.entries()) {
      if (i) { keyboard.push(['join', join]); pad.push(['join', join]); }
      const key = String(id).toLowerCase();
      if (DIR[key] !== undefined) {
        keyboard.push(['dir', key]);
        pad.push(['dir', key]);
      } else if (ACTION[key]) {
        keyboard.push(['key', bindings?.[0]?.[key] || key]);
        pad.push(['pad', key]);
      } else {
        keyboard.push(['text', id]);
        pad.push(['text', id]);
      }
    }
  }
  host.className = 'practice-keys cmd-practice';
  host.replaceChildren(commandLine(keyboard, 'Keyboard'), commandLine(pad, 'Pad'));
}
