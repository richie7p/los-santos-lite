import * as THREE from 'three';

export function createRoadTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Dark asphalt base
  ctx.fillStyle = '#1e2026';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle asphalt grain
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }

  // Double yellow center line
  ctx.fillStyle = '#eab308';
  ctx.fillRect(249, 0, 4, 512);
  ctx.fillRect(259, 0, 4, 512);

  // Dashed lane dividers
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let y = 16; y < 512; y += 64) {
    ctx.fillRect(126, y, 4, 34);
    ctx.fillRect(382, y, 4, 34);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export function createBuildingFacadeTexture(
  baseColor: string,
  litColor: string,
  style: 'glass' | 'office' | 'residential' = 'office'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 256, 512);

  const cols = style === 'glass' ? 8 : 6;
  const rows = style === 'glass' ? 18 : 14;
  const padX = 8;
  const padY = 10;
  const cellW = (256 - padX * 2) / cols;
  const cellH = (512 - padY * 2) / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = padX + c * cellW + 3;
      const y = padY + r * cellH + 4;
      const w = cellW - 6;
      const h = cellH - 8;

      const isLit = Math.random() > 0.36;
      if (isLit) {
        ctx.fillStyle = litColor;
      } else {
        ctx.fillStyle = style === 'glass' ? '#0f172a' : '#111827';
      }
      ctx.fillRect(x, y, w, h);

      // Window frame mullion
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createSignTexture(
  title: string,
  subtitle: string,
  bgColor: string,
  accentColor: string
): THREE.CanvasTexture {
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
  ctx.fillText(title, 256, 78);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 22px "Inter", sans-serif';
  ctx.fillText(subtitle, 256, 122);

  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}
