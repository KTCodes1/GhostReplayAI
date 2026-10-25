// Real-time player tags: a name tag pops up when a player hits a threshold — a sprint (top speed
// in the freeze frame) or a distance milestone (when they lead the match for ground covered).
// Shared by the overlay cue builder (server) and the on-pitch tags (client), so both agree.

import { toAbsolute } from '../geometry';
import type { MatchEvent, MatchMeta } from '../types';

export type PlayerAlert = { playerId: string; kind: 'sprint' | 'distance'; value: number; text: string; clockMs: number };

/** 7.4 m/s ≈ 27 km/h: the top 1% of running speeds in this engine's movement model. */
export const SPRINT_MS = 7.4;
const SPRINT_COOLDOWN_PLAYER_MS = 10 * 60_000;
const SPRINT_COOLDOWN_ANY_MS = 3 * 60_000;
const DISTANCE_MILESTONES_KM = [3, 6, 9, 12];
const LAYOUT = new Set(['pass', 'carry', 'shot', 'kickoff']);

export class PlayerTracker {
  private names = new Map<string, string>();
  private distance = new Map<string, number>(); // metres
  private prev: Map<string, { x: number; y: number }> | undefined;
  private lastSprint = new Map<string, number>();
  private lastAnySprint = -Infinity;
  private milestone = 0; // index into DISTANCE_MILESTONES_KM

  constructor(meta: MatchMeta) {
    for (const s of ['home', 'away'] as const) for (const p of meta[s].players) this.names.set(p.id, p.shortName);
  }

  /** Feed every event in order; returns any tags to show now. */
  push(e: MatchEvent): PlayerAlert[] {
    const out: PlayerAlert[] = [];
    if (!LAYOUT.has(e.type)) return out;
    const frame = new Map(e.freezeFrame.map((f) => [f.playerId, toAbsolute(f.pos, e.team)]));
    if (this.prev && e.type !== 'kickoff')
      for (const [id, p] of frame) {
        const q = this.prev.get(id);
        if (q) this.distance.set(id, (this.distance.get(id) ?? 0) + Math.hypot(p.x - q.x, p.y - q.y));
      }
    this.prev = frame;

    // Sprint: the fastest player in the frame, if over the threshold and not tagged recently.
    if (e.t - this.lastAnySprint >= SPRINT_COOLDOWN_ANY_MS) {
      const fastest = e.freezeFrame
        .map((f) => ({ id: f.playerId, v: f.vel ? Math.hypot(f.vel.x, f.vel.y) : 0 }))
        .filter((x) => x.v >= SPRINT_MS && e.t - (this.lastSprint.get(x.id) ?? -Infinity) >= SPRINT_COOLDOWN_PLAYER_MS)
        .sort((a, b) => b.v - a.v)[0];
      if (fastest) {
        const kmh = Math.round(fastest.v * 3.6);
        this.lastSprint.set(fastest.id, e.t);
        this.lastAnySprint = e.t;
        out.push({ playerId: fastest.id, kind: 'sprint', value: kmh, text: `${this.names.get(fastest.id)} · ${kmh} km/h`, clockMs: e.clockMs });
      }
    }

    // Distance: when the match leader passes the next milestone.
    const km = DISTANCE_MILESTONES_KM[this.milestone];
    if (km !== undefined) {
      const [leader, metres] = [...this.distance.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
      if (leader && metres !== undefined && metres >= km * 1000) {
        this.milestone += 1;
        out.push({ playerId: leader, kind: 'distance', value: +(metres / 1000).toFixed(1), text: `${this.names.get(leader)} · ${(metres / 1000).toFixed(1)} km covered, most on the pitch`, clockMs: e.clockMs });
      }
    }
    return out;
  }

  distanceKm(playerId: string): number {
    return (this.distance.get(playerId) ?? 0) / 1000;
  }
}
