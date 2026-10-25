// Left-hand sidebar: one tab at a time instead of a long scroll.

import type { Side } from '@ghost/engine';
import { useState } from 'react';
import { useMatch } from '../store';
import { BroadcastTab } from './Broadcast';
import { minute, pct, teamColor } from './format';
import { DnaView } from './Dna';
import { StatsTab, TimelineTab } from './Panels';

type Tab = 'stats' | 'timeline' | 'player' | 'feed';

const RATINGS = [
  ['finishing', 'Finishing'],
  ['passing', 'Passing'],
  ['dribbling', 'Dribbling'],
  ['tackling', 'Tackling'],
  ['pace', 'Pace'],
  ['decision', 'Decisions'],
] as const;

function PlayerTab() {
  const meta = useMatch((s) => s.meta)!;
  const focusId = useMatch((s) => s.prefs.focusPlayerId);
  const setPrefs = useMatch((s) => s.setPrefs);
  const record = useMatch((s) => s.decisions.find((d) => d.playerId === focusId));
  const moments = useMatch((s) => s.moments.filter((m) => m.playerId === focusId));
  const show = useMatch((s) => s.showMoment);
  const side: Side | undefined = focusId ? (meta.home.players.some((p) => p.id === focusId) ? 'home' : 'away') : undefined;
  const p = side ? meta[side].players.find((x) => x.id === focusId) : undefined;
  const rate = record && record.decisions ? record.bestChoices / record.decisions : 0;

  return (
    <>
      <label className="field">
        Follow a player
        <select value={focusId ?? ''} onChange={(e) => setPrefs({ focusPlayerId: e.target.value || undefined })}>
          <option value="">Choose a player…</option>
          {(['home', 'away'] as Side[]).map((s) => (
            <optgroup key={s} label={meta[s].name}>
              {meta[s].players.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.role} · {x.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {!p || !side ? (
        <div className="empty">
          Follow one player all match: a ring on the pitch, their decision score as it happens, and more of their ghost moments.
        </div>
      ) : (
        <div className="focus-card" style={{ ['--club' as string]: teamColor(meta, side) }}>
          <div>
            <div className="focus-name">
              {p.name} <span className="role">{p.role}</span>
            </div>
            <div className="focus-sub">
              {meta[side].name} · #{p.number}
            </div>
          </div>

          <div>
            <div className="dec-score" title="Judged on-ball decisions where they picked the best option">
              <span>Decision score</span>
              {record ? (
                <b>
                  {record.bestChoices}/{record.decisions} · {pct(rate)}
                </b>
              ) : (
                <span className="muted">No decisions yet</span>
              )}
            </div>
            <div className="meter">
              <div style={{ width: `${rate * 100}%` }} />
            </div>
          </div>

          <div className="ratings">
            {RATINGS.map(([k, label]) => (
              <div key={k} className="rating">
                <span>{label}</span>
                <div className="meter">
                  <div style={{ width: `${p.attrs[k] * 100}%` }} />
                </div>
                <b>{Math.round(p.attrs[k] * 100)}</b>
              </div>
            ))}
          </div>

          <table className="seasons">
            <thead>
              <tr>
                <th>Season</th>
                <th>Apps</th>
                <th>Goals</th>
                <th>Assists</th>
                <th>Tackles</th>
                <th>Pass %</th>
              </tr>
            </thead>
            <tbody>
              {[p.seasons.current, p.seasons.previous].map((s) => (
                <tr key={s.season}>
                  <td>{s.season}</td>
                  <td>{s.apps}</td>
                  <td>{s.goals}</td>
                  <td>{s.assists}</td>
                  <td>{s.tackles}</td>
                  <td>{Math.round(s.passAccuracy * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <DnaSection playerId={p.id} />

          {moments.length > 0 && (
            <div className="tl-list">
              <span className="eyebrow">Their ghost moments</span>
              {moments.map((m) => (
                <div key={m.eventId} className="tl-item tl-ghost tl-click" onClick={() => show(m)} onKeyDown={(e) => e.key === 'Enter' && show(m)} tabIndex={0}>
                  <span className="tl-min">{minute(m.clockMs)}</span>
                  <span className="tl-team" style={{ background: teamColor(meta, side) }} />
                  <span className="tl-text">
                    <i className="diamond" />
                    <span>Replay this moment</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Decision DNA for the followed player: this match so far, or across their last five matches. */
function DnaSection({ playerId }: { playerId: string }) {
  const dna = useMatch((s) => s.dna[playerId]);
  const pending = useMatch((s) => s.dnaPending.includes(playerId));
  const requestDna = useMatch((s) => s.requestDna);
  const [scope, setScope] = useState<'match' | 'across'>('across');
  const shown = dna?.[scope] ?? null;
  return (
    <div className="dna-section">
      <div className="gp-section-head">
        <span className="eyebrow">Decision DNA</span>
        {dna && (
          <div className="seg" role="group" aria-label="DNA scope">
            <button className={scope === 'match' ? 'on' : ''} onClick={() => setScope('match')}>
              This match
            </button>
            <button className={scope === 'across' ? 'on' : ''} onClick={() => setScope('across')}>
              Last 5
            </button>
          </div>
        )}
      </div>
      {!dna ? (
        <button onClick={() => requestDna(playerId)} disabled={pending} title="How this player makes decisions: risk, vision, composure, late-game, against their peers">
          {pending ? 'Building from 5 matches…' : 'Build Decision DNA'}
        </button>
      ) : shown ? (
        <DnaView dna={shown} compact />
      ) : (
        <div className="empty">Not enough decisions yet {scope === 'match' ? 'this match' : ''} (20 needed).</div>
      )}
      {dna && (
        <button className="link" onClick={() => requestDna(playerId)} disabled={pending}>
          {pending ? 'Updating…' : 'Update'}
        </button>
      )}
    </div>
  );
}

export function Sidebar() {
  const [tab, setTab] = useState<Tab>('stats');
  const moments = useMatch((s) => s.moments.length);
  const cues = useMatch((s) => s.cues.length);
  const tabs: [Tab, string, number?][] = [
    ['stats', 'Stats'],
    ['timeline', 'Timeline', moments || undefined],
    ['player', 'Player'],
    ['feed', 'Feed', cues || undefined],
  ];
  return (
    <aside className="sidebar">
      <nav className="tabs" role="tablist">
        {tabs.map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
            {n ? <span className="count">{n}</span> : null}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === 'stats' && <StatsTab />}
        {tab === 'timeline' && <TimelineTab />}
        {tab === 'player' && <PlayerTab />}
        {tab === 'feed' && <BroadcastTab />}
      </div>
    </aside>
  );
}
