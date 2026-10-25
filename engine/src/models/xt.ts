import { PITCH_LENGTH, PITCH_WIDTH, clamp } from '../geometry';
import type { Vec2 } from '../types';

// Karun Singh's public expected-threat grid (12 columns along the pitch x 8 rows across),
// attacking towards x = 105. Values = probability the possession ends in a goal from that zone.
// Source: https://karun.in/blog/expected-threat.html
const COLS = 12;
const ROWS = 8;
const ROW_A = [0.00638303, 0.00779616, 0.00844854, 0.00977659, 0.01126267, 0.01248344, 0.01473596, 0.0174506, 0.02122129, 0.02756312, 0.03485072, 0.0379259];
const ROW_B = [0.00750072, 0.00878589, 0.00942382, 0.0105949, 0.01214719, 0.0138454, 0.01611813, 0.01870347, 0.02401521, 0.02953272, 0.04066992, 0.04647721];
const ROW_C = [0.0088799, 0.00977745, 0.01001304, 0.01110462, 0.01269174, 0.01429128, 0.01685596, 0.01935132, 0.0241224, 0.02855202, 0.05491138, 0.06442595];
const ROW_D = [0.00941056, 0.01082722, 0.01016549, 0.01132376, 0.01262646, 0.01484598, 0.01689528, 0.0199707, 0.02385149, 0.03511326, 0.10805102, 0.25745362];

/** XT_GRID[row][col]; row 0 = bottom touchline (y = 0), col 0 = own goal line. */
export const XT_GRID: readonly (readonly number[])[] = [ROW_A, ROW_B, ROW_C, ROW_D, ROW_D, ROW_C, ROW_B, ROW_A];

const CELL_W = PITCH_LENGTH / COLS;
const CELL_H = PITCH_WIDTH / ROWS;

/** Raw cell lookup (the classic xT definition). */
export function xtCell(p: Vec2): number {
  const c = clamp(Math.floor(p.x / CELL_W), 0, COLS - 1);
  const r = clamp(Math.floor(p.y / CELL_H), 0, ROWS - 1);
  return XT_GRID[r]![c]!;
}

/** Bilinearly interpolated xT between cell centres — smoother for scoring ghost options. */
export function xt(p: Vec2): number {
  const gx = clamp(p.x / CELL_W - 0.5, 0, COLS - 1);
  const gy = clamp(p.y / CELL_H - 0.5, 0, ROWS - 1);
  const c0 = Math.floor(gx);
  const r0 = Math.floor(gy);
  const c1 = Math.min(c0 + 1, COLS - 1);
  const r1 = Math.min(r0 + 1, ROWS - 1);
  const fx = gx - c0;
  const fy = gy - r0;
  const g = XT_GRID;
  const top = g[r0]![c0]! * (1 - fx) + g[r0]![c1]! * fx;
  const bot = g[r1]![c0]! * (1 - fx) + g[r1]![c1]! * fx;
  return top * (1 - fy) + bot * fy;
}

/** Threat the *opponent* would have if they won the ball at p (p in our attacking frame). */
export function opponentXt(p: Vec2): number {
  return xt({ x: PITCH_LENGTH - p.x, y: PITCH_WIDTH - p.y });
}

/** xT added by moving the ball from a to b. */
export const xtDelta = (a: Vec2, b: Vec2): number => xt(b) - xt(a);
