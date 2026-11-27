/**
 * Interior mapping for building windows.
 *
 * Every window bay gets a fake room behind the glass: the view ray is traced through a box
 * (side walls, floor, ceiling, back wall) in the bay's tangent space, so rooms show real
 * parallax as the camera moves. Rooms are seeded per bay and per facade, so lights, wall
 * colours, furniture, blinds and curtains never repeat with the texture tiles. At night some
 * rooms are lit (warm homes, cool offices, bright shops) and a few flicker with TV light.
 */
import * as THREE from 'three';

/** Off on the low preset: windows fall back to their flat lit textures (cheaper on weak GPUs). */
export const interiorSettings = { enabled: true };

/** Shared by every interior material; the world updates these once per frame. */
export const interiorUniforms = {
  uNightF: { value: 0 },
  uTimeF: { value: 0 },
};

export const RoomKind = { Office: 0, Home: 1, Shop: 2 } as const;
export type RoomKind = (typeof RoomKind)[keyof typeof RoomKind];

export interface InteriorOptions {
  /** Rooms per UV unit (u, v). */
  cells: [number, number];
  /** Room bay size in meters (width, height). */
  size: [number, number];
  kind: RoomKind;
  /** Where the glass is: the B channel of the metalness (ORM) map, or a separate mask texture (R). */
  mask: 'metalness' | THREE.Texture;
}

