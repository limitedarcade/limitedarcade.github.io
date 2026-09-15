// Impact sprites, drawn into canvases at boot instead of shipped as PNGs.
//
// Nothing here is fetched, so the effects carry no licence and no load, and the
// look is tunable from one file. Every texture is authored white-on-transparent
// and tinted per use, so one spark sheet serves sparks, blood mist and the
// finisher flash without a second upload.

import * as THREE from '../vendor/three.module.js';

function canvas(size) {
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  return el;
}

function toTexture(el) {
  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// A hard-cored radial burst with irregular spikes -- the anime hit-spark shape
// the references use, rather than a soft glow.
function drawSpark(size = 256, spikes = 13) {
  const el = canvas(size);
  const ctx = el.getContext('2d');
  const c = size / 2;
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c * 0.55);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.35, 'rgba(255,244,214,0.85)');
  glow.addColorStop(1, 'rgba(255,180,60,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i += 1) {
    const angle = (i / (spikes * 2)) * Math.PI * 2;
    const long = i % 2 === 0;
    const r = long ? c * (0.72 + Math.sin(i * 3.7) * 0.24) : c * 0.19;
    const x = c + Math.cos(angle) * r;
    const y = c + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  return toTexture(el);
}

// One soft droplet. Blood is drawn as many of these, not as one big blob,
// because a spray reads as a spray only if the edge is made of separate drops.
function drawBlob(size = 128) {
  const el = canvas(size);
  const ctx = el.getContext('2d');
  const c = size / 2;
  const g = ctx.createRadialGradient(c * 0.75, c * 0.65, c * 0.04, c, c, c * 0.92);
  g.addColorStop(0, 'rgba(255,225,219,1)');
  g.addColorStop(0.18, 'rgba(235,170,167,1)');
  g.addColorStop(0.42, 'rgba(158,95,99,1)');
  g.addColorStop(0.79, 'rgba(92,49,57,0.96)');
  g.addColorStop(0.92, 'rgba(72,35,43,0.65)');
  g.addColorStop(1, 'rgba(72,35,43,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(el);
}

// Low-opacity aerosol behind the ballistic droplets, never an additive red glow.
function drawMist(size = 128) {
  const el = canvas(size), ctx = el.getContext('2d');
  for (let i = 0; i < 28; i++) {
    const angle = i * 2.39996, radius = Math.sqrt((i + 0.5) / 28) * size * 0.31;
    const x = size * 0.5 + Math.cos(angle) * radius, y = size * 0.5 + Math.sin(angle) * radius;
    const r = size * (0.08 + (i % 5) * 0.015);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return toTexture(el);
}

// The tapered crescent that trails a heavy swing.
function drawSlash(size = 512) {
  const el = canvas(size);
  const ctx = el.getContext('2d');
  ctx.translate(size / 2, size / 2);
  for (let pass = 0; pass < 3; pass += 1) {
    const width = size * (0.055 - pass * 0.014);
    const alpha = pass === 2 ? 1 : 0.5 - pass * 0.16;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.33, -Math.PI * 0.42, Math.PI * 0.42);
    ctx.stroke();
  }
  return toTexture(el);
}

function drawRing(size = 256) {
  const el = canvas(size);
  const ctx = el.getContext('2d');
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, c * 0.62, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(el);
}

// Radial speed lines: the comic-panel emphasis behind a big connect.
function drawSpeedLines(size = 512) {
  const el = canvas(size);
  const ctx = el.getContext('2d');
  const c = size / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineCap = 'butt';
  for (let i = 0; i < 64; i += 1) {
    const angle = (i / 64) * Math.PI * 2 + Math.sin(i) * 0.05;
    const inner = c * (0.30 + (i % 5) * 0.045);
    const outer = c * (0.86 + (i % 3) * 0.05);
    ctx.lineWidth = 1.4 + (i % 4) * 1.9;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(angle) * inner, c + Math.sin(angle) * inner);
    ctx.lineTo(c + Math.cos(angle) * outer, c + Math.sin(angle) * outer);
    ctx.stroke();
  }
  // Punch a soft hole in the middle so the fighters stay readable through it.
  const hole = ctx.createRadialGradient(c, c, 0, c, c, c * 0.42);
  hole.addColorStop(0, 'rgba(0,0,0,1)');
  hole.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = hole;
  ctx.fillRect(0, 0, size, size);
  return toTexture(el);
}

function drawImpactShape(type) {
  const el = canvas(256), ctx = el.getContext('2d');
  ctx.translate(128, 128);
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
  if (type === 'block') {
    ctx.lineWidth = 7;
    for (const radius of [62, 88]) {
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const angle = i * Math.PI / 3;
        if (!i) ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        else ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      ctx.stroke();
    }
  } else if (type === 'counter') {
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2); ctx.beginPath();
      ctx.moveTo(0, -118); ctx.lineTo(12, -20); ctx.lineTo(0, 10); ctx.lineTo(-12, -20); ctx.closePath(); ctx.fill();
    }
    ctx.lineWidth = 4; ctx.strokeRect(-34, -34, 68, 68);
  } else {
    for (let i = 0; i < 9; i++) {
      ctx.rotate(Math.PI * 2 / 9); ctx.beginPath();
      ctx.moveTo(-8, -24); ctx.lineTo(-5, -95 - i % 3 * 10); ctx.lineTo(8, -108); ctx.lineTo(13, -35); ctx.closePath(); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
  }
  return toTexture(el);
}

export function createVfxTextures() {
  return {
    spark: drawSpark(),
    blunt: drawImpactShape('blunt'),
    block: drawImpactShape('block'),
    counter: drawImpactShape('counter'),
    blob: drawBlob(),
    mist: drawMist(),
    slash: drawSlash(),
    ring: drawRing(),
    lines: drawSpeedLines(),
  };
}
