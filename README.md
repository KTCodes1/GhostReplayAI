# Ghost Replay

**An AI analyst that watches a football match live, freezes the play when a player misses a better option, and shows the "ghost" of what they could have done on a 3D pitch: how likely it was to work, how much more dangerous it was, and why.**

Built for **Inside the Game: Developer Hackathon** (Microsoft × Premier League), challenge: *The Synthetic Match Insights Engine for Premier League Studio*. Every club, player and match is synthetic; no real Premier League data is used.

---

## The elevator pitch

Football tools have always told fans *what* happened. Ghost Replay shows *what could have happened*.

As a match streams in live, the engine judges every decision a player makes on the ball, about 1,500 per match. When someone misses a clearly better option, the match freezes. The camera swoops over the moment, and a glowing "ghost" arrow shows the pass they didn't play. Next to it are the numbers that matter: the chance it comes off, the expected goals it would have created, and the value left on the table. An AI pundit explains why it mattered.

Decision analysis has a bad reputation for being unfair: it blames players for options they couldn't see, judges a frozen photo, and states guesses as facts. Ghost Replay is built to fix that:

- It only blames a player for what they **could actually see**.
- It judges where players **will be when the ball arrives**, not where they stood.
- It checks every claim in a **simulation where defenders react**.
- It labels each verdict **clear, reasonable, or not enough evidence**.
- It **checks every word the AI writes against the engine's facts** before anyone sees it.

It also celebrates **moments of genius** as well as mistakes. Fans can **play along**, pundits can **draw their own ideas** and have them tested, and every player gets a **Decision DNA** profile.

**In one line:** the second-screen AI analyst a broadcaster could put next to the live feed: fair, explainable, and fun.

---

## How it works (the five-stage pipeline)

| Stage | What happens |
| --- | --- |
| **1. Ingest** | A seeded match generator creates realistic synthetic matches (formations, pressing, possession spells, about 2.7 goals, 18 shots and 80% passing per match). Every event carries a freeze-frame of all 22 players with their speeds and directions, and events stream to the browser in real time at 1× to 60× speed. |
| **2. Interpret** | Live stats: expected goals (xG), expected threat (xT), pass distance, accuracy and difficulty (1–10), ball and shot speed, possession, pressing, momentum, and a rolling five-minute **match pulse**. |
| **3. Explain** | The **ghost engine** scores every option on the ball, finds the moments where real value was lost (or a brilliant ball was found), checks each one in a 50-run simulation, and has the AI explain it, with every claim checked against the facts. |
| **4. Render** | A 3D pitch with four cameras, ghost arrows, the player's vision cone, outcome trees and a side-by-side what-if timeline, plus **timed overlay cues as JSON** that a broadcaster could sync to their own graphics. |
| **5. Personalize** | Follow one player all match, play **"You're the player"**, draw your own option as a pundit, and get a full-time report with ratings, Decision DNA and validation numbers. |

---

## Every feature

### Watching the match live
- **3D pitch** with four cameras: **Broadcast** (TV gantry), **Tactical** (top-down), **Sideline** (always the full width of the pitch, fast to follow the ball) and **Player** (behind the ball).
- **Live stats panel**: possession, xG, shots, threat added, pass accuracy, average pass difficulty, pressing, ball wins and fouls.
- **Match pulse**: the last five minutes at a glance (pressing, territory, threat and predictability for each side) and the spell the game is in, such as *"Control without penetration"* or *"Sustained pressure, but passing is becoming predictable"*, with a short AI line when a new spell starts.
- **Real-time player tags**: a name tag pops up over a player when they **sprint** ("Kowalski · 27 km/h") or lead the match for **distance covered** ("Moreau · 9.0 km covered").
- **Pitch footer** for every action: the type, who passed to whom, distance, pass difficulty (1–10), ball speed and the threat added.
- **Live commentary** in a broadcast-style lower third, a goal banner, and **studio analysis** at 15, 30, 60 and 75 minutes plus half and full time.
- **Match scrubber** from 0' to 90' with clickable markers for ghost moments, moments of genius and goals.
- **Timeline and live insights feed** of goals, shots, ghost moments, studio lines and pulse spells.
- **Playback controls**: pause, 1× to 60× speed, and **Next moment** to jump to the next big decision.

