// WebSocket protocol between server and client. JSON, one message per frame.

import type { PlayerDecisionRecord } from './ghost/ghost';
import type { WhatIfResult } from './ghost/whatif';
import type { MatchReport } from './report/report';
import type { EventMetrics, StatsSnapshot } from './stats/interpret';
import type { DecisionMoment, MatchEvent, MatchMeta, OverlayCue } from './types';

export type ServerMsg =
  | { type: 'meta'; meta: MatchMeta; speed: number; totalEvents: number; durationMs: number }
  /** `playT` = playback time: match ms with long dead-ball gaps compressed. Animate against this. */
  | { type: 'event'; event: MatchEvent; metrics: EventMetrics; playT: number }
  /** Play freezes on this moment. The server holds the stream until resumed (or for `holdMs` wall ms if set). */
  | { type: 'ghost'; moment: DecisionMoment; holdMs: number | null }
  | { type: 'whatif'; eventId: string; result: WhatIfResult }
  /** Instant template commentary tied to an event (show it when the playhead reaches that event). */
  | { type: 'commentary'; eventId: string; text: string }
  /** Written analysis: why a ghost moment mattered, studio lines, half/full-time summaries. */
  | { type: 'narrative'; kind: NarrativeKind; eventId?: string; clockMs: number; text: string; source: 'gemini' | 'azure' | 'template' }
  | { type: 'stats'; stats: StatsSnapshot; decisions: PlayerDecisionRecord[] }
  | { type: 'state'; paused: boolean; speed: number; fastForward: boolean }
  | { type: 'end'; recap: DecisionMoment[] }
  /** Post-match (or so-far) report; `report_lines` then replaces the template one-liners with AI ones. */
  | { type: 'report'; report: MatchReport }
  | { type: 'report_lines'; matchId: string; status: MatchReport['status']; lines: Record<string, string>; source: 'gemini' | 'azure' | 'template' }
  /** New overlay cues (a cue whose payload has `replaces` cuts that earlier cue short at its own startT). */
  | { type: 'cues'; cues: OverlayCue[] }
  | { type: 'error'; message: string };

export type NarrativeKind = 'ghost' | 'studio' | 'half_time' | 'full_time';

/** Viewer settings: who they're following (player focus mode). */
export type ViewerPrefs = {
  focusPlayerId?: string;
};

export type ClientMsg =
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'speed'; value: number }
  /** Fast-forward to the next ghost moment. */
  | { cmd: 'next_moment' }
  /** Play out an option (by `optionKey`) from a moment's freeze frame. */
  | { cmd: 'simulate'; eventId: string; key: string }
  /** Viewer settings; can change mid-match. */
  | { cmd: 'prefs'; prefs: ViewerPrefs }
  /** Ask for (or refresh) the "why it mattered" text of a moment, e.g. one opened from the recap. */
  | { cmd: 'explain'; eventId: string }
  /** Ask for the match report so far (it is sent automatically at full time). */
  | { cmd: 'report' };

export type StreamParams = {
  seed: number;
  home?: string;
  away?: string;
  speed?: number;
  holdMs?: number; // omit to hold until the viewer continues
};
