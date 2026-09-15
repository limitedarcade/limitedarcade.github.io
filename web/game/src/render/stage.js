// Stage lifecycle, lighting, persistent decals and impact debris.
// Lake America loads Blender scenery with runtime water, sky and flag animation.

import * as THREE from '../vendor/three.module.js';
import { stageById, stageImpactStrength } from './stageRegistry.js';
import { buildArena } from './arenaArchitecture.js';
import { buildLakeAmerica } from './lakeAmerica3d.js';
export { STAGES, stageById } from './stageRegistry.js';

const BACKDROP_WIDTH = 34;
const BACKDROP_ASPECT = 1370 / 784;
const BACKDROP_HEIGHT = BACKDROP_WIDTH / BACKDROP_ASPECT;
// Where the painted shoreline sits, as a fraction down from the top of the art.
const BACKDROP_SHORELINE = 0.548;
const BACKDROP_Z = -17;
// Put that shoreline on y = 0, which is where the 3D floor's far edge lands.
const BACKDROP_Y = (BACKDROP_SHORELINE - 0.5) * BACKDROP_HEIGHT;

// Crop of the boot-printed Constitution on the second sheet, in that sheet's
// own pixels. Measured from the art, not guessed.
const CONSTITUTION_RECT = [795, 378, 310, 384];
const MOON_RECT = [608, 41, 92, 92];
const WEEPING_TREE_RECT = [18, 247, 391, 345];
const GNARLED_TREE_RECT = [459, 252, 287, 264];

// Stage dressing is toggleable at runtime so a look can be rejected without
// editing this file or reverting anything. `?stage=-bloodMoon` in the URL puts
// the original grey moon back; `?stage=-deciduous` removes the new trees.
// Nothing gated here is load-bearing -- every flag off is the previous stage.
const STAGE_DEFAULTS = { bloodMoon: true, deciduous: true };

function readStageFlags() {
  const flags = { ...STAGE_DEFAULTS };
  let raw = '';
  try {
    raw = new URLSearchParams(window.location.search).get('stage')
      || window.localStorage.getItem('battlefi.stage') || '';
  } catch {
    raw = '';
  }
  for (const token of raw.split(',').map((t) => t.trim()).filter(Boolean)) {
    const disabled = token.startsWith('-');
    const key = disabled ? token.slice(1) : token;
    if (key in flags) flags[key] = !disabled;
  }
  return flags;
}

const FLAGS = readStageFlags();

// Impact light per hit profile: [colour, peak intensity]. Tuned against the
// announcer slam, which drives the same light at 200.
const FLASH = Object.freeze({
  blunt: [0xffb066, 95],
  slash: [0xffd489, 105],
  counter: [0xfff2d6, 170],
  block: [0x6fb4ff, 58],
  ko: [0xff4326, 300],
});

const ICE_FAR = BACKDROP_Z;
const ICE_NEAR = 13;
const DECAL_RES = 1024;
const DECAL_SPAN = 16;        // metres of x and z covered by the decal canvas
const BASE_URL = import.meta.env?.BASE_URL || '/';
const ATLAS_URL = `${BASE_URL}stages/lake_america_assets.jpg`;
// A second painted sheet. Kept separate rather than merged into the first so
// the original crop rectangles stay valid -- re-cutting a working atlas to make
// room for one prop is how a stage that already looks right stops looking right.
const PROPS_URL = `${BASE_URL}stages/lake_america_props.jpg`;

