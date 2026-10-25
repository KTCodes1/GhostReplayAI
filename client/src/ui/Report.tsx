// Post-match (or so-far) report, as a full page: story, key numbers, momentum, the decisions that
// shaped it, standout players and the full player table.

import type { MatchMeta, PlayerReport, Side } from '@ghost/engine';
import { useMatch } from '../store';
import { cueSheet } from './Broadcast';
import { choicePhrase, clock, downloadJSON, minute, optionPhrase, pct, providerName, signed, teamColor } from './format';
import { MomentumChart } from './MomentumChart';
import { AiBadge, Split } from './Panels';

/** Header buttons while the report is open. */
export function ReportExports() {
  const report = useMatch((s) => s.report);
  const lines = useMatch((s) => s.reportLines);
  const cues = useMatch((s) => s.cues);
  return (
    <>
      <button disabled={!report} onClick={() => report && downloadJSON(`${report.matchId}-report.json`, { ...report, playerLines: lines?.lines ?? {}, generatedAt: new Date().toISOString() })}>
        Export report JSON
      </button>
      <button disabled={!report} onClick={() => report && downloadJSON(`${report.matchId}-cues.json`, cueSheet(cues))} title="Timed overlay cues a broadcaster can sync to the feed">
        Export overlay cues
      </button>
    </>
  );
}

function Kpi({ label, home, away, hv, av }: { label: string; home: string; away: string; hv: number; av: number }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <div className="kpi-vals">
        <span>{home}</span>
        <span>{away}</span>
      </div>
      <Split home={hv} away={av} />
    </div>
  );
}

function PlayerCard({ p, meta, variant }: { p: PlayerReport; meta: MatchMeta; variant?: 'potm' | 'following' }) {
  const lines = useMatch((s) => s.reportLines);
  const openMoment = useMatch((s) => s.openMomentFromReport);
  const s = p.stats;
  const line = lines?.lines[p.playerId];
  const name = (id?: string) => [...meta.home.players, ...meta.away.players].find((x) => x.id === id)?.shortName ?? 'a teammate';
  const keeper = p.role === 'GK';
  const stats: [string, string | number][] = [
    ['Goals', s.goals],
    ['Assists', s.assists],
    ['Shots', `${s.shots} (${s.shotsOnTarget})`],
    ['xG', s.xG.toFixed(2)],
    ['Chances', s.keyPasses],
    ['xT added', s.xTAdded.toFixed(2)],
    ['Passes', `${s.passesCompleted}/${s.passes}`],
    keeper ? ['Saves', s.saves] : ['Ball wins', s.tackles + s.interceptions],
  ];
  const tag = variant === 'potm' ? 'Player of the match' : variant === 'following' ? 'Following' : `${meta[p.team].name} standout`;
  return (
    <div className={`pcard${variant ? ` ${variant}` : ''}`} style={{ ['--club' as string]: teamColor(meta, p.team) }}>
      <div className="pcard-head">
        <div>
          <span className="pcard-tag">{tag}</span>
          <span className="pcard-name">
            {p.name} <span className="role">{p.role}</span>
          </span>
          <span className="pcard-club">
            {meta[p.team].name} · <span className="mono">{s.distanceKm} km</span>
          </span>
        </div>
        <div className="pcard-rating" title="Match rating out of 10">
          <b>{p.rating.toFixed(1)}</b>
          <span>RATING</span>
        </div>
      </div>
      <p className="pcard-line" dir="auto">
        {line ?? p.summary} {line && lines && lines.source !== 'template' && <AiBadge source={lines.source} />}
      </p>
      <div className="pcard-stats">
        {stats.map(([k, v]) => (
          <div key={k}>
            <b>{v}</b>
            <span>{k}</span>
          </div>
        ))}
      </div>
      {p.decisions && (
        <div className="pcard-dec" title="Share of judged on-ball decisions where this player picked the best available option">
          <div>
            <span>Decision score</span>
            <b>
              {p.decisions.best}/{p.decisions.total} · {pct(p.decisions.rate)}
            </b>
          </div>
          <div className="meter">
            <div style={{ width: `${p.decisions.rate * 100}%` }} />
          </div>
        </div>
      )}
      {p.bestMoment && (
        <div className="pm">
          <span>
            <span className="lbl">Best moment</span> {p.bestMoment.text}
          </span>
        </div>
      )}
      {p.missedChance && (
        <button className="pm" onClick={() => openMoment(p.missedChance!)} title="Open this moment and simulate the options">
          <span>
            <span className="lbl">Biggest miss, {minute(p.missedChance.clockMs)}</span> {optionPhrase(p.missedChance.ghost, name)} was on
          </span>
          <span className="go">Replay</span>
        </button>
      )}
    </div>
  );
}

