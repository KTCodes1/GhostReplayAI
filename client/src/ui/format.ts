import type { GhostOption, MatchMeta, PlayerInfo } from '@ghost/engine';
import { kitColors } from '../pitch/coords';

export const clock = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
};
/** 63:12.4 — the frozen frame's exact time. */
export const clockTenths = (ms: number) => `${clock(ms)}.${Math.floor((ms % 1000) / 100)}`;
export const minute = (ms: number) => `${Math.floor(ms / 60000) + 1}'`;
export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const signed = (v: number, digits = 3) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;

function luminance(rgb: number[]) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** A club colour that still reads as a bar on the dark console: very dark kits are lifted towards white. */
export function onDark(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  let rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let t = 0.08; luminance(rgb) < 0.11 && t <= 0.6; t += 0.04) {
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c * (1 + t * 3) + 255 * t * 0.25)).map((c) => Math.min(255, c));
  }
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The colour a team is drawn in everywhere in the UI: its kit on the pitch, lifted for dark backgrounds. */
export const teamColor = (meta: MatchMeta, side: 'home' | 'away') => onDark(kitColors(meta)[side].main);

/** Display name of the AI behind a piece of text. */
export const providerName = (source: 'azure' | 'template') => (source === 'azure' ? 'Azure OpenAI' : 'Template');

export function playerLookup(meta?: MatchMeta): (id?: string) => PlayerInfo | undefined {
  const map = new Map(meta ? [...meta.home.players, ...meta.away.players].map((p) => [p.id, p]) : []);
  return (id) => (id ? map.get(id) : undefined);
}

/** "chose …": to shoot / to drive forward / a pass to X. */
export function choicePhrase(o: GhostOption, name: (id?: string) => string): string {
  return o.action === 'shot' ? 'to shoot' : o.action === 'carry' ? 'to drive forward' : `a pass to ${name(o.targetPlayerId)}`;
}

/** "… was on": a shot / a run forward / a pass to X. */
export function optionPhrase(o: GhostOption, name: (id?: string) => string): string {
  return o.action === 'shot' ? 'a shot' : o.action === 'carry' ? 'a run forward' : `a pass to ${name(o.targetPlayerId)}`;
}

/** Save data as a pretty-printed JSON file. */
export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
