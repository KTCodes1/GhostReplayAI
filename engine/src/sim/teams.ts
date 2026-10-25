// Invented clubs and their formations. No real Premier League clubs or players.

import { PLAYER_PROFILES } from '../data/profiles';
import type { Formation, PlayerInfo, Position, TeamInfo, Vec2 } from '../types';

export type RoleSlot = { role: string; position: Position; base: Vec2; number: number };

// Base shapes in the team's own frame (attacking towards x = 105; right flank = low y).
const BACK_FOUR: RoleSlot[] = [
  { role: 'GK', position: 'GK', base: { x: 4, y: 34 }, number: 1 },
  { role: 'RB', position: 'RB', base: { x: 30, y: 8 }, number: 2 },
  { role: 'RCB', position: 'CB', base: { x: 24, y: 25 }, number: 5 },
  { role: 'LCB', position: 'CB', base: { x: 24, y: 43 }, number: 4 },
  { role: 'LB', position: 'LB', base: { x: 30, y: 60 }, number: 3 },
];

export const FORMATIONS: Record<Formation, RoleSlot[]> = {
  '4-3-3': [
    ...BACK_FOUR,
    { role: 'DM', position: 'DM', base: { x: 40, y: 34 }, number: 6 },
    { role: 'RCM', position: 'CM', base: { x: 48, y: 21 }, number: 8 },
    { role: 'LCM', position: 'CM', base: { x: 48, y: 47 }, number: 10 },
    { role: 'RW', position: 'RW', base: { x: 70, y: 9 }, number: 7 },
    { role: 'ST', position: 'ST', base: { x: 75, y: 34 }, number: 9 },
    { role: 'LW', position: 'LW', base: { x: 70, y: 59 }, number: 11 },
  ],
  '4-4-2': [
    ...BACK_FOUR,
    { role: 'RM', position: 'RM', base: { x: 54, y: 9 }, number: 7 },
    { role: 'RCM', position: 'CM', base: { x: 44, y: 26 }, number: 8 },
    { role: 'LCM', position: 'CM', base: { x: 44, y: 42 }, number: 6 },
    { role: 'LM', position: 'LM', base: { x: 54, y: 59 }, number: 11 },
    { role: 'RST', position: 'ST', base: { x: 72, y: 28 }, number: 9 },
    { role: 'LST', position: 'ST', base: { x: 72, y: 40 }, number: 10 },
  ],
  '4-2-3-1': [
    ...BACK_FOUR,
    { role: 'RDM', position: 'DM', base: { x: 40, y: 27 }, number: 6 },
    { role: 'LDM', position: 'DM', base: { x: 40, y: 41 }, number: 8 },
    { role: 'RW', position: 'RW', base: { x: 64, y: 10 }, number: 7 },
    { role: 'AM', position: 'AM', base: { x: 61, y: 34 }, number: 10 },
    { role: 'LW', position: 'LW', base: { x: 64, y: 58 }, number: 11 },
    { role: 'ST', position: 'ST', base: { x: 76, y: 34 }, number: 9 },
  ],
};

type ClubDef = Omit<TeamInfo, 'players'>;

export const CLUBS: ClubDef[] = [
  { id: 'nba', name: 'Northbridge Albion', shortName: 'NBA', city: 'Northbridge', colors: { primary: '#c8102e', secondary: '#ffffff' }, formation: '4-3-3', style: { press: 0.8, directness: 0.35, tempo: 0.75 } },
  { id: 'kvl', name: 'Kestrel Vale', shortName: 'KVL', city: 'Kestrel Vale', colors: { primary: '#1d428a', secondary: '#f5c300' }, formation: '4-2-3-1', style: { press: 0.55, directness: 0.45, tempo: 0.6 } },
  { id: 'hsu', name: 'Harbourside United', shortName: 'HSU', city: 'Harbourside', colors: { primary: '#0b7a3e', secondary: '#ffffff' }, formation: '4-4-2', style: { press: 0.45, directness: 0.7, tempo: 0.55 } },
  { id: 'imc', name: 'Ironmoor City', shortName: 'IMC', city: 'Ironmoor', colors: { primary: '#6cabdd', secondary: '#1c2c5b' }, formation: '4-3-3', style: { press: 0.7, directness: 0.3, tempo: 0.7 } },
  { id: 'asr', name: 'Ashford Rovers', shortName: 'ASR', city: 'Ashford', colors: { primary: '#f47b20', secondary: '#111111' }, formation: '4-4-2', style: { press: 0.6, directness: 0.6, tempo: 0.65 } },
  { id: 'rva', name: 'Riverton Athletic', shortName: 'RVA', city: 'Riverton', colors: { primary: '#7a263a', secondary: '#9bc4e2' }, formation: '4-2-3-1', style: { press: 0.5, directness: 0.5, tempo: 0.5 } },
  { id: 'wht', name: 'Westholm Town', shortName: 'WHT', city: 'Westholm', colors: { primary: '#ffffff', secondary: '#132257' }, formation: '4-3-3', style: { press: 0.65, directness: 0.4, tempo: 0.6 } },
  { id: 'bfw', name: 'Brackenfield Wanderers', shortName: 'BFW', city: 'Brackenfield', colors: { primary: '#fdb913', secondary: '#231f20' }, formation: '4-2-3-1', style: { press: 0.4, directness: 0.55, tempo: 0.5 } },
];

/** A club's squad comes from the player-profile data file (synthetic; swappable for real data). */
export function buildTeam(clubId: string): TeamInfo {
  const def = CLUBS.find((c) => c.id === clubId);
  if (!def) throw new Error(`Unknown club ${clubId}`);
  const profiles = PLAYER_PROFILES[clubId];
  if (!profiles) throw new Error(`No player profiles for ${clubId} — run: npm run profiles -w @ghost/engine`);
  const players: PlayerInfo[] = FORMATIONS[def.formation].map((slot) => {
    const p = profiles.find((x) => x.role === slot.role);
    if (!p) throw new Error(`${clubId} has no player for ${slot.role}`);
    return { ...p, id: `${clubId}-${p.number}` };
  });
  return { ...def, players };
}
