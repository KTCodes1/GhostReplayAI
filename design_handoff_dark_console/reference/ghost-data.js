const pctPair = (h, a) => { const t = h + a || 1; return { hp: (h / t * 100).toFixed(1) + '%', ap: (a / t * 100).toFixed(1) + '%' }; };
const row = (label, h, a, fmt = (v) => String(v)) => ({ label, h: fmt(h), a: fmt(a), ...pctPair(h, a) });
const f2 = (v) => v.toFixed(2), f1 = (v) => v.toFixed(1), pc = (v) => Math.round(v) + '%';

const home = { name: 'Northbridge Albion', short: 'NBA', color: '#c8102e' };
const away = { name: 'Kestrel Vale', short: 'KVL', color: '#1d428a' };

const statGroups = [
  { title: 'Attack', rows: [row('Possession', 54, 46, pc), row('Expected goals (xG)', 1.42, 0.88, f2), row('Shots', 11, 7), row('Shots on target', 5, 3), row('Threat added (xT)', 2.31, 1.64, f2)] },
  { title: 'Passing', rows: [row('Pass accuracy', 84, 79, pc), row('Passes', 412, 356), row('Avg pass difficulty (1–10)', 4.2, 4.6, f1)] },
  { title: 'Defending', rows: [row('Pressures', 88, 102), row('Ball wins', 31, 36), row('Fouls', 7, 9)] },
];

const kpis = [
  { label: 'Possession', ...row('', 54, 46, pc) },
  { label: 'Expected goals', ...row('', 1.42, 0.88, f2) },
  { label: 'Shots (on target)', h: '11 (5)', a: '7 (3)', ...pctPair(11, 7) },
  { label: 'Pass accuracy', ...row('', 84, 79, pc) },
  { label: 'Threat added', ...row('', 2.31, 1.64, f2) },
  { label: 'Ball wins', ...row('', 31, 36) },
];

// Pitch: 105 x 68, NBA attacking right. Ghost moment, 63:12.
const P = (x, y, role, team, name) => ({ x, y, role, team, name: name || '' });
const players = [
  P(16, 34, 'GK', 'h'), P(52, 9, 'LB', 'h'), P(38, 26, 'LCB', 'h'), P(38, 43, 'RCB', 'h'), P(54, 60, 'RB', 'h'),
  P(47, 21, 'CM', 'h', 'Mensah'), P(60, 32, 'CM', 'h', 'Halloran'), P(64, 47, 'CM', 'h', 'Dunmore'),
  P(80, 12, 'LW', 'h'), P(83, 36, 'ST', 'h', 'Okafor'), P(78, 58, 'RW', 'h'),
  P(101, 34, 'GK', 'a'), P(86, 14, 'RB', 'a'), P(84, 28, 'RCB', 'a'), P(84, 43, 'LCB', 'a'), P(86, 56, 'LB', 'a'),
  P(72, 29, 'DM', 'a'), P(73, 44, 'DM', 'a'), P(62, 11, 'RM', 'a'), P(65, 37, 'AM', 'a'), P(61, 57, 'LM', 'a'), P(52, 36, 'ST', 'a'),
].map((p) => ({ ...p, cx: p.x, cy: p.y, tx: p.x, ty: p.y - 2.6, lx: p.x, ly: p.y + 0.55, hl: p.name === 'Halloran' }));

const arrows = {
  actual: { x1: 60, y1: 32, x2: 47.8, y2: 22 },
  ghost: { x1: 60, y1: 32, x2: 91.5, y2: 38.5 },
  alt: { x1: 60, y1: 32, x2: 63.5, y2: 45.5 },
  run: { x1: 83, y1: 36, x2: 91.5, y2: 38.5 },
};

