// Usage: npm run ghosts -- [seed]   — prints the live ghost moments and the recap for a match
import { analyzeMatch, buildRoster, generateMatch, type DecisionMoment } from '../src/index';

const seed = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 42);
const match = generateMatch({ seed });
const roster = buildRoster(match.meta);
const { live, recap, detector } = analyzeMatch(match);
const nm = (id?: string) => (id ? roster.get(id)!.info.shortName : '');
const clock = (ms: number) => `${Math.floor(ms / 60000)}'`;

function show(m: DecisionMoment) {
  const a = m.actual;
  const b = m.ghost;
  const sim = m.sim ? `  sim xG ${m.sim.actual.toFixed(3)} → ${m.sim.ghost.toFixed(3)}` : "";
  console.log(
    `${clock(m.clockMs).padStart(4)} ${match.meta[m.team].shortName} ${nm(m.playerId).padEnd(12)} sev ${m.severity.toFixed(3)}  ` +
      `did ${a.action}${a.targetPlayerId ? '→' + nm(a.targetPlayerId) : ''} (p ${a.pSuccess.toFixed(2)}, EV ${a.expectedValue.toFixed(3)}, ${m.actualOutcome})  ` +
      `ghost ${b.action}${b.targetPlayerId ? "→" + nm(b.targetPlayerId) : ""} (p ${b.pSuccess.toFixed(2)}, EV ${b.expectedValue.toFixed(3)}, +${b.deltaVsActual.toFixed(3)})` + sim,
  );
  for (const r of m.reasons) console.log(`        · ${r.text}`);
}

console.log(`${match.meta.home.name} ${match.events.at(-1)!.score.home}-${match.events.at(-1)!.score.away} ${match.meta.away.name}`);
console.log(`\nLIVE (${live.length}):`);
live.forEach(show);
console.log(`\nRECAP — the decisions that shaped the match:`);
recap.forEach(show);
const a = detector.analyses();
const sev = a.map((x) => x.severity).sort((p, q) => q - p);
console.log(`\n${a.length} decisions analysed; best choice ${(100 * a.filter((x) => x.choseBest).length / a.length).toFixed(0)}%; severity p50 ${sev[Math.floor(sev.length / 2)]!.toFixed(4)} p95 ${sev[Math.floor(sev.length * 0.05)]!.toFixed(3)} p99 ${sev[Math.floor(sev.length * 0.01)]!.toFixed(3)} >0.03: ${sev.filter((s) => s > 0.03).length}`);
const recs = detector.playerRecords().filter((r) => r.decisions >= 30).sort((x, y) => y.bestChoices / y.decisions - x.bestChoices / x.decisions);
for (const r of [recs[0]!, recs.at(-1)!]) console.log(`  ${nm(r.playerId)}: best option ${r.bestChoices}/${r.decisions}, EV lost ${r.evLost.toFixed(2)}`);
