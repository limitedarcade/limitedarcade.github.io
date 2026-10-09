import test from 'node:test';
import assert from 'node:assert/strict';
import { Vfx } from '../game/src/render/vfx.js';
import { Stage } from '../game/src/render/stage.js';
import { readFileSync } from 'node:fs';
import { FighterDamage } from '../game/src/render/fighterDamage.js';

// With the Gore option off, every path that puts blood on screen must stop at
// its door. Each `this` below throws if the method gets past its guard.
const trap = name => new Proxy({ showBlood: false }, {
  get: (target, key) => { if (key in target) return target[key]; throw new Error(`${name} drew blood via ${String(key)}`); },
});

test('gore off stops blood at every source: spray, ice stains, lens splatter, wound decals', () => {
  assert.doesNotThrow(() => Vfx.prototype.spray.call(trap('Vfx.spray'), 0, 1, 1, 3));
  assert.doesNotThrow(() => Stage.prototype.splatBlood.call(trap('Stage.splatBlood'), 0, 0, 1, 20));
  // hud.js imports CSS, which node can't load; check its guard in the source.
  const hud = readFileSync(new URL('../game/src/render/hud.js', import.meta.url), 'utf8');
  assert.match(hud, /splatterScreen\(nx, ny, power\) \{\s*if \(this\.showBlood === false\) return;/);
  assert.doesNotThrow(() => FighterDamage.prototype.onHit.call(trap('FighterDamage.onHit'), { type: 'hit', x: 0, y: 1.4 }, 2));
});

test('the main loop re-applies the blood setting to every rebuilt view and HUD', () => {
  const main = readFileSync(new URL('../game/src/main.js', import.meta.url), 'utf8');
  assert.match(main, /hud = new Hud\([^\n]*\n\s*applyBlood\(\);/, 'a new HUD gets the setting');
  assert.match(main, /function applyOptions[\s\S]*?applyBlood\(\);/, 'changing the option applies it');
});
