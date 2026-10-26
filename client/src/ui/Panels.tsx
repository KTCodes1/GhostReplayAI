// App chrome and live panels: header, match bar, scrubber, stats, timeline, pitch header/footer and lower third.

import { type DecisionMoment, type Side, optionKey } from '@ghost/engine';
import { useEffect, useRef, useState } from 'react';
import { type AiSource, type CameraMode, useMatch } from '../store';
import { clock, clockTenths, minute, pct, playerLookup, providerName, signed, teamColor } from './format';
import { kitColors } from '../pitch/coords';
import { resetCameraView, useFreeCam } from '../pitch/Scene';
import { ReportExports } from './Report';
import { type Ending, endingOf } from './compare';

export function AiBadge({ source }: { source: AiSource }) {
  if (source === 'template') return <span className="ai-badge tpl" title="Written from templates (AI unavailable)">Template</span>;
  return (
    <span className="ai-badge" title={`Written by ${providerName(source)} from the engine's facts`}>
      {providerName(source)}
    </span>
  );
}

/** Which AI wrote the latest generated text this match (template until one arrives). */
export function useAiProvider(): AiSource {
  return useMatch((s) => {
    const seen = [s.recapNarrative?.source, s.reportLines?.source, ...Object.values(s.explanations).map((e) => e.source), ...s.ticker.map((t) => t.source)];
    return seen.find((x): x is AiSource => !!x && x !== 'template') ?? 'template';
  });
}

function AiStatus() {
  const provider = useAiProvider();
  const label = provider === 'azure' ? 'Azure OpenAI · Microsoft Foundry' : 'Template mode';
  return (
    <div className={`ai-status${provider === 'template' ? ' tpl' : ''}`} title="Engine facts are written up by this model">
      <i />
      {label}
    </div>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">GR</div>
      <span className="brand-name">Ghost Replay</span>
      <span className="brand-div" />
      <span className="brand-sub">Match Intelligence</span>
    </div>
  );
}

/** Header for the start screen: brand and AI status only. */
export function StartHeader() {
  return (
    <header className="header">
      <Brand />
      <div className="spacer" />
      <AiStatus />
    </header>
  );
}