const GLSL = /* glsl */ `
uniform vec2 uRoomCells;
uniform vec2 uRoomSize;
uniform float uRoomKind;
uniform float uNightF;
uniform float uTimeF;
varying vec3 vRoomPos;
varying vec3 vRoomNrm;

float roomHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 roomInterior(vec2 uv, vec3 V, vec3 N) {
  vec2 cf = uv * uRoomCells;
  vec2 cell = floor(cf);
  vec2 f = fract(cf);
  vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
  // seed: bay index + which facade plane (so neighbouring buildings and faces differ)
  float plane = floor(dot(vRoomPos, N) * 2.0 + 0.5);
  vec3 id = vec3(cell, plane + N.x * 17.0 + N.z * 43.0);
  float h1 = roomHash(id);
  float h2 = roomHash(id + 7.31);
  float h3 = roomHash(id + 19.17);
  float h4 = roomHash(id + 31.73);
  float h5 = roomHash(id + 47.91);

  // ray in room space (meters): x along the facade, y up, z into the building
  vec3 rd = vec3(dot(V, T), V.y, -dot(V, N));
  rd.x = rd.x >= 0.0 ? max(rd.x, 1e-4) : min(rd.x, -1e-4);
  rd.y = rd.y >= 0.0 ? max(rd.y, 1e-4) : min(rd.y, -1e-4);
  rd.z = max(rd.z, 0.03);
  float depth = uRoomSize.x * mix(0.9, 1.7, h2) + (uRoomKind > 1.5 ? 2.5 : 0.0);
  vec3 size = vec3(uRoomSize, depth);
  vec3 ro = vec3(f * uRoomSize, 0.0);
  vec3 tt = (step(0.0, rd) * size - ro) / rd;
  float t = min(min(tt.x, tt.y), tt.z);
  vec3 q = clamp((ro + rd * t) / size, 0.0, 1.0);
  bool back = tt.z <= tt.x && tt.z <= tt.y;
  bool flr = !back && tt.y <= tt.x && rd.y < 0.0;
  bool ceil = !back && tt.y <= tt.x && rd.y > 0.0;

  // palette
  vec3 wallC;
  vec3 floorC;
  vec3 ceilC = vec3(0.8, 0.79, 0.76);
  if (uRoomKind < 0.5) {
    wallC = mix(vec3(0.74, 0.75, 0.76), vec3(0.6, 0.65, 0.72), h1);
    floorC = mix(vec3(0.17, 0.19, 0.23), vec3(0.33, 0.31, 0.29), h3);
  } else if (uRoomKind < 1.5) {
    wallC = h1 < 0.33 ? vec3(0.8, 0.7, 0.56) : h1 < 0.66 ? vec3(0.6, 0.68, 0.63) : vec3(0.82, 0.77, 0.7);
    floorC = mix(vec3(0.34, 0.2, 0.11), vec3(0.52, 0.38, 0.23), h3);
  } else {
    wallC = mix(vec3(0.7, 0.68, 0.64), vec3(0.62, 0.66, 0.68), h1);
    floorC = mix(vec3(0.5, 0.48, 0.45), vec3(0.36, 0.33, 0.3), h3);
  }

  vec3 col;
  if (back) {
    col = wallC;
    if (uRoomKind > 1.5) {
      if (h1 < 0.4) {
        // convenience store: shelves stocked with goods
        if (q.y < 0.78 && q.x > 0.05 && q.x < 0.95) {
          float shelf = fract(q.y * 4.0);
          vec3 goods = 0.32 + 0.14 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + floor(q.x * 22.0) * 0.137 + floor(q.y * 4.0) * 0.37 + h3));
          col = shelf < 0.16 ? vec3(0.16) : goods * (0.75 + 0.25 * step(0.4, fract(q.x * 66.0)));
        }
      } else if (h1 < 0.72) {
        // cafe: wood panelling, counter and a chalk menu board
        col = mix(vec3(0.36, 0.23, 0.14), vec3(0.46, 0.32, 0.2), step(0.5, fract(q.x * 9.0)));
        if (q.y < 0.27) col = vec3(0.15, 0.1, 0.08);
        else if (q.y > 0.46 && q.y < 0.74 && q.x > 0.18 && q.x < 0.82) col = vec3(0.06, 0.08, 0.07) + step(0.8, fract(q.y * 15.0)) * step(0.35, fract(q.x * 7.0 + q.y * 3.0)) * 0.45;
      } else {
        // boutique: garments on a rail
        col = vec3(0.8, 0.78, 0.75);
        if (q.y > 0.3 && q.y < 0.62 && fract(q.x * 6.0) < 0.78) col = 0.3 + 0.22 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + floor(q.x * 30.0) * 0.31 + h3));
        if (abs(q.y - 0.635) < 0.012) col = vec3(0.55);
      }
    } else {
      float fx0 = 0.08 + h4 * 0.35;
      float fx1 = fx0 + 0.28 + h5 * 0.3;
      float fh = uRoomKind < 0.5 ? 0.3 : 0.26 + h5 * 0.14;
      if (q.x > fx0 && q.x < fx1 && q.y < fh) col = uRoomKind < 0.5 ? vec3(0.19, 0.2, 0.23) : mix(vec3(0.38, 0.17, 0.14), vec3(0.18, 0.27, 0.4), h3);
      else if (h3 > 0.45 && abs(q.x - 0.5 - (h4 - 0.5) * 0.3) < 0.13 && abs(q.y - 0.6) < 0.1)
        col = uRoomKind < 0.5 ? vec3(0.08, 0.1, 0.14) : 0.25 + 0.5 * vec3(h1, h4, h5);
    }
  } else if (flr) {
    col = floorC;
    // shop aisles: rows of shelving seen from above
    if (uRoomKind > 1.5) {
      if (h1 < 0.4 && abs(fract(q.x * 2.0 + h2) - 0.5) < 0.16 && q.z > 0.25 && q.z < 0.85) col = vec3(0.2, 0.2, 0.22);
      else if (h1 >= 0.4 && h1 < 0.72) {
        col = vec3(0.3, 0.2, 0.13);
        if (length(fract(q.xz * vec2(2.5, 3.0)) - 0.5) < 0.2 && q.z < 0.78) col = vec3(0.12, 0.08, 0.06);
      }
    }
    // rug / desk footprint
    if (uRoomKind > 0.5 && uRoomKind < 1.5 && h2 > 0.4 && abs(q.x - 0.5) < 0.28 && abs(q.z - 0.55) < 0.22) col = mix(vec3(0.55, 0.2, 0.18), vec3(0.25, 0.32, 0.45), h4);
    if (uRoomKind < 0.5 && abs(q.z - 0.5) < 0.12) col *= 0.55;
  } else if (ceil) {
    col = ceilC;
  } else {
    col = wallC * 0.8;
    if (uRoomKind > 1.5 && h1 < 0.4 && q.y < 0.75 && q.z > 0.08) {
      float shelf = fract(q.y * 4.0);
      vec3 goods = 0.32 + 0.14 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + floor(q.z * 16.0) * 0.21 + floor(q.y * 4.0) * 0.29 + h3));
      col = shelf < 0.16 ? vec3(0.16) : goods;
    } else if (uRoomKind > 1.5 && h1 >= 0.4 && h1 < 0.72) {
      col = mix(vec3(0.3, 0.19, 0.12), vec3(0.4, 0.27, 0.17), step(0.5, fract(q.z * 8.0)));
    }
    if (uRoomKind < 1.5 && h5 > 0.5 && q.z > 0.5 && q.z < 0.82 && q.y < 0.72) col = vec3(0.32, 0.23, 0.16);
  }

  // lighting: daylight from the window falls off into the room; lamps at night
  float dayL = (uRoomKind > 1.5 ? 0.3 : uRoomKind < 0.5 ? 0.16 : 0.13) * mix(1.0, 0.45, q.z);
  float litP = uRoomKind < 0.5 ? 0.5 : uRoomKind < 1.5 ? 0.55 : 1.0;
  float lit = h4 < litP ? 1.0 : 0.0;
  vec3 lampC = uRoomKind < 0.5 ? vec3(0.86, 0.93, 1.0) : uRoomKind < 1.5 ? (h1 > 0.5 ? vec3(1.0, 0.76, 0.48) : vec3(1.0, 0.86, 0.66)) : (h1 >= 0.4 && h1 < 0.72 ? vec3(1.0, 0.72, 0.45) : vec3(1.0, 0.96, 0.9));
  float fall = 0.62 + 0.38 * clamp(1.0 - length(q.xz - 0.5) * 1.3, 0.0, 1.0);
  float night = uNightF;
  float lampI = uRoomKind < 0.5 ? 0.7 : uRoomKind < 1.5 ? 0.8 : 0.85;
  vec3 light = vec3(dayL) * (1.0 - night) + lampC * (lit * lampI * fall) * night + 0.008;
  if (ceil) {
    bool panel = uRoomKind > 1.5 ? (fract(q.x * 3.0) < 0.22 && fract(q.z * 3.0) < 0.3) : (abs(q.x - 0.5) < 0.2 && abs(q.z - 0.45) < 0.15);
    if (panel) light += lampC * (lit * night * 1.1 + (uRoomKind > 1.5 ? 0.7 : 0.0));
  }
  if (uRoomKind > 0.5 && uRoomKind < 1.5 && lit < 0.5 && h2 > 0.72) {
    float flick = 0.35 + 0.25 * sin(uTimeF * 9.0 + h1 * 40.0) * sin(uTimeF * 2.3 + h3 * 20.0);
    light += vec3(0.22, 0.36, 0.85) * flick * night;
  }
  vec3 outc = col * light;

  // blinds (offices) and curtains (homes) just behind the glass
  if (uRoomKind < 0.5 && h5 < 0.3) {
    float cover = 0.25 + h3 * 0.6;
    if (f.y > 1.0 - cover) {
      float slat = step(0.45, fract(f.y * uRoomSize.y * 9.0));
      outc = vec3(0.74, 0.73, 0.69) * (0.6 + 0.4 * slat) * (dayL * 1.6 * (1.0 - night) + lit * night * 0.7 * lampC + 0.012);
    }
  } else if (uRoomKind > 0.5 && uRoomKind < 1.5 && h5 < 0.45) {
    float cw = 0.12 + h3 * 0.2;
    if (f.x < cw || f.x > 1.0 - cw) {
      vec3 cc = mix(vec3(0.72, 0.26, 0.2), vec3(0.86, 0.8, 0.66), h2);
      outc = cc * (dayL * 1.4 * (1.0 - night) + lit * night * 0.8 * lampC + 0.01) * (0.82 + 0.18 * sin(f.x * 70.0));
    }
  }
  // seen through tinted glass
  outc *= uRoomKind < 0.5 ? vec3(0.8, 0.88, 0.93) : uRoomKind < 1.5 ? vec3(0.9, 0.93, 0.95) : vec3(0.95);
  return outc;
}
`;

