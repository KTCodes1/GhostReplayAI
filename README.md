# Ghost Replay

An AI that watches a (synthetic) football match live, freezes the moments where a player made the wrong call, and shows on a 3D pitch the "ghost" of what they could have done — with the xG / xT value they left on the table.

Built for **Inside the Game: Developer Hackathon** (Microsoft × Premier League). Synthetic data only: invented clubs and players.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173, pick clubs/seed, and press **Kick off**.
Shortcut: http://localhost:5173/?seed=7&speed=8&autostart&jump jumps straight to the first ghost moment.

## Packages

| Folder | What |
| --- | --- |
| `engine/` | Shared TypeScript: types, seeded match generator, xG / xT / pass models, live stats, ghost engine, WebSocket protocol |
| `server/` | Express + `ws`: replays a generated match in real time and runs the ghost detector live |
| `client/` | React + Vite + react-three-fiber: 3D pitch, ghost arrows, stats, timeline, full-time recap |

## Useful scripts

```bash
npm test                                   # engine unit tests
npm run sim -- 42                          # print one simulated match
npm run sim -- --many 50                   # realism averages over 50 matches
npm run ghosts -w @ghost/engine -- 7       # list the ghost moments of a match in the terminal
```
