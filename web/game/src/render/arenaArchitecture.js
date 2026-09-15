import * as THREE from '../vendor/three.module.js';

// Shared geometry makes the architecture inexpensive enough to sit behind two
// skinned fighters. Everything is owned by Stage.group and disposed on switch.
export function buildArena(stage, definition) {
  const group = stage.group, p = definition.palette;
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 12);
  const sphereGeometry = new THREE.SphereGeometry(1, 20, 12);
  const materials = {};
  const material = (name, color, roughness = 0.7, metalness = 0) => (materials[name] ||= new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const stone = material('stone', definition.id === 'palm-resort' ? 0xc08b81 : 0xb7bdba);
  const shadowStone = material('shadowStone', definition.id === 'palm-resort' ? 0x794963 : 0x596974);
  const gold = material('gold', 0xbfa36e, 0.3, 0.62);
  const trim = material('trim', 0xded8c5, 0.45);
  const dark = material('dark', 0x101a26);
  const foliage = material('foliage', definition.id === 'palm-resort' ? 0x264949 : 0x1d443e);
  const trunk = material('trunk', 0x665348);
  const emissive = new THREE.MeshBasicMaterial({ color: definition.id === 'palm-resort' ? 0xffc582 : 0xffdfa5, toneMapped: false });

  function mesh(geometry, mat, x, y, z, sx, sy, sz, name = '') {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(x, y, z); object.scale.set(sx, sy, sz);
    object.name = name; object.receiveShadow = true;
    // Only nearer dressing casts a shadow; the distant facade does not need a
    // shadow-map draw for every window and column.
    object.castShadow = z > -7 && y < 5;
    group.add(object); return object;
  }
  const box = (mat, x, y, z, sx, sy, sz, name) => mesh(boxGeometry, mat, x, y, z, sx, sy, sz, name);
  const cylinder = (mat, x, y, z, radius, height, name) => mesh(cylinderGeometry, mat, x, y, z, radius, height, radius, name);
  const sphere = (mat, x, y, z, sx, sy = sx, sz = sx, name) => mesh(sphereGeometry, mat, x, y, z, sx, sy, sz, name);

  // A quiet floor with large joints gives the eye a scale reference without
  // pulling attention from the fight. The lane itself always stays at y = 0.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(44, 39), material('ground', p.ground, definition.id === 'palm-resort' ? 0.4 : 0.68, 0.06));
  ground.rotation.x = -Math.PI / 2; ground.position.z = -4; ground.receiveShadow = true; group.add(ground); stage.ice = ground;
  const seam = material('seam', definition.id === 'executive-lawn' ? 0x627769 : 0x3e4753);
  for (let x = -20; x <= 20; x += 2.4) box(seam, x, 0.003, -1.5, 0.018, 0.006, 29);
  for (let z = -15; z <= 12; z += 2.4) box(seam, 0, 0.004, z, 42, 0.007, 0.018);
  const border = material('border', 0xb49b70, 0.42, 0.2);
  box(border, 0, 0.008, -2.2, 21, 0.012, 0.065);
  box(border, 0, 0.008, 2.2, 21, 0.012, 0.065);

  function windowRow(y, z, count, gap, height = 0.95) {
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * gap;
      box(dark, x, y, z, 0.58, height + 0.17, 0.10);
      box(emissive, x, y, z + 0.065, 0.41, height, 0.02);
      box(stone, x, y, z + 0.09, 0.045, height, 0.03);
      box(stone, x, y, z + 0.09, 0.44, 0.045, 0.03);
    }
  }

  function colonnade(z, columns, span, y = 2.15, height = 3.4) {
    box(trim, 0, y + height / 2 + 0.24, z, span + 1.2, 0.36, 1.45);
    for (let i = 0; i < columns; i++) {
      const x = (i / (columns - 1) - 0.5) * span;
      cylinder(stone, x, y, z, 0.24, height);
      cylinder(trim, x, y - height / 2 + 0.12, z, 0.36, 0.24);
      cylinder(trim, x, y + height / 2 - 0.08, z, 0.34, 0.23);
    }
  }

  function lamp(x, z, height = 2.5) {
    cylinder(dark, x, height / 2, z, 0.06, height);
    box(gold, x, height, z, 0.30, 0.06, 0.30);
    box(emissive, x, height + 0.23, z, 0.20, 0.38, 0.20);
    box(gold, x, height + 0.44, z, 0.32, 0.07, 0.32);
    const glow = new THREE.PointLight(0xffc47c, 12, 6, 2); glow.position.set(x, height + 0.2, z); group.add(glow);
  }

  function urn(x, z) {
    box(shadowStone, x, 0.24, z, 0.65, 0.48, 0.65);
    const bowl = sphere(gold, x, 0.84, z, 0.43, 0.53, 0.43, 'breakable-urn');
    cylinder(gold, x, 1.23, z, 0.46, 0.1);
    stage.interactives.push({ mesh: bowl, home: bowl.position.clone(), kind: 'urn', phase: x, strength: 0 });
  }

  function palm(x, z, h, direction) {
    const stem = cylinder(trunk, x, h / 2, z, 0.16, h); stem.rotation.z = direction * 0.065;
    const crown = new THREE.Group(); crown.position.set(x - direction * h * 0.035, h, z); group.add(crown);
    for (let i = 0; i < 7; i++) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.38, 3.1, 4), foliage);
      frond.rotation.set(0.9, i * Math.PI * 2 / 7, Math.PI / 2 + 0.25);
      frond.position.set(Math.cos(i * Math.PI * 2 / 7) * 0.65, -0.10, Math.sin(i * Math.PI * 2 / 7) * 0.65);
      crown.add(frond);
    }
    stage.interactives.push({ mesh: crown, home: crown.position.clone(), kind: 'palm', phase: x * 0.7, strength: 0 });
  }

  function fountain(x, z) {
    cylinder(shadowStone, x, 0.18, z, 1.35, 0.35);
    cylinder(trim, x, 0.33, z, 1.45, 0.13);
    cylinder(material('water', 0x559dba, 0.12, 0.35), x, 0.40, z, 1.28, 0.03);
    cylinder(stone, x, 0.93, z, 0.18, 1.15);
    cylinder(trim, x, 1.42, z, 0.65, 0.17);
    const waterMat = new THREE.MeshBasicMaterial({ color: 0x91d4e1, transparent: true, opacity: 0.32, depthWrite: false });
    const jet = mesh(new THREE.ConeGeometry(0.65, 1.55, 16, 1, true), waterMat, x, 1.28, z, 1, 1, 1, 'fountain-jet');
    stage.interactives.push({ mesh: jet, home: jet.position.clone(), kind: 'fountain', phase: x, strength: 0 });
  }

  if (definition.id === 'capitol') {
    for (let i = 0; i < 4; i++) box(stone, 0, 0.10 + i * 0.17, -8.8 - i * 0.6, 20 - i * 0.65, 0.20, 4.8 - i * 0.55);
    box(shadowStone, 0, 2.55, -13, 22, 4.1, 3.0);
    windowRow(2.6, -11.43, 15, 1.35);
    box(trim, 0, 4.7, -12.1, 23, 0.30, 3.8);
    colonnade(-10.3, 12, 18, 2.65, 3.6);
    cylinder(stone, 0, 5.15, -12.2, 2.4, 1.0);
    cylinder(trim, 0, 5.67, -12.2, 2.58, 0.18);
    mesh(new THREE.SphereGeometry(2.4, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), stone, 0, 5.68, -12.2, 1, 0.92, 1, 'capitol-dome');
    cylinder(trim, 0, 8.02, -12.2, 0.26, 0.7);
    sphere(gold, 0, 8.5, -12.2, 0.14, 0.24, 0.14);
    for (const x of [-8.5, 8.5]) {
      const column = cylinder(shadowStone, x, 1.1, -4.7, 0.43, 2.2, 'courtyard-pillar');
      cylinder(trim, x, 2.22, -4.7, 0.52, 0.15);
      stage.interactives.push({ mesh: column, home: column.position.clone(), kind: 'masonry', phase: x, strength: 0 });
      lamp(x * 0.82, -6.9);
    }
  } else if (definition.id === 'palm-resort') {
    box(shadowStone, 0, 2.15, -12.8, 23, 4.3, 3.6);
    box(stone, 0, 3.75, -10.8, 24, 0.24, 1.3);
    box(gold, 0, 3.98, -10.9, 24.7, 0.1, 1.6);
    windowRow(2.1, -10.95, 15, 1.4, 1.35);
    colonnade(-9.8, 10, 20, 1.85, 3.3);
    for (const x of [-8, 8]) {
      box(stone, x, 4.2, -12.3, 3.2, 2.0, 3.8);
      mesh(new THREE.ConeGeometry(2.6, 1.3, 4), gold, x, 5.73, -12.3, 1, 1, 1);
    }
    const pool = box(material('pool', 0x256a91, 0.12, 0.45), 0, 0.035, -5.7, 11, 0.04, 3.6);
    box(gold, 0, 0.065, -3.89, 11.4, 0.06, 0.10);
    box(gold, 0, 0.065, -7.51, 11.4, 0.06, 0.10);
    stage.interactives.push({ mesh: pool, home: pool.position.clone(), kind: 'pool', phase: 0, strength: 0 });
    for (const [x, z, h] of [[-9, -5, 5.8], [9, -5.5, 5.5], [-12, -9, 6.8], [12, -9.5, 7]]) palm(x, z, h, Math.sign(x));
    urn(-6.5, -4.6); urn(6.5, -4.6);
    lamp(-5.8, -8.1, 1.5); lamp(5.8, -8.1, 1.5);
  } else {
    box(shadowStone, 0, 2.3, -12.5, 24, 4.6, 3.5);
    windowRow(1.7, -10.71, 17, 1.28, 1.0);
    windowRow(3.4, -10.71, 17, 1.28, 0.8);
    box(trim, 0, 4.76, -12.3, 24.8, 0.30, 4.0);
    colonnade(-9.65, 6, 7.5, 2.3, 4.2);
    const roof = mesh(new THREE.ConeGeometry(5.5, 1.30, 3), trim, 0, 5.16, -10.1, 1, 1, 0.34); roof.rotation.y = Math.PI;
    for (const x of [-8.2, 8.2]) {
      box(foliage, x, 0.46, -4.9, 4.1, 0.9, 2.3);
      for (let i = 0; i < 3; i++) sphere(foliage, x + (i - 1) * 1.1, 0.96, -4.9, 0.7, 0.55, 0.7);
      lamp(x * 0.81, -7.1);
    }
    fountain(0, -6.4);
    for (const x of [-11, 11]) {
      cylinder(trunk, x, 2.1, -8, 0.28, 4.2);
      sphere(foliage, x, 4.5, -8, 2.2, 2.9, 1.8);
    }
  }

  // Visible 3D clouds and a disc remain behind the building. Keeping the sky
  // darker than the costume faces protects the fighters' silhouettes.
  const skyDisc = new THREE.Mesh(new THREE.CircleGeometry(definition.id === 'palm-resort' ? 3.1 : 1.4, 40),
    new THREE.MeshBasicMaterial({ color: definition.id === 'palm-resort' ? 0xdf917b : 0xa4bfd2, toneMapped: false, fog: false }));
  skyDisc.position.set(definition.id === 'palm-resort' ? -6 : 8, definition.id === 'palm-resort' ? 5.2 : 9, -22);
  group.add(skyDisc);
  stage.buildDecalSurface();
  stage.buildAtmosphere();
  for (const mist of stage.mist) { mist.material.color.setHex(p.fill); mist.material.opacity *= 0.65; }
  // Lake fire glows belong to its painted skyline, not these buildings.
  for (const glow of stage.fireGlows) { glow.visible = false; }
  stage.buildDebris();
}
