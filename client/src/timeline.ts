// Playback timeline: turns the stream of event snapshots into continuous motion.
// Players follow a smooth (cubic Hermite) curve through their snapshot positions; the ball
// flies along each pass/shot at its real speed, then rolls to where the next action starts.

import { type MatchEvent, type Vec2, dist, toAbsolute } from '@ghost/engine';

/** Events where the engine laid out all 22 players afresh (other events reuse a stale frame). */
const LAYOUT_TYPES = new Set(['pass', 'carry', 'shot', 'kickoff']);
/** Events that say where the ball is. */
const BALL_TYPES = new Set(['pass', 'carry', 'shot', 'kickoff', 'interception', 'tackle', 'possession_change', 'foul']);

type Frame = { pt: number; pos: Map<string, Vec2> };
type BallKey = { pt: number; start: Vec2; end?: Vec2; flightMs: number; lofted: boolean; holder: string };
/** A player winning the ball (interception, tackle, keeper collecting): only their own position is fresh. */
type Take = { pt: number; id: string; pos: Vec2 };
/** Restarts teleport the taker (goal kick, throw-in...): not something to animate as a run to the ball. */
const TAKE_CONTEXTS = new Set([undefined, 'keeper_save']);
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export type View = { positions: Map<string, Vec2>; ball: { x: number; y: number; h: number }; holder?: string };

