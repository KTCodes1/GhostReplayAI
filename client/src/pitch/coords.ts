import type { MatchMeta, Side, Vec2 } from '@ghost/engine';

/** Pitch metres (absolute frame, origin bottom-left) -> three.js world (y up, pitch centred at origin). */
export const toWorld = (p: Vec2, h = 0): [number, number, number] => [p.x - 52.5, h, 34 - p.y];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const colorDistance = (a: string, b: string) => {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};

/** On-screen replacements for kit colours that read poorly on the dark console (club id -> primary). */
const DISPLAY_PRIMARY: Record<string, string> = {
  rva: '#e8622c', // Riverton's claret is lost on the dark pitch; red-orange keeps it warm but visible
};

/** Kit colours for the match; the away side switches to its secondary colour on a clash. */
export function kitColors(meta: MatchMeta): Record<Side, { main: string; trim: string }> {
  const primary = (s: Side) => DISPLAY_PRIMARY[meta[s].id] ?? meta[s].colors.primary;
  const home = { main: primary('home'), trim: meta.home.colors.secondary };
  let away = { main: primary('away'), trim: meta.away.colors.secondary };
  if (colorDistance(home.main, away.main) < 120) away = { main: away.trim, trim: away.main };
  return { home, away };
}