export function Header() {
  const meta = useMatch((s) => s.meta)!;
  const reportOpen = useMatch((s) => s.reportOpen);
  const report = useMatch((s) => s.report);
  const predictMode = useMatch((s) => s.predictMode);
  const { openReport, disconnect, closeReport, setPredictMode } = useMatch.getState();
  return (
    <header className="header">
      <Brand />
      <nav className="crumbs" aria-label="Breadcrumb">
        <span>Matches</span>
        <span>/</span>
        <span>Seed {meta.seed}</span>
        <span>/</span>
        <span className="cur">
          {reportOpen ? (report?.status === 'live' ? 'Report so far' : 'Full-time report') : `${meta.home.name} v ${meta.away.name}`}
        </span>
      </nav>
      <div className="spacer" />
      {!reportOpen && <AiStatus />}
      <div className="header-actions">
        {reportOpen ? (
          <>
            <ReportExports />
            <button className="btn-quiet" onClick={closeReport}>
              Back to match
            </button>
          </>
        ) : (
          <>
            <button
              className={predictMode ? 'btn-ai' : 'btn-quiet'}
              aria-pressed={predictMode}
              onClick={() => setPredictMode(!predictMode)}
              title="At each frozen moment, pick what you'd do before the engine reveals its answer"
            >
              You're the player{predictMode ? ': on' : ''}
            </button>
            <button onClick={openReport} title="Stats, momentum and player cards">
              Match report
            </button>
            <button className="btn-quiet" onClick={disconnect}>
              New match
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function StatusPill() {
  const { status, ghost, userPaused, fastForward, whatIfPlaying } = useMatch();
  if (ghost) {
    const what = whatIfPlaying ? 'SIMULATING' : ghost.live ? 'PAUSED' : 'REPLAY';
    return (
      <span className="status-pill ghost">
        <i /> GHOST MOMENT · {what}
      </span>
    );
  }
  if (status === 'ended')
    return (
      <span className="status-pill ft">
        <i /> FULL TIME
      </span>
    );
  if (fastForward) return <span className="status-pill">SEARCHING</span>;
  if (userPaused) return <span className="status-pill">PAUSED</span>;
  return (
    <span className="status-pill live">
      <i /> LIVE
    </span>
  );
}

const CAMERAS: [CameraMode, string, string][] = [
  ['broadcast', 'Broadcast', 'TV gantry camera'],
  ['tactical', 'Tactical', 'Straight down, like a tactics board'],
  ['pitch', 'Sideline', 'Along the near touchline: the whole width of the pitch, panning with the ball'],
  ['player', 'Player', 'Behind the ball, facing where the team is attacking'],
];
export const cameraLabel = (c: CameraMode) => CAMERAS.find(([id]) => id === c)![1];

/** Score, clock, status, playback and camera: everything about the match in one row. */
export function MatchBar() {
  const meta = useMatch((s) => s.meta)!;
  const score = useMatch((s) => s.score);
  const clockMs = useMatch((s) => s.clockMs);
  const period = useMatch((s) => s.period);
  const { userPaused, speed, fastForward, camera, status, ghost } = useMatch();
  const { togglePause, setSpeed, nextMoment, setCamera } = useMatch.getState();
  const live = status === 'live';
  const team = (side: Side) => (
    <div className={`sb-team ${side}`}>
      {side === 'home' && <span className="club-bar" style={{ background: teamColor(meta, side) }} />}
      <div>
        <span className="sb-name">{meta[side].name}</span>
        <span className="sb-sub">
          {meta[side].shortName} · {meta[side].formation} · {side === 'home' ? 'Home' : 'Away'}
        </span>
      </div>
      {side === 'away' && <span className="club-bar" style={{ background: teamColor(meta, side) }} />}
    </div>
  );
  return (
    <div className="matchbar">
      <div className="scoreboard">
        {team('home')}
        <div className="score" aria-label={`Score ${score.home} to ${score.away}`}>
          {score.home}
          <span>–</span>
          {score.away}
        </div>
        {team('away')}
      </div>
      <div className="mb-clock">
        <b>{status === 'ended' ? '90:00+' : clock(clockMs)}</b>
        <span>{status === 'ended' ? 'Full time' : period === 1 ? '1st half' : '2nd half'}</span>
      </div>
      <StatusPill />
      <div className="spacer" />
      <div className="mb-group">
        <span className="eyebrow">Playback</span>
        <button disabled={!live || !!ghost} onClick={togglePause}>
          {userPaused ? 'Resume' : 'Pause'}
        </button>
        <div className="seg mono" role="group" aria-label="Speed">
          {[1, 4, 8, 20, 60].map((v) => (
            <button key={v} className={speed === v ? 'on' : ''} disabled={!live} onClick={() => setSpeed(v)}>
              {v}×
            </button>
          ))}
        </div>
        <button className="btn-ai" disabled={!live || fastForward} onClick={nextMoment} title="Fast-forward to the next ghost moment">
          {fastForward ? 'Searching…' : 'Next moment'}
        </button>
      </div>
      <div className="mb-group cam">
        <span className="eyebrow">Camera</span>
        <div className="seg" role="group" aria-label="Camera">
          {CAMERAS.map(([id, label, title]) => (
            <button key={id} className={camera === id ? 'on' : ''} onClick={() => setCamera(id)} title={title}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const MATCH_MS = 90 * 60_000;
const at = (clockMs: number) => `${Math.min(100, (clockMs / MATCH_MS) * 100)}%`;

/** 0'–90' track: progress, half-time, ghost moments (clickable) and goals. */
export function Scrubber() {
  const progress = useMatch((s) => s.progress);
  const moments = useMatch((s) => s.moments);
  const ticker = useMatch((s) => s.ticker);
  const matchId = useMatch((s) => s.meta?.matchId);
  const show = useMatch((s) => s.showMoment);
  // The ticker keeps only the latest items, so remember every goal seen this match.
  const goals = useRef<{ matchId?: string; byId: Map<string, number> }>({ byId: new Map() });
  if (goals.current.matchId !== matchId) goals.current = { matchId, byId: new Map() };
  for (const it of ticker) if (it.kind === 'goal') goals.current.byId.set(it.id, it.clockMs);
  return (
    <div className="scrubber">
      <span>0'</span>
      <div className="scr-track">
        <div className="scr-fill" style={{ width: `${progress * 100}%` }} />
        <div className="scr-ht" />
        {[...goals.current.byId].map(([id, ms]) => (
          <span key={id} className="scr-mark goal" style={{ left: at(ms) }} title={`Goal ${minute(ms)}`} />
        ))}
        {moments.map((m: DecisionMoment) => (
          <button
            key={m.eventId}
            className={`scr-mark ${m.kind === 'genius' ? 'genius' : 'ghost'}`}
            style={{ left: at(m.clockMs) }}
            onClick={() => show(m)}
            title={`${m.kind === 'genius' ? 'Genius' : 'Ghost'} moment ${minute(m.clockMs)}: open`}
            aria-label={`Open ${m.kind === 'genius' ? 'genius' : 'ghost'} moment at ${minute(m.clockMs)}`}
          />
        ))}
      </div>
      <span>90'</span>
      <div className="scr-legend">
        <span>
          <i className="diamond" />
          Ghost moment
        </span>
        <span>
          <i className="diamond genius" />
          Genius
        </span>
        <span>
          <i className="goal-dot" />
          Goal
        </span>
      </div>
    </div>
  );
}

function Compare({ label, home, away, fmt = (v: number) => String(v) }: { label: string; home: number; away: number; fmt?: (v: number) => string }) {
  const total = home + away;
  return (
    <div className="cmp">
      <div className="cmp-head">
        <span>{fmt(home)}</span>
        <span className="cmp-label">{label}</span>
        <span>{fmt(away)}</span>
      </div>
      <Split home={home} away={away} total={total} />
    </div>
  );
}

/** 3px two-team bar; widths are percentages of the row. */
export function Split({ home, away, total = home + away }: { home: number; away: number; total?: number }) {
  if (total <= 0) return <div className="split empty-split" />;
  return (
    <div className="split">
      <div style={{ width: `${(home / total) * 100}%`, background: 'var(--home)' }} />
      <div style={{ width: `${(away / total) * 100}%`, background: 'var(--away)' }} />
    </div>
  );
}

const PULSE_FROM_MS = 3 * 60_000;

/** Match Pulse: how the last five minutes have felt, side by side, and the spell it adds up to. */
function PulsePanel() {
  const pulse = useMatch((s) => s.pulse);
  const meta = useMatch((s) => s.meta)!;
  const line = useMatch((s) => s.ticker.find((t) => t.kind === 'pulse'));
  // The window needs a few minutes of play before the numbers mean anything.
  if (!pulse || pulse.clockMs < PULSE_FROM_MS) return null;
  const { home: h, away: a } = pulse;
  const vars = { ['--home' as string]: teamColor(meta, 'home'), ['--away' as string]: teamColor(meta, 'away') };
  const pctV = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="stat-group pulse" style={vars}>
      <span className="eyebrow">Match pulse · last {pulse.windowMin} min</span>
      <Compare label="Pressing (per min)" home={h.pressure} away={a.pressure} fmt={(v) => v.toFixed(1)} />
      <Compare label="Territory" home={h.territory} away={a.territory} fmt={pctV} />
      <Compare label="Threat (xT + xG)" home={h.threat} away={a.threat} fmt={(v) => v.toFixed(2)} />
      {h.predictability !== null && a.predictability !== null && <Compare label="Predictability" home={h.predictability} away={a.predictability} fmt={pctV} />}
      {pulse.spell && (
        <p className="spell">
          <i className="chip" style={{ background: pulse.spell.team ? teamColor(meta, pulse.spell.team) : 'var(--muted)' }} />
          {pulse.spell.team ? `${meta[pulse.spell.team].shortName}: ` : ''}
          {pulse.spell.label}
        </p>
      )}
      {line && (
        <p className="spell-line" dir="auto">
          {line.text.replace(/^Match pulse: /, '')} {line.source && line.source !== 'template' && <AiBadge source={line.source} />}
        </p>
      )}
    </div>
  );
}

export function StatsTab() {
  const stats = useMatch((s) => s.stats);
  const meta = useMatch((s) => s.meta)!;
  if (!stats) return <div className="empty">Waiting for kick-off…</div>;
  const h = stats.teams.home;
  const a = stats.teams.away;
  const vars = { ['--home' as string]: teamColor(meta, 'home'), ['--away' as string]: teamColor(meta, 'away') };
  return (
    <>
      <div className="teams-head">
        <span>
          <i className="chip" style={{ background: teamColor(meta, 'home') }} />
          {meta.home.shortName}
        </span>
        <span>
          {meta.away.shortName}
          <i className="chip" style={{ background: teamColor(meta, 'away') }} />
        </span>
      </div>
      <PulsePanel />
      <div className="stat-group" style={vars}>
        <span className="eyebrow">Attack</span>
        <Compare label="Possession" home={h.possessionPct} away={a.possessionPct} fmt={(v) => `${Math.round(v)}%`} />
        <Compare label="Expected goals (xG)" home={h.xG} away={a.xG} fmt={(v) => v.toFixed(2)} />
        <Compare label="Shots" home={h.shots} away={a.shots} />
        <Compare label="Shots on target" home={h.shotsOnTarget} away={a.shotsOnTarget} />
        <Compare label="Threat added (xT)" home={Math.max(0, h.xTAdded)} away={Math.max(0, a.xTAdded)} fmt={(v) => v.toFixed(2)} />
      </div>
      <div className="stat-group" style={vars}>
        <span className="eyebrow">Passing</span>
        <Compare label="Pass accuracy" home={h.passAccuracy} away={a.passAccuracy} fmt={pct} />
        <Compare label="Passes" home={h.passes} away={a.passes} />
        <Compare label="Avg pass difficulty (1–10)" home={h.avgPassDifficulty} away={a.avgPassDifficulty} fmt={(v) => v.toFixed(1)} />
      </div>
      <div className="stat-group" style={vars}>
        <span className="eyebrow">Defending</span>
        <Compare label="Pressures" home={h.pressures} away={a.pressures} />
        <Compare label="Ball wins" home={h.tackles + h.interceptions} away={a.tackles + a.interceptions} />
        <Compare label="Fouls" home={h.fouls} away={a.fouls} />
      </div>
    </>
  );
}

export function TimelineTab() {
  const items = useMatch((s) => s.ticker);
  const meta = useMatch((s) => s.meta)!;
  const moments = useMatch((s) => s.moments);
  const show = useMatch((s) => s.showMoment);
  if (!items.length) return <div className="empty">Goals, shots, ghost moments and studio analysis will appear here.</div>;
  return (
    <div className="tl-list">
      {items.map((it) => {
        const m = it.kind === 'ghost' || it.kind === 'genius' ? moments.find((x) => `g-${x.eventId}` === it.id) : undefined;
        return (
          <div
            key={it.id}
            className={`tl-item tl-${it.kind}${m ? ' tl-click' : ''}`}
            onClick={m ? () => show(m) : undefined}
            onKeyDown={m ? (e) => e.key === 'Enter' && show(m) : undefined}
            tabIndex={m ? 0 : undefined}
            title={m ? 'Open this ghost moment' : undefined}
          >
            <span className="tl-min">{minute(it.clockMs)}</span>
            <span className="tl-team" style={{ background: it.team ? teamColor(meta, it.team) : 'transparent' }} />
            <span className="tl-text">
              {it.kind === 'ghost' && <i className="diamond" />}
              {it.kind === 'genius' && <i className="diamond genius" />}
              {it.kind === 'goal' && <i className="goal-dot" />}
              {it.kind === 'studio' && <span className="tl-tag">STUDIO</span>}
              {it.kind === 'pulse' && <span className="tl-tag pulse">PULSE</span>}
              <span>{it.text}</span>
              {it.source && it.source !== 'template' && <AiBadge source={it.source} />}
              {m && <span className="tl-replay">Replay</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Pitch header: camera and frozen/live state, plus the arrow legend while a ghost is open. */
export function StageHeader() {
  const camera = useMatch((s) => s.camera);
  const ghost = useMatch((s) => s.ghost);
  const playing = useMatch((s) => s.whatIfPlaying);
  return (
    <div className="stage-head">
      <span className="stage-title">Pitch</span>
      <span className="stage-sub">
        {cameraLabel(camera)} ·{' '}
        {ghost ? (
          playing ? (
            'simulation'
          ) : (
            <>
              frozen at <span className="mono">{clockTenths(ghost.moment.clockMs)}</span>
            </>
          )
        ) : (
          'live'
        )}
      </span>
      <div className="spacer" />
      {ghost && (
        <div className="legend">
          <span>
            <i style={{ background: 'var(--actual)' }} />
            Chosen
          </span>
          <span>
            <i style={{ background: 'var(--ai)' }} />
            Better option
          </span>
          <span>
            <i className="dashed" />
            Alternative
          </span>
        </div>
      )}
    </div>
  );
}

/** Pitch footer: the action on the ball right now, as a data line. */
export function EventFooter() {
  const e = useMatch((s) => s.lastEvent);
  const m = useMatch((s) => s.lastMetrics);
  const meta = useMatch((s) => s.meta);
  const who = playerLookup(meta);
  const parts: { text: string; cls?: string }[] = [];
  if (e) {
    parts.push({ text: `EVT ${(e.id.split('-').pop() ?? e.id).padStart(4, '0')}`, cls: 'hi' });
    parts.push({ text: e.type.replace('_', ' ').toUpperCase() });
    const name = (who(e.playerId)?.shortName ?? '').toUpperCase();
    const target = e.type === 'pass' && e.targetPlayerId ? who(e.targetPlayerId)?.shortName.toUpperCase() : undefined;
    if (name) parts.push({ text: target ? `${name} → ${target}` : name });
    if (m?.passDistance !== undefined) parts.push({ text: `${m.passDistance.toFixed(0)} m` });
    if (m?.difficulty !== undefined) parts.push({ text: `DIFFICULTY ${m.difficulty}/10` });
    if (m?.xG !== undefined) parts.push({ text: `xG ${m.xG.toFixed(2)}` });
    if (m?.ballSpeedKmh) parts.push({ text: `${m.ballSpeedKmh} km/h` });
    if (m?.xTAdded) parts.push({ text: `xT ${signed(m.xTAdded)}`, cls: m.xTAdded < 0 ? 'neg' : 'pos' });
  }
  return (
    <div className="stage-foot">
      {parts.map((p, i) => (
        <span key={i} className={p.cls}>
          {p.text}
        </span>
      ))}
      <div className="spacer" />
      {e && <span>{e.freezeFrame.length} players · freeze-frame</span>}
    </div>
  );
}

/** On the pitch during a what-if timeline: what you're looking at. */
export function CompareLabel() {
  const comparing = useMatch((s) => s.comparing);
  if (!comparing) return null;
  return (
    <div className="compare-label">
      <b>WHAT-IF TIMELINE</b>
      <span>Solid: what happened · Translucent: the ghost run</span>
      <span className="hint">Plausible simulation, not a prediction</span>
    </div>
  );
}

/** On the pitch when a simulation or the what-if timeline finishes: how each run ended, in one word. */
export function RunResult() {
  const ghost = useMatch((s) => s.ghost);
  const playing = useMatch((s) => s.whatIfPlaying);
  const done = useMatch((s) => s.whatIfDone);
  const comparing = useMatch((s) => s.comparing);
  const compareDone = useMatch((s) => s.compareDone);
  const results = useMatch((s) => s.whatIf);
  if (!ghost) return null;
  const team = ghost.moment.team;
  let rows: [string, Ending][] = [];
  if (comparing && compareDone) {
    const run = results[optionKey(ghost.moment.ghost)];
    rows = [['What happened', endingOf([ghost.event, ...ghost.continuation], team)], ...(run ? [['Ghost run', endingOf(run.replay, team)] as [string, Ending]] : [])];
  } else if (playing && done && results[playing]) rows = [['This simulated run', endingOf(results[playing]!.replay, team)]];
  if (!rows.length) return null;
  return (
    <div className="run-result">
      {rows.map(([who, end]) => (
        <div key={who} className={end.goal ? 'goal' : undefined}>
          <span>{who}</span>
          <b>{end.label}</b>
        </div>
      ))}
    </div>
  );
}

/** On the pitch during a ghost moment: how to move the camera, and a way back to the framed shot. */
export function FreeCamHint() {
  const ghost = useMatch((s) => !!s.ghost);
  const sketching = useMatch((s) => s.sketching);
  const manual = useFreeCam((s) => s.manual);
  const setSketching = useMatch((s) => s.setSketching);
  if (!ghost) return null;
  if (sketching)
    return (
      <div className="cam-hint sketch">
        <span>Click where the ball should go</span>
        <button onClick={() => setSketching(false)}>Cancel</button>
      </div>
    );
  return (
    <div className="cam-hint">
      <span>Drag to rotate · Right-drag to pan · Scroll to zoom</span>
      {manual && <button onClick={resetCameraView}>Reset view</button>}
    </div>
  );
}

/** Broadcast-style lower third: live commentary and studio lines. */
export function LowerThird() {
  const caption = useMatch((s) => s.caption);
  const ghost = useMatch((s) => s.ghost);
  const report = useMatch((s) => s.reportOpen);
  const [, force] = useState(0);
  useEffect(() => {
    if (!caption) return;
    const id = setTimeout(() => force((x) => x + 1), Math.max(0, caption.until - performance.now()) + 50);
    return () => clearTimeout(id);
  }, [caption]);
  if (!caption || ghost || report || performance.now() > caption.until) return null;
  return (
    <div className={`lower-third ${caption.kind}`} key={caption.until}>
      <span className="lt-tag">{caption.kind === 'studio' ? 'STUDIO' : 'LIVE'}</span>
      <span className="lt-text" dir="auto">
        {caption.text}
      </span>
    </div>
  );
}

export function GoalBanner() {
  const flash = useMatch((s) => s.goalFlash);
  const meta = useMatch((s) => s.meta);
  const score = useMatch((s) => s.score);
  const [, force] = useState(0);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => force((x) => x + 1), flash.until - performance.now());
    return () => clearTimeout(id);
  }, [flash]);
  if (!flash || !meta || performance.now() > flash.until) return null;
  const team = meta[flash.team];
  return (
    <div className="goal-banner">
      <div className="gb-word" style={{ background: kitColors(meta)[flash.team].main, color: kitColors(meta)[flash.team].trim }}>
        GOAL
      </div>
      <div className="gb-who">
        {flash.scorer}
        <small>
          {team.shortName} · {score.home}–{score.away}
        </small>
      </div>
    </div>
  );
}