/** Adds interior mapping to a MeshStandardMaterial whose glass is marked by `opts.mask`. */
export function addInteriors(mat: THREE.MeshStandardMaterial, opts: InteriorOptions) {
  const own = {
    uRoomCells: { value: new THREE.Vector2(...opts.cells) },
    uRoomSize: { value: new THREE.Vector2(...opts.size) },
    uRoomKind: { value: opts.kind as number },
    uGlassMask: { value: opts.mask === 'metalness' ? null : opts.mask },
  };
  const useMaskTex = opts.mask !== 'metalness';
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    if (!interiorSettings.enabled) return;
    Object.assign(sh.uniforms, interiorUniforms, own);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoomPos;\nvarying vec3 vRoomNrm;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRoomPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRoomNrm = normalize(mat3(modelMatrix) * objectNormal);',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${useMaskTex ? 'uniform sampler2D uGlassMask;' : ''}\n${GLSL}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float glassMask = ${useMaskTex ? 'texture2D(uGlassMask, vMapUv).r' : 'smoothstep(0.36, 0.44, texelMetalness.b)'};
          if (glassMask > 0.01) {
            vec3 Vw = normalize(vRoomPos - cameraPosition);
            vec3 Nw = normalize(vRoomNrm);
            vec3 room = roomInterior(vMapUv, Vw, Nw);
            float cosT = clamp(dot(-Vw, Nw), 0.0, 1.0);
            float fres = pow(1.0 - cosT, 4.0);
            totalEmissiveRadiance = mix(totalEmissiveRadiance, room * (1.0 - fres * 0.85), glassMask);
          }
        }`,
      );
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `interiors-${interiorSettings.enabled ? 1 : 0}-${useMaskTex ? 1 : 0}-${prevKey ? prevKey() : ''}`;
  mat.needsUpdate = true;
}
