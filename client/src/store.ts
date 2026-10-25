// Client match state.
// - The server streams events stamped with `playT` (playback time).
// - A playhead runs a little behind the newest event so there is always a next snapshot to
//   interpolate towards; UI updates (score, ticker, ghost freeze) fire when the playhead
//   reaches them, so the scoreboard never runs ahead of the pitch.
// - The 3D scene samples `playback` every frame (no React renders for motion).

import {
  type ClientMsg,
  type DecisionMoment,
  type EventMetrics,
  type MatchEvent,
  type MatchReport,
  type OverlayCue,
  type MatchMeta,
  type PlayerDecisionRecord,
  type ServerMsg,
  type Side,
  type StatsSnapshot,
  type WhatIfResult,
  optionKey,
} from '@ghost/engine';
import { create } from 'zustand';
import { Timeline, type View } from './timeline';

export type TickerItem = { id: string; clockMs: number; team?: Side; text: string; kind: 'goal' | 'shot' | 'ghost' | 'info' | 'foul' | 'studio'; source?: AiSource };
export type AiSource = 'gemini' | 'azure' | 'template';
/** What the viewer picked. Favourite club is stored by club id (it maps to home/away per match). */
/** Viewer settings: who they're following (player focus). Per match, so not remembered. */
export type ClientPrefs = { focusPlayerId?: string };

/** Lower-third caption on the pitch: live commentary or a studio line. */
export type Caption = { text: string; kind: 'commentary' | 'studio'; source?: AiSource; until: number };
export type CameraMode = 'broadcast' | 'tactical' | 'pitch' | 'player';
/** `holdMs`: auto-continue after this long (demo mode); null = wait for the viewer. */
export type GhostView = { moment: DecisionMoment; event: MatchEvent; pt: number; live: boolean; holdMs?: number | null };

/** Playback buffer, in match ms: the playhead stays this far behind the newest event. */
const LAG = 8000; // > the server's 6 s dead-ball cap, so a long gap never drains the buffer
/** What-if replays play at this multiple of real time. */
export const WHATIF_SPEED = 1.5;
const WHATIF_MAX_GAP = 4000;
const CAPTION_MS = { commentary: 5000, studio: 11000 };

type State = {
  status: 'idle' | 'connecting' | 'live' | 'ended' | 'error';
  error?: string;
  meta?: MatchMeta;
  lastEvent?: MatchEvent;
  lastMetrics?: EventMetrics;
  score: { home: number; away: number };
  clockMs: number;
  period: 1 | 2;
  stats?: StatsSnapshot;
  decisions: PlayerDecisionRecord[];
  ghost?: GhostView;
  ticker: TickerItem[];
  recap: DecisionMoment[];
  moments: DecisionMoment[];
  userPaused: boolean;
  speed: number;
  fastForward: boolean;
  camera: CameraMode;
  goalFlash?: { team: Side; scorer: string; until: number };
  progress: number; // 0..1
  /** What-if simulations for the moment on screen, by option key. */
  whatIf: Record<string, WhatIfResult>;
  whatIfRequested: string[];
  whatIfPlaying?: string; // option key
  whatIfDone: boolean;
  /** "Why it mattered" for each ghost moment, by event id. */
  explanations: Record<string, { text: string; source: AiSource }>;
  prefs: ClientPrefs;
  caption?: Caption;
  recapNarrative?: { text: string; source: AiSource };
  report?: MatchReport;
  reportLines?: { lines: Record<string, string>; source: AiSource };
  reportOpen: boolean;
  /** Reopen the report when the viewer closes a moment they opened from it. */
  returnToReport: boolean;
  /** The match was paused to read the report; resume on close. */
  pausedForReport: boolean;
  /** Overlay cues received so far (machine-readable broadcast graphics). */
  cues: OverlayCue[];
  /** What this match was started with, so the full cue sheet can be fetched. */
  matchParams?: { seed: number; home?: string; away?: string };
};

type Actions = {
  connect: (p: { seed: number; home?: string; away?: string; speed: number; holdMs?: number; jump?: boolean }) => void;
  disconnect: () => void;
  send: (msg: ClientMsg) => void;
  setCamera: (c: CameraMode) => void;
  togglePause: () => void;
  setSpeed: (v: number) => void;
  nextMoment: () => void;
  showMoment: (m: DecisionMoment) => void;
  closeGhost: () => void;
  simulate: (key: string, play: boolean) => void;
  stopWhatIf: () => void;
  setPrefs: (patch: Partial<ClientPrefs>) => void;
  openReport: () => void;
  closeReport: () => void;
  openMomentFromReport: (m: DecisionMoment) => void;
};

