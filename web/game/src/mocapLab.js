import * as T from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { fighterAnimations } from './render/fighterAnimations.js';
import { carneyFighter } from './fighters/carney.js';
import { trumpFighter } from './fighters/trump.js';
import { CONTACT_MARKERS } from './render/clipTiming.js';
import { loadMocapClips } from './render/mocapClips.js';

const $ = id => document.getElementById(id);
const scene = new T.Scene(); scene.background = new T.Color(0x090e17); scene.fog = new T.Fog(0x090e17, 10, 24);
const renderer = new T.WebGLRenderer({ canvas: $('canvas'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
const camera = new T.PerspectiveCamera(33, 1, .05, 50), clock = new T.Clock();
scene.add(new T.HemisphereLight(0xc1d7ff, 0x292233, 1.65));
for (const [pos, color, intensity] of [[[2,5,4],0xffe4c9,3.4],[[-4,3,1],0x74aaff,2.8],[[1,4,-3],0x69d9ff,4]]) {
  const light = new T.DirectionalLight(color, intensity); light.position.set(...pos); scene.add(light);
  if (pos[0] === 2) { light.castShadow = true; light.shadow.mapSize.set(2048,2048); Object.assign(light.shadow.camera, {left:-4,right:4,top:4,bottom:-4,near:.1,far:15}); light.shadow.bias = -.0003; }
}
const floor = new T.Mesh(new T.PlaneGeometry(60,60), new T.MeshStandardMaterial({color:0x101a28,roughness:.72,metalness:.2}));
floor.rotation.x = -Math.PI/2; floor.position.y = -.003; floor.receiveShadow = true; scene.add(floor);
const grid = new T.GridHelper(20,80,0x385268,0x1b2b3c); grid.position.y = .001; scene.add(grid);
for (const [x,color] of [[-1.06,0x536984],[1.06,0xd9ae64]]) {
  const ring = new T.Mesh(new T.RingGeometry(.67,.68,100), new T.MeshBasicMaterial({color,transparent:true,opacity:.65,side:T.DoubleSide}));
  ring.rotation.x = -Math.PI/2; ring.position.set(x,.004,0); scene.add(ring);
}
let playing=true, wire=false, time=0, duration=1, models=[], loading=false, showcase=false, showIndex=0, settle=0;
const favorites = ['lightPunch','heavyPunch','lightKick','heavyKick','uppercut','risingKnee'];
const params = new URLSearchParams(location.search);
const markers = clip => clip?.userData?.contactMarkers || CONTACT_MARKERS[clip?.name];
function resize() {
  const narrow=innerWidth<960, w=narrow?innerWidth:innerWidth-330, h=narrow?innerHeight*.61:innerHeight;
  renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();
}
addEventListener('resize',resize); resize();
function layout() {
  const solo=$('compare').value==='solo';
  models.forEach((m,i)=>{m.root.visible=i===1||!solo;m.root.position.x=solo?0:i?1.06:-1.06;m.root.rotation.y=Number($('facing').value);});
  $('before-label').style.visibility=solo?'hidden':'visible';
  $('before-label').textContent=$('compare').value==='texture'?'ORIGINAL / VERTEX COLORS':'BEFORE / AUTHORED';
  $('after-label').textContent=solo?'RETARGETED / GAME GLB':'AFTER / MOTION CAPTURE';
}
function choose() {
  time=0; settle=0;
  for(const m of models){m.mixer.stopAllAction();m.action=null;}
  const name=$('clip').value;
  for(const [i,m] of models.entries()) {
    const clip=m.clips.find(c=>c.name===name)||m.clips.find(c=>c.name==='guard');
    if(clip){m.action=m.mixer.clipAction(clip);m.action.setLoop(T.LoopOnce,1);m.action.clampWhenFinished=true;m.action.play();if(i===1)duration=clip.duration;}
  }
  const clip=models[1]?.action?.getClip(), data=clip?.userData||{};
  $('contact').disabled=!markers(clip); $('move-title').textContent=data.label||name;
  $('source').textContent=data.source||'Existing authored game animation';
  $('source-detail').textContent=data.retargeted?`${data.sourceRange?'Trimmed + combat timed':'Full source take'} · 30 fps capture → GLB · fitted to ${$('fighter').selectedOptions[0].text}`:'Original game motion · shared runtime composition';
  $('duration').textContent=`${duration.toFixed(2)}s`;
  $('status').textContent=name.startsWith('mocap_')?'Full source take. Left holds the existing guard when no matching original exists. These review clips do not replace game moves.':'Both versions share the same character. Contact timing is aligned for a fair comparison.';
}
async function loadModels() {
  if(loading)return;
  loading=true; $('error').textContent=''; $('status').textContent='Loading fighter and motion library…';
  for(const m of models) {
    scene.remove(m.root);m.mixer.stopAllAction();m.mixer.uncacheRoot(m.model);
    m.model.traverse(n=>{if(n.isMesh){n.geometry.dispose();for(const mat of Array.isArray(n.material)?n.material:[n.material]){for(const v of Object.values(mat))if(v?.isTexture)v.dispose();mat.dispose();}}});
  }
  models=[];
  try {
    const id=$('fighter').value, definition=id==='carney'?carneyFighter:trumpFighter;
    for(let i=0;i<2;i++) {
      const asset=id==='carney'&&!(i===0&&$('compare').value==='texture')?'carney-hero':`${id}-rigged`;
      const gltf=await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}fighters/${id}/${asset}.glb`), model=gltf.scene;
      model.updateMatrixWorld(true); const height=new T.Box3().setFromObject(model).getSize(new T.Vector3()).y;
      model.scale.multiplyScalar(1.92/height); model.updateMatrixWorld(true);
      const b=new T.Box3().setFromObject(model), center=b.getCenter(new T.Vector3());model.position.add(new T.Vector3(-center.x,-b.min.y,-center.z));
      model.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});
      const root=new T.Group();root.add(model);scene.add(root);
      const clips=await fighterAnimations(i===0?{...definition,mocapAsset:null}:definition,gltf.animations);
      if(i===1)clips.push(...await loadMocapClips(`fighters/${id}/mocap-library.glb`));
      models.push({root,model,mixer:new T.AnimationMixer(model),clips});
    }
    const selected=$('clip').value||params.get('clip')||'heavyKick';$('clip').replaceChildren();
    for(const [title,filter] of [['COMBAT CUTS',c=>favorites.includes(c.name)],['40 FULL CAPTURE TAKES',c=>c.name.startsWith('mocap_')],['EXISTING GAME MOTION',c=>!favorites.includes(c.name)&&!c.name.startsWith('mocap_')]]) {
      const group=document.createElement('optgroup');group.label=title;
      for(const clip of models[1].clips.filter(filter)){const o=document.createElement('option');o.value=clip.name;o.textContent=clip.userData?.label||clip.name;group.append(o);}$('clip').append(group);
    }
    $('clip').value=selected;if(!$('clip').value)$('clip').value='heavyKick';
    $('count').textContent=models[1].clips.filter(c=>c.userData?.retargeted).length; layout();choose();
    if(params.has('time')){time=Math.min(duration,Number(params.get('time')));playing=false;$('play').textContent='Play';}
  }catch(e){$('error').textContent=e.message;console.error(e);}finally{loading=false;}
}
$('clip').onchange=()=>{showcase=false;$('reel').textContent='Play showcase';choose();};
$('time').oninput=()=>{playing=false;showcase=false;time=Number($('time').value)*duration;$('play').textContent='Play';$('reel').textContent='Play showcase';};
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Pause':'Play';};
$('contact').onclick=()=>{time=markers(models[1]?.action?.getClip())?.[0]||0;playing=false;showcase=false;$('play').textContent='Play';$('reel').textContent='Play showcase';};
$('facing').onchange=layout; $('fighter').onchange=loadModels; $('compare').onchange=loadModels;
$('wire').onclick=()=>{wire=!wire;for(const m of models)m.root.traverse(n=>{if(n.isMesh)for(const mat of Array.isArray(n.material)?n.material:[n.material])mat.wireframe=wire;});$('wire').textContent=wire?'Solid surfaces':'Wireframe';};
$('reel').onclick=()=>{showcase=!showcase;playing=showcase;$('play').textContent=playing?'Pause':'Play';$('reel').textContent=showcase?'Stop showcase':'Play showcase';if(showcase){showIndex=0;$('clip').value=favorites[0];choose();}};
for(const name of favorites) {
  const button=document.createElement('button');button.textContent={lightPunch:'JAB',heavyPunch:'CROSS',lightKick:'FRONT KICK',heavyKick:'ROUNDHOUSE',uppercut:'UPPERCUT',crouchKick:'SWEEP',risingKnee:'KNEE'}[name];
  button.onclick=()=>{showcase=false;$('reel').textContent='Play showcase';$('clip').value=name;playing=true;$('play').textContent='Pause';choose();};$('favorites').append(button);
}
function alignedTime(clip,reference,t) {
  if(clip===reference)return t;
  const a=markers(reference),b=markers(clip);
  if(a&&b){const keysA=[0,...a,reference.duration],keysB=[0,...b,clip.duration];for(let i=1;i<4;i++)if(t<=keysA[i])return T.MathUtils.lerp(keysB[i-1],keysB[i],(t-keysA[i-1])/Math.max(.001,keysA[i]-keysA[i-1]));}
  return t/reference.duration*clip.duration;
}
if(params.get('fighter'))$('fighter').value=params.get('fighter');
if(params.get('facing'))$('facing').value=params.get('facing');
if(params.get('view'))$('view').value=params.get('view');
loadModels();
renderer.setAnimationLoop(()=>{
  const dt=Math.min(clock.getDelta(),.05);
  if(!loading&&playing){time+=dt*Number($('speed').value);if(time>duration){settle+=dt;time=duration;if(settle>.35){time=0;settle=0;if(showcase){showIndex=(showIndex+1)%favorites.length;$('clip').value=favorites[showIndex];choose();}}}}
  const reference=models[1]?.action?.getClip();
  for(const m of models)if(m.action&&reference){m.action.time=Math.min(m.action.getClip().duration-1e-6,alignedTime(m.action.getClip(),reference,time));m.mixer.update(0);}
  $('time').value=time/duration; $('sample').textContent=`${time.toFixed(3)} / ${duration.toFixed(3)} s`;
  const contact=markers(reference);$('phase').textContent=contact?(time<contact[0]?'WINDUP':time<=contact[1]?'CONTACT':'RECOVERY'):'SOURCE MOTION';
  $('phase').classList.toggle('impact',!!contact&&time>=contact[0]&&time<=contact[1]);
  const mode=$('view').value,face=mode==='face',solo=$('compare').value==='solo',aim=new T.Vector3(0,face?1.64:.98,0);
  const distance=face?(solo?1.8:4.9):solo?4.8:6.9;
  camera.position.copy(aim).add(new T.Vector3(mode==='side'?distance*.8:mode==='rear'?1:mode==='three'?distance*.3:0,face?.02:.35,mode==='rear'?-distance:mode==='side'?distance*.3:distance));camera.lookAt(aim);
  renderer.render(scene,camera);
});