// The source sheet has a white matte rather than alpha. Turning only nearly
// neutral highlights transparent keeps the blue-white snow paint intact while
// removing the JPEG background and its antialiased fringe.
function makeAtlasCrop(image, [x, y, width, height], fade = [0, 0, 0, 0], radial = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);

  const pixels = ctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const low = Math.min(data[i], data[i + 1], data[i + 2]);
    const high = Math.max(data[i], data[i + 1], data[i + 2]);
    let alpha = 1;
    if (low >= 205 && high - low <= 30) {
      alpha = THREE.MathUtils.clamp((244 - low) / 39, 0, 1);
      if (alpha < 0.1) alpha = 0;
    }

    const px = (i / 4) % width;
    const py = Math.floor((i / 4) / width);
    const [left, top, right, bottom] = fade;
    if (left) alpha *= THREE.MathUtils.clamp(px / left, 0, 1);
    if (top) alpha *= THREE.MathUtils.clamp(py / top, 0, 1);
    if (right) alpha *= THREE.MathUtils.clamp((width - 1 - px) / right, 0, 1);
    if (bottom) alpha *= THREE.MathUtils.clamp((height - 1 - py) / bottom, 0, 1);
    // Round props whose matte is not clean white -- the moon sits in the
    // vortex strip's soft edge, so whiteness keying leaves a grey rectangle
    // around it. A radial cut is exact where a colour test cannot be.
    if (radial) {
      const nx = (px - (width - 1) / 2) / ((width - 1) / 2);
      const ny = (py - (height - 1) / 2) / ((height - 1) / 2);
      const r = Math.sqrt(nx * nx + ny * ny);
      alpha *= 1 - THREE.MathUtils.smoothstep(r, radial, Math.min(1, radial + 0.12));
    }
    data[i + 3] = Math.round(data[i + 3] * alpha);
  }
  ctx.putImageData(pixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function makeMistTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 32, 2, 128, 32, 128);
  gradient.addColorStop(0, 'rgba(204,226,255,0.72)');
  gradient.addColorStop(0.42, 'rgba(166,202,244,0.28)');
  gradient.addColorStop(1, 'rgba(130,174,225,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,245,185,1)');
  gradient.addColorStop(0.18, 'rgba(255,142,34,0.95)');
  gradient.addColorStop(0.55, 'rgba(255,54,14,0.36)');
  gradient.addColorStop(1, 'rgba(255,40,8,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A seamless cracked-ice tile. Each stroke is drawn nine times on a 3x3 offset
// grid so anything crossing an edge reappears on the opposite one -- the tile
// wraps without a seam, which a cropped photograph never does.
function makeIceTexture(size = 512, random = Math.random) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#5c7da8';
  ctx.fillRect(0, 0, size, size);

  // Cold mottling under the cracks so flat areas are not dead flat.
  for (let i = 0; i < 220; i += 1) {
    const r = 14 + random() * 90;
    ctx.save();
    ctx.translate(random() * size, random() * size);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, `rgba(${150 + random() * 70 | 0}, ${180 + random() * 60 | 0}, ${225 + random() * 30 | 0}, ${0.07 + random() * 0.16})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const wrapped = (draw) => {
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        ctx.save();
        ctx.translate(ox * size, oy * size);
        draw();
        ctx.restore();
      }
    }
  };

  // Long fractures, then short branches off them.
  for (let i = 0; i < 26; i += 1) {
    const x0 = random() * size;
    const y0 = random() * size;
    let angle = random() * Math.PI * 2;
    const segments = 5 + Math.floor(random() * 7);
    const points = [[x0, y0]];
    let x = x0;
    let y = y0;
    for (let s = 0; s < segments; s += 1) {
      angle += (random() - 0.5) * 0.9;
      const step = 18 + random() * 58;
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      points.push([x, y]);
    }
    const width = 0.7 + random() * 2.1;
    const alpha = 0.24 + random() * 0.5;
    wrapped(() => {
      ctx.strokeStyle = `rgba(226,240,255,${alpha})`;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (const [px, py] of points.slice(1)) ctx.lineTo(px, py);
      ctx.stroke();
      // A darker hairline beside the bright one gives the crack depth.
      ctx.strokeStyle = `rgba(44,66,98,${alpha * 0.6})`;
      ctx.lineWidth = width * 0.5;
      ctx.stroke();
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export class Stage {
  constructor(scene, { reducedMotion = false, id = 'lake-america' } = {}) {
    this.scene = scene;
    this.reducedMotion = reducedMotion;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.snow = null;
    this.decalCtx = null;
    this.decalTexture = null;
    this.stageTime = 0;
    this.animatedLayers = [];
    this.mist = [];
    this.fireGlows = [];
    this.interactives = [];
    this.debris = [];
    this.definition = stageById(id);
    this.id = this.definition.id;
    this.generation = 0;
    this.build();
  }

  setStage(id) {
    const definition = stageById(id);
    if (definition.id === this.id) return this.definition;
    this.clearScene();
    this.definition = definition;
    this.id = definition.id;
    this.build();
    return this.definition;
  }

  clearScene() {
    this.generation += 1;
    this.environment?.dispose?.();
    this.environment = null; this.ready = null;
    const geometries = new Set(), materials = new Set(), textures = new Set();
    this.group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) if (material) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
      object.shadow?.map?.dispose();
    });
    geometries.forEach(value => value.dispose());
    materials.forEach(value => value.dispose());
    textures.forEach(value => value.dispose());
    this.group.clear();
    this.snow = this.vortex = this.moon = this.skyline = this.backdrop = null;
    this.decalCtx = this.decalTexture = this.decalPlane = null;
    this.animatedLayers = []; this.mist = []; this.fireGlows = [];
    this.interactives = []; this.debris = []; this.stageTime = 0;
  }

  dispose() { this.clearScene(); this.scene.remove(this.group); }

  resetRound() {
    this.clearBlood();
    this.environment?.resetRound?.();
    this.flash = 0;
    for (const prop of this.interactives) {
      prop.strength = 0; prop.mesh.position.copy(prop.home); prop.mesh.rotation.z = 0;
      if (prop.kind === 'fountain') prop.mesh.scale.y = 1;
    }
    for (const shard of this.debris) { shard.life = 0; shard.mesh.visible = false; }
  }

  build() {
    const scene = this.scene;
    // The painting's own sky colour, so the frame above the art is continuous
    // with it instead of showing a black band on a tall viewport.
    const palette = this.definition.palette;
    scene.background = new THREE.Color(palette.sky);
    scene.fog = new THREE.Fog(palette.fog, 28, 54);

    this.group.add(new THREE.HemisphereLight(palette.fill, 0x16223f, 0.62));

    const key = new THREE.DirectionalLight(palette.key, 1.95);
    key.position.set(-5.5, 8.5, 6.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -2;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.022;
    this.group.add(key);
    this.key = key;

    const fill = new THREE.DirectionalLight(palette.fill, 0.82);
    fill.position.set(6, 4.5, -5);
    this.group.add(fill);

    const cityGlow = new THREE.PointLight(palette.fill, 14, 30, 2);
    cityGlow.position.set(0, 3.2, -11);
    this.group.add(cityGlow);

    // Lit by two sources that must not fight each other: the announcer slams
    // push a scene-wide pulse through `update`, while a landed blow flashes the
    // light at the contact point. The brighter of the two wins each frame, so a
    // punch during a slam does not dim the slam.
    this.impactLight = new THREE.PointLight(0xff3a2a, 0, 14, 2);
    this.impactLight.position.set(0, 1.4, 1.2);
    this.group.add(this.impactLight);
    this.flash = 0;
    this.flashColor = new THREE.Color(0xff3a2a);

    if (this.id !== 'lake-america') { buildArena(this, this.definition); return; }

    buildLakeAmerica(this);
    this.buildDecalSurface();
    this.buildDebris();
  }

  addAtlasPlane(image, rect, {
    x, bottom = 0, z, width, opacity = 1, floor = false,
    renderOrder = 0, name = 'stage-prop', fade = [0, 0, 0, 0], radial = 0,
  }) {
    const texture = makeAtlasCrop(image, rect, fade, radial);
    const height = width * rect[3] / rect[2];
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.025,
      depthWrite: false,
      opacity,
      toneMapped: false,
      fog: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    if (floor) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, bottom, z);
    } else {
      mesh.position.set(x, bottom + height / 2, z);
    }
    mesh.userData.home = mesh.position.clone();
    this.group.add(mesh);
    return mesh;
  }

  buildAtlasLayers(image) {
    // Far field: the vortex, moon and skyline barely move in frame.
    this.vortex = this.addAtlasPlane(image, [8, 12, 598, 216], {
      x: -4.4, bottom: 2.7, z: -16.88, width: 25.5, opacity: 0.94,
      renderOrder: 1, name: 'lake-america-vortex', fade: [24, 10, 56, 38],
    });
    if (!FLAGS.bloodMoon) {
      this.moon = this.addAtlasPlane(image, [610, 39, 91, 91], {
        x: 5.3, bottom: 5.2, z: -16.74, width: 1.95,
        renderOrder: 2, name: 'lake-america-moon',
      });
    }
    this.skyline = this.addAtlasPlane(image, [682, 0, 654, 239], {
      x: 1.0, bottom: -0.02, z: -16.55, width: 19.8,
      renderOrder: 3, name: 'lake-america-skyline',
    });

    // Mid and near field. Their different physical depths are what make the
    // camera pan and zoom produce genuine parallax.
    const leftForest = this.addAtlasPlane(image, [0, 238, 309, 368], {
      x: -11.6, bottom: -0.05, z: -8.8, width: 7.7,
      renderOrder: 4, name: 'lake-america-left-forest',
    });
    const rightForest = this.addAtlasPlane(image, [1051, 332, 319, 274], {
      x: 11.5, bottom: -0.06, z: -8.1, width: 7.5,
      renderOrder: 4, name: 'lake-america-right-forest',
    });
    this.addAtlasPlane(image, [1070, 235, 265, 159], {
      x: 9.0, bottom: 0.02, z: -7.2, width: 4.9,
      renderOrder: 5, name: 'lake-america-skull-cliff',
    });

    const leftTotem = this.addAtlasPlane(image, [357, 235, 194, 258], {
      x: -7.15, bottom: 0.02, z: -4.9, width: 2.25,
      renderOrder: 6, name: 'lake-america-left-totem',
    });
    const rightTotem = this.addAtlasPlane(image, [901, 235, 148, 260], {
      x: 7.1, bottom: 0.02, z: -4.65, width: 1.72,
      renderOrder: 6, name: 'lake-america-right-totem',
    });
    const frozenLeft = this.addAtlasPlane(image, [566, 257, 174, 221], {
      x: -3.85, bottom: 0.04, z: -5.7, width: 1.95, opacity: 0.92,
      renderOrder: 5, name: 'lake-america-frozen-wanderer',
    });
    const frozenRight = this.addAtlasPlane(image, [754, 276, 160, 194], {
      x: 3.95, bottom: 0.04, z: -5.4, width: 1.72, opacity: 0.9,
      renderOrder: 5, name: 'lake-america-bound-victim',
    });

    this.addAtlasPlane(image, [352, 503, 205, 105], {
      x: -5.25, bottom: 0.04, z: -2.8, width: 1.8,
      renderOrder: 7, name: 'lake-america-axe',
    });
    this.addAtlasPlane(image, [891, 516, 152, 98], {
      x: 5.45, bottom: 0.035, z: -3.1, width: 1.45,
      renderOrder: 7, name: 'lake-america-skulls',
    });

    const floorIce = [
      this.addAtlasPlane(image, [116, 603, 286, 91], {
        x: -5.4, bottom: 0.012, z: -4.0, width: 4.8, floor: true,
        renderOrder: 2, name: 'lake-america-ice-fragments-left',
      }),
      this.addAtlasPlane(image, [472, 598, 426, 111], {
        x: 5.0, bottom: 0.013, z: -4.5, width: 5.6, floor: true,
        renderOrder: 2, name: 'lake-america-ice-fragments-right',
      }),
      this.addAtlasPlane(image, [264, 628, 372, 151], {
        x: -1.2, bottom: 0.014, z: 2.9, width: 4.3, floor: true,
        renderOrder: 3, name: 'lake-america-blood-floe',
      }),
      this.addAtlasPlane(image, [642, 661, 191, 116], {
        x: 3.6, bottom: 0.015, z: 1.2, width: 2.1, floor: true,
        renderOrder: 3, name: 'lake-america-small-floe',
      }),
    ];

    this.animatedLayers.push(
      { mesh: leftForest, kind: 'sway', phase: 0.4, amount: 0.0028 },
      { mesh: rightForest, kind: 'sway', phase: 2.1, amount: 0.0032 },
      { mesh: leftTotem, kind: 'breathe', phase: 1.0, amount: 0.008 },
      { mesh: rightTotem, kind: 'breathe', phase: 3.4, amount: 0.008 },
      { mesh: frozenLeft, kind: 'frost', phase: 0.0, amount: 0.035 },
      { mesh: frozenRight, kind: 'frost', phase: 2.7, amount: 0.035 },
      ...floorIce.map((mesh, index) => ({
        mesh, kind: 'drift', phase: index * 1.7, amount: index < 2 ? 0.045 : 0.025,
      })),
    );

    this.buildAtmosphere();
  }

  // Second sheet. The Constitution is the stage's thesis statement, so it is
  // placed where the eye lands between exchanges -- left of the lane, in front
  // of the totem, near enough that the boot print reads at fighting distance --
  // rather than tucked into the far field where it would be a beige smudge.
  buildPropLayers(image) {
    if (FLAGS.bloodMoon) {
      // Larger than the grey moon it replaces: a blood moon that reads as a
      // detail rather than an event is not worth the swap.
      this.moon = this.addAtlasPlane(image, MOON_RECT, {
        x: 5.3, bottom: 5.05, z: -16.74, width: 2.4, radial: 0.85,
        renderOrder: 2, name: 'lake-america-blood-moon',
      });
    }

    if (FLAGS.deciduous) {
      // The existing forests are pine masses. These two break that silhouette
      // up, which is most of what stops a treeline reading as wallpaper. They
      // sit in the gaps between the pine mass and the totem on each side.
      // Pulled inside the pine mass's outer edge so it is on screen during
      // ordinary play, not only at a full left pan.
      const weeping = this.addAtlasPlane(image, WEEPING_TREE_RECT, {
        x: -8.6, bottom: -0.05, z: -7.0, width: 4.4,
        renderOrder: 4, name: 'lake-america-weeping-tree',
      });
      // Behind the right totem rather than beside it: at fighting depth this
      // tree crowded the totem and the bound figure into one unreadable mass.
      const gnarled = this.addAtlasPlane(image, GNARLED_TREE_RECT, {
        x: 5.9, bottom: -0.03, z: -8.2, width: 2.4,
        renderOrder: 3, name: 'lake-america-gnarled-tree',
      });
      this.animatedLayers.push(
        { mesh: weeping, kind: 'sway', phase: 1.3, amount: 0.0045 },
        { mesh: gnarled, kind: 'sway', phase: 3.9, amount: 0.0038 },
      );
    }

    const constitution = this.addAtlasPlane(image, CONSTITUTION_RECT, {
      x: -6.4, bottom: 0.02, z: -3.6, width: 1.55,
      renderOrder: 7, name: 'lake-america-constitution',
    });
    // A slight lean stops it reading as a poster hung in mid-air.
    constitution.rotation.z = 0.045;
    this.animatedLayers.push({
      mesh: constitution, kind: 'breathe', phase: 1.9, amount: 0.006,
    });
  }

  buildAtmosphere() {
    const mistTexture = makeMistTexture();
    for (let i = 0; i < 7; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: mistTexture,
        color: 0xb8d8ff,
        transparent: true,
        opacity: 0.055 + (i % 3) * 0.018,
        depthWrite: false,
        fog: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(-14 + i * 4.5, 0.22 + (i % 2) * 0.22, -2.5 - (i % 3) * 2.2);
      sprite.scale.set(5.5 + (i % 2) * 2.2, 0.8 + (i % 3) * 0.18, 1);
      sprite.userData.speed = 0.18 + (i % 3) * 0.055;
      sprite.userData.phase = i * 0.9;
      this.group.add(sprite);
      this.mist.push(sprite);
    }

    const glowTexture = makeGlowTexture();
    for (const [x, y, scale, phase] of [[-3.55, 0.43, 0.62, 0], [5.9, 0.54, 0.72, 2.3]]) {
      const material = new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xff7b22,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(x, y, -16.35);
      sprite.scale.setScalar(scale);
      sprite.userData.baseScale = scale;
      sprite.userData.phase = phase;
      sprite.renderOrder = 8;
      this.group.add(sprite);
      this.fireGlows.push(sprite);
    }
  }

  // Blood lands on its own transparent plane a few millimetres above the ice.
  // Painting into a canvas rather than spawning decal meshes keeps the cost of
  // a hundred splats identical to the cost of one.
  buildDecalSurface() {
    const canvas = document.createElement('canvas');
    canvas.width = DECAL_RES;
    canvas.height = DECAL_RES;
    this.decalCtx = canvas.getContext('2d');
    this.decalCtx.clearRect(0, 0, DECAL_RES, DECAL_RES);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.decalTexture = texture;

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(DECAL_SPAN, DECAL_SPAN),
      new THREE.MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false,
        opacity: 0.88, toneMapped: false,
      }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, 0.007, 0);
    plane.renderOrder = 2;
    this.group.add(plane);
    this.decalPlane = plane;
  }

  decalPixel(x, z) {
    return [
      ((x + DECAL_SPAN / 2) / DECAL_SPAN) * DECAL_RES,
      ((z + DECAL_SPAN / 2) / DECAL_SPAN) * DECAL_RES,
    ];
  }

  // `radius` is metres of scatter, `amount` the number of drops. Drops are
  // small and irregular on purpose: a round of fighting should read as spatter
  // building up, not as one puddle being repainted wider.
  splatBlood(x, z, radius, amount, random = Math.random) {
    const ctx = this.decalCtx;
    if (!ctx) return;
    const [px, pz] = this.decalPixel(x, z);
    const scale = DECAL_RES / DECAL_SPAN;
    for (let i = 0; i < amount; i += 1) {
      const angle = random() * Math.PI * 2;
      const spread = Math.pow(random(), 0.55) * radius * scale;
      const r = this.id === 'lake-america'
        ? Math.max(.009, Math.min(.105, (.012 + Math.pow(random(), 2) * .14) * Math.max(.2, radius))) * scale
        : (0.28 + random() * 0.9) * Math.max(0.05, radius) * scale * 0.34;
      const cx = px + Math.cos(angle) * spread, cy = pz + Math.sin(angle) * spread;
      const pigment = ctx.createRadialGradient(cx - r * 0.18, cy - r * 0.14, 0, cx, cy, r);
      pigment.addColorStop(0, 'rgba(48,4,12,0.88)');
      pigment.addColorStop(0.65, 'rgba(85,8,20,0.82)');
      pigment.addColorStop(0.88, 'rgba(108,14,26,0.66)');
      pigment.addColorStop(1, 'rgba(90,12,24,0.06)');
      ctx.fillStyle = pigment;
      ctx.beginPath();
      if (this.id === 'lake-america') {
        // Continuous lobes replace the eleven straight edges of the old splat.
        const phase = random() * Math.PI * 2;
        for(let point=0;point<48;point++) {
          const a=point/48*Math.PI*2, edge=r*(.84+Math.sin(a*3+phase)*.09+Math.sin(a*5-phase)*.05);
          const dx=cx+Math.cos(a)*edge, dy=cy+Math.sin(a)*edge*.78;
          if(point) ctx.lineTo(dx,dy); else ctx.moveTo(dx,dy);
        }
        ctx.closePath(); ctx.fill();
        continue;
      }
      ctx.ellipse(
        px + Math.cos(angle) * spread, pz + Math.sin(angle) * spread,
        r, r * (0.5 + random() * 0.8), random() * Math.PI, 0, Math.PI * 2,
      );
      ctx.fill();
    }
    this.decalTexture.needsUpdate = true;
  }

  // A burn mark. Painted into the same canvas as the blood, so a scorched
  // arena costs no extra texture and clears with the round like everything
  // else. Drawn as a dark core under a hot rim rather than a flat black disc,
  // which is what stops a swept line reading as a drawn stroke.
  scorch(x, z, radius, random = Math.random) {
    const ctx = this.decalCtx;
    if (!ctx) return;
    const [px, pz] = this.decalPixel(x, z);
    const scale = DECAL_RES / DECAL_SPAN;
    const r = Math.max(1, radius * scale);
    const glow = ctx.createRadialGradient(px, pz, r * 0.1, px, pz, r);
    glow.addColorStop(0, 'rgba(16,10,8,0.82)');
    glow.addColorStop(0.55, 'rgba(74,26,14,0.5)');
    glow.addColorStop(0.82, 'rgba(216,31,42,0.28)');
    glow.addColorStop(1, 'rgba(216,31,42,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(px, pz, r, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    // A few cinders off the line so the burn has an edge instead of a contour.
    for (let i = 0; i < 4; i += 1) {
      const angle = random() * Math.PI * 2;
      const spread = Math.pow(random(), 0.6) * r * 1.5;
      ctx.fillStyle = `rgba(${18 + Math.round(random() * 40)},12,10,${0.18 + random() * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(px + Math.cos(angle) * spread, pz + Math.sin(angle) * spread * 0.5,
        r * 0.16 * (0.4 + random()), r * 0.1 * (0.4 + random()), random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    this.decalTexture.needsUpdate = true;
  }

  clearBlood() {
    if (!this.decalCtx) return;
    this.decalCtx.clearRect(0, 0, DECAL_RES, DECAL_RES);
    this.decalTexture.needsUpdate = true;
  }

  buildSnow() {
    const count = 900;
    const positions = new Float32Array(count * 3);
    this.snowSpeed = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 34;
      positions[i * 3 + 1] = Math.random() * 14;
      positions[i * 3 + 2] = -14 + Math.random() * 24;
      this.snowSpeed[i] = 0.4 + Math.random() * 0.9;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const snow = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xdcecff, size: 0.05, transparent: true, opacity: 0.6,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.group.add(snow);
    this.snow = snow;
  }

  // A landed blow lights the arena from the point of contact. Colour carries
  // the read at a glance: cold for a guard, hot white for a counter, deep red
  // for a finish. Without this a heavy punch changed nothing about the scene.
  impactFlash(profile, x, y) {
    const [hex, power] = FLASH[profile.type] || FLASH.blunt;
    this.flashColor.setHex(hex);
    const intensity = power * (0.62 + Math.min(profile.power, 4) * 0.26);
    this.flash = Math.max(this.flash, this.id === 'lake-america' ? Math.min(8, intensity * .045) : intensity);
    this.impactLight.position.set(x, Math.max(0.7, y), 1.2);
  }

  // A bounded set of fragments keeps destructive dressing at a fixed cost.
  buildDebris() {
    const geometry = new THREE.TetrahedronGeometry(0.065);
    const material = new THREE.MeshStandardMaterial({
      color: this.id === 'lake-america' ? 0xa7d6ed : this.id === 'palm-resort' ? 0xd3a565 : 0xb8bab3,
      roughness: 0.58, metalness: this.id === 'palm-resort' ? 0.35 : 0.03,
    });
    for (let i = 0; i < 36; i++) {
      const mesh = new THREE.Mesh(geometry, material); mesh.visible = false;
      this.group.add(mesh); this.debris.push({ mesh, velocity: new THREE.Vector3(), life: 0 });
    }
  }

  impact(event, profile = {}) {
    this.impactFlash({ type: profile.type || 'blunt', power: profile.power || event.bloodScale || 1 }, event.x, event.y);
    const strength = stageImpactStrength(event, profile);
    if (!strength) return;
    this.environment?.impact?.(event, strength);
    const side = event.x >= 0 ? 1 : -1;
    const target = this.interactives.filter(prop => Math.sign(prop.home.x) === side || prop.home.x === 0)
      .sort((a, b) => Math.abs(a.home.x - event.x) - Math.abs(b.home.x - event.x))[0];
    if (target) target.strength = Math.max(target.strength, strength);
    const x = target?.home.x ?? event.x;
    const z = target?.home.z ?? -0.45;
    const y = target?.home.y ?? 0.02;
    let count = this.reducedMotion ? 3 : Math.round(8 + strength * 14);
    for (const shard of this.debris) {
      if (shard.life > 0 || count-- <= 0) continue;
      shard.mesh.visible = true; shard.life = 0.6 + Math.random() * 0.7;
      shard.mesh.position.set(x, y, z);
      shard.mesh.scale.setScalar(0.6 + Math.random() * 1.5);
      shard.velocity.set((Math.random() - 0.5) * 2.6, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 1.3);
    }
    if (this.id === 'lake-america') this.fracture(event.x, strength);
  }

  fracture(x, strength) {
    const ctx = this.decalCtx;
    if (!ctx) return;
    const [px, py] = this.decalPixel(x, -0.05), scale = DECAL_RES / DECAL_SPAN;
    ctx.strokeStyle = 'rgba(188,232,255,0.65)'; ctx.lineWidth = 1.15;
    for (let i = 0; i < 7; i++) {
      const angle = i * Math.PI * 2 / 7;
      ctx.beginPath(); ctx.moveTo(px, py);
      for (let j = 1; j <= 3; j++) {
        const distance = j * scale * (0.12 + strength * 0.16);
        ctx.lineTo(px + Math.cos(angle + Math.sin(i + j) * 0.2) * distance, py + Math.sin(angle) * distance * 0.55);
      }
      ctx.stroke();
    }
    this.decalTexture.needsUpdate = true;
  }

  update(dt, impactPulse = 0) {
    // Hitstop holds dt at 0, which is exactly what this wants: the flash stays
    // lit for the whole freeze and only decays once time resumes.
    if (dt > 0) this.flash *= Math.pow(0.0016, dt);
    if (this.flash < 1) this.flash = 0;
    const pulse = impactPulse * (this.id === 'lake-america' ? 9 : 200);
    if (this.flash > pulse) {
      this.impactLight.color.copy(this.flashColor);
      this.impactLight.intensity = this.flash;
    } else {
      this.impactLight.color.setHex(0xff3a2a);
      this.impactLight.intensity = pulse;
      if (!this.flash) this.impactLight.position.set(0, 1.4, 1.2);
    }
    if (dt <= 0) return;
    this.stageTime += dt;
    this.environment?.update(dt);

    for (const prop of this.interactives) {
      prop.strength *= Math.exp(-dt * 4.5);
      const wave = this.reducedMotion ? 0 : Math.sin(this.stageTime * 0.8 + prop.phase);
      if (prop.kind === 'palm') prop.mesh.rotation.z = wave * 0.018 + Math.sin(this.stageTime * 28) * prop.strength * 0.035;
      else if (prop.kind === 'fountain') {
        prop.mesh.scale.y = 1 + wave * 0.04 + prop.strength * 1.5;
        prop.mesh.position.y = prop.home.y + prop.strength * 0.55;
      } else if (prop.kind === 'pool') prop.mesh.material.roughness = 0.1 + (wave * 0.015) + prop.strength * 0.15;
      else prop.mesh.rotation.z = Math.sin(this.stageTime * 35) * prop.strength * 0.025;
    }
    for (const shard of this.debris) {
      if (shard.life <= 0) continue;
      shard.life -= dt;
      shard.velocity.y -= dt * 8;
      shard.mesh.position.addScaledVector(shard.velocity, dt);
      shard.mesh.rotation.x += dt * 3; shard.mesh.rotation.z += dt * 4;
      if (shard.mesh.position.y < 0.035) { shard.mesh.position.y = 0.035; shard.velocity.y = Math.abs(shard.velocity.y) * 0.28; shard.velocity.x *= 0.7; }
      if (shard.life <= 0) shard.mesh.visible = false;
    }

    if (this.snow) {
      const positions = this.snow.geometry.attributes.position;
      const array = positions.array;
      for (let i = 0; i < this.snowSpeed.length; i += 1) {
        array[i * 3 + 1] -= this.snowSpeed[i] * dt;
        array[i * 3] += Math.sin((array[i * 3 + 1] + i) * 0.6) * dt * 0.16;
        if (array[i * 3 + 1] < 0) {
          array[i * 3 + 1] = 13.5;
          array[i * 3] = (Math.random() - 0.5) * 34;
        }
      }
      positions.needsUpdate = true;
    }

    const motion = this.reducedMotion ? 0 : 1;
    if (this.vortex) this.vortex.rotation.z = Math.sin(this.stageTime * 0.075) * 0.012 * motion;
    if (this.moon) {
      const pulse = 1 + Math.sin(this.stageTime * 0.48) * 0.012 * motion;
      this.moon.scale.setScalar(pulse);
    }
    for (const layer of this.animatedLayers) {
      const wave = Math.sin(this.stageTime * 0.42 + layer.phase) * layer.amount * motion;
      if (layer.kind === 'sway') layer.mesh.rotation.z = wave;
      if (layer.kind === 'breathe') layer.mesh.scale.set(1 + wave, 1 - wave * 0.35, 1);
      if (layer.kind === 'frost') layer.mesh.material.opacity = 0.9 + wave;
      if (layer.kind === 'drift') layer.mesh.position.x = layer.mesh.userData.home.x + wave;
    }
    for (const sprite of this.mist) {
      if (!motion) continue;
      sprite.position.x += sprite.userData.speed * dt;
      sprite.position.y += Math.sin(this.stageTime * 0.32 + sprite.userData.phase) * dt * 0.018;
      if (sprite.position.x > 17) sprite.position.x = -17;
    }
    for (const sprite of this.fireGlows) {
      const flicker = motion ? 0.82 + Math.sin(this.stageTime * 9 + sprite.userData.phase) * 0.13
        + Math.sin(this.stageTime * 21 + sprite.userData.phase) * 0.05 : 0.84;
      sprite.material.opacity = flicker;
      sprite.scale.setScalar(sprite.userData.baseScale * (0.94 + flicker * 0.12));
    }
  }
}