/** Mutable playback data read by the render loop. */
export const playback = {
  live: new Timeline(),
  playhead: 0,
  buffering: true,
  whatIf: undefined as undefined | { key: string; timeline: Timeline; startWall: number; endPt: number },
  view: undefined as View | undefined,
};

type Pending = { pt: number; ghost?: GhostView; apply?: (s: State) => Partial<State> };

let ws: WebSocket | undefined;
let durationMs = 1;
let pending: Pending[] = [];
const eventPt = new Map<string, number>();
const events = new Map<string, MatchEvent>();
let rafId = 0;
let lastNow = 0;

/**
 * Everything a new match starts from. Every field must be listed — optional ones as `undefined` —
 * because zustand merges: anything left out would survive from the previous match (e.g. a frozen ghost).
 */
type ResetKeys = keyof Omit<State, 'camera' | 'speed' | 'prefs'>;
type MatchReset = { [K in ResetKeys]: undefined extends State[K] ? State[K] | undefined : State[K] };

const initial = (): MatchReset => ({
  error: undefined,
  meta: undefined,
  lastEvent: undefined,
  lastMetrics: undefined,
  stats: undefined,
  ghost: undefined,
  goalFlash: undefined,
  whatIfPlaying: undefined,
  caption: undefined,
  recapNarrative: undefined,
  report: undefined,
  reportLines: undefined,
  matchParams: undefined,
  status: 'idle',
  score: { home: 0, away: 0 },
  clockMs: 0,
  period: 1,
  decisions: [],
  ticker: [],
  recap: [],
  moments: [],
  userPaused: false,
  fastForward: false,
  progress: 0,
  whatIf: {},
  whatIfRequested: [],
  whatIfDone: false,
  explanations: {},
  reportOpen: false,
  returnToReport: false,
  pausedForReport: false,
  cues: [],
});

function resetPlayback() {
  playback.live = new Timeline();
  playback.playhead = 0;
  playback.buffering = true;
  playback.whatIf = undefined;
  playback.view = undefined;
  pending = [];
  eventPt.clear();
  events.clear();
}

