// Impact effects: sparks, blood, slash arcs, shockwaves and speed lines.
//
// Impact particles are pooled sprites. Pooling is not premature here -- a heavy
// exchange spawns ~180 sprites inside two frames, and allocating those live is
// the difference between a clean hit and a visible stutter on a phone.
//
// Blood droplets are simulated with gravity and hand off to the stage's decal
// canvas when they land, so the ice keeps a record of the round.

import * as THREE from '../vendor/three.module.js';
import { createVfxTextures } from './vfxTextures.js';
import { impactProfile } from './impact.js';
import { ModelVfx } from './modelVfx.js';
import { CombatVfx } from './combatVfx.js';

const BLOOD_BRIGHT = new THREE.Color(0x9e1825);
const BLOOD_DARK = new THREE.Color(0x510c19);
const SPARK_HOT = new THREE.Color(0xfff2c4);
const SPARK_WARM = new THREE.Color(0xff9a2e);

export class SpritePool {
  constructor(scene, texture, { blending = THREE.NormalBlending, capacity = 220 } = {}) {
    this.scene = scene;
    this.free = [];
    this.live = new Set();
    this.capacity = capacity;
    this.material = new THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false,
      blending, toneMapped: false,
    });
  }

  acquire() {
    let sprite = this.free.pop();
    if (!sprite) {
      if (this.live.size >= this.capacity) return null;
      sprite = new THREE.Sprite(this.material.clone());
      this.scene.add(sprite);
    }
    this.live.add(sprite);
    sprite.visible = true;
    return sprite;
  }

  release(sprite) {
    if (!this.live.delete(sprite)) return;
    sprite.visible = false;
    this.free.push(sprite);
  }
}

export class Vfx {
  constructor(scene, { stage, reducedMotion = false, quality = 1 } = {}) {
    this.scene = scene;
    this.stage = stage;
    this.reducedMotion = reducedMotion;
    this.quality = quality;
    this.models = new ModelVfx(scene, { reducedMotion, quality });
    this.authored = new CombatVfx(this.models);
    this.ready = this.models.preload(['fireball', 'shield', 'appearance', 'burst']);
    this.textures = createVfxTextures();
    this.pools = {
      blunt: new SpritePool(scene, this.textures.blunt, { blending: THREE.AdditiveBlending, capacity: 24 }),
      block: new SpritePool(scene, this.textures.block, { blending: THREE.AdditiveBlending, capacity: 24 }),
      counter: new SpritePool(scene, this.textures.counter, { blending: THREE.AdditiveBlending, capacity: 24 }),
      spark: new SpritePool(scene, this.textures.spark, { blending: THREE.AdditiveBlending, capacity: 160 }),
      blood: new SpritePool(scene, this.textures.blob, { capacity: 320 }),
      mist: new SpritePool(scene, this.textures.mist, { capacity: 20 }),
      slash: new SpritePool(scene, this.textures.slash, { blending: THREE.AdditiveBlending, capacity: 24 }),
      ring: new SpritePool(scene, this.textures.ring, { blending: THREE.AdditiveBlending, capacity: 24 }),
      lines: new SpritePool(scene, this.textures.lines, { blending: THREE.AdditiveBlending, capacity: 12 }),
    };
    this.particles = [];
    this.flashes = [];
  }

  scaled(count) {
    return Math.max(1, Math.round(count * this.quality));
  }

  // A one-shot billboard that scales and fades along a curve.
  flash(poolName, { x, y, z = 0.35, from, to, life, color, opacity = 1, rotation = 0, spin = 0 }) {
    const pool = this.pools[poolName];
    const sprite = pool.acquire();
    if (!sprite) return;
    sprite.position.set(x, y, z);
    sprite.material.color.copy(color);
    sprite.material.rotation = rotation;
    sprite.material.opacity = opacity;
    sprite.scale.setScalar(from);
    this.flashes.push({ pool, sprite, t: 0, life, from, to, opacity, spin });
  }

  particle({ x, y, z = 0, vx, vy, vz = 0, size, life, color, gravity, kind, fade = 1, drag = 0 }) {
    const pool = this.pools[kind === 'blood' ? 'blood' : 'spark'];
    const sprite = pool.acquire();
    if (!sprite) return;
    sprite.position.set(x, y, z);
    sprite.material.color.copy(color);
    sprite.material.opacity = 1;
    sprite.scale.setScalar(size);
    this.particles.push({ pool, sprite, vx, vy, vz, life, maxLife: life, gravity, kind, size, fade, drag });
  }

