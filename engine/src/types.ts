// Shared data shapes for engine, server and client.
//
// Coordinate convention: metres on a 105 x 68 pitch, origin bottom-left.
// Every MatchEvent (including its freezeFrame) is expressed in the frame of the
// team that performed it, attacking left -> right (towards x = 105).
// Use `toAbsolute` / `toTeamFrame` from geometry.ts to convert for rendering,
// where "absolute" means home attacks left -> right.

export type Vec2 = { x: number; y: number };

export type Side = 'home' | 'away';

export type PlayerSnapshot = {
  playerId: string;
  team: Side;
  pos: Vec2;
  vel?: Vec2; // m/s
};

export type EventType =
  | 'pass'
  | 'shot'
  | 'tackle'
  | 'interception'
  | 'carry'
  | 'pressure'
  | 'possession_change'
  | 'foul'
  | 'kickoff'
  | 'half_time'
  | 'full_time';

export type Outcome = 'success' | 'fail' | 'goal' | 'saved' | 'blocked' | 'off_target';

export type MatchEvent = {
  id: string;
  seq: number; // 0-based order within the match
  t: number; // ms since kickoff (continuous across halves, excludes the break)
  period: 1 | 2;
  clockMs: number; // match clock as displayed (second half starts at 45:00)
  type: EventType;
  team: Side;
  playerId: string;
  start: Vec2;
  end?: Vec2;
  targetPlayerId?: string;
  outcome?: Outcome;
  ballSpeed?: number; // m/s
  /** Set-piece / restart context, e.g. 'penalty', 'free_kick', 'goal_kick', 'throw_in'. */
  context?: string;
  score: { home: number; away: number }; // score *after* this event
  freezeFrame: PlayerSnapshot[]; // all 22 players at the moment of the event
};

export type Position = 'GK' | 'RB' | 'CB' | 'LB' | 'DM' | 'CM' | 'AM' | 'RM' | 'LM' | 'RW' | 'LW' | 'ST';

/** Ratings 0..1 (shown as 0..100). Synthetic — see engine/src/data/profiles.ts. */
export type PlayerAttributes = {
  passing: number;
  finishing: number; // converts chances: scales the goal chance of a shot
  dribbling: number;
  tackling: number; // wins the ball back from carriers
  pace: number; // gets past people when carrying
  decision: number; // how reliably they pick the best option
  shotBias: number; // -1..1, tendency to shoot when a pass was better
};

export type SeasonStats = {
  season: string; // e.g. '2025/26'
  apps: number;
  goals: number;
  assists: number;
  tackles: number;
  interceptions: number;
  passAccuracy: number; // 0..1
};

export type PlayerInfo = {
  id: string;
  name: string;
  shortName: string;
  number: number;
  position: Position;
  role: string; // formation slot, e.g. 'LCB'
  attrs: PlayerAttributes;
  seasons: { current: SeasonStats; previous: SeasonStats };
};

/** One squad member as stored in the data file (the id is derived from club + number). */
export type PlayerProfile = Omit<PlayerInfo, 'id'>;

export type Formation = '4-3-3' | '4-4-2' | '4-2-3-1';

export type TeamInfo = {
  id: string;
  name: string;
  shortName: string;
  city: string;
  colors: { primary: string; secondary: string };
  formation: Formation;
  style: { press: number; directness: number; tempo: number }; // 0..1
  players: PlayerInfo[];
};

export type MatchMeta = {
  matchId: string;
  seed: number;
  competition: string;
  venue: string;
  kickoffISO: string;
  home: TeamInfo;
  away: TeamInfo;
  halfLengthMs: number;
};

export type GeneratedMatch = {
  meta: MatchMeta;
  events: MatchEvent[];
};

export type GhostOption = {
  action: 'pass' | 'shot' | 'carry';
  targetPlayerId?: string;
  end: Vec2;
  pSuccess: number;
  valueIfSuccess: number; // xT at target, or 1 (a goal) for a shot so EV ≈ xG
  turnoverCost: number; // opponent xT at the loss location
  expectedValue: number; // pSuccess * value - (1 - pSuccess) * turnoverCost
  deltaVsActual: number;
  difficulty?: number; // 1..10 for passes
  features?: Record<string, number>; // model inputs for the analyst breakdown
};

export type DecisionReason = {
  code:
    | 'receiver_free'
    | 'lane_clear'
    | 'line_breaking'
    | 'into_box'
    | 'better_shot'
    | 'low_xg_shot'
    | 'blocked_shot_lane'
    | 'marked_receiver'
    | 'crowded_lane'
    | 'safe_but_slow'
    | 'risky_zone'
    | 'speculative_dribble'
    | 'space_to_carry'
    | 'top_scorer'
    | 'clinical_finisher'
    | 'weak_finisher';
  about: 'actual' | 'best';
  text: string; // short English fact; personalised prose is produced server-side
  value?: number;
};

export type DecisionMoment = {
  eventId: string;
  t: number;
  period: 1 | 2;
  clockMs: number;
  team: Side;
  playerId: string;
  actual: GhostOption;
  actualOutcome?: Outcome;
  ghost: GhostOption; // headline ghost: best *plausible* alternative (what casual mode shows)
  alternatives: GhostOption[]; // every alternative, sorted by EV (analyst mode)
  severity: number; // how much value was left on the table, weighted towards dangerous zones
  evLost: number; // best EV − actual EV (unweighted)
  zoneWeight: number;
  reasons: DecisionReason[];
  /** Simulation check: expected goals per attempt for the actual choice vs the ghost. */
  sim?: { actual: number; ghost: number; rollouts: number };
};

export type OverlayCue = {
  cueId: string;
  startT: number;
  durationMs: number;
  kind: 'player_tag' | 'stat' | 'ghost_replay' | 'narrative' | 'milestone';
  priority: number;
  payload: unknown;
};
