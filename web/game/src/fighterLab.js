import * as T from './vendor/three.module.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {fighterAnimations} from './render/fighterAnimations.js';
import {carneyFighter} from './fighters/carney.js';
import {CONTACT_MARKERS} from './render/clipTiming.js';
const scene=new T.Scene();scene.background=new T.Color(0x161d27);
const renderer=new T.WebGLRenderer({canvas:document.querySelector('#canvas'),antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.toneMapping=T.ACESFilmicToneMapping;
const camera=new T.PerspectiveCamera(35,1,.05,40);const clock=new T.Clock();
scene.add(new T.HemisphereLight(0xd1e4ff,0x575260,2));
for(const [x,color,intensity] of [[-3,0xffe5cc,3],[3,0x90baff,2]]){const l=new T.DirectionalLight(color,intensity);l.position.set(x,4,5);scene.add(l)}
const grid=new T.GridHelper(10,40,0x62768a,0x2d3b49);scene.add(grid);
let playing=true,wire=false,time=0,duration=1;const models=[];
const $=id=>document.getElementById(id);
function resize(){const narrow=innerWidth<900,w=narrow?innerWidth:innerWidth-310,h=narrow?Math.round(innerHeight*.62):innerHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
function choose(){time=0;for(const m of models){m.mixer.stopAllAction();const clip=m.clips.find(c=>c.name===$('clip').value);if(clip){m.action=m.mixer.clipAction(clip);m.action.play();duration=clip.duration}}
 const clip=models[0]?.action?.getClip();$('contact').disabled=!(clip?.userData?.contactMarkers||CONTACT_MARKERS[clip?.name]);
}
$('clip').onchange=choose;$('time').oninput=()=>{playing=false;time=Number($('time').value)*duration;$('play').textContent='Play animation'};
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'Pause animation':'Play animation'};
$('contact').onclick=()=>{const clip=models[0]?.action?.getClip();const markers=clip?.userData?.contactMarkers||CONTACT_MARKERS[clip?.name];if(markers){time=markers[0];playing=false;$('play').textContent='Play animation'}};
$('facing').onchange=()=>{for(const m of models)m.root.rotation.y=Number($('facing').value)};
$('wire').onclick=()=>{wire=!wire;for(const m of models)m.root.traverse(n=>{if(n.isMesh)for(const mat of Array.isArray(n.material)?n.material:[n.material])mat.wireframe=wire});$('wire').textContent=wire?'Hide wireframe':'Show wireframe'};
async function loadModels(){try{
 for(const [i,name] of ['carney-rigged','carney-hero'].entries()){
  const gltf=await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}fighters/carney/${name}.glb`);
  gltf.scene.updateMatrixWorld(true);const b=new T.Box3().setFromObject(gltf.scene),s=b.getSize(new T.Vector3());
  gltf.scene.scale.setScalar(1.92/s.y);gltf.scene.updateMatrixWorld(true);const bb=new T.Box3().setFromObject(gltf.scene),center=bb.getCenter(new T.Vector3());
  gltf.scene.position.set(-center.x,-bb.min.y,-center.z);
  const root=new T.Group();root.add(gltf.scene);root.position.x=i?.68:-.68;scene.add(root);
  models.push({root,mixer:new T.AnimationMixer(gltf.scene),clips:await fighterAnimations(carneyFighter,gltf.animations)});
 }
 const shared=models[0].clips.map(c=>c.name).filter(n=>models[1].clips.some(c=>c.name===n));
 for(const name of shared){const o=document.createElement('option');o.value=name;o.textContent=models[0].clips.find(c=>c.name===name)?.userData?.label||name;$('clip').append(o)}
 $('clip').value='guard';choose();
 $('status').textContent=`${shared.length} runtime animations · GLB + packed specials + Carney motion. Drag time to inspect deformation.`;
}catch(e){$('error').textContent=e.message}}
loadModels();
renderer.setAnimationLoop(()=>{
 const dt=Math.min(clock.getDelta(),.05);if(playing)time=(time+dt)%duration;$('time').value=time/duration;
 for(const m of models)if(m.action){m.action.time=time;m.mixer.update(0)}
 $('sample').textContent=`${time.toFixed(3)} s / ${duration.toFixed(3)} s`;
 const mode=$('view').value,face=mode==='face';
 const aim=new T.Vector3(0,face?1.67:1.02,0);
 camera.position.copy(aim).add(new T.Vector3(mode==='side'?3:mode==='rear'?1:0,face?.04:.22,mode==='rear'?-4.8:face?2.6:5.1));camera.lookAt(aim);
 renderer.render(scene,camera);
});
