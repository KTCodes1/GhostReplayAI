// Numbers without reasons don't convince anyone. These find the *cause* in the freeze frame:
// which defender left the gap, who was already running, where the overload was, what the next
// ball would have been. Plain English facts; the AI layer turns them into commentary.
// All positions are in the acting team's frame (attacking towards x = 105).

import { dist } from '../geometry';
import { offsideLine } from '../models/dynamics';
import type { DecisionReason, GhostOption, MatchEvent, Vec2 } from '../types';
import type { Roster } from './judge';

const DEFENSIVE = new Set(['CB', 'RB', 'LB', 'DM']);
const pct = (p: number) => `${Math.round(p * 100)}%`;

export function optionPhrase(o: Pick<GhostOption, 'action' | 'targetPlayerId'>, name: (id?: string) => string): string {
  return o.action === 'shot' ? 'a shot' : o.action === 'carry' ? 'a run forward with the ball' : `a pass to ${name(o.targetPlayerId)}`;
}

/** Why `o` was on: the movement and the gaps around it. */
export function optionCauses(o: GhostOption, e: MatchEvent, roster: Roster, about: DecisionReason['about']): DecisionReason[] {
  const out: DecisionReason[] = [];
  const name = (id?: string) => (id ? roster.get(id)?.info.shortName ?? 'a teammate' : 'a teammate');
  const carrier = name(e.playerId);
  const frame = e.freezeFrame;
  const mine = frame.filter((s) => s.team === e.team && s.playerId !== e.playerId);
  const theirs = frame.filter((s) => s.team !== e.team);
  const outfield = theirs.filter((s) => !roster.get(s.playerId)?.isGK);
  const target = o.targetPlayerId ? frame.find((s) => s.playerId === o.targetPlayerId) : undefined;
  const speed = (vel?: Vec2) => (vel ? Math.hypot(vel.x, vel.y) : 0);

  if (o.action === 'pass' && target) {
    if (o.runner) out.push({ code: 'runner_in_behind', about, text: `${name(target.playerId)} was already on the move at ${speed(target.vel).toFixed(1)} m/s, so the ball could go into their path`, value: speed(target.vel) });

    // A defender who stepped out to press, with the pass going in behind them.
    const presser = outfield
      .filter((s) => DEFENSIVE.has(roster.get(s.playerId)?.info.position ?? '') && dist(s.pos, e.start) < 5.5)
      .sort((a, b) => dist(a.pos, e.start) - dist(b.pos, e.start))[0];
    if (presser && o.end.x > presser.pos.x + 5)
      out.push({ code: 'pressing_gap', about, text: `${name(presser.playerId)} stepped out to press ${carrier}, which left space behind them for ${name(target.playerId)}`, value: dist(presser.pos, e.start) });

    // The nearest marker drifting towards the ball, away from the receiver.
    const marker = [...outfield].sort((a, b) => dist(a.pos, target.pos) - dist(b.pos, target.pos))[0];
    if (marker && dist(marker.pos, target.pos) < 9 && marker.vel) {
      const toBall = { x: e.start.x - marker.pos.x, y: e.start.y - marker.pos.y };
      const l = Math.hypot(toBall.x, toBall.y) || 1;
      const closing = (marker.vel.x * toBall.x + marker.vel.y * toBall.y) / l;
      if (closing > 1.5) out.push({ code: 'ball_watching', about, text: `${name(marker.playerId)}, the nearest defender to ${name(target.playerId)}, was drifting towards the ball`, value: closing });
    }
  }

  // A high line with room behind it.
  const line = offsideLine(theirs.map((s) => s.pos), e.start.x);
  if (o.action !== 'shot' && line <= 80 && o.end.x > line - 3)
    out.push({ code: 'high_line', about, text: `the back line was high, with ${Math.round(105 - line)} m of space behind it`, value: 105 - line });

  // Numbers around where the ball would go.
  if (o.action !== 'shot') {
    const near = (s: { pos: Vec2 }) => dist(s.pos, o.end) < 12;
    const a = mine.filter(near).length;
    const d = outfield.filter(near).length;
    if (a >= 2 && a > d) {
      const side = o.end.y < 22 ? 'right' : o.end.y > 46 ? 'left' : 'middle';
      out.push({ code: 'overload', about, text: `${a} v ${d} around there, ${side === 'middle' ? 'through the middle' : `on the ${side}`}`, value: a - d });
    }
  }

  if (o.followUp) {
    const f = o.followUp;
    out.push({ code: 'sets_up_next', about, text: `it would have set up ${optionPhrase(f, name)} next (worth ${f.ev.toFixed(3)})`, value: f.ev });
  }
  return out;
}

