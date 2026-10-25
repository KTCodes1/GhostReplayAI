// The right-hand column. During a ghost moment, one clear hierarchy —
// who & what happened → why it mattered → chose vs better option → verdict → factors → every option.
// Otherwise it shows the live insights feed.

import { type GhostOption, type WhatIfOutcome, type WhatIfResult, optionKey } from '@ghost/engine';
import { useState } from 'react';
import { useMatch } from '../store';
import { choicePhrase, minute, pct, playerLookup, signed, teamColor } from './format';
import { AiBadge, TimelineTab } from './Panels';

const OUTCOME: Record<WhatIfOutcome, string> = {
  goal: 'a goal',
  shot: 'a shot',
  turnover: 'losing the ball',
  foul: 'a foul',
  kept: 'keeping the ball',
};
const RESULT: Record<string, string> = { success: 'came off', fail: 'failed', goal: 'goal', saved: 'saved', blocked: 'blocked', off_target: 'off target' };

function actionLabel(o: GhostOption, name: (id?: string) => string) {
  return o.action === 'shot' ? 'Shoot' : o.action === 'carry' ? 'Drive forward' : `Pass to ${name(o.targetPlayerId)}`;
}

function OptionCard({ o, kind, name, outcome }: { o: GhostOption; kind: 'actual' | 'ghost'; name: (id?: string) => string; outcome?: string }) {
  const key = optionKey(o);
  const sim = useMatch((s) => s.whatIf[key]);
  const playing = useMatch((s) => s.whatIfPlaying === key);
  const simulate = useMatch((s) => s.simulate);
  const s = sim?.summary;
  const chance = o.action === 'shot' ? 'Chance of scoring' : 'Chance it comes off';
  const runs = s?.rollouts ?? 50;
  return (
    <div className={`opt-card ${kind}${playing ? ' playing' : ''}`}>
      <span className="opt-label">{kind === 'actual' ? 'CHOSEN' : 'BETTER OPTION'}</span>
      <span className="opt-action">{actionLabel(o, name)}</span>
      <div className="opt-metric">
        <span>{chance}</span>
        <b>{pct(o.pSuccess)}</b>
      </div>
      <div className="opt-metric" title="Expected goals from choosing this, from 50 simulations">
        <span>xG per attempt</span>
        <b>{s ? s.expectedGoals.toFixed(3) : '…'}</b>
      </div>
      <div className="opt-metric">
        <span>Leads to a shot</span>
        <b>{s ? pct(s.shotRate) : '…'}</b>
      </div>
      <div className="opt-metric">
        <span>Ball lost</span>
        <b>{s ? pct(s.turnoverRate) : '…'}</b>
      </div>
      {outcome && <span className="opt-outcome">Result: {outcome}</span>}
      <button className={kind === 'ghost' ? 'btn-primary' : undefined} onClick={() => simulate(key, true)} title="Replay the match from this frozen moment with this option, on the pitch">
        {playing ? 'Replay simulation' : kind === 'ghost' ? `Simulate ${runs} runs` : 'Simulate'}
      </button>
    </div>
  );
}

function SimulationStrip({ name }: { name: (id?: string) => string }) {
  const ghost = useMatch((s) => s.ghost)!;
  const playing = useMatch((s) => s.whatIfPlaying);
  const done = useMatch((s) => s.whatIfDone);
  const results = useMatch((s) => s.whatIf);
  const { simulate, stopWhatIf } = useMatch.getState();
  if (!playing) return null;
  const m = ghost.moment;
  const opt = [m.actual, m.ghost, ...m.alternatives].find((o) => optionKey(o) === playing);
  const res: WhatIfResult | undefined = results[playing];
  return (
    <div className="sim-strip">
      <span className="eyebrow">Simulation · {opt ? actionLabel(opt, name) : ''}</span>
      {!done && (
        <div className="sim-progress">
          <div />
        </div>
      )}
      <p>
        {!res
          ? 'Simulating from the frozen moment…'
          : done
            ? `This run ended in ${OUTCOME[res.replayOutcome]}${res.replayXg ? ` (xG ${res.replayXg.toFixed(2)})` : ''}. One of ${res.summary.rollouts} simulated runs: ${pct(res.summary.shotRate)} led to a shot, ${pct(res.summary.goalRate)} to a goal.`
            : `Playing one of ${res.summary.rollouts} simulated runs on the pitch…`}
      </p>
      <div className="btn-row">
        <button onClick={() => simulate(playing, true)}>Replay</button>
        <button className="btn-quiet" onClick={stopWhatIf}>
          Exit simulation
        </button>
      </div>
    </div>
  );
}

function LiveInsights() {
  return (
    <aside className="rightcol" aria-label="Live insights">
      <div className="insights-head">
        <span className="eyebrow">Live insights</span>
      </div>
      <div className="insights-body">
        <TimelineTab />
      </div>
    </aside>
  );
}

