// Usage: npm run sim -- [seed] [--json out.json] [--many N]
import { writeFileSync } from 'node:fs';
import { LiveStats, generateMatch } from '../src/index';

const args = process.argv.slice(2);
const many = args.includes('--many') ? Number(args[args.indexOf('--many') + 1]) : 0;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;
const seed = Number(args.find((a) => /^\d+$/.test(a)) ?? 42);

function run(s: number, verbose: boolean) {
  const m = generateMatch({ seed: s });
  const stats = new LiveStats(m.meta);
  for (const e of m.events) stats.push(e);
  const snap = stats.snapshot();
  const counts: Record<string, number> = {};
  for (const e of m.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  if (verbose) {
    console.log(`${m.meta.home.name} ${snap.score.home} - ${snap.score.away} ${m.meta.away.name}  (seed ${s}, ${m.events.length} events)`);
    for (const side of ['home', 'away'] as const) {
      const t = snap.teams[side];
      console.log(
        `  ${side.padEnd(4)} poss ${t.possessionPct.toFixed(0)}%  shots ${t.shots} (${t.shotsOnTarget} on)  xG ${t.xG.toFixed(2)}  passes ${t.passes} @ ${(100 * t.passAccuracy).toFixed(0)}%  avgLen ${t.avgPassDistance.toFixed(1)}m  diff ${t.avgPassDifficulty.toFixed(1)}  xT ${t.xTAdded.toFixed(2)}  press ${t.pressures}  tkl ${t.tackles}  int ${t.interceptions}  fouls ${t.fouls}`,
      );
    }
    console.log('  events:', counts);
    const goals = m.events.filter((e) => e.outcome === 'goal');
    for (const g of goals) console.log(`  GOAL ${Math.floor(g.clockMs / 60000)}' ${g.team} ${g.playerId} ${g.context ?? ''}`);
    const last = m.events[m.events.length - 1]!;
    console.log(`  full time at clock ${(last.clockMs / 60000).toFixed(1)}'`);
  }
  return { snap, counts };
}

if (many) {
  const agg = { goals: 0, shots: 0, xg: 0, passes: 0, acc: 0, pressures: 0, events: 0 };
  for (let s = 1; s <= many; s++) {
    const { snap, counts } = run(s, false);
    const h = snap.teams.home, a = snap.teams.away;
    agg.goals += h.goals + a.goals;
    agg.shots += h.shots + a.shots;
    agg.xg += h.xG + a.xG;
    agg.passes += h.passes + a.passes;
    agg.acc += (h.passesCompleted + a.passesCompleted) / (h.passes + a.passes);
    agg.pressures += h.pressures + a.pressures;
    agg.events += Object.values(counts).reduce((x, y) => x + y, 0);
  }
  const f = (x: number) => (x / many).toFixed(2);
  console.log(`avg over ${many}: goals ${f(agg.goals)} shots ${f(agg.shots)} xG ${f(agg.xg)} passes ${f(agg.passes)} acc ${f(agg.acc * 100)}% pressures ${f(agg.pressures)} events ${f(agg.events)}`);
} else {
  run(seed, true);
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(generateMatch({ seed })));
    console.log(`wrote ${jsonOut}`);
  }
}