export function ReportScreen() {
  const report = useMatch((s) => s.report);
  const meta = useMatch((s) => s.meta);
  const focusId = useMatch((s) => s.prefs.focusPlayerId);
  const story = useMatch((s) => s.recapNarrative);
  const moments = useMatch((s) => s.moments);
  const openMomentFromReport = useMatch((s) => s.openMomentFromReport);
  if (!meta) return null;
  if (!report)
    return (
      <div className="report-page">
        <div className="report">
          <span className="eyebrow">Building the report…</span>
        </div>
      </div>
    );

  const byId = new Map(report.players.map((p) => [p.playerId, p]));
  const name = (id?: string) => [...meta.home.players, ...meta.away.players].find((x) => x.id === id)?.shortName ?? 'a teammate';
  const h = report.teams.home;
  const a = report.teams.away;
  const potm = report.playerOfTheMatch ? byId.get(report.playerOfTheMatch) : undefined;
  const focus = focusId && focusId !== potm?.playerId ? byId.get(focusId) : undefined;
  const final = report.status === 'final';
  const vars = { ['--home' as string]: teamColor(meta, 'home'), ['--away' as string]: teamColor(meta, 'away') };

  // Standouts: player of the match, the followed player, then the best of each side in turn; whole rows of three.
  const standouts: { p: PlayerReport; variant?: 'potm' | 'following' }[] = [];
  if (potm) standouts.push({ p: potm, variant: 'potm' });
  if (focus) standouts.push({ p: focus, variant: 'following' });
  const rest = (side: Side) => report.highlights[side].filter((id) => id !== focus?.playerId && id !== potm?.playerId);
  const [hs, as] = [rest('home'), rest('away')];
  for (let i = 0; i < Math.max(hs.length, as.length); i++) for (const id of [hs[i], as[i]]) if (id && byId.has(id)) standouts.push({ p: byId.get(id)! });
  const shown = standouts.slice(0, standouts.length >= 6 ? 6 : 3);

  const team = (side: Side) => (
    <span className="rp-team">
      {side === 'home' && <span className="club-bar" style={{ background: teamColor(meta, side) }} />}
      {meta[side].name}
      {side === 'away' && <span className="club-bar" style={{ background: teamColor(meta, side) }} />}
    </span>
  );

  return (
    <div className="report-page">
      <div className="report" style={vars}>
        <div className="rp-title">
          <div>
            <span className="eyebrow">{final ? 'Full-time report' : `Report so far · ${minute(report.clockMs)}`}</span>
            <div className="rp-score">
              {team('home')}
              <span className="score">
                {report.score.home}
                <span>–</span>
                {report.score.away}
              </span>
              {team('away')}
            </div>
          </div>
          <span className="rp-meta">
            Seed {meta.seed} · {final ? '90:00+' : clock(report.clockMs)} · {moments.length} ghost moment{moments.length === 1 ? '' : 's'}
          </span>
        </div>

        {final && story && (
          <div className="panel rp-summary">
            <div>
              <span className="eyebrow">Match summary</span>
              {story.source === 'template' ? <small className="tpl">Written from engine facts (template)</small> : <small>Generated by {providerName(story.source)} from engine facts</small>}
            </div>
            <p dir="auto">{story.text}</p>
          </div>
        )}

        <div className="panel kpis">
          <Kpi label="Possession" home={`${Math.round(h.possessionPct)}%`} away={`${Math.round(a.possessionPct)}%`} hv={h.possessionPct} av={a.possessionPct} />
          <Kpi label="Expected goals" home={h.xG.toFixed(2)} away={a.xG.toFixed(2)} hv={h.xG} av={a.xG} />
          <Kpi label="Shots (on target)" home={`${h.shots} (${h.shotsOnTarget})`} away={`${a.shots} (${a.shotsOnTarget})`} hv={h.shots} av={a.shots} />
          <Kpi label="Pass accuracy" home={pct(h.passAccuracy)} away={pct(a.passAccuracy)} hv={h.passAccuracy} av={a.passAccuracy} />
        </div>

        <div className="rp-two">
          <MomentumChart report={report} meta={meta} />
          <section className="panel rp-panel rp-moments">
            <div className="rp-panel-head">
              <span className="eyebrow">The decisions that shaped the match</span>
              <small>EV lost</small>
            </div>
            {report.topMoments.length === 0 && <div className="empty">No ghost moments yet.</div>}
            {report.topMoments.map((m) => (
              <button key={m.eventId} className="moment-row" onClick={() => openMomentFromReport(m)}>
                <span className="tl-min">{minute(m.clockMs)}</span>
                <i style={{ background: teamColor(meta, m.team) }} />
                <span>
                  <b>{name(m.playerId)}</b> chose {choicePhrase(m.actual, name)} when {optionPhrase(m.ghost, name)} was on
                </span>
                <span className="delta">{signed(m.evLost)}</span>
                <span className="go">Replay</span>
              </button>
            ))}
          </section>
        </div>

        {shown.length > 0 && (
          <section className="rp-section">
            <span className="eyebrow">Standout performers</span>
            <div className="pcards">
              {shown.map(({ p, variant }) => (
                <PlayerCard key={p.playerId} p={p} meta={meta} variant={variant} />
              ))}
            </div>
          </section>
        )}

        <section className="panel">
          <div className="ptable-head">
            <span className="eyebrow">All players</span>
            <small>
              Sorted by rating · <span className="mono">{report.players.length}</span> players
            </small>
          </div>
          <div className="prow th">
            <span>Player</span>
            <span>Rating</span>
            <span>G</span>
            <span>A</span>
            <span>xG</span>
            <span>Chances</span>
            <span>Ball wins</span>
            <span>Pass %</span>
            <span>Decisions</span>
            <span>km</span>
          </div>
          {report.players.map((p) => (
            <div key={p.playerId} className="prow">
              <span>
                <span className="club-bar" style={{ background: teamColor(meta, p.team) }} />
                <span className="r">{p.role}</span>
                {p.shortName}
              </span>
              <span className="rt">{p.rating.toFixed(1)}</span>
              <span>{p.stats.goals}</span>
              <span>{p.stats.assists}</span>
              <span>{p.stats.xG.toFixed(2)}</span>
              <span>{p.stats.keyPasses}</span>
              <span>{p.stats.tackles + p.stats.interceptions}</span>
              <span>{p.stats.passes ? pct(p.stats.passAccuracy) : '–'}</span>
              <span>{p.decisions ? `${p.decisions.best}/${p.decisions.total}` : '–'}</span>
              <span className="km">{p.stats.distanceKm}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