function upperIndex<T extends { pt: number }>(arr: T[], pt: number): number {
  // first index with arr[i].pt > pt
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]!.pt <= pt) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class Timeline {
  private frames: Frame[] = [];
  private balls: BallKey[] = [];
  private takes: Take[] = [];
  lastPt = -Infinity;
  firstPt = Infinity;

  add(e: MatchEvent, pt: number) {
    this.lastPt = Math.max(this.lastPt, pt);
    this.firstPt = Math.min(this.firstPt, pt);
    if (LAYOUT_TYPES.has(e.type)) {
      const pos = new Map<string, Vec2>();
      for (const s of e.freezeFrame) pos.set(s.playerId, toAbsolute(s.pos, e.team));
      this.frames.push({ pt, pos });
    }
    if (BALL_TYPES.has(e.type)) {
      let start = toAbsolute(e.start, e.team);
      const prevBall = this.balls[this.balls.length - 1];
      // A keeper's save: they hold it where the shot met them.
      if (e.context === 'keeper_save' && prevBall?.end) start = prevBall.end;
      const won = e.type === 'interception' || (e.type === 'tackle' && e.outcome === 'success') || (e.type === 'possession_change' && TAKE_CONTEXTS.has(e.context));
      if (won) this.takes.push({ pt, id: e.playerId, pos: start });
      const end = e.end && e.type !== 'kickoff' ? toAbsolute(e.end, e.team) : undefined;
      const d = end ? dist(start, end) : 0;
      const speed = e.type === 'carry' ? 5.5 : e.ballSpeed ?? 15;
      const holder = e.type === 'pass' && e.outcome === 'success' && e.targetPlayerId ? e.targetPlayerId : e.playerId;
      this.balls.push({ pt, start, end, flightMs: end ? (d / speed) * 1000 : 0, lofted: e.type === 'pass' && d > 30, holder });
    }
  }

  get length() {
    return this.frames.length;
  }

  sample(pt: number): View {
    return { positions: this.samplePlayers(pt), ...this.sampleBall(pt) };
  }

  private samplePlayers(pt: number): Map<string, Vec2> {
    const out = this.sampleFrames(pt);
    // Pull whoever won the ball onto it, easing in from the frame before and out to the frame after.
    const k = upperIndex(this.takes, pt);
    for (const t of [this.takes[k - 1], this.takes[k]]) {
      const base = t && out.get(t.id);
      if (!t || !base) continue;
      const fi = upperIndex(this.frames, t.pt - 1);
      const from = this.frames[fi - 1]?.pt ?? t.pt - 1000;
      const to = this.frames[fi]?.pt;
      let w = 0;
      if (pt <= t.pt) w = pt >= from ? smooth((pt - from) / Math.max(1, t.pt - from)) : 0;
      else w = to === undefined ? 1 : pt < to ? smooth(1 - (pt - t.pt) / Math.max(1, to - t.pt)) : 0;
      if (w > 0) out.set(t.id, { x: base.x + (t.pos.x - base.x) * w, y: base.y + (t.pos.y - base.y) * w });
    }
    return out;
  }

  private sampleFrames(pt: number): Map<string, Vec2> {
    const f = this.frames;
    const out = new Map<string, Vec2>();
    if (!f.length) return out;
    if (f.length === 1 || !(pt > f[0]!.pt)) {
      for (const [id, p] of f[0]!.pos) out.set(id, p);
      return out;
    }
    const i1 = Math.min(Math.max(upperIndex(f, pt), 1), f.length - 1);
    const i0 = i1 - 1;
    const a = f[i0]!;
    const b = f[i1]!;
    if (pt >= b.pt) {
      for (const [id, p] of b.pos) out.set(id, p);
      return out;
    }
    const prev = f[i0 - 1];
    const next = f[i1 + 1];
    const span = b.pt - a.pt;
    const u = (pt - a.pt) / span;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    for (const [id, p1] of a.pos) {
      const p2 = b.pos.get(id) ?? p1;
      const p0 = prev?.pos.get(id);
      const p3 = next?.pos.get(id);
      // Tangents (metres per ms) from neighbouring snapshots, scaled to this segment.
      const m1x = p0 ? (p2.x - p0.x) / (b.pt - prev!.pt) : (p2.x - p1.x) / span;
      const m1y = p0 ? (p2.y - p0.y) / (b.pt - prev!.pt) : (p2.y - p1.y) / span;
      const m2x = p3 ? (p3.x - p1.x) / (next!.pt - a.pt) : (p2.x - p1.x) / span;
      const m2y = p3 ? (p3.y - p1.y) / (next!.pt - a.pt) : (p2.y - p1.y) / span;
      out.set(id, {
        x: h00 * p1.x + h10 * span * m1x + h01 * p2.x + h11 * span * m2x,
        y: h00 * p1.y + h10 * span * m1y + h01 * p2.y + h11 * span * m2y,
      });
    }
    return out;
  }

  private sampleBall(pt: number): { ball: View['ball']; holder?: string } {
    const k = this.balls;
    if (!k.length) return { ball: { x: 52.5, y: 34, h: 0 } };
    const i = Math.max(upperIndex(k, pt) - 1, 0);
    const a = k[i]!;
    const b = k[i + 1];
    if (pt <= a.pt) return { ball: { ...a.start, h: 0 }, holder: a.holder };
    const nextStart = b?.start ?? a.end ?? a.start;
    const gap = b ? b.pt - a.pt : Infinity;
    const el = pt - a.pt;
    if (a.end && a.flightMs < gap) {
      // In flight, then rolling/carried to wherever the next action starts.
      if (el <= a.flightMs) {
        const u = a.flightMs > 0 ? el / a.flightMs : 1;
        const h = a.lofted ? 4 * Math.min(8, dist(a.start, a.end) / 7) * u * (1 - u) : 0;
        return { ball: { x: a.start.x + (a.end.x - a.start.x) * u, y: a.start.y + (a.end.y - a.start.y) * u, h }, holder: a.holder };
      }
      if (!b) return { ball: { ...a.end, h: 0 }, holder: a.holder };
      const u = Math.min(1, (el - a.flightMs) / (gap - a.flightMs));
      return { ball: { x: a.end.x + (nextStart.x - a.end.x) * u, y: a.end.y + (nextStart.y - a.end.y) * u, h: 0 }, holder: a.holder };
    }
    if (!b) return { ball: { ...(a.end ?? a.start), h: 0 }, holder: a.holder };
    // Cut short (e.g. intercepted): travel straight to the next action's spot.
    const u = Math.min(1, el / gap);
    return { ball: { x: a.start.x + (nextStart.x - a.start.x) * u, y: a.start.y + (nextStart.y - a.start.y) * u, h: 0 }, holder: a.holder };
  }
}