const moment = {
  minute: "63'", clock: '63:12', half: '2nd half',
  player: 'Kieran Halloran', short: 'Halloran', role: 'CM', number: 8, club: home.name,
  chose: 'chose a pass to Mensah (came off)',
  why: "Halloran had Okafor running beyond Kestrel Vale's high line with 14 metres of space behind. A through ball comes off six times in ten and puts the club's top scorer one-on-one; recycling to Mensah kept the ball but gave Kestrel Vale time to reset their back four.",
  actual: { label: 'Chosen', action: 'Pass to Mensah', outcome: 'Result: came off', metrics: [['Chance it comes off', '94%'], ['xG per attempt', '0.012'], ['Leads to a shot', '8%'], ['Ball lost', '6%']] },
  ghost: { label: 'Better option', action: 'Pass to Okafor', outcome: 'Through ball in behind', metrics: [['Chance it comes off', '61%'], ['xG per attempt', '0.131'], ['Leads to a shot', '44%'], ['Ball lost', '31%']] },
  evLost: '+0.142', simGain: '+0.119', rollouts: 50,
  factors: [
    { kind: 'ghost', text: 'Okafor was level with the last defender with 14 m of space behind the line.' },
    { kind: 'ghost', text: 'Okafor is the club’s top scorer (finishing 86) and a clinical finisher.' },
    { kind: 'actual', text: 'The pass to Mensah moved the ball 13 m backwards and lost 0.021 xT.' },
    { kind: 'ghost', text: 'Pressure on Halloran was low: nearest opponent 5.1 m away.' },
  ],
  options: [
    { kind: 'actual', label: 'Pass to Mensah', tag: 'Chosen', p: '94%', ev: '0.009', d: '–', sim: '0.012' },
    { kind: 'ghost', label: 'Pass to Okafor', tag: 'Best', p: '61%', ev: '0.151', d: '+0.142', sim: '0.131' },
    { kind: '', label: 'Pass to Dunmore', tag: '', p: '78%', ev: '0.064', d: '+0.055', sim: '0.048' },
    { kind: '', label: 'Drive forward', tag: '', p: '70%', ev: '0.041', d: '+0.032', sim: '0.029' },
    { kind: '', label: 'Shoot', tag: '', p: '4%', ev: '0.022', d: '+0.013', sim: '0.019' },
  ],
};

// match scrubber: 0–90 min; markers
const markers = [
  { left: (12 / 90 * 100) + '%', kind: 'ghost', min: "12'" },
  { left: (23 / 90 * 100) + '%', kind: 'goal', min: "23'" },
  { left: (31 / 90 * 100) + '%', kind: 'ghost', min: "31'" },
  { left: (44 / 90 * 100) + '%', kind: 'ghost', min: "44'" },
  { left: (52 / 90 * 100) + '%', kind: 'ghost', min: "52'" },
  { left: (63.2 / 90 * 100) + '%', kind: 'ghost', min: "63'" },
];
const progress = (63.2 / 90 * 100).toFixed(1) + '%';

const timeline = [
  { min: "63'", kind: 'ghost', text: 'Halloran: through ball to Okafor was on', team: 'h' },
  { min: "60'", kind: 'studio', text: 'Kestrel Vale’s press has dropped 18% since half-time.', team: '' },
  { min: "57'", kind: 'shot', text: 'Kessler shot, saved · xG 0.21', team: 'a' },
  { min: "52'", kind: 'ghost', text: 'Dunmore: cut-back to Okafor was on', team: 'h' },
  { min: "45'", kind: 'info', text: 'Half time · 1–0', team: '' },
  { min: "44'", kind: 'ghost', text: 'Silva: switch to Ueda was on', team: 'a' },
  { min: "31'", kind: 'ghost', text: 'Ueda: pass to Silva was on', team: 'a' },
  { min: "23'", kind: 'goal', text: 'GOAL · Okafor · xG 0.38', team: 'h' },
  { min: "12'", kind: 'ghost', text: 'Gallagher: pass to Okafor was on', team: 'h' },
];

