import * as THREE from 'three';

export interface WorldTextures {
  glass: THREE.Texture;
  apt: THREE.Texture;
  street: THREE.Texture;
  industrial: THREE.Texture;
  civic: THREE.Texture;
  asphalt: THREE.Texture;
  sidewalk: THREE.Texture;
  grass: THREE.Texture;
  roof: THREE.Texture;
  sky: THREE.Texture;
}

const texCache = new Map<string, THREE.CanvasTexture>();

function loadPhotoTex(url: string, tile: boolean): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.wrapS = t.wrapT = tile ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        t.repeat.set(1, 1);
        t.needsUpdate = true;
        resolve(t);
      },
      undefined,
      () => reject(new Error(url))
    );
  });
}

export async function loadWorldTextures(): Promise<WorldTextures | null> {
  try {
    const [glass, apt, street, industrial, civic, asphalt, sidewalk, grass, roof, sky] =
      await Promise.all([
        loadPhotoTex('./textures/facade-glass.jpg', false),
        loadPhotoTex('./textures/facade-apt.jpg', true),
        loadPhotoTex('./textures/facade-street.jpg', true),
        loadPhotoTex('./textures/facade-industrial.jpg', true),
        loadPhotoTex('./textures/facade-civic.jpg', false),
        loadPhotoTex('./textures/asphalt.jpg', true),
        loadPhotoTex('./textures/sidewalk.jpg', true),
        loadPhotoTex('./textures/grass.jpg', true),
        loadPhotoTex('./textures/roof.jpg', true),
        loadPhotoTex('./textures/sky.jpg', false),
      ]);
    return { glass, apt, street, industrial, civic, asphalt, sidewalk, grass, roof, sky };
  } catch {
    return null;
  }
}

export function tileBoxUVs(
  geo: THREE.BoxGeometry,
  sx: number,
  sy: number,
  sz: number,
  tile: number
) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  const faces: Array<[number, number]> = [
    [sz / tile, sy / tile],
    [sz / tile, sy / tile],
    [sx / tile, sz / tile],
    [sx / tile, sz / tile],
    [sx / tile, sy / tile],
    [sx / tile, sy / tile],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faces[f]!;
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  uv.needsUpdate = true;
}

export function scaleFacadeUVs(geo: THREE.BoxGeometry, w: number, h: number, d: number) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  const su = (len: number) => (len > 18 ? 2 : 1);
  const sv = h > 22 ? 2 : 1;
  const roofU = Math.max(1.2, w / 9);
  const roofV = Math.max(1.2, d / 9);
  const scales: Array<[number, number]> = [
    [su(d), sv],
    [su(d), sv],
    [roofU, roofV],
    [roofU, roofV],
    [su(w), sv],
    [su(w), sv],
  ];
  for (let f = 0; f < 6; f++) {
    const [u, v] = scales[f]!;
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * u, uv.getY(idx) * v);
    }
  }
  uv.needsUpdate = true;
}

export function tilePlaneUVs(
  geo: THREE.PlaneGeometry,
  worldU: number,
  worldV: number,
  tile: number
) {
  const uv = geo.attributes.uv;
  if (!uv) return;
  const su = worldU / tile;
  const sv = worldV / tile;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}

export function createSignTexture(
  title: string,
  subtitle: string,
  bgColor: string,
  accentColor: string
): THREE.CanvasTexture {
  const key = `sign:${title}:${subtitle}:${bgColor}:${accentColor}`;
  const hit = texCache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 512, 160);

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 144);

  ctx.fillStyle = accentColor;
  ctx.font = '900 44px "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 76);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 20px "Inter", sans-serif';
  ctx.fillText(subtitle, 256, 122);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}
