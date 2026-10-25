import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { CLUBS, type ClientMsg, type GeneratedMatch, buildCueSheet, generateMatch, type ServerMsg } from '@ghost/engine';
import { aiProvider } from './ai/askAI';
import { Narrator } from './narrative';
import { MatchReplay } from './replay';
import { validation } from './votes';

// Secrets live in the repo-root .env (git-ignored). Missing file = mock AI, which is fine.
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  /* no .env */
}
const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.get('/api/health', (_req, res) => res.json({ ok: true }));
// How often fans and coaches agree with the model's picks ("You're the player" votes).
app.get('/api/validation', (_req, res) => res.json(validation()));
app.get('/api/clubs', (_req, res) => res.json(CLUBS.map(({ id, name, shortName, colors, formation }) => ({ id, name, shortName, colors, formation }))));

// Matches are deterministic, so cache them by their parameters.
const cache = new Map<string, GeneratedMatch>();
function getMatch(seed: number, home?: string, away?: string): GeneratedMatch {
  const key = `${seed}:${home ?? ''}:${away ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = generateMatch({ seed, homeClubId: home || undefined, awayClubId: away || undefined });
    cache.set(key, m);
  }
  return m;
}

// A whole match's overlay cue sheet, for broadcasters who want it up front (template commentary, no AI).
app.get('/api/cues', (req, res) => {
  const q = (k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : undefined);
  try {
    const match = getMatch(Number(q('seed') ?? 7), q('home'), q('away'));
    const narrator = new Narrator(match.meta);
    res.setHeader('content-disposition', `inline; filename="${match.meta.matchId}-cues.json"`);
    res.json(buildCueSheet(match, (e, m) => narrator.commentary(e, m)));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const num = (k: string) => (url.searchParams.has(k) ? Number(url.searchParams.get(k)) : undefined);
  const send = (msg: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  let replay: MatchReplay;
  try {
    const home = url.searchParams.get('home') ?? undefined;
    const away = url.searchParams.get('away') ?? undefined;
    if (home && away && home === away) throw new Error('Pick two different clubs');
    const match = getMatch(num('seed') ?? 7, home, away);
    replay = new MatchReplay(match, send, {
      ...(num('speed') ? { speed: num('speed') } : {}),
      ...(num('holdMs') !== undefined ? { holdMs: num('holdMs') } : {}),
    });
  } catch (err) {
    send({ type: 'error', message: (err as Error).message });
    ws.close();
    return;
  }

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.cmd === 'pause') replay.pause();
    else if (msg.cmd === 'resume') replay.resume();
    else if (msg.cmd === 'speed') replay.setSpeed(msg.value);
    else if (msg.cmd === 'next_moment') replay.nextMoment();
    else if (msg.cmd === 'simulate') replay.simulate(msg.eventId, msg.key);
    else if (msg.cmd === 'prefs') replay.setPrefs(msg.prefs);
    else if (msg.cmd === 'explain') replay.explain(msg.eventId);
    else if (msg.cmd === 'report') replay.sendReport();
    else if (msg.cmd === 'vote') replay.vote(msg.eventId, msg.key, msg.role === 'coach' ? 'coach' : 'fan');
    else if (msg.cmd === 'sketch') replay.sketch(msg.eventId, msg.end);
    else if (msg.cmd === 'dna') void replay.dna(msg.playerId);
  });
  ws.on('close', () => replay.stop());
  replay.start();
});

server.listen(PORT, () => console.log(`Ghost Replay server on http://localhost:${PORT} (ws: /ws) — AI: ${aiProvider()}`));
