import * as THREE from '../vendor/three.module.js';

// One island-sized fracture field: no repeated paving pattern or per-frame work.
// R = deep fractures, G = frost rims, B = fine scoring. World-space mapping keeps
// every exported slab seamless and leaves the collision surface exactly at Y=0.
export function lakeFractures() {
  const size = 2048, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  let state = 7319;
  const random = () => ((state = Math.imul(state, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
  const paths = [];
  function crack(x, y, angle, length, width, depth) {
    const path = [[x, y]], steps = Math.ceil(length / 13);
    for (let i = 0; i < steps; i++) {
      angle += (random() - .5) * .85;
      x += Math.cos(angle) * 13; y += Math.sin(angle) * 13;
      path.push([x, y]);
      if (depth > 0 && i > 2 && random() > .87) crack(x, y, angle + (random() > .5 ? .8 : -.8), length * (.13 + random() * .22), width * .52, depth - 1);
    }
    paths.push({ path, width });
  }
  for (let i = 0; i < 27; i++) {
    const x = random() * size, y = random() * size;
    crack(x, y, random() * Math.PI * 2, 100 + random() * 390, .7 + random() * 1.4, 2);
  }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const { path, width } of paths) {
    for (const [color, scale] of [['#002700', 8], ['#009200', 3.3], ['#ffb700', 1]]) {
      ctx.strokeStyle = color; ctx.lineWidth = width * scale;
      ctx.beginPath(); path.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
  }
  ctx.strokeStyle = '#00003e'; ctx.lineWidth = .6;
  for (let i = 0; i < 1700; i++) {
    const x = random() * size, y = random() * size;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 4 + random() * 29, y + random() * 3); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  return texture;
}

// Small HDR-like sky source for the physical ice, steel, glass and wet wood.
// Bound explicitly to materials so the Stage lifecycle owns and disposes it.
export function lakeReflection() {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 0, 256);
  for (const [stop, color] of [[0,'#26394f'],[.3,'#526f8b'],[.46,'#a9b4c0'],[.5,'#e8c4a0'],[.55,'#486474'],[1,'#132635']]) gradient.addColorStop(stop,color);
  ctx.fillStyle = gradient; ctx.fillRect(0,0,512,256);
  const sun = ctx.createRadialGradient(294,116,1,294,116,40);
  sun.addColorStop(0,'#fff4d7'); sun.addColorStop(.13,'#ffe2ab'); sun.addColorStop(1,'#e8c4a000');
  ctx.fillStyle = sun; ctx.fillRect(0,0,512,256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping; texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function glacialIce(fractures, reflection, noise) {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#426c7b', roughness: .3, metalness: .16, clearcoat: .65,
    clearcoatRoughness: .22, envMap: reflection, envMapIntensity: .6,
  });
  material.name = 'Lake America · deep glacial ice';
  // Stage disposes all texture-valued material properties, including this map.
  material.fractureMap = fractures;
  material.onBeforeCompile = shader => {
    shader.uniforms.lakeFractures = { value: fractures };
    shader.vertexShader = 'varying vec3 vLakeWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLakeWorld=(modelMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader = 'varying vec3 vLakeWorld; uniform sampler2D lakeFractures;\n' + noise + '\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      vec2 p=vLakeWorld.xz;
      vec3 fracture=texture2D(lakeFractures,vec2((p.x+25.)/50.,1.-(p.y+13.)/28.)).rgb;
      float clouds=fbm(p*.37+fbm(p*.63)*2.);
      float frost=smoothstep(.44,.79,clouds);
      float shore=smoothstep(5.,12.,abs(p.y))+smoothstep(9.,21.,abs(p.x));
      frost=clamp(frost*.55+shore*.55,0.,1.);
      vec3 deep=mix(vec3(.035,.10,.135),vec3(.13,.245,.28),clouds);
      diffuseColor.rgb=mix(deep,vec3(.42,.52,.56),frost);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.30,.56,.61),fracture.g*.72);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.025,.105,.14),fracture.r*.8);
      diffuseColor.rgb+=fracture.b*.045;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(.24,.8,frost);');
  };
  material.customProgramCacheKey = () => 'lake-glacial-ice-v1';
  return material;
}
