// Who was on top, five minutes at a time: home threat (xT gained + xG) above the line, away below.
// Position (above/below) carries team identity as well as colour, so it never relies on hue alone.

import type { MatchMeta, MatchReport } from '@ghost/engine';
import { minute, playerLookup, teamColor } from './format';

const MATCH_MS = 90 * 60_000;

export function MomentumChart({ report, meta }: { report: MatchReport; meta: MatchMeta }) {
  const bins = report.momentum;
  const peak = Math.max(0.05, ...bins.flatMap((b) => [b.home, b.away]));
  const who = playerLookup(meta);
  const home = teamColor(meta, 'home');
  const away = teamColor(meta, 'away');
  const range = (label: string) => (label.endsWith('+') ? `${label.replace('+', '')}+` : `${label}–${Number(label.replace("'", '')) + 5}'`);

  return (
    <section className="panel rp-panel" aria-label={`Momentum: threat created by ${meta.home.name} (above) and ${meta.away.name} (below), per five minutes`}>
      <div className="rp-panel-head">
        <span className="eyebrow">Momentum · xT per 5 min</span>
        <div className="mom-legend">
          <span>
            <i style={{ background: home }} />
            {meta.home.shortName}
          </span>
          <span>
            <i style={{ background: away }} />
            {meta.away.shortName}
          </span>
        </div>
      </div>
      <div className="mom-plot">
        <div className="mom-zero" />
        <div className="mom-ht" />
        {bins.map((b, i) => (
          <div key={i} className="mom-bin" title={`${range(b.label)}  ${meta.home.shortName} ${b.home.toFixed(2)} · ${meta.away.shortName} ${b.away.toFixed(2)}`}>
            <div>
              <i style={{ height: `${(b.home / peak) * 100}%`, background: home }} />
            </div>
            <div>
              <i style={{ height: `${(b.away / peak) * 100}%`, background: away }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mom-goals">
        {report.goals.map((g) => (
          <span key={g.eventId} style={{ left: `${Math.min(97, Math.max(3, (g.clockMs / MATCH_MS) * 100))}%` }}>
            <i className="goal-dot" />
            {minute(g.clockMs)} {who(g.playerId)?.shortName ?? ''}
            {g.penalty ? ' (pen)' : ''}
          </span>
        ))}
      </div>
      <div className="mom-axis">
        <span>0'</span>
        <span>HT</span>
        <span>90'</span>
      </div>
    </section>
  );
}
