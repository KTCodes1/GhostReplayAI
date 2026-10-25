import { useEffect, useState } from 'react';
import { PitchScene } from './pitch/Scene';
import { useMatch } from './store';
import { GhostPanel } from './ui/GhostPanel';
import { EventFooter, FreeCamHint, GoalBanner, Header, LowerThird, MatchBar, Scrubber, StageHeader, StartHeader } from './ui/Panels';
import { ReportScreen } from './ui/Report';
import { Sidebar } from './ui/Sidebar';

type Club = { id: string; name: string; shortName: string; colors: { primary: string; secondary: string }; formation: string };

const FEATURES: [string, string][] = [
  ['Live decision detection', 'Every on-ball choice is scored against every alternative. The big misses freeze the play, with an AI explanation of why it mattered.'],
  ['What-if simulation', 'Restart the match engine from the frozen frame, play the better option out 50 times, and watch one run on the pitch.'],
  ['Broadcast-ready output', 'Live stats, a full-time report with decision scores and ratings, and timed overlay cues as JSON.'],
];

function StartScreen() {
  const connect = useMatch((s) => s.connect);
  const status = useMatch((s) => s.status);
  const error = useMatch((s) => s.error);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [seed, setSeed] = useState(7);
  const [speed, setSpeed] = useState(8);
  const [loadError, setLoadError] = useState<string>();

  // Deep link for demos: /?seed=7&home=rva&away=imc&speed=8&autostart[&jump][&holdMs=9000]
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (!q.has('autostart')) return;
    connect({ seed: Number(q.get('seed') ?? 7), home: q.get('home') ?? undefined, away: q.get('away') ?? undefined, speed: Number(q.get('speed') ?? 8), holdMs: q.has('holdMs') ? Number(q.get('holdMs')) : undefined, jump: q.has('jump') });
  }, [connect]);

  useEffect(() => {
    fetch('/api/clubs')
      .then((r) => r.json())
      .then(setClubs)
      .catch(() => setLoadError('Match server not reachable. Start it with `npm run dev`.'));
  }, []);

  const same = home && away && home === away;
  const clubSelect = (value: string, set: (v: string) => void) => (
    <select value={value} onChange={(e) => set(e.target.value)}>
      <option value="">Random club</option>
      {clubs.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="start">
      <StartHeader />
      <div className="start-main">
        <div className="start-inner">
          <div>
            <span className="eyebrow">Match intelligence</span>
            <h1>See the decisions behind every match.</h1>
            <p className="start-lede">
              Ghost Replay watches a live match, spots the moments a player made the wrong call, freezes the play and shows the option they missed, with the expected goals it would have created.
            </p>
            <div className="features">
              {FEATURES.map(([title, text]) => (
                <div key={title} className="feature">
                  <b>{title}</b>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="setup">
            <span className="eyebrow">New analysis</span>
            <h2>Set up a match</h2>
            <div className="setup-teams">
              <label className="field">
                Home
                {clubSelect(home, setHome)}
              </label>
              <span className="setup-vs">VS</span>
              <label className="field">
                Away
                {clubSelect(away, setAway)}
              </label>
            </div>
            <div className="setup-row">
              <label className="field">
                Match seed
                <input type="number" className="mono" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
              </label>
              <label className="field">
                Playback speed
                <select className="mono" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  {[1, 4, 8, 20, 60].map((v) => (
                    <option key={v} value={v}>
                      {v}× {v === 1 ? '(real time)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="btn-primary" disabled={!!same || status === 'connecting'} onClick={() => connect({ seed, home: home || undefined, away: away || undefined, speed })}>
              {status === 'connecting' ? 'Connecting…' : 'Start live analysis'}
            </button>
            {same && <div className="error">Pick two different clubs.</div>}
            {(loadError || error) && <div className="error">{error ?? loadError}</div>}
            <p className="setup-note">Synthetic data only: invented clubs and players, generated live from the seed. The same seed always replays the same match.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const status = useMatch((s) => s.status);
  const meta = useMatch((s) => s.meta);
  const error = useMatch((s) => s.error);
  const reportOpen = useMatch((s) => s.reportOpen);
  const frozen = useMatch((s) => !!s.ghost);
  if (!meta || status === 'idle' || status === 'connecting' || (status === 'error' && !meta)) return <StartScreen />;
  return (
    <div className="app">
      <Header />
      {reportOpen && <ReportScreen />}
      {/* The live view stays mounted under the report so the 3D scene isn't rebuilt on return. */}
      <div style={{ display: reportOpen ? 'none' : 'contents' }}>
        <MatchBar />
        <Scrubber />
        <main className="body">
          <Sidebar />
          <section className="stage">
            <StageHeader />
            <div className="canvas-wrap">
              <div className={`canvas-inner${frozen ? " free" : ""}`}>
                <PitchScene />
                <GoalBanner />
                <LowerThird />
                <FreeCamHint />
                {status === 'error' && <div className="overlay-error">{error}</div>}
              </div>
            </div>
            <EventFooter />
          </section>
          <GhostPanel />
        </main>
      </div>
    </div>
  );
}
