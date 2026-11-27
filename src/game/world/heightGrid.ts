/** Sampled terrain heights shared by the terrain mesh and the map (computed once, lazily). */
import { WORLD_HALF, terrainHeight } from './layout';

export const GRID_STEP = 6.25;
export const GRID_RES = Math.round((WORLD_HALF * 2) / GRID_STEP); // cells per side
export const GRID_SAMPLES = GRID_RES + 1;

let grid: Float32Array | null = null;

export function heightGrid() {
  if (grid) return grid;
  grid = new Float32Array(GRID_SAMPLES * GRID_SAMPLES);
  for (let j = 0; j < GRID_SAMPLES; j++) {
    const z = -WORLD_HALF + j * GRID_STEP;
    for (let i = 0; i < GRID_SAMPLES; i++) grid[j * GRID_SAMPLES + i] = terrainHeight(-WORLD_HALF + i * GRID_STEP, z);
  }
  return grid;
}

/** Height at grid indices (clamped). */
export function gridAt(i: number, j: number) {
  const g = heightGrid();
  i = Math.max(0, Math.min(GRID_RES, i));
  j = Math.max(0, Math.min(GRID_RES, j));
  return g[j * GRID_SAMPLES + i];
}
