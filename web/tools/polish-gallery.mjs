// Assemble the saved screenshots into a local, reproducible review.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve('artifacts/polish-2026-10-07');
const report = JSON.parse(readFileSync(resolve(root, 'after/report.json'), 'utf8'));
const escape = value => String(value).replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sheets = [];
for (const id of ['trump', 'carney', 'officer_flock', 'lang']) {
  const samples = report.samples.filter(s => s.fighters.some(f => f.id === id && f.move));
  const width = 480, height = 292, cells = [];
  for (const [index, sample] of samples.entries()) {
    const left = index % 2 * width, top = Math.floor(index / 2) * height;
    cells.push({ input: await sharp(resolve(root, 'after', sample.file)).resize(width, 270).png().toBuffer(), left, top });
    const fighter = sample.fighters.find(f => f.id === id);
    const label = escape(`${id} · ${fighter.move}${sample.state.mirror ? ' · reversed' : ''}`);
    cells.push({ input: Buffer.from(`<svg width="${width}" height="22"><rect width="100%" height="100%" fill="#171b25"/><text x="10" y="16" font-family="Arial" font-size="14" fill="white">${label}</text></svg>`), left, top: top + 270 });
  }
  const file = `review-${id}.png`;
  await sharp({ create: { width: width * 2, height: height * Math.ceil(samples.length / 2), channels: 4, background: '#171b25' } }).composite(cells).png().toFile(resolve(root, file));
  sheets.push(file);
}
const samples = report.samples.map(s => ({ file: s.file, before: existsSync(resolve(root, 'before', s.file)), name: s.file.replace(/\.png$/, '').replaceAll('-', ' ') }));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Combat polish review · October 7</title>
<style>body{margin:0;background:#0e1118;color:#f5f6fb;font:16px system-ui}main{max-width:1280px;margin:auto;padding:24px}h1{font-size:28px;margin:0 0 10px}p{color:#b7bdcd;line-height:1.6}a{color:#ffd15a}label{display:block;margin:16px 0 8px}select{padding:10px;max-width:100%;background:#202635;color:white;border:1px solid #566078;border-radius:6px}input{width:100%}.stage{position:relative;display:grid;overflow:hidden;background:#000;max-height:85vh}.stage img{display:block;grid-area:1/1;width:100%;height:100%;object-fit:contain;max-height:85vh}.stage #after{clip-path:inset(0 0 0 50%)}.tag{position:absolute;top:12px;padding:5px 10px;background:#000b;border-radius:5px;pointer-events:none}.before{left:12px}.after{right:12px}.sheet{width:100%;height:auto;margin:16px 0}button{padding:10px 14px;border:1px solid #566078;background:#202635;color:white;border-radius:6px}summary{cursor:pointer;padding:12px 0}#note{min-height:1.5em}</style>
<main><h1>Combat polish review</h1><p>Closer combat framing, planted basic attacks, directional impact shake and faster repeat entrances. Saved review poses use the actual production renderer. Play the moving result in the <a href="http://127.0.0.1:5176/">local game</a>.</p>
<label for="sample">Scene or attack</label><select id="sample"></select><p id="note"></p><div class="stage"><img id="before" alt="Previous framing"><img id="after" alt="Polished framing"><span class="tag before">Before</span><span class="tag after">After</span></div><label for="wipe">Drag to compare</label><input id="wipe" type="range" min="0" max="100" value="50">
<p>First encounters retain the full entrance. Rematches and repeat rounds use a 96-frame opening, with locked input and a fresh timer. Reduced motion suppresses shake. Authored finisher camera cuts retain their exact positions.</p>
<details><summary>All four fighters · basic attacks in both directions</summary>${sheets.map(file => `<img class="sheet" loading="lazy" src="${file}" alt="${escape(file)}">`).join('')}</details>
<p>Build, focused checks and desktop/touch/reduced-motion browser flows passed. The full named test suite has the same three failures recorded before this work. Physical phone, controller, speaker and sustained performance acceptance remain separate.</p></main>
<script>const samples=${JSON.stringify(samples)},select=document.querySelector('#sample'),before=document.querySelector('#before'),after=document.querySelector('#after'),wipe=document.querySelector('#wipe');for(const [i,s]of samples.entries()){const o=document.createElement('option');o.value=i;o.textContent=s.name;select.append(o)}function show(){const s=samples[select.value];after.src='after/'+s.file;before.src=(s.before?'before/':'after/')+s.file;document.querySelector('#note').textContent=s.before?'Before and after saved poses. Animation phases may vary slightly between captures.':'After-only review: this reversed pose has no baseline capture.';document.querySelector('.before').hidden=!s.before;wipe.disabled=!s.before;after.style.clipPath=s.before?'inset(0 0 0 '+wipe.value+'%)':'none'}select.addEventListener('change',show);wipe.addEventListener('input',()=>after.style.clipPath='inset(0 0 0 '+wipe.value+'%)');show();</script></html>`;
writeFileSync(resolve(root, 'comparison.html'), html);
console.log(`Created comparison.html and ${sheets.length} attack contact sheets.`);