export function GhostPanel() {
  const ghost = useMatch((s) => s.ghost);
  const meta = useMatch((s) => s.meta);
  const moments = useMatch((s) => s.moments);
  const why = useMatch((s) => (s.ghost ? s.explanations[s.ghost.moment.eventId] : undefined));
  const results = useMatch((s) => s.whatIf);
  const playing = useMatch((s) => s.whatIfPlaying);
  const returnToReport = useMatch((s) => s.returnToReport);
  const { closeGhost, nextMoment, simulate } = useMatch.getState();
  const [showAll, setShowAll] = useState(false);
  if (!ghost || !meta) return <LiveInsights />;

  const { moment } = ghost;
  const who = playerLookup(meta);
  const name = (id?: string) => who(id)?.shortName ?? 'a teammate';
  const p = who(moment.playerId);
  const club = meta[moment.team];
  const ghostKey = optionKey(moment.ghost);
  const actualKey = optionKey(moment.actual);
  const options = [moment.actual, ...moment.alternatives.filter((o) => optionKey(o) !== actualKey)];
  const outcome = moment.actualOutcome ? RESULT[moment.actualOutcome] ?? moment.actualOutcome : undefined;
  const half = moment.period === 1 ? '1st half' : '2nd half';
  const index = moments.findIndex((m) => m.eventId === moment.eventId);

  return (
    <aside className="rightcol" aria-label="Ghost moment" key={moment.eventId}>
      <div className="gp-head">
        <div className="gp-kicker">
          <span>
            <i className="diamond" />
            GHOST MOMENT{index >= 0 ? ` ${index + 1} OF ${moments.length}` : ''}
          </span>
          <span className="mono">
            {minute(moment.clockMs)} · {half}
          </span>
        </div>
        <div className="gp-player">
          <span className="club-bar" style={{ background: teamColor(meta, moment.team) }} />
          <div>
            <div className="gp-player-name">
              {p?.name} <span className="role">{p?.role}</span>
            </div>
            <span className="gp-player-sub">
              {club.name}
              {p ? ` · #${p.number}` : ''} · chose {choicePhrase(moment.actual, name)}
              {outcome ? ` (${outcome})` : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="gp-body">
        <SimulationStrip name={name} />

        <section className="gp-section">
          <div className="gp-section-head">
            <span className="eyebrow">Why it mattered</span>
            {why && <AiBadge source={why.source} />}
          </div>
          {why ? (
            <p className="gp-why" dir="auto">
              {why.text}
            </p>
          ) : (
            <p className="gp-why pending">Analysing the moment…</p>
          )}
        </section>

        <section className="gp-section">
          <div className="gp-section-head">
            <span className="eyebrow">Decision comparison</span>
            <button className="link" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
              {showAll ? 'Hide options' : `All options (${options.length})`}
            </button>
          </div>
          <div className="compare">
            <OptionCard o={moment.actual} kind="actual" name={name} outcome={outcome} />
            <OptionCard o={moment.ghost} kind="ghost" name={name} />
          </div>
          <div className="verdict">
            <div title="Expected value, in goal-probability units">
              <b>{signed(moment.evLost)}</b>
              <span>Expected value left on the table</span>
            </div>
            <div>
              <b>{moment.sim ? signed(moment.sim.ghost - moment.sim.actual) : '–'}</b>
              <span>xG gained across {moment.sim?.rollouts ?? 50} simulations</span>
            </div>
          </div>
          {showAll && (
            <>
              <table className="options-table">
                <thead>
                  <tr>
                    <th>Option</th>
                    <th>Success</th>
                    <th>EV</th>
                    <th>Δ vs chosen</th>
                    <th>Sim xG</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {options.map((o) => {
                    const k = optionKey(o);
                    const res = results[k];
                    const isActual = k === actualKey;
                    return (
                      <tr key={k} className={`${isActual ? 'is-actual' : k === ghostKey ? 'is-ghost' : ''}${playing === k ? ' is-playing' : ''}`}>
                        <td>
                          {actionLabel(o, name)}
                          {isActual ? ' (chosen)' : k === ghostKey ? <span className="best">Best</span> : ''}
                        </td>
                        <td>{pct(o.pSuccess)}</td>
                        <td>{o.expectedValue.toFixed(3)}</td>
                        <td>{isActual ? '–' : signed(o.deltaVsActual)}</td>
                        <td>{res ? res.summary.expectedGoals.toFixed(3) : '–'}</td>
                        <td>
                          <button onClick={() => simulate(k, true)} title="Simulate this option">
                            Run
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="gp-note">
                EV = chance it comes off × threat gained − chance it fails × threat handed to the opponent. Simulate restarts the match engine from this exact frozen frame,
                makes the player take the option, and plays the move out 50 times; one run is shown on the pitch.
              </p>
            </>
          )}
        </section>

        {moment.reasons.length > 0 && (
          <section className="gp-section">
            <span className="eyebrow">Key factors</span>
            <ul className="factors">
              {moment.reasons.map((r, i) => (
                <li key={i} className={r.about}>
                  {r.text.charAt(0).toUpperCase() + r.text.slice(1)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="gp-foot">
        {ghost.live ? (
          <>
            <button className="btn-primary" onClick={closeGhost}>
              Continue match
            </button>
            <button onClick={nextMoment} title="Skip to the next ghost moment">
              Next moment
            </button>
          </>
        ) : (
          <>
            <button className="btn-primary" onClick={closeGhost}>
              {returnToReport ? 'Back to report' : 'Back to the match'}
            </button>
            <span />
          </>
        )}
      </div>
    </aside>
  );
}