### Ghost moments (when a player missed a better option)
- **The freeze**: play stops, the camera swoops over the moment, and three arrows appear: what they **chose** (coral), the **better option** (blue) and other alternatives (dashed grey).
- **Free camera**: drag to rotate, right-drag to pan and scroll to zoom around the frozen moment, with **Reset view**.
- **Why it mattered**: an AI pundit's explanation that names the *cause* ("Yilmaz stepped out to press, which left space behind them for Rasmussen"), not just the numbers.
- **Chosen vs better option** side by side: the chance each comes off, xG per attempt, how often it leads to a shot, how often the ball is lost, whether the player could see it, what it sets up next, and how hard it was to execute.
- **Verdict**: the value left on the table, and the xG gained across 50 simulations.
- **Fair Play lens**: one plain verdict on every miss: **Clear opportunity missed**, **Reasonable alternative** (with the reason, such as "it was on the edge of their vision"), or **Not enough evidence to judge**.
- **Confidence** (high, medium or low): how sure the engine is that the other option really was better. Low-confidence moments never freeze the match.
- **Key factors**: the reasons in plain English. Who was free and how far away the nearest defender was, which defender left the gap, who was already running, overloads, a high back line, line-breaking passes, the receiver's finishing record, and the game state ("protecting a 1-0 lead, 87'").
- **All options table**: every option the player had, with whether they could see it, its chance, expected value, how much better or worse it was, and its simulated xG; any option can be simulated.

### Fair judging (the criticisms it answers)
| The usual criticism | What Ghost Replay does |
| --- | --- |
| "You're blaming players for things they couldn't see." | A **vision cone** works out which way the player faced and how much time they had. Options are labelled *in view*, *edge of vision* or *behind them*, and a player is **never blamed** for an option behind them. |
| "It's a frozen photo; players are moving." | Players are judged on where they'll be **when the ball arrives**: runners get the ball played into their path, and offside receivers are ruled out. |
| "The best option on paper was unplayable for him." | Each pass is adjusted for **this player's range and weaker foot**. |
| "Patient build-up gets punished." | A **two-step look-ahead** gives a pass credit for the ball it sets up next. |
| "In real life the defenders would react." | **Reactive simulations**: defenders react, accelerate, reach and race the receiver. Nothing is forced to come off. |
| "At 1-0 up in the 89th you keep the ball." | **Game state** changes what the right call is: protecting a lead, chasing the game, or level. |
| "It treats close calls as mistakes." | **Confidence** and the **Fair Play lens** keep close calls out of the spotlight. |
| "It's only ever negative." | **Moments of genius** celebrate the hard, right ball. |
| "Numbers, but no reasons." | **Cause-based explanations**, checked against the evidence. |

### Evidence-checked AI ("why we think this")
- The AI only sees a **numbered list of facts** from the engine (distances, chances, xG and xT values, what the player could see, the simulation result) and must say **which facts each claim relies on**.
- Before anyone sees it, the answer is **checked**: every number must match a fact, every player named must be part of the moment, and contradictions are caught (for example "unmarked" when a defender was 0.3 m away, "saw it" when the option was behind the player, or "offside" when nobody was).
- A rejected answer is rewritten once with its mistakes listed. If it fails again, the viewer gets an explanation written straight from the facts. **When the evidence is thin, it says "not enough evidence to judge"** instead of inventing a reason.
- **Why we think this** under every explanation shows each claim with the facts behind it, and any drafts that were rejected.
- Studio lines, summaries, pulse lines, sketch verdicts and player one-liners are checked too.

### Simulations
- **Simulate 50 runs**: the match engine restarts from the frozen frame, makes the player take the chosen option, and plays the move out 50 times with defenders reacting. One run plays on the pitch.
- **Outcome tree**: each option as branching probabilities ("82% comes off, then 22% goal… 18% cut out, then a counter-attack shot against"), drawn on the pitch as faint branches too.
- **What-if timeline**: **Watch both** plays what really happened and the ghost run **at the same time**, with the ghost players see-through, and live readouts of the threat built and chance created. It's clearly labelled *"plausible simulation, not a prediction"*.

### Moments of genius
- The flip side of a ghost: a player found **the hard, right ball** that most players wouldn't. It was the best option, it came off, it was ambitious, and it was hard to find (on the edge of their vision, line-breaking, into a runner's path, or a risky ball).
- Shown in **green**: *what they found* against *the obvious ball*, with an AI write-up celebrating what they saw. Each one is confirmed by simulation, so they're rare and earned.

### For fans and pundits
- **"You're the player"**: at every freeze, pick what you'd do (options A–E, shown as neutral arrows on the pitch) **before the reveal**. Then compare **your pick, the engine's pick, what actually happened, and what everyone else picked**. Votes are saved across sessions, and you can mark yourself as someone who coaches or plays.
- **Pundit sketch**: click anywhere on the pitch to draw your own option (a pass, a ball into space, a run or a shot). The engine scores it with the same models, simulates it 50 times, ranks it against every other option ("#3 of 12"), and gives an AI verdict. Play it on the pitch.
- **Player focus**: follow one player all match, with a ring on the pitch, more of their moments, a live decision score ("chose the best option 22 of 43 times"), their ratings and two seasons of stats.
- **Decision DNA**: a new kind of player stat about *how* someone decides. Seven traits (decision quality, risk appetite, progression, vision, under pressure, late in games and unpredictability), each a **percentile against the other players** with the fact behind it, plus a style such as *"Progressive risk-taker"* or *"Cool under pressure"*. Available for this match or **across their last five matches**.

