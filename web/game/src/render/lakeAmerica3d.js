import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { LakeAtmosphere } from './lakeAtmosphere.js';
import { lakeFractures, lakeReflection, glacialIce } from './lakeSurface.js';
import { iceReflection } from './lakeIceReflection.js';

const BASE = import.meta.env?.BASE_URL || '/';
const NOISE = /* glsl */`
float hash21(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise21(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+1.),f.x),f.y);
}
float fbm(vec2 p) {
  float f=0.; float a=.5;
  for(int i=0;i<4;i++){ f+=a*noise21(p); p=mat2(.8,-.6,.6,.8)*p*2.07+13.7; a*=.5; }
  return f;
}`;

// The GLB's text curves export as thin, coarse geometry that turns to mush at
// fight-camera distance. Paint the lettering onto crisp plates instead; the
// original meshes stay in the file (hidden) so the Blender master is unchanged.
function signPlate(width, height, canvasWidth, draw, reflection) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth; canvas.height = Math.round(canvasWidth * height / width);
  const ctx = canvas.getContext('2d'); draw(ctx, canvas.width, canvas.height);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 16;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({
    map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: .22, roughness: .7, envMap: reflection, envMapIntensity: .2,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  plate.receiveShadow = true;
  return plate;
}

function letter(ctx, text, x, y, size, color, spacing, maxWidth) {
  ctx.font = `700 ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  ctx.letterSpacing = `${spacing}px`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
  // Letter spacing trails the last glyph; shift right by half to stay centred.
  ctx.fillText(text, x + spacing / 2, y, maxWidth);
}

function paintSignFaces(scene, reflection) {
  const sign = scene.getObjectByName('lake-america-trail-sign');
  if (sign) {
    for (const child of sign.children) if (/^Sign_/.test(child.name)) child.visible = false;
    // Covers the navy panel (4.84 × 1.3) and the red warning band along its foot.
    const face = signPlate(4.84, 1.3, 2048, (ctx, w, h) => {
      const enamel = ctx.createLinearGradient(0, 0, 0, h);
      enamel.addColorStop(0, '#183b44'); enamel.addColorStop(1, '#0a232d');
      ctx.fillStyle = enamel; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#bba578'; ctx.lineWidth = 5; ctx.strokeRect(28, 22, w - 56, 408);
      ctx.lineWidth = 2; ctx.strokeRect(40, 34, w - 80, 384);
      letter(ctx, 'WATERFRONT PARK', w / 2, 93, 43, '#c6b897', 15, w - 200);
      ctx.font = 'bold 162px Georgia, serif'; ctx.letterSpacing = '5px';
      ctx.fillStyle = '#fff3d9'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('LAKE AMERICA', w / 2, 230, w - 160);
      ctx.fillStyle = '#bba578'; ctx.fillRect(w / 2 - 300, 328, 600, 3);
      letter(ctx, 'FROZEN WATERFRONT', w / 2, 375, 44, '#d7e4e2', 14, w - 240);
      ctx.fillStyle = '#962c24'; ctx.fillRect(0, 457, w, h - 457);
      letter(ctx, 'CAUTION   /   THIN ICE', w / 2, 505, 59, '#fff3d9', 9, w - 140);
    }, reflection);
    // Not named Sign_…: the victory nameplate hides only the lake-name labels.
    face.name = 'lake-america-sign-face'; face.position.set(0, 1.96, .18);
    sign.add(face);
  }
  const station = scene.getObjectByName('Station_·_Rescue001') || scene.children.find(o => /^Station_/.test(o.name));
  if (station) {
    station.visible = false;
    const face = signPlate(3.02, .43, 1536, (ctx, w, h) => {
      ctx.fillStyle = '#15283a'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#bba578'; ctx.lineWidth = 5; ctx.strokeRect(15, 15, w-30, h-30);
      letter(ctx, 'LAKE RESCUE', w / 2, h / 2 + 4, 122, '#f5eedd', 18, w - 100);
    }, reflection);
    face.name = 'lake-america-rescue-face'; face.position.set(station.position.x, 2.18, station.position.z);
    station.parent.add(face);
  }
}

function sky() {
  const material = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    uniforms: { time: { value: 0 }, top: { value: new THREE.Color('#283e60') }, horizon: { value: new THREE.Color('#d9b9a0') } },
    vertexShader: 'varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: /* glsl */`
      varying vec3 vDirection; uniform float time; uniform vec3 top,horizon;
      ${NOISE}
      void main(){
        vec3 d=normalize(vDirection); float h=max(0.,d.y);
        vec3 col=mix(horizon,top,1.-exp(-h*8.));
        vec3 sunDir=normalize(vec3(.48,.16,-1.));
        float alignment=max(0.,dot(d,sunDir));
        col+=vec3(.32,.125,.035)*pow(alignment,12.);
        vec2 cloud=d.xz/(max(.05,d.y)+.18)*vec2(1.4,4.)+vec2(time*.0015,0.);
        float n=fbm(cloud), detail=fbm(cloud*2.8);
        float cover=smoothstep(.38,.67,n+detail*.13)*smoothstep(.018,.13,d.y);
        vec3 cloudColor=mix(vec3(.11,.16,.24),vec3(.5,.48,.48),detail);
        cloudColor+=vec3(.37,.19,.08)*pow(alignment,14.)*smoothstep(.45,.72,n);
        col=mix(col,cloudColor,cover*.82);
        float sun=smoothstep(.99986,.99996,alignment);
        col+=vec3(1.,.72,.39)*sun*2.8*(1.-cover*.84);
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(550, 32, 16), material);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return mesh;
}

function water() {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 } }]), fog: true,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main(){
        vec4 world=modelMatrix*vec4(position,1.); vWorld=world.xyz;
        vec4 mvPosition=viewMatrix*world; gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float time; varying vec3 vWorld;
      #include <fog_pars_fragment>
      ${NOISE}
      float waves(vec2 p){return sin(p.x*.7+p.y*2.1+time*.8+noise21(p*.4)*2.)*.012
        +sin(p.x*2.7-p.y*3.3+time*1.2)*.005+noise21(p*2.+time*.08)*.013;}
      void main(){
        vec2 p=vWorld.xz; float e=.055; float h=waves(p);
        vec3 n=normalize(vec3((h-waves(p+vec2(e,0.)))/e,1.,(h-waves(p+vec2(0.,e)))/e));
        vec3 view=normalize(cameraPosition-vWorld);
        float fresnel=pow(1.-max(dot(n,view),0.),4.);
        vec3 col=mix(vec3(.012,.035,.055),vec3(.17,.215,.255),fresnel);
        float ripples=fbm(p*.8+vec2(time*.06,0.)); col+=vec3(.009,.015,.022)*ripples;
        vec3 reflected=reflect(-view,n);
        float sunset=pow(max(0.,dot(reflected,normalize(vec3(.48,.16,-1.)))),28.);
        col=mix(col,vec3(.38,.245,.15),sunset*.55);
        vec3 halfV=normalize(view+normalize(vec3(.48,.16,-1.)));
        float spec=pow(max(0.,dot(n,halfV)),240.);
        col+=vec3(1.,.65,.3)*spec*1.6;
        // Fine foam along the island, with opaque water under it.
        float edge=length(vec2(p.x/25.,(p.y-1.)/14.));
        float foam=(1.-smoothstep(.025,.085,abs(edge-1.03)))*(.25+.6*noise21(p*8.-time*.3));
        col=mix(col,vec3(.4,.54,.58),foam*.5);
        gl_FragColor=vec4(col,1.);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1000,1000),material);
  mesh.rotation.x=-Math.PI/2; mesh.position.y=-.65;
  return mesh;
}

