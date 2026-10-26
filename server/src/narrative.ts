// Turns engine facts into words: instant template commentary for live events, and
// AI-written explanations / studio lines (with template fallbacks) for the big moments.

import {
  type DecisionMoment,
  type EventMetrics,
  type GhostOption,
  type MatchEvent,
  type MatchMeta,
  type PlayerInfo,
  type Side,
  type StatsSnapshot,
  type MatchReport,
  type GhostAnalysis,
  type SketchVerdict,
  type WhatIfResult,
  type Evidence,
  type EvidenceFact,
  type MatchPulse,
  type PulseSpell,
  type Roster,
  buildRoster,
  checkAgainstFacts,
  hashSeed,
  momentFacts,
  parseClaimed,
  templateExplanation,
  withFacts,
} from '@ghost/engine';
import { type AskResult, askAI } from './ai/askAI';

/** An AI answer plus how it was checked against the engine's facts. */
export type CheckedResult = AskResult & { evidence?: Evidence };

const SYSTEM = [
  'You are the co-commentator and studio analyst for "Premier League Studio", covering a SYNTHETIC match between invented clubs.',
  'Use only the facts you are given. Never invent statistics, players, scores or events.',
  'Refer to players by surname. Never use gendered pronouns (he/him/she/her) for players: use the name, "they", or the role.',
  'Plain text only: no markdown, no lists, no emojis, no quotation marks around the whole answer.',
  'Write numbers as digits (62%, 0.14), never spelled out, and respect the word limit.',
].join(' ');

export class Narrator {
  private players = new Map<string, { info: PlayerInfo; team: Side }>();
  private roster: Roster;

  constructor(private meta: MatchMeta) {
    this.roster = buildRoster(meta);
    for (const team of ['home', 'away'] as Side[]) for (const info of meta[team].players) this.players.set(info.id, { info, team });
  }

  private system(): string {
    return `${SYSTEM} The audience are analysts: be precise and quote the numbers you are given.`;
  }

  private name = (id?: string) => (id ? this.players.get(id)?.info.shortName ?? 'a teammate' : 'a teammate');
  private club = (side: Side) => this.meta[side].name;
  private minute = (clockMs: number) => `${Math.floor(clockMs / 60000) + 1}'`;
  private scoreline = (s: { home: number; away: number }) => `${this.meta.home.name} ${s.home}-${s.away} ${this.meta.away.name}`;

  // ---- live commentary (templates: instant, free, never rate-limited) --------------

  commentary(e: MatchEvent, m: EventMetrics): string | undefined {
    const who = this.name(e.playerId);
    const club = this.club(e.team);
    const pick = (lines: string[]) => lines[hashSeed(e.id) % lines.length]!;
    const xg = m.xG ?? 0;
    switch (e.type) {
      case 'kickoff':
        return e.t === 0 ? `We're under way: ${this.meta.home.name} against ${this.meta.away.name}.` : e.period === 2 && e.clockMs <= this.meta.halfLengthMs + 1000 ? 'The second half is under way.' : undefined;
      case 'shot': {
        if (e.context === 'penalty') return e.outcome === 'goal' ? `${who} steps up... and scores the penalty! ${this.scoreline(e.score)}.` : `${who} steps up... and the penalty is ${e.outcome === 'saved' ? 'saved' : 'missed'}!`;
        if (e.outcome === 'goal')
          return pick([
            `GOAL! ${who} finds the net for ${club}. ${this.scoreline(e.score)}.`,
            `${who} scores! ${club} celebrate. ${this.scoreline(e.score)}.`,
            `It's in! ${who} with the finish. ${this.scoreline(e.score)}.`,
          ]);
        const big = xg >= 0.25;
        const dist = m.xG !== undefined ? Math.round(Math.hypot(105 - e.start.x, 34 - e.start.y)) : 0;
        if (e.outcome === 'saved') return big ? `Huge chance for ${who}, but the keeper saves! That was ${pct(xg)} xG.` : `${who} tries from ${dist} m, saved.`;
        if (e.outcome === 'blocked') return pick([`${who} shoots from ${dist} m, blocked.`, `${who} lets fly but it's charged down.`]);
        return big ? `${who} should have scored there! Off target from a ${pct(xg)} xG chance.` : pick([`${who} tries from ${dist} m, wide.`, `${who} shoots, off target.`]);
      }
      case 'foul':
        return e.context === 'penalty' ? `Penalty! ${who} brings a player down in the box.` : undefined;
      case 'half_time':
        return `Half time: ${this.scoreline(e.score)}.`;
      case 'full_time':
        return `Full time: ${this.scoreline(e.score)}.`;
      default:
        return undefined;
    }
  }