// Full-time report
const report = {
  score: '2 – 1', ft: 'Full time · 90:00+',
  story: "Northbridge Albion controlled the middle third and turned 2.14 xG into two goals. Kestrel Vale's equaliser came in their best spell after the hour, but Whitlock's late finish settled it. Halloran's 63rd-minute recycle, with Okafor clear in behind, was the costliest decision of the match.",
  kpis: [
    { label: 'Possession', ...row('', 53, 47, pc) },
    { label: 'Expected goals', ...row('', 2.14, 1.21, f2) },
    { label: 'Shots (on target)', h: '16 (7)', a: '10 (4)', ...pctPair(16, 10) },
    { label: 'Pass accuracy', ...row('', 84, 79, pc) },
  ],
  // momentum: 18 five-minute bins, + = home
  momentum: [0.25, 0.42, -0.12, 0.35, 0.62, 0.18, -0.28, -0.46, 0.2, 0.12, -0.22, 0.4, 0.52, -0.35, -0.68, -0.3, 0.44, 0.58].map((v, i) => ({
    up: (Math.max(0, v) * 100).toFixed(0) + '%', down: (Math.max(0, -v) * 100).toFixed(0) + '%', i,
  })),
  goals: [{ left: (23 / 90 * 100) + '%', side: 'h', label: "23' Okafor" }, { left: (71 / 90 * 100) + '%', side: 'a', label: "71' Kessler" }, { left: (84 / 90 * 100) + '%', side: 'h', label: "84' Whitlock" }],
  moments: [
    { min: "63'", team: 'h', player: 'Halloran', text: 'chose a pass to Mensah when a through ball to Okafor was on', ev: '+0.142' },
    { min: "31'", team: 'a', player: 'Ueda', text: 'chose a long shot when a pass to Silva was on', ev: '+0.118' },
    { min: "52'", team: 'h', player: 'Dunmore', text: 'chose to carry when a cut-back to Okafor was on', ev: '+0.097' },
    { min: "77'", team: 'a', player: 'Silva', text: 'chose a cross when a pass to Kessler was on', ev: '+0.081' },
    { min: "12'", team: 'h', player: 'Gallagher', text: 'chose a shot when a pass to Okafor was on', ev: '+0.064' },
  ],
  performers: [
    { tag: 'Player of the match', potm: true, name: 'Daniel Okafor', role: 'ST', team: 'h', club: 'Northbridge Albion · 10.8 km', rating: '8.4',
      line: 'Scored the opener, set up Whitlock’s winner and was the outlet behind Kestrel Vale’s high line all afternoon.',
      stats: [['1', 'Goals'], ['1', 'Assists'], ['5 (3)', 'Shots'], ['0.92', 'xG'], ['3', 'Chances'], ['0.61', 'xT added'], ['21/26', 'Passes'], ['4', 'Ball wins']], dec: '7/10', decPct: '70%' },
    { tag: 'Kestrel Vale standout', potm: false, name: 'Lukas Kessler', role: 'ST', team: 'a', club: 'Kestrel Vale · 10.1 km', rating: '7.6',
      line: 'Took his goal well and forced two saves; isolated for long spells in the first half.',
      stats: [['1', 'Goals'], ['0', 'Assists'], ['4 (2)', 'Shots'], ['0.54', 'xG'], ['1', 'Chances'], ['0.33', 'xT added'], ['14/19', 'Passes'], ['2', 'Ball wins']], dec: '5/8', decPct: '63%' },
    { tag: 'Biggest miss', potm: false, name: 'Kieran Halloran', role: 'CM', team: 'h', club: 'Northbridge Albion · 11.9 km', rating: '7.1',
      line: 'Ran the midfield at 91% passing, but twice recycled when Okafor was clear in behind.',
      stats: [['0', 'Goals'], ['0', 'Assists'], ['1 (0)', 'Shots'], ['0.04', 'xG'], ['2', 'Chances'], ['0.48', 'xT added'], ['68/75', 'Passes'], ['6', 'Ball wins']], dec: '11/16', decPct: '69%' },
  ],
  table: [
    { team: 'h', role: 'ST', name: 'Okafor', rating: '8.4', g: 1, a: 1, xg: '0.92', ch: 3, bw: 4, pass: '81%', dec: '7/10', km: '10.8' },
    { team: 'h', role: 'LW', name: 'Whitlock', rating: '7.8', g: 1, a: 0, xg: '0.47', ch: 2, bw: 3, pass: '83%', dec: '6/9', km: '10.4' },
    { team: 'a', role: 'ST', name: 'Kessler', rating: '7.6', g: 1, a: 0, xg: '0.54', ch: 1, bw: 2, pass: '74%', dec: '5/8', km: '10.1' },
    { team: 'h', role: 'CM', name: 'Halloran', rating: '7.1', g: 0, a: 0, xg: '0.04', ch: 2, bw: 6, pass: '91%', dec: '11/16', km: '11.9' },
    { team: 'a', role: 'AM', name: 'Silva', rating: '6.9', g: 0, a: 1, xg: '0.21', ch: 3, bw: 3, pass: '80%', dec: '8/13', km: '11.2' },
    { team: 'a', role: 'DM', name: 'Ueda', rating: '6.4', g: 0, a: 0, xg: '0.12', ch: 0, bw: 7, pass: '86%', dec: '9/15', km: '11.6' },
  ],
};

export default { home, away, statGroups, kpis, players, arrows, moment, markers, progress, timeline, report };
