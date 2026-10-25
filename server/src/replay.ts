// Replays a generated match to one client in (scaled) real time, running the
// interpret + ghost layers live as each event goes out.

import {
  DecisionDetector,
  type GeneratedMatch,
  LiveStats,
  type DecisionMoment,
  type ServerMsg,
  type ViewerPrefs,
  analyzeEvent,
  CueBuilder,
  STATS_PANEL_MINUTES,
  type OverlayCue,
  buildMatchReport,
  optionKey,
  simulateWhatIf,
} from '@ghost/engine';
import type { AskResult } from './ai/askAI';
import { Narrator } from './narrative';

/** Studio lines come in at these match minutes (half/full time get their own summaries). */
const STUDIO_MINUTES = [15, 30, 60, 75];

export type ReplayOptions = {
  speed: number; // match ms per wall ms
  holdMs: number | null; // how long play stays frozen on a ghost moment (null = until the viewer continues)
  maxGapMs: number; // dead-ball gaps (goal celebrations, restarts) are capped to this much match time
  statsEveryEvents: number;
};

export const DEFAULT_REPLAY: ReplayOptions = { speed: 8, holdMs: null, maxGapMs: 6000, statsEveryEvents: 15 };
const MAX_SPEED = 120;

export class MatchReplay {
  private i = 0;
  private playT = 0;
  // Pacing reference: playback time `clockPt` was due at wall time `clockWall`.
  // Scheduling against this (not chained delays) stops the stream drifting behind real time.
  private clockWall = 0;
  private clockPt = 0;
  private timer: NodeJS.Timeout | undefined;
  private paused = false;
  private holding = false;
  private fastForward = false;
  private stopped = false;
  private stats: LiveStats;
  private detector: DecisionDetector;
  private opts: ReplayOptions;
  private narrator: Narrator;
  private studioDone = new Set<number>();
  /** Every moment shown live or in the recap, so its explanation can be (re)written on request. */
  private moments = new Map<string, DecisionMoment>();
  private current: DecisionMoment | undefined;
  private focusPlayerId: string | undefined;
  private cues: CueBuilder;
  private panelsDone = new Set<number>();

  constructor(
    private match: GeneratedMatch,
    private send: (msg: ServerMsg) => void,
    opts: Partial<ReplayOptions> = {},
  ) {
    this.opts = { ...DEFAULT_REPLAY, ...opts };
    this.stats = new LiveStats(match.meta);
    this.detector = new DecisionDetector(match.meta);
    this.narrator = new Narrator(match.meta);
    this.cues = new CueBuilder(match.meta);
  }

  private sendCues(cues: OverlayCue[]) {
    if (cues.length && !this.stopped) this.send({ type: 'cues', cues });
  }

  /** Send AI text when it arrives (unless the viewer has gone). */
  private narrate(kind: 'ghost' | 'studio' | 'half_time' | 'full_time', clockMs: number, job: Promise<AskResult>, eventId?: string) {
    const t = this.match.events[Math.max(0, this.i - 1)]!.t;
    job.then((r) => {
      if (this.stopped) return;
      this.send({ type: 'narrative', kind, clockMs, text: r.text, source: r.source, ...(eventId ? { eventId } : {}) });
      this.sendCues(this.cues.onNarrative(r.text, t, clockMs, kind === 'studio' ? 'studio' : 'analysis', r.source, eventId));
    });
  }

  /** Viewer settings: who they're following (player focus). */
  setPrefs(prefs: ViewerPrefs) {
    this.detector.setFocus(prefs.focusPlayerId);
    this.focusPlayerId = prefs.focusPlayerId;
  }

  /** Build the report from everything played so far; AI one-liners follow for the final report. */
  sendReport() {
    const upto = this.i - 1;
    if (upto < 0) return;
    const focus = this.focusPlayerId ? [this.focusPlayerId] : [];
    const report = buildMatchReport(this.match, this.detector, upto, focus);
    // Moments in the report can be opened and explained like live ones.
    for (const m of [...report.topMoments, ...report.players.flatMap((p) => (p.missedChance ? [p.missedChance] : []))]) {
      if (!this.moments.has(m.eventId)) this.moments.set(m.eventId, m);
    }
    this.send({ type: 'report', report });
    if (report.status !== 'final') return; // live reports keep the template lines: no AI calls
    const ids = [report.playerOfTheMatch, ...report.highlights.home, ...report.highlights.away, ...focus].filter((x): x is string => !!x);
    this.narrator.playerLines(report, [...new Set(ids)]).then(({ lines, source }) => {
      if (!this.stopped) this.send({ type: 'report_lines', matchId: report.matchId, status: report.status, lines, source });
    });
  }

  explain(eventId: string) {
    const m = this.moments.get(eventId);
    if (m) this.narrate('ghost', m.clockMs, this.narrator.explainMoment(m), m.eventId);
  }

  private resetClock() {
    this.clockWall = performance.now();
    this.clockPt = this.playT;
  }

