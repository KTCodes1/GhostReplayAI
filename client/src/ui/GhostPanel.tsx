// The right-hand column. During a ghost moment, one clear hierarchy —
// who & what happened → (your call) → why it mattered → chose vs better option → outcome tree →
// factors → every option → pundit sketch. Genius moments flip it: what they found vs the obvious ball.
// Otherwise it shows the live insights feed.

import { type DecisionMoment, type GhostOption, type GhostTree, type WhatIfOutcome, type WhatIfResult, hashSeed, optionKey } from '@ghost/engine';
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
const SEEN: Record<NonNullable<GhostOption['visibility']>, string> = { visible: 'In view', peripheral: 'Edge of vision', behind: 'Behind them' };
const SEEN_SHORT: Record<NonNullable<GhostOption['visibility']>, string> = { visible: 'View', peripheral: 'Edge', behind: 'Behind' };
const LETTERS = 'ABCDEF';

export function actionLabel(o: Pick<GhostOption, 'action' | 'targetPlayerId'>, name: (id?: string) => string) {
  return o.action === 'shot' ? 'Shoot' : o.action === 'carry' ? 'Drive forward' : `Pass to ${name(o.targetPlayerId)}`;
}

/** The options offered in "You're the player", in a stable order that doesn't give the answer away. */
export function predictOptions(m: DecisionMoment): GhostOption[] {
  const seen = new Set<string>();
  const pool = [m.actual, m.ghost, ...m.alternatives].filter((o) => {
    const k = optionKey(o);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return pool.slice(0, 5).sort((a, b) => hashSeed(`${m.eventId}|${optionKey(a)}`) - hashSeed(`${m.eventId}|${optionKey(b)}`));
}

type CardKind = 'actual' | 'ghost' | 'found' | 'obvious';
const CARD_LABEL: Record<CardKind, string> = { actual: 'CHOSEN', ghost: 'BETTER OPTION', found: 'WHAT THEY FOUND', obvious: 'THE OBVIOUS BALL' };

function OptionCard({ o, kind, name, outcome }: { o: GhostOption; kind: CardKind; name: (id?: string) => string; outcome?: string }) {
  const key = optionKey(o);
  const sim = useMatch((s) => s.whatIf[key]);
  const playing = useMatch((s) => s.whatIfPlaying === key);
  const simulate = useMatch((s) => s.simulate);
  const s = sim?.summary;
  const chance = o.action === 'shot' ? 'Chance of scoring' : 'Chance it comes off';
  const runs = s?.rollouts ?? 50;
  const primary = kind === 'ghost' || kind === 'found';
  return (
    <div className={`opt-card ${kind}${playing ? ' playing' : ''}`}>
      <span className="opt-label">{CARD_LABEL[kind]}</span>
      <span className="opt-action">{actionLabel(o, name)}</span>
      <div className="opt-metric">
        <span>{chance}</span>
        <b>{pct(o.pSuccess)}</b>
      </div>
      <div className="opt-metric" title="Expected goals from choosing this, from 50 simulations with defenders reacting">
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
      {o.visibility && (
        <div className="opt-metric" title="Worked out from which way the player was facing and how much time they had">
          <span>Could they see it</span>
          <b className={`seen ${o.visibility}`}>{SEEN[o.visibility]}</b>
        </div>
      )}
      {o.followUp && (
        <div className="opt-note" title="Two-step look-ahead: the best next action from there">
          Sets up {o.followUp.action === 'pass' ? `a pass to ${name(o.followUp.targetPlayerId)}` : o.followUp.action === 'shot' ? 'a shot' : 'a run'} next
        </div>
      )}
      {o.execution && o.execution.notes.length > 0 && o.execution.fit < 0.9 && <div className="opt-note">Harder to execute: {o.execution.notes.join(', ')}</div>}
      {outcome && <span className="opt-outcome">Result: {outcome}</span>}
      <button className={primary ? 'btn-primary' : undefined} onClick={() => simulate(key, true)} title="Replay the match from this frozen moment with this option, on the pitch">
        {playing ? 'Replay simulation' : primary ? `Simulate ${runs} runs` : 'Simulate'}
      </button>
    </div>
  );
}

/** Branching outcomes of an option across the simulations: football as probabilities, not certainties. */
function TreeRow({ label, tree, kind, shot }: { label: string; tree: GhostTree; kind: 'ghost' | 'actual' | 'found'; shot: boolean }) {
  const lost = 1 - tree.arrive;
  return (
    <div className={`tree ${kind}`}>
      <span className="tree-label">{label}</span>
      <div className="tree-branch">
        <span className="tree-bar ok" style={{ width: `${Math.max(2, tree.arrive * 100)}%` }} />
        <span className="tree-text">
          {shot ? (
            <>
              <b>{pct(tree.arrive)}</b> goal
            </>
          ) : (
            <>
              <b>{pct(tree.arrive)}</b> comes off, then <b>{pct(tree.thenShot)}</b> shot · <b>{pct(tree.thenGoal)}</b> goal · <b>{pct(tree.thenKept)}</b> kept · <b>{pct(tree.thenLost)}</b> lost
            </>
          )}
        </span>
      </div>
      <div className="tree-branch">
        <span className="tree-bar bad" style={{ width: `${Math.max(2, lost * 100)}%` }} />
        <span className="tree-text">
          <b>{pct(lost)}</b> {shot ? 'saved, blocked or wide' : 'cut out'}
          {!shot && lost > 0 ? (
            <>
              , then <b>{pct(tree.counterShot)}</b> counter-attack shot against
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function OutcomeTree({ moment, name }: { moment: DecisionMoment; name: (id?: string) => string }) {
  const results = useMatch((s) => s.whatIf);
  const genius = moment.kind === 'genius';
  const a = results[optionKey(moment.actual)];
  const g = results[optionKey(moment.ghost)];
  if (!a && !g) return null;
  return (
    <section className="gp-section">
      <div className="gp-section-head">
        <span className="eyebrow">Outcome tree</span>
        <span className="hint">{a?.summary.rollouts ?? g?.summary.rollouts ?? 50} runs each, defenders reacting</span>
      </div>
      {genius ? (
        <>
          {a && <TreeRow label={actionLabel(moment.actual, name)} tree={a.summary.tree} kind="found" shot={moment.actual.action === 'shot'} />}
          {g && <TreeRow label={actionLabel(moment.ghost, name)} tree={g.summary.tree} kind="actual" shot={moment.ghost.action === 'shot'} />}
        </>
      ) : (
        <>
          {g && <TreeRow label={actionLabel(moment.ghost, name)} tree={g.summary.tree} kind="ghost" shot={moment.ghost.action === 'shot'} />}
          {a && <TreeRow label={actionLabel(moment.actual, name)} tree={a.summary.tree} kind="actual" shot={moment.actual.action === 'shot'} />}
        </>
      )}
    </section>
  );
}

function SimulationStrip({ name }: { name: (id?: string) => string }) {
  const ghost = useMatch((s) => s.ghost)!;
  const playing = useMatch((s) => s.whatIfPlaying);
  const done = useMatch((s) => s.whatIfDone);
  const results = useMatch((s) => s.whatIf);
  const sketches = useMatch((s) => s.sketches[ghost.moment.eventId] ?? []);
  const { simulate, stopWhatIf } = useMatch.getState();
  if (!playing) return null;
  const m = ghost.moment;
  const opt = [m.actual, m.ghost, ...m.alternatives, ...sketches.map((x) => x.verdict.option)].find((o) => optionKey(o) === playing);
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
            ? `This run ended in ${OUTCOME[res.replayOutcome]}${res.replayXg ? ` (xG ${res.replayXg.toFixed(2)})` : ''}. One of ${res.summary.rollouts} simulated runs: it came off ${pct(res.summary.pSuccess)} of the time, and ${pct(res.summary.shotRate)} of those led to a shot.`
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

/** "You're the player": pick before the reveal. */
function PredictPicker({ moment, name }: { moment: DecisionMoment; name: (id?: string) => string }) {
  const role = useMatch((s) => s.role);
  const { vote, setRole, setPredictMode } = useMatch.getState();
  const options = predictOptions(moment);
  const p = playerLookup(useMatch.getState().meta)(moment.playerId);
  return (
    <section className="gp-section predict">
      <span className="eyebrow">You're the player</span>
      <p className="predict-q">
        You're {p?.shortName ?? 'on the ball'}. What do you do? Pick before the reveal; the lettered arrows are on the pitch.
      </p>
      <div className="predict-options">
        {options.map((o, i) => (
          <button key={optionKey(o)} className="predict-option" onClick={() => vote(optionKey(o))}>
            <span className="predict-letter">{LETTERS[i]}</span>
            <span>{actionLabel(o, name)}</span>
          </button>
        ))}
      </div>
      <div className="predict-foot">
        <label className="check">
          <input type="checkbox" checked={role === 'coach'} onChange={(e) => setRole(e.target.checked ? 'coach' : 'fan')} />I coach or play
        </label>
        <button className="link" onClick={() => setPredictMode(false)}>
          Turn off
        </button>
      </div>
    </section>
  );
}

/** After the vote: you vs the engine vs what happened vs the crowd. */
function PredictReveal({ moment, name, mine }: { moment: DecisionMoment; name: (id?: string) => string; mine: string }) {
  const votes = useMatch((s) => s.votes[moment.eventId]);
  const options = predictOptions(moment);
  const engineKey = moment.kind === 'genius' ? optionKey(moment.actual) : optionKey(moment.ghost);
  const actualKey = optionKey(moment.actual);
  const label = (k: string) => {
    const o = options.find((x) => optionKey(x) === k) ?? [moment.actual, moment.ghost, ...moment.alternatives].find((x) => optionKey(x) === k);
    return o ? actionLabel(o, name) : 'another option';
  };
  const tally = votes?.tally ?? {};
  const total = votes?.total ?? 0;
  const ranked = Object.entries(tally)
    .map(([k, v]) => ({ k, n: v.fans + v.coaches, coaches: v.coaches }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);
  const agreed = mine === engineKey;
  return (
    <section className="gp-section reveal">
      <div className="gp-section-head">
        <span className="eyebrow">Your call</span>
        <span className={`pill ${agreed ? 'ok' : 'warn'}`}>{agreed ? 'Same as the engine' : 'Different from the engine'}</span>
      </div>
      <div className="reveal-grid">
        <span>You</span>
        <b>{label(mine)}</b>
        <span>The engine</span>
        <b className="ai">{label(engineKey)}</b>
        <span>What happened</span>
        <b className="act">{label(actualKey)}</b>
      </div>
      <div className="crowd">
        <span className="hint">{total > 1 ? `Everyone who has voted on this moment (${total})` : "You're the first to vote on this moment"}</span>
        {ranked.map((r) => (
          <div key={r.k} className={`crowd-row${r.k === mine ? ' mine' : ''}`}>
            <span className="crowd-name">{label(r.k)}</span>
            <span className="crowd-track">
              <span style={{ width: `${(r.n / Math.max(1, total)) * 100}%` }} />
            </span>
            <span className="mono">{pct(r.n / Math.max(1, total))}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SketchSection({ moment }: { moment: DecisionMoment }) {
  const sketching = useMatch((s) => s.sketching);
  const sketches = useMatch((s) => s.sketches[moment.eventId] ?? []);
  const playing = useMatch((s) => s.whatIfPlaying);
  const { setSketching, simulate } = useMatch.getState();
  return (
    <section className="gp-section">
      <div className="gp-section-head">
        <span className="eyebrow">Pundit sketch</span>
        <button className={sketching ? 'btn-ai' : undefined} onClick={() => setSketching(!sketching)}>
          {sketching ? 'Cancel' : 'Draw an option'}
        </button>
      </div>
      {sketching ? (
        <p className="gp-note">Click the pitch where the ball should go: on a teammate for a pass, into space for a through ball, close by for a run, the goal mouth for a shot. The engine scores and simulates it.</p>
      ) : sketches.length === 0 ? (
        <p className="gp-note">Think there was something better? Draw it and the engine tests it with the same models and 50 simulations.</p>
      ) : null}
      {sketches.map((x, i) => {
        const o = x.verdict.option;
        const s = x.whatif.summary;
        return (
          <div key={x.whatif.key} className={`sketch-card${playing === x.whatif.key ? ' playing' : ''}`}>
            <div className="sketch-head">
              <b>
                Sketch {i + 1}: {x.verdict.readAs}
              </b>
              <span className="mono">
                #{x.verdict.rank} of {x.verdict.of}
              </span>
            </div>
            <div className="sketch-stats mono">
              <span>{pct(o.pSuccess)} to come off</span>
              <span className={o.deltaVsActual > 0 ? 'pos' : 'neg'}>{signed(o.deltaVsActual)} vs chosen</span>
              <span>{s.expectedGoals.toFixed(3)} xG in sim</span>
            </div>
            {x.verdict.notes.length > 0 && <div className="opt-note">{x.verdict.notes.join('; ')}</div>}
            {x.note ? (
              <p className="sketch-note" dir="auto">
                {x.note.text} <AiBadge source={x.note.source} />
              </p>
            ) : (
              <p className="sketch-note pending">Writing the verdict…</p>
            )}
            <button onClick={() => simulate(x.whatif.key, true)}>Play it</button>
          </div>
        );
      })}
    </section>
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

const CONFIDENCE: Record<string, string> = { clear: 'Clear call', likely: 'Likely', close: 'Close call' };

export function GhostPanel() {
  const ghost = useMatch((s) => s.ghost);
  const meta = useMatch((s) => s.meta);
  const moments = useMatch((s) => s.moments);
  const why = useMatch((s) => (s.ghost ? s.explanations[s.ghost.moment.eventId] : undefined));
  const results = useMatch((s) => s.whatIf);
  const playing = useMatch((s) => s.whatIfPlaying);
  const returnToReport = useMatch((s) => s.returnToReport);
  const predictMode = useMatch((s) => s.predictMode);
  const mine = useMatch((s) => (s.ghost ? s.myVotes[s.ghost.moment.eventId] : undefined));
  const { closeGhost, nextMoment, simulate } = useMatch.getState();
  const [showAll, setShowAll] = useState(false);
  if (!ghost || !meta) return <LiveInsights />;

  const { moment } = ghost;
  const genius = moment.kind === 'genius';
  const who = playerLookup(meta);
  const name = (id?: string) => who(id)?.shortName ?? 'a teammate';
  const p = who(moment.playerId);
  const club = meta[moment.team];
  const ghostKey = optionKey(moment.ghost);
  const actualKey = optionKey(moment.actual);
  const options = [moment.actual, ...moment.alternatives.filter((o) => optionKey(o) !== actualKey)];
  const outcome = moment.actualOutcome ? RESULT[moment.actualOutcome] ?? moment.actualOutcome : undefined;
  const half = moment.period === 1 ? '1st half' : '2nd half';
  const same = moments.filter((m) => m.kind === moment.kind);
  const index = same.findIndex((m) => m.eventId === moment.eventId);
  const guessing = predictMode && !mine;
  const state = moment.gameState && moment.gameState.code !== 'open' ? moment.gameState.label : undefined;

  return (
    <aside className={`rightcol${genius ? ' genius' : ''}`} aria-label={genius ? 'Genius moment' : 'Ghost moment'} key={moment.eventId}>
      <div className="gp-head">
        <div className="gp-kicker">
          <span>
            <i className="diamond" />
            {genius ? 'GENIUS MOMENT' : 'GHOST MOMENT'}
            {index >= 0 ? ` ${index + 1} OF ${same.length}` : ''}
          </span>
          <span className="gp-kicker-right">
            {moment.confidence && !guessing && (
              <span className={`conf ${moment.confidence.level}`} title="Model margin and simulation margin combined">
                {CONFIDENCE[moment.confidence.level]} {pct(moment.confidence.score)}
              </span>
            )}
            <span className="mono">
              {minute(moment.clockMs)} · {half}
            </span>
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
              {p ? ` · #${p.number}` : ''}
              {guessing ? ' · on the ball' : ` · ${genius ? 'found' : 'chose'} ${choicePhrase(moment.actual, name)}${outcome ? ` (${outcome})` : ''}`}
            </span>
          </div>
        </div>
        {state && <span className="state-chip">{state}</span>}
      </div>

      <div className="gp-body">
        {guessing ? (
          <PredictPicker moment={moment} name={name} />
        ) : (
          <>
            <SimulationStrip name={name} />
            {predictMode && mine && <PredictReveal moment={moment} name={name} mine={mine} />}

            <section className="gp-section">
              <div className="gp-section-head">
                <span className="eyebrow">{genius ? 'What they saw' : 'Why it mattered'}</span>
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
                {genius ? (
                  <>
                    <OptionCard o={moment.actual} kind="found" name={name} outcome={outcome} />
                    <OptionCard o={moment.ghost} kind="obvious" name={name} />
                  </>
                ) : (
                  <>
                    <OptionCard o={moment.actual} kind="actual" name={name} outcome={outcome} />
                    <OptionCard o={moment.ghost} kind="ghost" name={name} />
                  </>
                )}
              </div>
              <div className="verdict">
                {genius ? (
                  <div title="xT reached over the obvious ball, in goal-probability units">
                    <b>{signed(moment.evGained ?? 0)}</b>
                    <span>More threat than the obvious ball</span>
                  </div>
                ) : (
                  <div title="Expected value, in goal-probability units">
                    <b>{signed(moment.evLost)}</b>
                    <span>Expected value left on the table</span>
                  </div>
                )}
                <div>
                  <b>{moment.sim ? signed(genius ? moment.sim.actual - moment.sim.ghost : moment.sim.ghost - moment.sim.actual) : '–'}</b>
                  <span>xG gained across {moment.sim?.rollouts ?? 50} simulations</span>
                </div>
              </div>
              {showAll && (
                <>
                  <table className="options-table">
                    <thead>
                      <tr>
                        <th>Option</th>
                        <th>Seen</th>
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
                              {isActual ? ' (chosen)' : k === ghostKey ? <span className="best">{genius ? 'Obvious' : 'Best'}</span> : ''}
                              {o.offside && <span className="best off">Offside</span>}
                            </td>
                            <td className="sans" title={o.visibility ? SEEN[o.visibility] : undefined}>{o.visibility ? SEEN_SHORT[o.visibility] : '–'}</td>
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
                    EV = chance it comes off × threat reached (or the best next action it sets up) − chance it fails × threat handed over, scaled for the game state. Options are judged on
                    where players will be when the ball arrives, for what this player can execute. Simulate restarts the match engine from this frozen frame with defenders reacting, and
                    plays the move out 50 times; one run is shown on the pitch.
                  </p>
                </>
              )}
            </section>

            <OutcomeTree moment={moment} name={name} />

            {moment.reasons.length > 0 && (
              <section className="gp-section">
                <span className="eyebrow">{genius ? 'What made it special' : 'Key factors'}</span>
                <ul className="factors">
                  {moment.reasons.map((r, i) => (
                    <li key={i} className={r.about}>
                      {r.text.charAt(0).toUpperCase() + r.text.slice(1)}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <SketchSection moment={moment} />
          </>
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