  // ---- event handlers ---------------------------------------------------

  onHit(event, profile = impactProfile(event)) {
    const { x, y, facing } = event;
    const { power, heavy, type } = profile;
    const authored = this.authored.onHit(event);
    const flashPower = (event.finisherId ? Math.min(power, 0.85) : power) * (authored ? 0.72 : 1);
    const dir = facing >= 0 ? 1 : -1;

    const gold = new THREE.Color(0xffc63d);
    const color = type === 'counter' || type === 'ko' ? gold : type === 'slash' ? new THREE.Color(0xd9efff) : SPARK_HOT;
    this.flash(type === 'ko' ? 'counter' : type, {
      x, y, from: (type === 'slash' ? 0.85 : 0.5) * flashPower, to: 1.7 * flashPower, life: heavy ? 0.24 : 0.16,
      color, rotation: type === 'slash' ? -dir * 0.65 : 0, spin: type === 'slash' ? dir * 2 : 0,
    });
    if (type === 'counter' || type === 'ko') {
      this.flash('ring', { x, y, from: 0.7, to: 2.7 * flashPower, life: 0.3, color: gold, opacity: 0.65 });
    }
    if (heavy && !this.reducedMotion) this.flash('lines', {
      x, y, z: -0.6, from: 2, to: 4.5 * flashPower, life: 0.2, color, opacity: event.finisherId ? 0.12 : 0.3,
    });

    for (let i = 0; i < this.scaled(6 + power * 10); i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.4 + Math.random() * 6.5 * power;
      this.particle({
        x, y, z: (Math.random() - 0.5) * 0.35,
        vx: Math.cos(angle) * speed * 0.55 + dir * 2.2 * power,
        vy: Math.sin(angle) * speed * 0.7 + 1.4,
        vz: (Math.random() - 0.5) * 2.2,
        size: 0.06 + Math.random() * 0.11,
        life: 0.18 + Math.random() * 0.22,
        color: Math.random() < 0.5 ? SPARK_HOT : SPARK_WARM,
        gravity: 9, kind: 'spark',
      });
    }

    this.spray(x, y, dir, power);
  }

  // The blood arc. Droplets are launched forward along the hit direction with a
  // wide cone, and each one stains the ice where it lands.
  spray(x, y, dir, power, multiplier = 1) {
    if (power <= 0) return;
    const count = this.scaled((12 + power * 23) * multiplier);
    if (!this.reducedMotion) this.flash('mist', {
      x: x + dir * 0.12, y, z: 0.08, from: 0.12, to: 0.35 + power * 0.18,
      life: 0.18 + power * 0.025, color: BLOOD_DARK, opacity: 0.28,
      rotation: dir * 0.35,
    });
    for (let i = 0; i < count; i += 1) {
      const spread = (Math.random() - 0.5) * 1.1;
      const speed = (1.4 + Math.random() * 4.6) * (0.65 + power * 0.3);
      const big = Math.random() < 0.12;
      this.particle({
        x: x + dir * 0.04, y: y + (Math.random() - 0.5) * 0.08,
        z: (Math.random() - 0.5) * 0.14,
        vx: dir * speed * (0.55 + Math.random() * 0.6),
        vy: speed * (0.1 + Math.random() * 0.55) + spread,
        vz: (Math.random() - 0.5) * 1.5,
        size: (big ? 0.032 : 0.009) + Math.random() * 0.017,
        life: 1.1 + Math.random() * 0.6,
        color: Math.random() < 0.7 ? BLOOD_BRIGHT : BLOOD_DARK,
        gravity: 15.5, kind: 'blood', drag: 0.4,
      });
    }
  }

  onBlock(event) {
    const { x, y, facing } = event;
    const dir = facing >= 0 ? 1 : -1;
    this.flash('block', {
      x, y, from: 0.65, to: 1.15, life: 0.15,
      color: new THREE.Color(0xcfffe4), rotation: 0,
    });
    this.flash('block', { x, y, from: 0.45, to: 0.9, life: 0.1, color: new THREE.Color(0xffffff), opacity: 0.9 });
    for (let i = 0; i < this.scaled(10); i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      this.particle({
        x, y, z: (Math.random() - 0.5) * 0.3,
        vx: Math.cos(angle) * speed * 0.5 + dir * 1.4,
        vy: Math.sin(angle) * speed * 0.6 + 1,
        vz: (Math.random() - 0.5) * 1.6,
        size: 0.045 + Math.random() * 0.06,
        life: 0.16 + Math.random() * 0.16,
        color: new THREE.Color(0x8fffc0), gravity: 8, kind: 'spark',
      });
    }
  }

