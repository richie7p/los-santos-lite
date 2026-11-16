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
const RAIN_FOG = new THREE.Color(0x7c8794);
const RAIN_HEMI = new THREE.Color(0x9aa4b0);
const RAIN_BOX = 70;
const RAIN_H = 34;
const wrap = (v: number, size: number) => ((((v + size / 2) % size) + size) % size) - size / 2;

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
  /** Current rain amount 0..1 (smoothly approaches rainTarget). */
  rain = 0;
  rainTarget = 0;
  /** Game hours until the weather rolls again. */
  private weatherHours = 3;
  /** Lightning flash brightness (decays). */
  flash = 0;
  private flashCd = 6;
  onThunder?: (delay: number) => void;
  readonly rainLines: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainSeed: Float32Array;
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

    // rain streaks that follow the camera
    const N = 2600;
    this.rainPos = new Float32Array(N * 6);
    this.rainSeed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.rainSeed[i * 3] = Math.random() * RAIN_BOX - RAIN_BOX / 2;
      this.rainSeed[i * 3 + 1] = Math.random() * RAIN_H;
      this.rainSeed[i * 3 + 2] = Math.random() * RAIN_BOX - RAIN_BOX / 2;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainLines = new THREE.LineSegments(
      rg,
      new THREE.LineBasicMaterial({ color: 0xb8c4d2, transparent: true, opacity: 0, depthWrite: false, fog: false }),
    );
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    scene.add(this.rainLines);
  }

  /** Force a weather state (0 clear .. 1 storm). */
  setWeather(rain: number, instant = false) {
    this.rainTarget = rain;
    this.weatherHours = 4 + Math.random() * 4;
    if (instant) this.rain = rain;
  }

  private updateWeather(dt: number, cam: THREE.Vector3) {
    this.weatherHours -= dt / this.secondsPerHour;
    if (this.weatherHours <= 0) {
      const roll = Math.random();
      this.rainTarget = roll < 0.62 ? 0 : roll < 0.85 ? 0.55 : 1;
      this.weatherHours = this.rainTarget > 0 ? 1.5 + Math.random() * 3 : 4 + Math.random() * 6;
    }
    this.rain += (this.rainTarget - this.rain) * Math.min(1, dt * 0.08);
    if (Math.abs(this.rain - this.rainTarget) < 0.002) this.rain = this.rainTarget;
    const r = this.rain;
    // streaks
    const lines = this.rainLines;
    lines.visible = r > 0.02;
    (lines.material as THREE.LineBasicMaterial).opacity = r * (0.32 + this.night * 0.1);
    if (lines.visible) {
      const n = this.rainSeed.length / 3;
      const active = Math.floor(n * Math.min(1, 0.25 + r));
      const fall = 26;
      const t = performance.now() / 1000;
      const windX = 3.5;
      for (let i = 0; i < n; i++) {
        const o = i * 6;
        if (i >= active) {
          this.rainPos.fill(0, o, o + 6);
          continue;
        }
        const sx = this.rainSeed[i * 3];
        const sy = this.rainSeed[i * 3 + 1];
        const sz = this.rainSeed[i * 3 + 2];
        const y = RAIN_H - ((sy + t * fall) % RAIN_H);
        // wrap the column around the camera so it never runs out
        const x = cam.x + wrap(sx - cam.x + (RAIN_H - y) * (windX / fall), RAIN_BOX);
        const z = cam.z + wrap(sz - cam.z, RAIN_BOX);
        const yy = cam.y - 12 + y;
        this.rainPos[o] = x;
        this.rainPos[o + 1] = yy;
        this.rainPos[o + 2] = z;
        this.rainPos[o + 3] = x - windX * 0.035;
        this.rainPos[o + 4] = yy + 0.9;
        this.rainPos[o + 5] = z;
      }
      lines.geometry.attributes.position.needsUpdate = true;
    }
    // lightning in heavy rain
    this.flash = Math.max(0, this.flash - dt * 4);
    if (r > 0.75) {
      this.flashCd -= dt;
      if (this.flashCd <= 0) {
        this.flashCd = 8 + Math.random() * 18;
        this.flash = 1;
        this.onThunder?.(0.4 + Math.random() * 2);
      }
    }
  }

  /** Scales the sky's HDR output so bloom only catches the sun disc. */
  readonly skyGain = { value: 0.45 };
  private static overcast = { value: 0 };
  private static addSkyGain(sky: Sky, gain: { value: number }) {
    const m = sky.material as THREE.ShaderMaterial;
    m.uniforms.uSkyGain = gain;
    m.uniforms.uOvercast = Environment.overcast;
    m.fragmentShader = m.fragmentShader
      .replace('void main() {', 'uniform float uSkyGain;\nuniform float uOvercast;\nvoid main() {')
      .replace(
        'gl_FragColor = vec4( retColor, 1.0 );',
        'vec3 grey = vec3(dot(retColor, vec3(0.3, 0.59, 0.11))) * vec3(0.92, 0.95, 1.0);\n\t\t\tgl_FragColor = vec4( mix(retColor, grey, uOvercast) * uSkyGain, 1.0 );',
      );
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
    this.updateWeather(dt, focus);
    const r = this.rain;
    this.skyGain.value = 0.45 * (1 - 0.6 * r) + this.flash * 0.6;
    this.sky.material.uniforms.turbidity.value = lerp(2.5, 12, r);
    Environment.overcast.value = Math.min(1, r * 1.1);
    const dusk = (1 - Math.abs(smoothstep(-0.1, 0.35, e) * 2 - 1)) * (1 - this.night * 0.6);

    // fog
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(DAY_FOG).lerp(DUSK_FOG, dusk * 0.7 * (1 - r)).lerp(RAIN_FOG, r * 0.85).lerp(NIGHT_FOG, this.night);
    fog.near = lerp(lerp(220, 70, this.night), 25, r * 0.8);
    fog.far = lerp(lerp(1900, 800, this.night), 520, r);
    this.renderer.setClearColor(fog.color);

    // sky exposure at night
    this.sky.material.uniforms.rayleigh.value = lerp(1.4, 0.3, this.night);
    this.sky.visible = this.night < 0.97;
    (this.stars.material as THREE.PointsMaterial).opacity = smoothstep(0.5, 1, this.night) * (1 - r);
    this.stars.position.copy(focus);

    // main light: sun by day, moon at night
    const lightDir = this.night > 0.5 ? new THREE.Vector3(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z).normalize() : this.sunDir;
    this.sun.position.copy(focus).addScaledVector(lightDir, 300);
    this.sun.target.position.copy(focus);
    if (this.night > 0.5) {
      this.sun.color.copy(MOON);
      this.sun.intensity = 0.55 * smoothstep(0.5, 1, this.night) * (1 - r * 0.7);
    } else {
      this.sun.color.copy(SUN_WHITE).lerp(SUN_WARM, clamp(1 - e * 2.2, 0, 1));
      this.sun.intensity = 2.7 * smoothstep(-0.02, 0.25, e) * (1 - r * 0.78);
    }
    // snap shadow camera to texels to avoid shimmering
    const texel = 180 / this.shadowSize;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.x = this.sun.target.position.x + lightDir.x * 300;
    this.sun.position.z = this.sun.target.position.z + lightDir.z * 300;

    this.hemi.color.copy(DAY_HEMI_SKY).lerp(NIGHT_HEMI_SKY, this.night);
    this.hemi.groundColor.copy(DAY_HEMI_GROUND).lerp(NIGHT_HEMI_GROUND, this.night);
    this.hemi.color.lerp(RAIN_HEMI, r * 0.6 * (1 - this.night));
    this.hemi.intensity = lerp(0.7, 0.8, this.night) + this.flash * 2.5;

    // regenerate reflections when the sun moved noticeably
    const envKey = elevDeg + Math.round(r * 10) * 100;
    if (Math.abs(envKey - this.lastEnvElev) > 3) {
      this.lastEnvElev = envKey;
      this.envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
      this.envSky.material.uniforms.rayleigh.value = this.sky.material.uniforms.rayleigh.value;
      const rt = this.pmrem.fromScene(this.envScene, 0.02);
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    this.scene.environmentIntensity = lerp(1.0, 0.25, this.night) * (1 - r * 0.35);
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
    this.rainLines.geometry.dispose();
    (this.rainLines.material as THREE.Material).dispose();
  }
}