/** The situation: what the player could see, what they could execute, and the scoreline. */
export function contextCauses(args: {
  e: MatchEvent;
  roster: Roster;
  actual: GhostOption;
  best: GhostOption;
  unseen?: GhostOption;
  offsideBest?: GhostOption;
  state: { code: string; label: string; lossAversion: number };
}): DecisionReason[] {
  const { e, roster, actual, best, unseen, offsideBest, state } = args;
  const out: DecisionReason[] = [];
  const name = (id?: string) => (id ? roster.get(id)?.info.shortName ?? 'a teammate' : 'a teammate');
  const carrier = name(e.playerId);
  if (best !== actual && best.visibility === 'peripheral')
    out.push({ code: 'peripheral_vision', about: 'context', text: `${best.action === 'pass' ? name(best.targetPlayerId) : 'that option'} was on the edge of ${carrier}'s vision, so it was harder to spot` });
  if (unseen)
    out.push({ code: 'unseen_option', about: 'context', text: `an even better option, ${optionPhrase(unseen, name)}, was behind ${carrier} and out of sight, so it isn't counted against them`, value: unseen.expectedValue });
  if (offsideBest) out.push({ code: 'offside', about: 'context', text: `${name(offsideBest.targetPlayerId)} looked free but was in an offside position` });
  if (best !== actual && best.execution && best.execution.notes.length && best.execution.fit < 0.85)
    out.push({ code: 'execution_demand', about: 'best', text: `it wasn't easy: ${best.execution.notes.join(', ')}`, value: best.execution.fit });
  if (actual.execution && actual.execution.notes.length && actual.execution.fit < 0.8)
    out.push({ code: 'execution_demand', about: 'actual', text: `the pass chosen was hard to execute: ${actual.execution.notes.join(', ')}`, value: actual.execution.fit });
  if (state.code !== 'open')
    out.push({ code: 'game_state', about: 'context', text: `${state.label}: losing the ball counted ${state.lossAversion.toFixed(1)}x as much`, value: state.lossAversion });
  return out;
}

/** For a genius moment: why the choice was special. */
export function geniusCauses(actual: GhostOption, obvious: GhostOption, e: MatchEvent, roster: Roster): DecisionReason[] {
  const out: DecisionReason[] = [];
  const name = (id?: string) => (id ? roster.get(id)?.info.shortName ?? 'a teammate' : 'a teammate');
  const carrier = name(e.playerId);
  const who = actual.action === 'pass' ? name(actual.targetPlayerId) : 'the space';
  if (actual.visibility === 'behind') out.push({ code: 'saw_it', about: 'actual', text: `${carrier} found ${who} behind them, a ball most players never see` });
  else if (actual.visibility === 'peripheral') out.push({ code: 'saw_it', about: 'actual', text: `${carrier} spotted ${who} on the edge of their vision` });
  const bypassed = actual.features?.bypassed ?? 0;
  if (bypassed >= 3) out.push({ code: 'hard_to_find', about: 'actual', text: `it took ${bypassed} defenders out of the game`, value: bypassed });
  if (actual.pSuccess < 0.7) out.push({ code: 'hard_to_find', about: 'actual', text: `a ${pct(actual.pSuccess)} ball that most players wouldn't risk`, value: actual.pSuccess });
  out.push({
    code: 'safe_but_slow',
    about: 'best',
    text: `the obvious option was ${optionPhrase(obvious, name)} (${pct(obvious.pSuccess)} to come off) but it was worth ${(actual.expectedValue - obvious.expectedValue).toFixed(3)} less`,
    value: obvious.expectedValue,
  });
  return out;
}