  /** One-line player profile (synthetic ratings and season stats) for the AI's facts. */
  private profile(id: string): string {
    const p = this.players.get(id)?.info;
    if (!p) return '';
    const a = p.attrs;
    const { previous: v, current: c } = p.seasons;
    const r = (x: number) => Math.round(x * 100);
    return `${p.shortName} (${p.role}): finishing ${r(a.finishing)}, passing ${r(a.passing)}, dribbling ${r(a.dribbling)}, tackling ${r(a.tackling)}, pace ${r(a.pace)} (out of 100); ${v.season}: ${v.goals} goals, ${v.assists} assists in ${v.apps} games; ${c.season} so far: ${c.goals} goals, ${c.assists} assists in ${c.apps}.`;
  }

  // ---- AI moments ------------------------------------------------------------------

  private describe(o: GhostOption): string {
    if (o.action === 'shot') return `a shot (${pct(o.pSuccess)} chance of scoring)`;
    if (o.action === 'carry') return `driving forward with the ball (${pct(o.pSuccess)} chance of getting past the press)`;
    const bypass = o.features?.bypassed ? `, taking ${o.features.bypassed} defenders out of the game` : '';
    return `a pass to ${this.name(o.targetPlayerId)} (${pct(o.pSuccess)} chance to arrive${bypass})`;
  }

  /**
   * Check an AI answer's numbers and names against the facts it was given; anything unsupported
   * means the template (written from the same facts) is used instead.
   */
  private async verified(job: Promise<AskResult>, factLines: string[], fallback: string): Promise<CheckedResult> {
    const facts: EvidenceFact[] = factLines.filter(Boolean).map((text, i) => ({ id: `F${i + 1}`, text }));
    const r = await job;
    if (r.source === 'template') return { ...r, evidence: { status: 'template', claims: [], checked: facts.length, rejected: [] } };
    const problems = checkAgainstFacts(r.text, null, facts, this.roster);
    if (!problems.length) return { ...r, evidence: { status: 'verified', claims: [], checked: facts.length, rejected: [] } };
    console.warn(`[evidence] rejected AI text (${problems.join('; ')}): ${r.text}`);
    return { text: fallback, source: 'template', evidence: { status: 'template', claims: [], checked: facts.length, rejected: problems } };
  }