  confetti(event) {
    const colors = [0xffc63d, 0x80dbff, 0xff6386, 0xc4ffe4].map(c => new THREE.Color(c));
    for (let i = 0; i < this.scaled(110); i++) this.particle({
      x: event.x, y: event.y + 0.4, z: 0.4, vx: (Math.random() - 0.5) * 7,
      vy: 2 + Math.random() * 5, vz: (Math.random() - 0.5) * 3,
      size: 0.055 + Math.random() * 0.065, life: 1.4 + Math.random(),
      color: colors[i % colors.length], gravity: 3, kind: 'spark', drag: 0.8,
    });
  }

  // The finisher: a much larger version of the same vocabulary, staged over
  // three beats so the camera has something to hold on.
  onFinisher(event) {
    const { x, y, facing } = event;
    const dir = facing >= 0 ? 1 : -1;
    if (event.finisherId === 'carney-cold-cut') {
      // The camera is already at the contact: keep its silhouette readable.
      this.flash('lines', { x, y, z: -0.8, from: 1, to: 3, life: 0.2, color: SPARK_HOT, opacity: 0.14 });
      this.flash('spark', { x, y, from: 0.15, to: 0.9, life: 0.14, color: SPARK_WARM, opacity: 0.65 });
      this.flash('ring', { x, y, from: 0.2, to: 1.6, life: 0.24, color: SPARK_WARM, opacity: 0.3 });
      this.spray(x, y, dir, 2, 1.1);
      this.spray(x, y + 0.3, -dir, 1.5, 0.6);
      return;
    }
    this.flash('lines', { x, y, z: -0.8, from: 2, to: 8, life: 0.5, color: SPARK_HOT, opacity: 0.65 });
    this.flash('spark', { x, y, from: 0.5, to: 4.5, life: 0.4, color: SPARK_HOT, spin: 2 });
    this.flash('ring', { x, y, from: 0.4, to: 7, life: 0.6, color: new THREE.Color(0xff5a3c), opacity: 0.9 });
    this.spray(x, y, dir, 4, 2.6);
    this.spray(x, y + 0.3, -dir, 3, 1.4);
  }

  sync(snapshot) {
    this.models.quality = this.quality;
    this.models.reducedMotion = this.reducedMotion;
    this.authored.sync(snapshot);
  }

  onSummon(strike) { return this.authored.onSummon(strike); }

  update(dt) {
    this.models.quality = this.quality;
    this.models.reducedMotion = this.reducedMotion;
    this.models.update(dt);
    for (let i = this.flashes.length - 1; i >= 0; i -= 1) {
      const f = this.flashes[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.life);
      const eased = 1 - Math.pow(1 - k, 2.2);
      f.sprite.scale.setScalar(f.from + (f.to - f.from) * eased);
      f.sprite.material.opacity = f.opacity * (1 - k) ** 1.4;
      f.sprite.material.rotation += f.spin * dt;
      if (k >= 1) { f.pool.release(f.sprite); this.flashes.splice(i, 1); }
    }

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= dt;
      p.vy -= p.gravity * dt;
      if (p.drag) {
        const k = 1 - p.drag * dt;
        p.vx *= k; p.vz *= k;
      }
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      const k = Math.max(0, p.life / p.maxLife);
      if (p.kind === 'blood') {
        const stretch = Math.min(2.8, 1 + Math.hypot(p.vx, p.vy) * 0.12);
        p.sprite.scale.set(p.size * stretch, p.size * 0.8, 1);
        p.sprite.material.rotation = Math.atan2(p.vy, p.vx);
      }
      p.sprite.material.opacity = p.kind === 'blood' ? Math.min(1, k * 2.4) : k;

      // Blood that reaches the ice stops being a particle and becomes a stain.
      if (p.kind === 'blood' && p.sprite.position.y <= 0.02) {
        this.stage?.splatBlood(p.sprite.position.x, p.sprite.position.z, 0.04 + p.size * 1.3, p.size > 0.032 ? 3 : 1);
        p.life = 0;
      }
      if (p.life <= 0) { p.pool.release(p.sprite); this.particles.splice(i, 1); }
    }
  }

  clear() {
    this.authored.clear();
    this.models.clear();
    for (const f of this.flashes) f.pool.release(f.sprite);
    for (const p of this.particles) p.pool.release(p.sprite);
    this.flashes.length = 0;
    this.particles.length = 0;
  }
}