### The full-time report
- **Match summary** written by the AI from the engine's facts and checked against them.
- **Key numbers**: possession, xG, shots (on target) and pass accuracy.
- **Momentum chart**: threat per five minutes for each side, with goals marked.
- **The decisions that shaped the match**, each with its Fair Play verdict, plus **moments of genius**. Any of them can be replayed.
- **The what-if scoreline**: "With the best available decisions, the expected score was 0.78–2.66. Actual: 0–2."
- **Validation**: how often the simulation upheld the model's flags (typically 60–70%), and how often fans, and people who coach or play, agreed with the engine.
- **Standout performers**: player of the match and the best of each side, with ratings, stats, decision score, Decision DNA, best moment and biggest miss.
- **All players table**, with **JSON exports** of the report and the broadcast overlay cues.

### For broadcasters
- **Timed, machine-readable overlay cues (JSON)**, streamed live and downloadable for a whole match: goals and milestones, ghost replays (arrows, freeze frame, confidence, game state and vision cone), player tags (including sprint and distance), stat panels and commentary. Each cue has a screen slot and priority, so higher-priority graphics cut lower ones short.
- Everything has an **AI fallback**: if the AI is slow or offline, an explanation written from the facts is shown, so the live show never stalls.

---

## Why you can trust it
- **Honest models.** Pass probabilities stay calibrated: the simulation and the model agree (for example, passes the model gives 75% come off about 75% of the time in simulation).
- **Two independent checks.** A moment only freezes the match if the model *and* a 50-run simulation agree, and the simulation rejects about a third of the model's flags.
- **Labelled uncertainty.** Every miss has a confidence level and a Fair Play verdict.
- **Checked AI.** No AI sentence reaches the screen unless its numbers and names match the engine's facts.
- **Tested.** 69 automated engine tests cover the models, the generator, the ghost engine, simulations, evidence checks, the pulse, the report and the overlay cues.

---

## Run it

```bash
npm install
npm run dev
```

Open **http://localhost:5173**, pick two clubs and a match seed, and press **Start live analysis**. The same seed always replays the same match.

**Quick demo links**
| Link | What you'll see |
| --- | --- |
| `http://localhost:5173/?seed=7&speed=8&autostart&jump` | Straight to the first ghost moment (0:27). Press **Next moment** twice for a *Clear opportunity missed* at 18'. |
| `http://localhost:5173/?seed=11&speed=20&autostart&jump` | Then press **Next moment**: a **moment of genius** at 12'. |
| `http://localhost:5173/?seed=7&speed=20&autostart&holdMs=300` | Hands-free: moments auto-continue, so you see the match pulse and player tags. |

Click **You're the player** in the header to play along, **Draw an option** in the panel to sketch, the **Player** tab for Decision DNA, and **Match report** at any time.

**AI provider.** Set `AI_PROVIDER` in `.env` (see `.env.example`): `azure` for **Azure OpenAI through Microsoft Foundry** (the submission setting), `gemini` for development, or `mock` for no AI. The app works fully in every mode.

---

## Built with

- **TypeScript end to end**, as an npm workspaces monorepo on **GitHub**.
- **Engine** (`engine/`): match generator, xG / xT / pass models, the ghost engine and fair judging, reactive simulations, evidence checks, match pulse, Decision DNA, the report and broadcast cues.
- **Server** (`server/`): Node and Express with WebSockets; replays the match live, runs the engine as events stream, and calls the AI through one `askAI()` function with evidence checks.
- **Client** (`client/`): React and Vite with Three.js (react-three-fiber) for the 3D pitch and the analyst console UI.
- **Microsoft**: **Azure OpenAI via Microsoft Foundry** for the AI analyst, with **Azure** hosting planned.

### Useful scripts

```bash
npm test                                   # all engine tests
npm run sim -- 42                          # print one simulated match
npm run sim -- --many 50                   # realism averages over 50 matches
npm run ghosts -w @ghost/engine -- 7       # every ghost and genius moment of a match, with confidence and fair-play data
```

**More detail:** [docs/FEATURES.md](docs/FEATURES.md) has every feature with where to see it, how to demo it, and a suggested video outline.
