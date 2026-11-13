/** Sky, sun/moon lighting, fog, environment reflections and time of day. */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { clamp, lerp, smoothstep } from '../core/math';

const DAY_FOG = new THREE.Color(0xa9bccb);
const DUSK_FOG = new THREE.Color(0xe2a98a);
const NIGHT_FOG = new THREE.Color(0x0c1424);
const DAY_HEMI_SKY = new THREE.Color(0xcfe3ff);
const NIGHT_HEMI_SKY = new THREE.Color(0x3a4f7a);
const DAY_HEMI_GROUND = new THREE.Color(0x8a7f6a);
const NIGHT_HEMI_GROUND = new THREE.Color(0x10131a);
const SUN_WARM = new THREE.Color(0xffb07a);
const SUN_WHITE = new THREE.Color(0xfff4e6);
const MOON = new THREE.Color(0x9fb4ff);

export class Environment {
  readonly sky: Sky;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly stars: THREE.Points;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky: Sky;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvElev = 999;
  private sunDir = new THREE.Vector3();
  /** 0 = full day, 1 = deep night. */
  night = 0;
  /** Hours 0..24 */
  hour = 9.5;
  /** Real seconds per game hour. */
  secondsPerHour = 40;
  shadowSize = 2048;

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
  ) {
    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    Environment.addSkyGain(this.sky, this.skyGain);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.0025;
    u.mieDirectionalG.value = 0.86;
    scene.add(this.sky);

    this.envSky = new Sky();
    this.envSky.scale.setScalar(9000);
    Environment.addSkyGain(this.envSky, this.skyGain);
    Object.assign(this.envSky.material.uniforms.turbidity, { value: 4 });
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.hemi = new THREE.HemisphereLight(DAY_HEMI_SKY, DAY_HEMI_GROUND, 1.0);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -90;
    sc.right = 90;
    sc.top = 90;
    sc.bottom = -90;
    sc.near = 1;
    sc.far = 600;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun);
    scene.add(this.sun.target);

    scene.fog = new THREE.Fog(DAY_FOG.clone(), 120, 1100);

    // stars
    const n = 1500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 0.95);
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * 4000;
      pos[i * 3 + 1] = Math.cos(ph) * 4000;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 4000;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
    );
    scene.add(this.stars);
  }

  /** Scales the sky's HDR output so bloom only catches the sun disc. */
  readonly skyGain = { value: 0.45 };
  private static addSkyGain(sky: Sky, gain: { value: number }) {
    const m = sky.material as THREE.ShaderMaterial;
    m.uniforms.uSkyGain = gain;
    m.fragmentShader = m.fragmentShader
      .replace('void main() {', 'uniform float uSkyGain;\nvoid main() {')
      .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * uSkyGain, 1.0 );');
    m.needsUpdate = true;
  }

  setShadowQuality(size: number, enabled: boolean) {
    this.sun.castShadow = enabled;
    if (size !== this.shadowSize) {
      this.shadowSize = size;
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  get sunElevation() {
    // sunrise 6:00, sunset 19:00
    const t = (this.hour - 6) / 13;
    return Math.sin(clamp(t, -0.5, 1.5) * Math.PI);
  }

  update(dt: number, focus: THREE.Vector3) {
    this.hour = (this.hour + dt / this.secondsPerHour) % 24;
    const e = this.sunElevation; // -1..1
    const elevDeg = e * 62;
    // east at sunrise, south (+Z) at noon, west at sunset
    const az = Math.PI / 2 - ((this.hour - 6) / 13) * Math.PI;
    const phi = THREE.MathUtils.degToRad(90 - elevDeg);
    this.sunDir.setFromSphericalCoords(1, phi, az);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);

    this.night = 1 - smoothstep(-0.12, 0.12, e);
    const dusk = (1 - Math.abs(smoothstep(-0.1, 0.35, e) * 2 - 1)) * (1 - this.night * 0.6);

    // fog
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(DAY_FOG).lerp(DUSK_FOG, dusk * 0.7).lerp(NIGHT_FOG, this.night);
    fog.near = lerp(220, 70, this.night);
    fog.far = lerp(1900, 800, this.night);
    this.renderer.setClearColor(fog.color);

    // sky exposure at night
    this.sky.material.uniforms.rayleigh.value = lerp(1.4, 0.3, this.night);
    this.sky.visible = this.night < 0.97;
    (this.stars.material as THREE.PointsMaterial).opacity = smoothstep(0.5, 1, this.night);
    this.stars.position.copy(focus);

    // main light: sun by day, moon at night
    const lightDir = this.night > 0.5 ? new THREE.Vector3(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z).normalize() : this.sunDir;
    this.sun.position.copy(focus).addScaledVector(lightDir, 300);
    this.sun.target.position.copy(focus);
    if (this.night > 0.5) {
      this.sun.color.copy(MOON);
      this.sun.intensity = 0.55 * smoothstep(0.5, 1, this.night);
    } else {
      this.sun.color.copy(SUN_WHITE).lerp(SUN_WARM, clamp(1 - e * 2.2, 0, 1));
      this.sun.intensity = 2.7 * smoothstep(-0.02, 0.25, e);
    }
    // snap shadow camera to texels to avoid shimmering
    const texel = 180 / this.shadowSize;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.x = this.sun.target.position.x + lightDir.x * 300;
    this.sun.position.z = this.sun.target.position.z + lightDir.z * 300;

    this.hemi.color.copy(DAY_HEMI_SKY).lerp(NIGHT_HEMI_SKY, this.night);
    this.hemi.groundColor.copy(DAY_HEMI_GROUND).lerp(NIGHT_HEMI_GROUND, this.night);
    this.hemi.intensity = lerp(0.7, 0.5, this.night);

    // regenerate reflections when the sun moved noticeably
    if (Math.abs(elevDeg - this.lastEnvElev) > 3) {
      this.lastEnvElev = elevDeg;
      this.envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
      this.envSky.material.uniforms.rayleigh.value = this.sky.material.uniforms.rayleigh.value;
      const rt = this.pmrem.fromScene(this.envScene, 0.02);
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    this.scene.environmentIntensity = lerp(1.0, 0.25, this.night);
  }

  dispose() {
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.envSky.geometry.dispose();
    this.envSky.material.dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose();
  }
}