function stoneMaterial(material) {
  if (material.userData.lakeStone) return;
  material.userData.lakeStone = true;
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vStoneWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvStoneWorld=(modelMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader='varying vec3 vStoneWorld;\n'+NOISE+'\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 sp=vec2(vStoneWorld.x+vStoneWorld.z*.74,vStoneWorld.y);
      float grit=fbm(sp*15.);
      float strata=sin(vStoneWorld.y*28.+fbm(sp*2.)*5.);
      float seam=1.-smoothstep(.02,.13,abs(strata));
      diffuseColor.rgb*=.68+grit*.55-seam*.16;`);
  };
  material.customProgramCacheKey=()=> 'lake-granite-v1';
}

// World-space grain keeps the batched Blender timber detailed without extra maps.
function timberMaterial(material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vTimber;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvTimber=(modelMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader = 'varying vec3 vTimber;\n' + NOISE + '\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float grain=fbm(vec2(vTimber.x*.8+vTimber.z*.6,vTimber.y*95.));
      float fibre=sin(vTimber.y*290.+noise21(vTimber.xz*3.)*8.);
      diffuseColor.rgb*=.72+grain*.48+fibre*.035;`);
  };
  material.customProgramCacheKey = () => 'lake-timber-v1';
}

function flag() {
  const canvas=document.createElement('canvas'); canvas.width=512; canvas.height=256;
  const ctx=canvas.getContext('2d'); ctx.fillStyle='#f5f3e8';ctx.fillRect(0,0,512,256);
  ctx.fillStyle='#d41425';ctx.fillRect(0,0,128,256);ctx.fillRect(384,0,128,256);
  // Deliberate vector emblem, crisp at every mip level.
  const leaf=[[0,-95],[16,-58],[33,-68],[30,-24],[64,-44],[61,-16],[90,-22],[73,12],[83,26],[38,53],[41,70],[6,65],[6,99],[-6,99],[-6,65],[-41,70],[-38,53],[-83,26],[-73,12],[-90,-22],[-61,-16],[-64,-44],[-30,-24],[-33,-68],[-16,-58]];
  ctx.beginPath();leaf.forEach(([x,y],i)=>i?ctx.lineTo(256+x,124+y):ctx.moveTo(256+x,124+y));ctx.closePath();ctx.fill();
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshStandardMaterial({map:texture,roughness:.92,side:THREE.DoubleSide});
  const time={value:0};
  material.onBeforeCompile=shader=>{
    shader.uniforms.flagTime=time;
    shader.vertexShader='uniform float flagTime;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float reach=position.x/2.6+.5;
      transformed.z+=sin(reach*8.-flagTime*2.6+position.y*1.2)*.17*reach;
      transformed.y-=reach*.12;`);
  };
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(2.6,1.3,28,10),material);
  mesh.position.set(10.1,5.95,-5.9); mesh.castShadow=false;
  return {mesh,time};
}

export function buildLakeAmerica(stage) {
  const root=new THREE.Group();root.name='Lake America · Blender environment';stage.group.add(root);
  const backdrop=sky(), lake=water(), banner=flag();root.add(backdrop,lake,banner.mesh);
  stage.scene.background=new THREE.Color('#aab8c5');
  stage.scene.fog=new THREE.Fog('#a5abb5',100,370);
  stage.key.color.set('#ffd2a5'); stage.key.intensity=2.7;
  stage.key.position.set(16,14,-18);
  stage.key.shadow.bias=-.00025;
  stage.key.shadow.normalBias=.035;
  for (const light of stage.group.children) {
    if (light.isHemisphereLight) { light.color.set('#bacde0'); light.groundColor.set('#304958'); light.intensity=.95; }
    else if (light.isDirectionalLight && light !== stage.key) { light.color.set('#c3d9f3'); light.position.set(-8,8,12); light.intensity=1.5; }
    else if (light.isPointLight && light !== stage.impactLight) light.intensity=0;
  }
  Object.assign(stage.key.shadow.camera, { left: -14, right: 14, top: 11, bottom: -11, near: 1, far: 65 });
  stage.key.shadow.camera.updateProjectionMatrix();
  const reflection=lakeReflection(), fractures=lakeFractures();
  const ice=glacialIce(fractures,reflection,NOISE);
  const mirror=iceReflection(fractures,NOISE); root.add(mirror);
  let iceAttached=false;
  // Own these textures immediately, even if the GLB fails or the stage changes.
  lake.material.reflectionMap=reflection; lake.material.fractureMap=fractures;
  const lamps = new THREE.Group(); lamps.name='Lake America · waterfront lamplight'; root.add(lamps);
  const glowCanvas=document.createElement('canvas'); glowCanvas.width=glowCanvas.height=128;
  const ctx=glowCanvas.getContext('2d'), glow=ctx.createRadialGradient(64,64,0,64,64,64);
  glow.addColorStop(0,'rgba(255,227,169,.8)'); glow.addColorStop(.1,'rgba(255,193,104,.4)'); glow.addColorStop(.35,'rgba(255,163,67,.09)'); glow.addColorStop(1,'rgba(255,140,50,0)');
  ctx.fillStyle=glow; ctx.fillRect(0,0,128,128);
  const glowMap=new THREE.CanvasTexture(glowCanvas); glowMap.colorSpace=THREE.SRGBColorSpace;
  const glowMaterial=new THREE.SpriteMaterial({map:glowMap,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,color:'#ffd197'});
  for(const [x,z] of [[-8.2,-9.3],[-3.8,-11.6],[3.6,-11.6],[7.1,-9.3]]) {
    const halo=new THREE.Sprite(glowMaterial); halo.position.set(x,2.8,z); halo.scale.set(1.7,1.7,1); lamps.add(halo);
    const lamp=new THREE.PointLight('#ffb65f',5,5,2); lamp.position.set(x,2.65,z); lamps.add(lamp);
  }
  const cabinLight=new THREE.PointLight('#ffad5d',12,7,2); cabinLight.position.set(8.8,1.55,-13.2); lamps.add(cabinLight);
  const weather = new LakeAtmosphere(root), floaters = [];
  weather.update(0, stage.reducedMotion);
  let time = 0;
  // Runtime tracks wind and water on the same slowed scene clock as the action.
  const generation=stage.generation;
  stage.environment={
    weather,
    dispose() { mirror.getRenderTarget().dispose(); if(!iceAttached) ice.dispose(); },
    update(dt) {
      const motionDt = stage.reducedMotion ? 0 : Math.max(0, dt);
      time += motionDt;
      backdrop.material.uniforms.time.value = time;
      lake.material.uniforms.time.value = time;
      banner.time.value = time;
      weather.update(dt, stage.reducedMotion);
      for (const [i, floe] of floaters.entries()) {
        floe.mesh.position.y = floe.y + (stage.reducedMotion ? 0 : Math.sin(time * .65 + i * 1.8) * .025);
        floe.mesh.rotation.z = floe.roll + (stage.reducedMotion ? 0 : Math.sin(time * .5 + i) * .008);
      }
    },
    impact(event, strength) { if (!stage.reducedMotion) weather.impact(event.x, strength); },
    resetRound() { weather.resetRound(); },
  };
  const ready=new GLTFLoader().loadAsync(`${BASE}stages/lake-america-3d/lake-america.glb`).then(gltf=>{
    if(stage.generation!==generation){
      gltf.scene.traverse(o=>{o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());});
      return;
    }
    gltf.scene.traverse(object=>{
      if (/^lake-america-(floe-\d+|buoy)$/.test(object.name)) {
        floaters.push({ mesh: object, y: object.position.y, roll: object.rotation.z });
      }
      if(!object.isMesh)return;
      object.receiveShadow=true;
      object.castShadow=/^(02[ _]|06[ _]|07[ _]|08[ _]|10[ _]|lake-america-axe)/.test(object.name) || object.parent?.name === 'lake-america-axe';
      const mats=Array.isArray(object.material)?object.material:[object.material];
      for(const mat of mats) {
        if(mat.name.startsWith('Slate')) { object.material=ice; iceAttached=true; mat.dispose(); continue; }
        if(mat.name.startsWith('Granite')) stoneMaterial(mat);
        if(mat.name.startsWith('Cedar') || mat.name.startsWith('Bark')) timberMaterial(mat);
        if(mat.name.startsWith('Lantern')) mat.emissiveIntensity = 1.35;
        mat.envMap=reflection;
        mat.envMapIntensity=mat.name.startsWith('Snow')?.28:.45;
        if(mat.name.startsWith('Snow')) { mat.roughness=.94; mat.color.set('#d6e3ee'); }
        if(mat.name.startsWith('City')) mat.color.set('#758899');
      }
    });
    paintSignFaces(gltf.scene, reflection);
    root.add(gltf.scene);
  });
  // Preserve rejection for startMatch while avoiding an unhandled startup promise.
  ready.catch(error=>console.error('Lake America failed to load',error));
  stage.ready=ready;
  return root;
}
