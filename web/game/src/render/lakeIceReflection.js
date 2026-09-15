import * as THREE from '../vendor/three.module.js';
import { Reflector } from '../vendor/Reflector.js';

// A modest single reflection target, shared by the full ice shelf. Five taps
// soften reflected silhouettes; frost masks them out around snowy shorelines.
export function iceReflection(fractures, noise) {
  const mirror = new Reflector(new THREE.PlaneGeometry(49, 27), {
    textureWidth: 768, textureHeight: 512, multisample: 0, clipBias: .003,
    shader: {
      name: 'Lake America · frosted planar reflection',
      uniforms: { color: { value: new THREE.Color('#a6c4d0') }, tDiffuse: { value: null }, textureMatrix: { value: new THREE.Matrix4() }, fractures: { value: fractures } },
      vertexShader: `uniform mat4 textureMatrix; varying vec4 vReflection; varying vec3 vWorld;
        void main(){vReflection=textureMatrix*vec4(position,1.);vWorld=(modelMatrix*vec4(position,1.)).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse,fractures; uniform vec3 color;
        varying vec4 vReflection; varying vec3 vWorld;
        ${noise}
        void main(){
          vec2 p=vWorld.xz;
          float cloud=fbm(p*.37+fbm(p*.63)*2.);
          float frost=clamp(smoothstep(.44,.79,cloud)*.55+smoothstep(5.,12.,abs(p.y))*.55+smoothstep(9.,21.,abs(p.x))*.55,0.,1.);
          vec2 uv=vReflection.xy/vReflection.w;
          vec2 blur=vec2(.0012,.0018);
          vec3 reflected=texture2D(tDiffuse,uv).rgb*.4;
          reflected+=texture2D(tDiffuse,uv+blur).rgb*.15;
          reflected+=texture2D(tDiffuse,uv-blur).rgb*.15;
          reflected+=texture2D(tDiffuse,uv+vec2(blur.x,-blur.y)).rgb*.15;
          reflected+=texture2D(tDiffuse,uv+vec2(-blur.x,blur.y)).rgb*.15;
          float edge=1.-smoothstep(.86,1.,length(vec2(p.x/24.,(p.y-1.)/13.)));
          float fracture=texture2D(fractures,vec2((p.x+25.)/50.,1.-(p.y+13.)/28.)).g;
          gl_FragColor=vec4(reflected*color,.23*(1.-frost)*(1.-fracture*.8)*edge);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    },
  });
  mirror.name='Lake America · reflected shoreline and fighters';
  mirror.rotation.x=-Math.PI/2; mirror.position.set(0,.002,1);
  mirror.material.transparent=true; mirror.material.depthWrite=false;
  mirror.material.uniforms.fractures.value=fractures;
  mirror.renderOrder=1;
  return mirror;
}