export const useMatch = create<State & Actions>((set, get) => {
  const playerName = (id: string) => {
    const m = get().meta;
    const p = m && [...m.home.players, ...m.away.players].find((x) => x.id === id);
    return p?.shortName ?? id;
  };

  function tickerFor(e: MatchEvent, m: EventMetrics): TickerItem | undefined {
    const who = playerName(e.playerId);
    const base = { id: e.id, clockMs: e.clockMs, team: e.team };
    const xg = m.xG !== undefined ? ` · xG ${m.xG.toFixed(2)}` : '';
    switch (e.type) {
      case 'shot':
        if (e.outcome === 'goal') return { ...base, kind: 'goal', text: `GOAL! ${who}${e.context === 'penalty' ? ' (pen)' : ''}${xg}` };
        return { ...base, kind: 'shot', text: `${who} shot — ${e.outcome?.replace('_', ' ')}${xg}` };
      case 'foul':
        return { ...base, kind: 'foul', text: `Foul by ${who}${e.context === 'penalty' ? ' — PENALTY!' : ''}` };
      case 'half_time':
        return { ...base, team: undefined, kind: 'info', text: 'Half time' };
      case 'full_time':
        return { ...base, team: undefined, kind: 'info', text: 'Full time' };
      case 'kickoff':
        return e.t === 0 ? { ...base, kind: 'info', text: 'Kick off' } : undefined;
      default:
        return undefined;
    }
  }

  // ---- playhead loop ------------------------------------------------------------
  function frame(now: number) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(100, now - (lastNow || now));
    lastNow = now;
    const s = get();
    if (!s.meta) return;
    const live = playback.live;
    const streamDone = s.status === 'ended';

    if (!s.ghost && !s.userPaused && live.length) {
      if (playback.buffering) {
        // Rebuffer: wait until there is enough ahead to animate smoothly.
        if (live.lastPt - playback.playhead >= LAG || streamDone || s.fastForward) playback.buffering = false;
      }
      // Ease off when the buffer runs low rather than stopping dead.
      const ahead = live.lastPt - playback.playhead;
      const ease = streamDone ? 1 : Math.min(1, Math.max(0.6, ahead / (LAG * 0.5)));
      if (!playback.buffering) playback.playhead += dt * s.speed * ease;
      // Way behind (fast-forward, hidden tab): jump.
      if (live.lastPt - playback.playhead > LAG * 2.5) playback.playhead = live.lastPt - LAG;
      if (playback.playhead >= live.lastPt) {
        playback.playhead = live.lastPt;
        if (!streamDone) playback.buffering = true;
      }
    }

    if (pending.length && pending[0]!.pt <= playback.playhead) {
      const draft: State = { ...get() };
      const patch: Partial<State> = {};
      while (pending.length && pending[0]!.pt <= playback.playhead) {
        const item = pending.shift()!;
        if (item.ghost) {
          playback.playhead = item.pt;
          Object.assign(patch, { ghost: item.ghost, whatIf: {}, whatIfRequested: [], whatIfPlaying: undefined, whatIfDone: false });
          break;
        }
        const p = item.apply!(draft);
        Object.assign(draft, p);
        Object.assign(patch, p);
      }
      set(patch);
      const g = get().ghost;
      if (g && patch.ghost) {
        autoSimulate(g);
        // Auto-continue mode: let go of the freeze on the same timer the server uses.
        if (g.live && g.holdMs != null) {
          setTimeout(() => {
            const cur = get().ghost;
            if (cur === g && !get().whatIfPlaying) get().closeGhost();
          }, g.holdMs);
        }
      }
    }
  }

  function autoSimulate(g: GhostView) {
    // Get the odds for the actual choice and the headline ghost straight away.
    get().simulate(optionKey(g.moment.actual), false);
    get().simulate(optionKey(g.moment.ghost), false);
  }

  function startWhatIf(result: WhatIfResult) {
    const g = get().ghost;
    if (!g) return;
    const tl = new Timeline();
    let pt = 0;
    let prevT = g.event.t;
    for (const e of result.replay) {
      pt += Math.min(e.t - prevT, WHATIF_MAX_GAP);
      prevT = e.t;
      tl.add(e, pt);
    }
    playback.whatIf = { key: result.key, timeline: tl, startWall: performance.now(), endPt: pt + 1500 };
    set({ whatIfPlaying: result.key, whatIfDone: false });
  }

  function onMessage(msg: ServerMsg) {
    switch (msg.type) {
      case 'meta': {
        durationMs = msg.durationMs;
        resetPlayback();
        set({ ...initial(), status: 'live', meta: msg.meta, speed: msg.speed, prefs: {}, matchParams: get().matchParams });
        break;
      }
      case 'event': {
        const e = msg.event;
        events.set(e.id, e);
        eventPt.set(e.id, msg.playT);
        if (playback.live.length === 0) playback.playhead = msg.playT - LAG;
        playback.live.add(e, msg.playT);
        const metrics = msg.metrics;
        pending.push({
          pt: msg.playT,
          apply: (s) => {
            const item = tickerFor(e, metrics);
            const patch: Partial<State> = {
              lastEvent: e,
              lastMetrics: metrics,
              score: e.score,
              clockMs: e.clockMs,
              period: e.period,
              progress: Math.min(1, e.t / durationMs),
            };
            if (item) patch.ticker = [item, ...s.ticker].slice(0, 40);
            if (e.type === 'shot' && e.outcome === 'goal') patch.goalFlash = { team: e.team, scorer: playerName(e.playerId), until: performance.now() + 3500 };
            return patch;
          },
        });
        break;
      }
      case 'ghost': {
        const event = events.get(msg.moment.eventId);
        const pt = eventPt.get(msg.moment.eventId);
        if (!event || pt === undefined) break;
        const moment = msg.moment;
        pending.push({
          pt,
          apply: (s) => ({
            fastForward: false,
            moments: [...s.moments, moment],
            ticker: [{ id: `g-${moment.eventId}`, clockMs: moment.clockMs, team: moment.team, kind: 'ghost' as const, text: `Ghost moment: ${playerName(moment.playerId)}` }, ...s.ticker].slice(0, 40),
          }),
        });
        pending.push({ pt, ghost: { moment, event, pt, live: true, holdMs: msg.holdMs } });
        break;
      }
      case 'whatif': {
        const g = get().ghost;
        if (!g || g.moment.eventId !== msg.eventId) break;
        set({ whatIf: { ...get().whatIf, [msg.result.key]: msg.result } });
        if (get().whatIfPlaying === msg.result.key && !playback.whatIf) startWhatIf(msg.result);
        break;
      }
      case 'commentary': {
        const pt = eventPt.get(msg.eventId);
        // Drop any line more than ~6 s (real time) behind the pitch.
        if (pt === undefined || (playback.playhead - pt) / Math.max(1, get().speed) > 6000) break;
        const text = msg.text;
        pending.push({ pt, apply: (s) => (s.ghost ? {} : { caption: { text, kind: 'commentary', until: performance.now() + CAPTION_MS.commentary } }) });
        break;
      }
      case 'narrative': {
        const { kind, text, source } = msg;
        // Ignore text written for settings the viewer has since changed.
        if (kind === 'ghost' && msg.eventId) {
          set({ explanations: { ...get().explanations, [msg.eventId]: { text, source } } });
          break;
        }
        // Studio lines / summaries: show when the pitch catches up with when they were written.
        const label = kind === 'half_time' ? 'Half-time analysis' : kind === 'full_time' ? 'Full-time analysis' : 'Studio';
        const item: TickerItem = { id: `n-${kind}-${msg.clockMs}`, clockMs: msg.clockMs, kind: 'studio', text: `${label}: ${text}`, source };
        pending.push({
          pt: playback.live.lastPt,
          apply: (s) => ({
            ticker: [item, ...s.ticker].slice(0, 40),
            ...(kind === 'full_time' ? { recapNarrative: { text, source } } : {}),
            ...(s.ghost ? {} : { caption: { text, kind: 'studio' as const, source, until: performance.now() + CAPTION_MS.studio } }),
          }),
        });
        break;
      }
      case 'stats': {
        const { stats, decisions } = msg;
        pending.push({ pt: playback.live.lastPt, apply: () => ({ stats, decisions }) });
        break;
      }
      case 'state':
        // fastForward is cleared when the playhead reaches the ghost, not when the server finds it.
        set(msg.fastForward ? { speed: msg.speed, fastForward: true } : { speed: msg.speed });
        break;
      case 'end': {
        const recap = msg.recap;
        pending.push({ pt: playback.live.lastPt, apply: () => ({ recap, progress: 1, fastForward: false }) });
        set({ status: 'ended' });
        break;
      }
      case 'report': {
        const report = msg.report;
        const fresh = get().report?.status !== 'final' && report.status === 'final';
        // Full time: show the report once the pitch has caught up with the final whistle.
        if (fresh) pending.push({ pt: playback.live.lastPt, apply: () => ({ report, reportOpen: true }) });
        else set({ report, reportLines: undefined });
        if (fresh) set({ reportLines: undefined });
        break;
      }
      case 'cues': {
        // A cue that `replaces` another cuts that one short at its own start.
        const cues = [...get().cues];
        for (const c of msg.cues) {
          const rep = (c.payload as { replaces?: string }).replaces;
          if (rep) {
            const i = cues.findIndex((x) => x.cueId === rep);
            if (i >= 0) cues[i] = { ...cues[i]!, durationMs: Math.max(0, c.startT - cues[i]!.startT) };
          }
          cues.push(c);
        }
        set({ cues });
        break;
      }
      case 'report_lines':
        set({ reportLines: { lines: msg.lines, source: msg.source } });
        break;
      case 'error':
        set({ status: 'error', error: msg.message });
        break;
    }
  }

  return {
    ...initial(),
    speed: 8,
    camera: 'broadcast',
    prefs: {},
    connect: ({ seed, home, away, speed, holdMs, jump }) => {
      ws?.close();
      resetPlayback();
      const q = new URLSearchParams({ seed: String(seed), speed: String(speed) });
      if (holdMs !== undefined) q.set('holdMs', String(holdMs));
      if (home) q.set('home', home);
      if (away) q.set('away', away);
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const sock = new WebSocket(`${proto}://${location.host}/ws?${q}`);
      ws = sock;
      set({ ...initial(), status: 'connecting', speed, fastForward: !!jump, matchParams: { seed, home, away } });
      sock.onmessage = (ev) => onMessage(JSON.parse(ev.data));
      if (jump) sock.addEventListener('open', () => sock.send(JSON.stringify({ cmd: 'next_moment' })), { once: true });
      sock.onerror = () => set({ status: 'error', error: 'Could not reach the match server — is it running? (npm run dev)' });
      sock.onclose = () => {
        if (ws === sock && get().status === 'live') set({ status: 'error', error: 'Connection to the match server closed.' });
      };
      cancelAnimationFrame(rafId);
      lastNow = 0;
      rafId = requestAnimationFrame(frame);
    },
    disconnect: () => {
      const sock = ws;
      ws = undefined;
      sock?.close();
      cancelAnimationFrame(rafId);
      resetPlayback();
      // Drop demo deep-link options (?autostart…) so the start screen doesn't relaunch the old match.
      if (location.search) history.replaceState(null, '', location.pathname);
      set({ ...initial() });
    },
    send: (msg) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)),
    setCamera: (camera) => set({ camera }),
    togglePause: () => {
      const paused = !get().userPaused;
      set({ userPaused: paused });
      get().send({ cmd: paused ? 'pause' : 'resume' });
    },
    setSpeed: (value) => {
      set({ speed: value });
      get().send({ cmd: 'speed', value });
    },
    nextMoment: () => {
      if (get().ghost) get().closeGhost();
      set({ userPaused: false, fastForward: true });
      get().send({ cmd: 'next_moment' });
    },
    showMoment: (moment) => {
      const event = events.get(moment.eventId);
      const pt = eventPt.get(moment.eventId);
      if (!event || pt === undefined) return;
      playback.whatIf = undefined;
      const wasRunning = get().status === 'live' && !get().userPaused && !get().ghost?.live;
      if (wasRunning) get().send({ cmd: 'pause' });
      set({ ghost: { moment, event, pt, live: false }, whatIf: {}, whatIfRequested: [], whatIfPlaying: undefined, whatIfDone: false, userPaused: wasRunning || get().userPaused });
      autoSimulate(get().ghost!);
      if (!get().explanations[moment.eventId]) get().send({ cmd: 'explain', eventId: moment.eventId });
    },
    closeGhost: () => {
      const g = get().ghost;
      playback.whatIf = undefined;
      set({ ghost: undefined, whatIf: {}, whatIfRequested: [], whatIfPlaying: undefined, whatIfDone: false });
      if (!g) return;
      if (get().returnToReport) {
        set({ returnToReport: false, reportOpen: true });
        return;
      }
      if (g.live) {
        playback.buffering = true;
        get().send({ cmd: 'resume' });
      } else if (get().status === 'live') {
        // Back from a recap/timeline moment: carry on where the live match was.
        set({ userPaused: false });
        get().send({ cmd: 'resume' });
      }
    },
    simulate: (key, play) => {
      const g = get().ghost;
      if (!g) return;
      const have = get().whatIf[key];
      if (play) {
        playback.whatIf = undefined;
        set({ whatIfPlaying: key, whatIfDone: false });
        if (have) startWhatIf(have);
      }
      if (!have && !get().whatIfRequested.includes(key)) {
        set({ whatIfRequested: [...get().whatIfRequested, key] });
        get().send({ cmd: 'simulate', eventId: g.moment.eventId, key });
      }
    },
    stopWhatIf: () => {
      playback.whatIf = undefined;
      set({ whatIfPlaying: undefined, whatIfDone: false });
    },
    openReport: () => {
      const s = get();
      // Pause a running match while the viewer reads.
      const pause = s.status === 'live' && !s.userPaused && !s.ghost;
      if (pause) get().send({ cmd: 'pause' });
      set({ reportOpen: true, pausedForReport: pause, userPaused: s.userPaused || pause });
      if (s.status !== 'ended' || !s.report) get().send({ cmd: 'report' });
    },
    closeReport: () => {
      const s = get();
      set({ reportOpen: false, pausedForReport: false });
      if (s.pausedForReport) {
        set({ userPaused: false });
        get().send({ cmd: 'resume' });
      }
    },
    openMomentFromReport: (m) => {
      set({ reportOpen: false, returnToReport: true });
      get().showMoment(m);
    },
    setPrefs: (patch) => {
      const prefs: ClientPrefs = { ...get().prefs, ...patch };
      if (!prefs.focusPlayerId) delete prefs.focusPlayerId;
      set({ prefs });
      get().send({ cmd: 'prefs', prefs });
    },
  };
});

/** Called by the scene once per frame: pick what to show (live, frozen moment, or a what-if). */
export function sampleView(now: number): View | undefined {
  const s = useMatch.getState();
  const wi = playback.whatIf;
  if (s.ghost && wi) {
    const pt = (now - wi.startWall) * WHATIF_SPEED;
    if (pt >= wi.endPt && !s.whatIfDone) useMatch.setState({ whatIfDone: true });
    playback.view = wi.timeline.sample(Math.min(pt, wi.endPt));
  } else if (s.ghost) {
    playback.view = playback.live.sample(s.ghost.pt);
  } else if (playback.live.length) {
    playback.view = playback.live.sample(playback.playhead);
  }
  return playback.view;
}

// Dev-only hook for automated smoothness checks.
if (import.meta.env.DEV) (window as unknown as { __playback: typeof playback }).__playback = playback;
