// Color bible: web/COLOR_BIBLE.md. CSS receives the same semantic tokens.
export const PALETTE = Object.freeze({
  ink: '#080c18', panel: '#111a2a', paper: '#eef3ff', muted: '#b1bed0',
  gold: '#ffc63d', goldLight: '#ffe9a1', goldDeep: '#e8871a',
  red: '#d81f2a', redDeep: '#7c0d14', blue: '#2f6bff', cyan: '#80dbff',
});
export function installPalette() {
  for (const [key, value] of Object.entries(PALETTE))
    document.documentElement.style.setProperty(`--${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`, value);
}
