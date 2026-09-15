// One selection drives pointer, keyboard and gamepad presentation alike.
export function installTitleMenu() {
  const root = document.querySelector('#screen-title');
  const nav = root.querySelector('#title-actions');
  const buttons = [...nav.querySelectorAll('button')];
  const description = root.querySelector('#menu-description');
  const descriptions = {
    Play: 'Choose your fighter. Settle it in the arena.',
    Practice: 'Learn the moves. Find your edge.',
    Demo: 'Watch a live exhibition and signature moves.',
    Options: 'Tune your sound, display and controls.',
    Profile: 'Your record, achievements and discovered finishers.',
  };
  let selected = buttons[0];
  const select = button => {
    selected = button;
    for (const item of buttons) item.classList.toggle('is-selected', item === button);
    description.textContent = descriptions[button.textContent.trim()] || '';
  };
  buttons.forEach((button, index) => {
    const label = button.textContent.trim();
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-description', descriptions[label] || '');
    button.dataset.index = String(index + 1).padStart(2, '0');
    button.addEventListener('focus', () => select(button));
    button.addEventListener('pointerenter', event => {
      if (event.pointerType === 'mouse') button.focus({ preventScroll: true });
    });
  });
  select(selected);
  if (matchMedia('(pointer: coarse)').matches) root.dataset.input = 'touch';
  root.addEventListener('pointerdown', event => {
    root.dataset.input = event.pointerType === 'touch' ? 'touch' : 'keyboard';
  });
  root.addEventListener('keydown', () => { root.dataset.input = 'keyboard'; });
  // Handle the first key even when DOM focus is still on the page body.
  addEventListener('keydown', event => {
    if (!root.classList.contains('active') || document.querySelector('dialog[open]')) return;
    root.dataset.input = 'keyboard';
    const direction = { ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right' }[event.code];
    if (direction) {
      const current = buttons.includes(document.activeElement) ? document.activeElement : selected;
      const rect = current.getBoundingClientRect();
      const vertical = direction === 'up' || direction === 'down';
      const sign = direction === 'up' || direction === 'left' ? -1 : 1;
      const candidates = buttons.filter(button => button !== current).map(button => {
        const next = button.getBoundingClientRect();
        const dx = next.x + next.width / 2 - rect.x - rect.width / 2;
        const dy = next.y + next.height / 2 - rect.y - rect.height / 2;
        return { button, along: (vertical ? dy : dx) * sign, across: Math.abs(vertical ? dx : dy) };
      }).filter(candidate => candidate.along > 4).sort((a, b) => a.along + a.across * 2 - b.along - b.across * 2);
      const next = candidates[0]?.button || buttons[(buttons.indexOf(current) + sign + buttons.length) % buttons.length];
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      event.preventDefault();
    } else if (event.code === 'Home' || event.code === 'End') {
      buttons[event.code === 'Home' ? 0 : buttons.length - 1].focus({ preventScroll: true });
      event.preventDefault();
    } else if ((event.code === 'Enter' || event.code === 'Space') && !root.contains(document.activeElement)) {
      event.preventDefault();
      if (!event.repeat) selected.click();
    }
  });
}
