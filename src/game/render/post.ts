/** Post-processing stack: bloom, colour grading, vignette, damage tint, AA. */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uSaturation: { value: 1.18 },
    uContrast: { value: 1.1 },
    uDamage: { value: 0 },
    uSlowmo: { value: 0 },
    uTime: { value: 0 },
    uWarm: { value: 0.0 },
    uFade: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSaturation, uContrast, uDamage, uSlowmo, uTime, uWarm, uFade;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      // chromatic aberration when hurt / slow-mo
      float ca = (uDamage * 0.006 + uSlowmo * 0.003) * length(uv - 0.5);
      vec2 dir = normalize(uv - 0.5 + 1e-5);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ca).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSaturation * (1.0 - uSlowmo * 0.55) * (1.0 - uDamage * 0.5));
      col = (col - 0.5) * uContrast + 0.5;
      col += vec3(0.025, 0.01, -0.02) * uWarm;
      // slow-mo cool tint
      col = mix(col, col * vec3(0.85, 0.95, 1.12), uSlowmo * 0.6);
      // vignette
      float d = distance(uv, vec2(0.5));
      float vig = smoothstep(0.85, 0.25, d);
      col *= mix(1.0, vig, uVignette + uDamage * 0.4 + uSlowmo * 0.25);
      // damage red edges
      col = mix(col, vec3(0.55, 0.0, 0.0), uDamage * smoothstep(0.3, 0.75, d) * 0.85);
      // film grain
      col += (hash(uv * 900.0 + uTime) - 0.5) * 0.025;
      gl_FragColor = vec4(col * uFade, 1.0);
    }
  `,
};

export class PostFX {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  smaa: SMAAPass | null = null;
  /** Ground-truth ambient occlusion (contact shadows); high quality only. */
  gtao: GTAOPass;
  enabled = true;
  /** Objects the AO pass must ignore (sky dome, cloud layer, sea): GTAOPass only skips points and lines. */
  readonly noAO: THREE.Object3D[] = [];

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    w: number,
    h: number,
    useSMAA: boolean,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, w, h);
    this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 12, distanceFallOff: 1 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.blendIntensity = 0.9;
    this.gtao.enabled = false;
    const hooks = this.gtao as unknown as { _overrideVisibility: () => void };
    const hide = hooks._overrideVisibility.bind(this.gtao);
    hooks._overrideVisibility = () => {
      hide(); // caches every object's visibility first, so the restore brings these back too
      for (const o of this.noAO) o.visible = false;
    };
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.5, 0.93);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    if (useSMAA) {
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    }
    this.setSize(w, h);
  }

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(dt: number, scene: THREE.Scene, camera: THREE.Camera) {
    if (!this.enabled) {
      this.renderer.render(scene, camera);
      return;
    }
    this.grade.uniforms.uTime.value = (this.grade.uniforms.uTime.value + dt) % 100;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
    this.gtao.dispose();
  }
}