  /**
   * Why did this moment matter (or, for a genius moment, what made it special)? Evidence-checked:
   * the AI sees only the engine's numbered facts, must list the facts behind each claim, and the
   * answer is validated; a rejected answer is regenerated once with the problems spelled out, then
   * we fall back to an explanation written straight from the facts. When the Fair Play lens says
   * there isn't enough evidence, that is what the viewer is told.
   */
  async explainMoment(mo: DecisionMoment, e: MatchEvent): Promise<CheckedResult> {
    const facts = momentFacts(mo, e, this.roster);
    const tpl = templateExplanation(mo, facts, this.roster);
    const fromTemplate = (status: Evidence['status'], rejected: string[]): CheckedResult => ({
      text: tpl.explanation,
      source: 'template',
      evidence: { status, claims: withFacts(tpl.claims, facts), checked: facts.length, rejected },
    });
    if (mo.fairPlay?.verdict === 'insufficient') return fromTemplate('insufficient', []);

    const genius = mo.kind === 'genius';
    const who = this.name(mo.playerId);
    const task = genius
      ? `This was a moment of genius, not a mistake. As a TV analyst, celebrate in two short sentences (under 50 words) what ${who} saw that others wouldn't and why it was the right ball.`
      : `As a TV analyst, explain in two short sentences (under 50 words) why this moment mattered and what the better option was. Name the cause (the gap, the run, the overload) rather than just the numbers. Be fair: if it was on the edge of their vision or hard to execute, say so.`;
    const rules =
      'Use ONLY the facts below. Every number you write must appear in the facts, exactly as written there. Mention only players named in the facts. ' +
      'Reply with ONLY a JSON object: {"explanation": "<your two sentences>", "claims": [{"text": "<one claim from the explanation>", "facts": ["F3", "F8"]}]}. ' +
      'Every sentence of the explanation must be covered by a claim, and every claim must list the fact ids it relies on.';
    const sheet = facts.map((f) => `${f.id}: ${f.text}`).join('\n');
    const rejected: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const retry = attempt ? `\n\nYour previous answer was rejected because: ${rejected.join('; ')}. Fix every one of these.` : '';
      const r = await askAI(`Facts from the match engine:\n${sheet}\n\n${task}\n${rules}${retry}`, {
        system: this.system(),
        fallback: '',
        maxTokens: 450,
        temperature: attempt ? 0.3 : 0.6,
        cacheKey: `${genius ? 'genius' : 'ghost'}:${mo.eventId}:${attempt}`,
      });
      if (r.source === 'template' || !r.text) break; // AI unavailable: no point retrying
      const parsed = parseClaimed(r.text);
      const problems = parsed ? checkAgainstFacts(parsed.explanation, parsed.claims, facts, this.roster) : ['the answer was not in the required JSON format'];
      if (parsed && !problems.length)
        return { text: parsed.explanation, source: r.source, evidence: { status: attempt ? 'regenerated' : 'verified', claims: withFacts(parsed.claims, facts), checked: facts.length, rejected } };
      console.warn(`[evidence] draft ${attempt + 1} for ${mo.eventId} rejected: ${problems.join('; ')}`);
      rejected.push(...problems);
    }
    return fromTemplate('template', rejected);
  }

  /** A spell in the Match Pulse ("sustained pressure, but passing is becoming predictable"), checked against its facts. */
  pulseLine(spell: PulseSpell, pulse: MatchPulse): Promise<CheckedResult> {
    const club = (txt: string) => txt.replace(/^home\b/, this.meta.home.name).replace(/^away\b/, this.meta.away.name).replace(/; home:/, `; ${this.meta.home.name}:`).replace(/; away:/, `; ${this.meta.away.name}:`);
    const team = spell.team ? this.club(spell.team) : 'Both sides';
    const facts = [`Minute ${this.minute(pulse.clockMs)}, the last 5 minutes.`, `Spell: ${team}: ${spell.label.toLowerCase()}.`, ...spell.facts.map(club)];
    const fallback = `${team}: ${spell.label.toLowerCase()}. ${club(spell.facts[0] ?? '')}`.trim();
    const prompt = `${facts.join('\n')}\n\nAs the studio analyst, sum up this spell of the match in one punchy sentence (under 28 words), like a TV pundit would say it. Use at most two numbers, written exactly as in the facts, and only these facts.`;
    return this.verified(askAI(prompt, { system: this.system(), fallback, maxTokens: 140, priority: 'low', cacheKey: `pulse:${this.meta.matchId}:${Math.floor(pulse.clockMs / 60000)}:${spell.code}` }), facts, fallback);
  }

  /** A pundit's drawn option, scored by the engine: would it have worked? */
  explainSketch(a: GhostAnalysis, v: SketchVerdict, w: WhatIfResult, mo?: DecisionMoment): Promise<CheckedResult> {
    const who = this.name(a.event.playerId);
    const o = v.option;
    const s = w.summary;
    const better = o.deltaVsActual > 0.005;
    const fallback =
      `The pundit's idea, ${v.readAs}, comes off ${pct(s.pSuccess)} of the time in simulation and creates ${s.expectedGoals.toFixed(3)} xG per attempt. ` +
      `It ranks ${v.rank} of ${v.of} options: ${better ? `better than what ${who} did by ${o.deltaVsActual.toFixed(3)}` : `no better than what ${who} did`}.` +
      (v.notes.length ? ` ${v.notes[0]!.charAt(0).toUpperCase()}${v.notes[0]!.slice(1)}.` : '');
    const facts = [
      `Minute ${this.minute(a.event.clockMs)}. ${who} chose ${this.describe(a.actual)}.`,
      mo && mo.kind === 'miss' ? `The engine's better option: ${this.describe(mo.ghost)}.` : '',
      `The pundit drew: ${v.readAs}. Model chance it comes off ${pct(o.pSuccess)}, expected value ${o.expectedValue.toFixed(3)} vs ${a.actual.expectedValue.toFixed(3)} for the choice made. It ranks ${v.rank} of ${v.of} options.`,
      `Simulation over ${s.rollouts} runs with defenders reacting: comes off ${pct(s.pSuccess)}, leads to a shot ${pct(s.shotRate)} of the time when it does, ${s.expectedGoals.toFixed(3)} xG per attempt.`,
      o.visibility ? `It was ${visibilityWords(o.visibility)} for ${who}.` : '',
      ...v.notes.map((n) => `Note: ${n}.`),
    ]
      .filter(Boolean)
      .join('\n');
    const prompt = `${facts}\n\nAs the studio analyst, give a fair verdict on the pundit's suggestion in two short sentences: would it have worked, and how does it compare? Under 45 words. Write numbers exactly as given.`;
    return this.verified(askAI(prompt, { system: this.system(), fallback, maxTokens: 160, cacheKey: `sketch:${a.event.id}:${w.key}` }), facts.split('\n'), fallback);
  }

  /** Every ~15 minutes: who's in control, who's creating, is it calm or chaotic? */
  studioLine(snap: StatsSnapshot, clockMs: number): Promise<CheckedResult> {
    const { home: h, away: a } = snap.teams;
    const control: Side = h.possessionPct >= a.possessionPct ? 'home' : 'away';
    const danger: Side = h.xG >= a.xG ? 'home' : 'away';
    const recent = snap.momentum.slice(-3);
    const recentThreat = { home: sum(recent.map((x) => x.home)), away: sum(recent.map((x) => x.away)) };
    const pressing = snap.pressureTrend.slice(-3);
    const press = { home: sum(pressing.map((x) => x.home)), away: sum(pressing.map((x) => x.away)) };
    const turnovers = h.tackles + h.interceptions + a.tackles + a.interceptions;
    const chaos = turnovers / Math.max(1, clockMs / 60000); // turnovers per minute
    const mood = chaos > 4.5 ? 'scrappy and chaotic, with the ball changing hands constantly' : chaos < 3 ? 'calm and controlled' : 'end to end';

    const fallback =
      `${this.club(control)} have had ${Math.round(snap.teams[control].possessionPct)}% of the ball` +
      (danger !== control ? `, but ${this.club(danger)} have the better chances (xG ${snap.teams[danger].xG.toFixed(2)} vs ${snap.teams[control].xG.toFixed(2)}).` : ` and the better chances too (xG ${snap.teams[danger].xG.toFixed(2)}).`) +
      ` It's been ${mood}.`;

    const facts = [
      `Minute ${this.minute(clockMs)}. Score: ${this.scoreline(snap.score)}.`,
      `Possession: ${this.meta.home.name} ${Math.round(h.possessionPct)}%, ${this.meta.away.name} ${Math.round(a.possessionPct)}%.`,
      `xG: ${h.xG.toFixed(2)} vs ${a.xG.toFixed(2)}. Shots: ${h.shots} vs ${a.shots}. Pass accuracy: ${pct(h.passAccuracy)} vs ${pct(a.passAccuracy)}.`,
      `Threat created in the last 15 minutes (xT+xG): ${recentThreat.home.toFixed(2)} vs ${recentThreat.away.toFixed(2)}.`,
      `Pressures in the last 15 minutes: ${press.home} vs ${press.away}.`,
      `Turnovers per minute: ${chaos.toFixed(1)} (game feel: ${mood}).`,
    ].join('\n');
    const ask = 'Give one studio-analyst observation (max 2 sentences, under 40 words) about control versus chaos and who has the momentum right now.';
    return this.verified(askAI(`${facts}\n\n${ask} Write numbers exactly as given.`, { system: this.system(), fallback, maxTokens: 160, cacheKey: `studio:${this.meta.matchId}:${Math.floor(clockMs / 60000)}` }), facts.split('\n'), fallback);
  }

  /**
   * One-line verdicts for the report's spotlight players, in ONE AI call (JSON back).
   * Falls back to the report's template lines for anyone the AI misses.
   */
  async playerLines(report: MatchReport, ids: string[]): Promise<{ lines: Record<string, string>; source: AskResult['source'] }> {
    const byId = new Map(report.players.map((p) => [p.playerId, p]));
    const picked = ids.filter((id) => byId.has(id));
    const fallback = Object.fromEntries(picked.map((id) => [id, byId.get(id)!.summary]));
    if (!picked.length) return { lines: fallback, source: 'template' };
    const facts = picked.map((id) => {
      const p = byId.get(id)!;
      const s = p.stats;
      const miss = p.missedChance ? ` Biggest miss (${this.minute(p.missedChance.clockMs)}): chose ${this.describe(p.missedChance.actual)} when ${this.describe(p.missedChance.ghost)} was on.` : '';
      const dec = p.decisions ? ` Chose the best option ${p.decisions.best} of ${p.decisions.total} times.` : '';
      return (
        `${id}: ${p.name} (${p.role}, ${this.club(p.team)}), rating ${p.rating}/10. ${s.goals} goals, ${s.assists} assists, ${s.shots} shots (xG ${s.xG}), ${s.keyPasses} chances created, ` +
        `${s.tackles + s.interceptions} ball wins, ${s.passesCompleted}/${s.passes} passes, ${s.distanceKm} km` +
        (s.saves || s.goalsConceded ? `, ${s.saves} saves, ${s.goalsConceded} conceded` : '') +
        `.${dec}${p.bestMoment ? ` Best moment: ${p.bestMoment.text}.` : ''}${miss}`
      );
    });
    const prompt =
      `Match: ${this.scoreline(report.score)} (${report.status === 'final' ? 'full time' : `after ${this.minute(report.clockMs)}`}).\n${facts.join('\n')}\n\n` +
      `For EACH player id above, write one pundit's verdict (one sentence, max 24 words): a judgement of their match plus the one detail that defines it ` +
      '(a goal, a key decision, a missed chance). Do not list stats, do not quote the rating, vary the openings. ' +
      'Reply with ONLY a JSON object mapping each id to its sentence, no other text.';
    const r = await askAI(prompt, {
      system: this.system(),
      fallback: JSON.stringify(fallback),
      maxTokens: 700,
      temperature: 0.6,
      timeoutMs: 20_000, // a full-time report isn't time-critical, and JSON for several players takes longer
      cacheKey: `lines:${report.matchId}:${report.status}:${Math.floor(report.clockMs / 60000)}:${picked.join(',')}`,
    });
    if (r.source === 'template') return { lines: fallback, source: 'template' };
    try {
      const json = JSON.parse(r.text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()) as Record<string, unknown>;
      const lines = { ...fallback };
      picked.forEach((id, i) => {
        const line = typeof json[id] === 'string' ? (json[id] as string).trim() : '';
        // Each verdict is checked against the facts given for that player (and the scoreline).
        const own = [`Match: ${this.scoreline(report.score)}.`, facts[i]!].map((text, k) => ({ id: `F${k + 1}`, text }));
        if (line && !checkAgainstFacts(line, null, own, this.roster).length) lines[id] = line;
      });
      return { lines, source: r.source };
    } catch {
      return { lines: fallback, source: 'template' };
    }
  }

  halfTime(snap: StatsSnapshot): Promise<CheckedResult> {
    return this.summary(snap, [], 'half time', 3, `half:${this.meta.matchId}`);
  }

  fullTime(snap: StatsSnapshot, recap: DecisionMoment[], report?: MatchReport): Promise<CheckedResult> {
    const extra: string[] = [];
    if (report) {
      const w = report.whatIfScore;
      extra.push(`What-if scoreline (model estimate): with the best available decision in each attack, expected goals would have been ${w.bestDecisions.home.toFixed(2)} to ${w.bestDecisions.away.toFixed(2)}, against actual xG ${w.xg.home.toFixed(2)} to ${w.xg.away.toFixed(2)} and a final score of ${w.goals.home}-${w.goals.away}.`);
      for (const g of report.genius) extra.push(`Moment of genius (a good decision), minute ${this.minute(g.clockMs)}: ${this.name(g.playerId)} found ${this.describe(g.actual)} when most would have played ${this.describe(g.ghost)}.`);
    }
    return this.summary(snap, recap, 'full time', 4, `full:${this.meta.matchId}`, extra);
  }

  private summary(snap: StatsSnapshot, recap: DecisionMoment[], when: string, sentences: number, cacheKey: string, extra: string[] = []): Promise<CheckedResult> {
    const { home: h, away: a } = snap.teams;
    const top = [...recap].sort((x, y) => y.evLost - x.evLost)[0];
    const fallback =
      `${when === 'full time' ? 'Full time' : 'Half time'}: ${this.scoreline(snap.score)}. ` +
      `xG ${h.xG.toFixed(2)} to ${a.xG.toFixed(2)}, possession ${Math.round(h.possessionPct)}% to ${Math.round(a.possessionPct)}%.` +
      (top ? ` The decision that cost most: ${this.name(top.playerId)} in the ${this.minute(top.clockMs)} chose ${this.describe(top.actual)} when ${this.describe(top.ghost)} was on.` : '');
    const facts = [
      `${when.toUpperCase()}. Score: ${this.scoreline(snap.score)}.`,
      `xG ${h.xG.toFixed(2)} vs ${a.xG.toFixed(2)}; shots ${h.shots} (${h.shotsOnTarget} on target) vs ${a.shots} (${a.shotsOnTarget}); possession ${Math.round(h.possessionPct)}% vs ${Math.round(a.possessionPct)}%; pass accuracy ${pct(h.passAccuracy)} vs ${pct(a.passAccuracy)}.`,
      ...recap.map(
        (m) =>
          `Missed opportunity (a mistake, not a good decision), minute ${this.minute(m.clockMs)}: ${this.name(m.playerId)} (${this.club(m.team)}) chose ${this.describe(m.actual)} when ${this.describe(m.ghost)} was the better option; value left on the table ${m.evLost.toFixed(3)}.`,
      ),
      ...extra,
    ].join('\n');
    const n = sentences;
    const prompt = `${facts}\n\nWrite the ${when} studio summary in at most ${n} sentences (under ${n * 25} words): the story of the match so far${recap.length ? ' and the decisions that shaped it' : ''}.`;
    return this.verified(askAI(`${prompt} Write numbers exactly as given.`, { system: this.system(), fallback, maxTokens: 300, cacheKey, timeoutMs: 15_000 }), facts.split('\n'), fallback);
  }
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const visibilityWords = (v: string) =>
  v === 'visible' ? 'inside their modeled field of view' : v === 'peripheral' ? 'at the edge of their modeled field of view' : v === 'behind' ? 'outside their modeled field of view' : 'of unknown visibility';
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const outcomeWord = (o: string) =>
  ({ success: 'came off', fail: 'did not come off', goal: 'went in', saved: 'was saved', blocked: 'was blocked', off_target: 'went off target' })[o] ?? o;
