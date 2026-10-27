import * as THREE from 'three';

const texCache = new Map<string, THREE.CanvasTexture>();

export function createSkyDomeTexture(): THREE.CanvasTexture {
  const hit = texCache.get('sky_dome');
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // California / Los Santos Golden Hour Sunset Gradient
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#0f172a'); // Deep twilight zenith
  grad.addColorStop(0.32, '#1e293b');
  grad.addColorStop(0.46, '#4c1d95'); // Violet dusk band
  grad.addColorStop(0.54, '#be185d'); // Sunset crimson-rose
  grad.addColorStop(0.61, '#f97316'); // Golden orange horizon
  grad.addColorStop(0.67, '#fde047'); // Sunlit horizon glow
  grad.addColorStop(0.72, '#334155'); // Below horizon
  grad.addColorStop(1.0, '#1e293b');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Subtle stars in upper twilight sky
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  for (let i = 0; i < 90; i++) {
    const sx = Math.random() * 512;
    const sy = Math.random() * 165;
    ctx.fillRect(sx, sy, 1.5, 1.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  texCache.set('sky_dome', tex);
  return tex;
}

export function createAsphaltTexture(): THREE.CanvasTexture {
  const hit = texCache.get('asphalt');
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#2d3138';
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 600; i++) {
    ctx.fillStyle =
      i % 2 === 0
        ? `rgba(255,255,255,${0.03 + Math.random() * 0.04})`
        : `rgba(0,0,0,${0.05 + Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set('asphalt', tex);
  return tex;
}

export function createGrassTexture(): THREE.CanvasTexture {
  const hit = texCache.get('grass');
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#36583d';
  ctx.fillRect(0, 0, 256, 256);

  for (let i = 0; i < 450; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#406848' : '#2d4b33';
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(36, 36);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set('grass', tex);
  return tex;
}

export function createBuildingFacadeTexture(
  baseColor: string,
  litColor: string,
  style: 'glass' | 'office' | 'residential' = 'office',
  seed = 1
): THREE.CanvasTexture {
  const key = `facade:${baseColor}:${litColor}:${style}:${seed}`;
  const hit = texCache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 256, 512);

  // Top & bottom architectural shadow bands
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, 0, 256, 18);
  ctx.fillRect(0, 490, 256, 22);

  // Subtle vertical pilasters
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(0, 0, 10, 512);
  ctx.fillRect(246, 0, 10, 512);

  const cols = style === 'glass' ? 6 : 5;
  const rows = style === 'glass' ? 14 : 10;
  const padX = 16;
  const padY = 24;
  const cellW = (256 - padX * 2) / cols;
  const cellH = (512 - padY * 2) / rows;

  let s = seed * 9973;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  for (let r = 0; r < rows; r++) {
    // Horizontal floor slab line
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(0, padY + r * cellH - 2, 256, 3);

    for (let c = 0; c < cols; c++) {
      const x = padX + c * cellW + 4;
      const y = padY + r * cellH + 4;
      const w = cellW - 8;
      const h = cellH - 10;

      const isLit = rand() > 0.32;
      ctx.fillStyle = isLit ? litColor : style === 'glass' ? '#1e293b' : '#18181b';
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
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
  ctx.font = '700 21px "Inter", sans-serif';
  ctx.fillText(subtitle, 256, 122);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}