  start() {
    const last = this.match.events.at(-1)!;
    this.resetClock();
    this.send({ type: 'meta', meta: this.match.meta, speed: this.opts.speed, totalEvents: this.match.events.length, durationMs: last.t });
    this.sendState();
    this.schedule(300);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  pause() {
    this.paused = true;
    clearTimeout(this.timer);
    this.sendState();
  }

  resume() {
    this.paused = false;
    this.holding = false;
    this.resetClock();
    this.sendState();
    this.schedule(0);
  }

  setSpeed(value: number) {
    this.opts.speed = Math.min(MAX_SPEED, Math.max(0.25, value));
    this.resetClock();
    this.sendState();
  }

  nextMoment() {
    this.fastForward = true;
    if (this.paused || this.holding) this.resume();
    else this.sendState();
  }

  private sendState() {
    this.send({ type: 'state', paused: this.paused || this.holding, speed: this.opts.speed, fastForward: this.fastForward });
  }

  private schedule(delayMs: number) {
    clearTimeout(this.timer);
    if (this.stopped || this.paused) return;
    this.timer = setTimeout(() => this.tick(), delayMs);
  }

  private tick() {
    const events = this.match.events;
    const e = events[this.i];
    if (!e || this.stopped) return;

    const tickStart = performance.now();
    const metrics = this.stats.push(e);
    if (this.i > 0) this.playT += this.gapMs(this.i - 1);
    this.send({ type: 'event', event: e, metrics, playT: this.playT });
    const line = this.narrator.commentary(e, metrics);
    if (line && !this.fastForward) this.send({ type: 'commentary', eventId: e.id, text: line });
    const cues = this.cues.onEvent(e, metrics);
    if (line) cues.push(...this.cues.onNarrative(line, e.t, e.clockMs, 'commentary', 'template', e.id));
    const moment = this.detector.push(e);
    if (moment) cues.push(...this.cues.onMoment(moment, e));
    const panelAt = STATS_PANEL_MINUTES.find((x) => Math.floor(e.clockMs / 60000) >= x && Math.floor(e.clockMs / 60000) < x + 5 && !this.panelsDone.has(x));
    if (panelAt !== undefined || e.type === 'half_time') {
      if (panelAt !== undefined) this.panelsDone.add(panelAt);
      cues.push(...this.cues.onStatsPanel(this.stats.snapshot(), e.t, e.clockMs));
    }
    this.sendCues(cues);
    const tickMs = performance.now() - tickStart;
    if (tickMs > 100) console.warn(`[replay] slow tick: ${e.type} ${e.id} took ${tickMs.toFixed(0)} ms`);
    this.i += 1;

    const notable = e.type === 'shot' || e.type === 'half_time' || e.type === 'full_time' || e.type === 'kickoff';
    if (this.i % this.opts.statsEveryEvents === 0 || notable) {
      this.send({ type: 'stats', stats: this.stats.snapshot(), decisions: this.detector.playerRecords() });
    }

    // Studio lines and summaries (skipped while fast-forwarding past them).
    const minute = Math.floor(e.clockMs / 60000);
    const studioAt = STUDIO_MINUTES.find((m) => minute >= m && minute < m + 5 && !this.studioDone.has(m));
    if (studioAt !== undefined) {
      this.studioDone.add(studioAt);
      if (!this.fastForward) this.narrate('studio', e.clockMs, this.narrator.studioLine(this.stats.snapshot(), e.clockMs));
    }
    if (e.type === 'half_time') this.narrate('half_time', e.clockMs, this.narrator.halfTime(this.stats.snapshot()));

    if (this.i >= events.length) {
      const recap = this.detector.recap();
      for (const m of recap) if (!this.moments.has(m.eventId)) this.moments.set(m.eventId, m);
      this.send({ type: 'end', recap });
      this.narrate('full_time', e.clockMs, this.narrator.fullTime(this.stats.snapshot(), recap));
      this.sendReport();
      return;
    }

    if (moment) {
      this.fastForward = false;
      this.holding = true;
      this.moments.set(moment.eventId, moment);
      this.current = moment;
      this.send({ type: 'ghost', moment, holdMs: this.opts.holdMs });
      this.narrate('ghost', moment.clockMs, this.narrator.explainMoment(moment), moment.eventId);
      this.sendState();
      clearTimeout(this.timer);
      const hold = this.opts.holdMs;
      if (hold !== null) {
        this.timer = setTimeout(() => {
          if (this.holding && !this.paused) this.resume();
        }, hold);
      }
      return;
    }

    if (this.fastForward) {
      this.resetClock();
      this.schedule(0);
      return;
    }
    const due = this.clockWall + (this.playT + this.gapMs(this.i - 1) - this.clockPt) / this.opts.speed;
    this.schedule(Math.max(0, due - performance.now()));
  }

  /** Match ms between event i and i+1, with dead-ball gaps capped. */
  private gapMs(i: number): number {
    const ev = this.match.events;
    return Math.min(ev[i + 1]!.t - ev[i]!.t, this.opts.maxGapMs);
  }

  /** Play out one option of a moment from its freeze frame and send the result. */
  simulate(eventId: string, key: string) {
    const event = this.match.events.find((e) => e.id === eventId);
    const analysis = event && analyzeEvent(event, this.detector.roster);
    const option = analysis && [analysis.actual, ...analysis.alternatives].find((o) => optionKey(o) === key);
    if (!event || !option) {
      this.send({ type: 'error', message: `Unknown option ${key} for ${eventId}` });
      return;
    }
    this.send({ type: 'whatif', eventId, result: simulateWhatIf(this.match.meta, event, option) });
  }
}
