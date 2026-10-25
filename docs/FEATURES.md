# Ghost Replay: everything it does

A reference for writing the demo video script and the submission write-up. Each feature says what it is, why it matters, and **where to see it on screen**. Numbers are from real runs of the engine; where a number varies by match, a range is given.

> **One-line pitch:** an AI that watches a live football match, freezes the moments where a player made the wrong call (or a brilliant one), and shows on a 3D pitch what they could have done instead, judged fairly: only for what the player could see, could execute, and was worth doing at that score and minute.

---

## 1. How to demo it

```bash
npm install
npm run dev          # server on :8787, app on http://localhost:5173
```

| Shot you want | Open this | Then |
| --- | --- | --- |
| A ghost moment, straight away | `http://localhost:5173/?seed=7&speed=8&autostart&jump` | Freezes at 0:27. Theo Dunmore shoots (blocked); the engine says the pass to Moreau was on, but on the edge of his vision, so the Fair Play lens says **Reasonable alternative**. Open **Why we think this** under the explanation to see every claim with its facts. |
| Clear opportunity missed | same link, press **Next moment** twice | 18', Mensah passes to Yilmaz when a pass to Rasmussen would have taken 4 defenders out: **Clear opportunity missed**. |
| What-if timeline | at any freeze, **Watch both** | The real next seconds (solid players) and the ghost run (translucent players) play together, with running xT / xG. |
| Match pulse and player tags | `...?seed=7&speed=20&autostart&holdMs=300` | Stats tab, **Match pulse**, after a few minutes; sprint tags ("Kowalski · 27 km/h") pop up over players. |
| A moment of genius | `http://localhost:5173/?seed=11&speed=20&autostart&jump` | First freeze is a miss at 1'. Press **Next moment** in the panel: 12', Tariq Halloran drives forward when the obvious ball was a pass to Achterberg. Green "Genius moment". |
| "You're the player" | Any match, click **You're the player** in the header | At the next freeze, pick A–E before the reveal. |
| Pundit sketch | At any freeze, **Draw an option** in the panel | Click the pitch where the ball should go. |
| Decision DNA | Sidebar **Player** tab, follow a player, **Build Decision DNA** | Takes a couple of seconds (it simulates 4 more matches). |
| Full-time report | `...?seed=7&speed=60&autostart&holdMs=400`, wait about 90 s | The report opens at full time. Or click **Match report** at any point. |
| Hands-free demo | add `&holdMs=9000` to any link | Each freeze auto-continues after 9 s. |

AI text is written live (Google Gemini in development; **Azure OpenAI via Microsoft Foundry** with `AI_PROVIDER=azure`), so the wording changes between runs. Every AI call has a template fallback, so the app never shows a blank.

---

## 2. The problem it answers

Decision-analysis tools exist, and analysts and players criticise them for the same reasons. Ghost Replay is built around fixing those criticisms:

| The criticism | What Ghost Replay does | Where to see it |
| --- | --- | --- |
| **God's-eye bias**: tools blame players for options they couldn't see | A **vision cone** works out which way the player was facing (running, receiving, or carrying) and how much time they had. Every option is labelled *in view*, *edge of vision* or *behind them*. A player is **never blamed** for an option behind them; if a better one existed there, the panel says so and doesn't count it. | Translucent wedge on the pitch at every freeze; "Could they see it" row on each option card; "Seen" column in All options |
| **The world is frozen**: the snapshot ignores movement | Players are projected to **where they'll be when the ball arrives**. Runners get the ball played into their path. Defenders keep their momentum for a reaction time, then respond. Receivers standing **offside** are flagged and never offered as the better option. | "…was already on the move at 4.2 m/s" in Key factors; "Offside" tag in All options |
| **Decision vs execution**: the best option on paper may be unplayable | Each pass is adjusted for **this player's** range (a 45 m ball from a weak passer) and their **weaker foot**. | "Harder to execute: …" note on option cards |
| **One step only**: patient build-up gets punished | **Two-step look-ahead**: a pass is also worth the best next ball it sets up, with defenders closing down. | "Sets up a shot next" on cards; "it would have set up a pass to X next" in factors |
| **Defenders don't react**: ghost outcomes are too optimistic | **Reactive simulation**: when the ghost is played out, defenders react after about 0.3 s, accelerate realistically, reach out a leg, and race the receiver to the ball. Nothing is forced to come off. | "50 runs each, defenders reacting" on the outcome tree |
| **No context**: a risky ball isn't right at 1-0 up in the 89th | **Game state** scales risk: protecting a late lead makes losing the ball cost up to 1.9× as much; chasing the game makes it cost less. | Chip under the player name, e.g. "protecting a 2-0 lead, 83'" |
| **False certainty**: close calls shown as mistakes | **Confidence** (how sure the engine is that the other option was better) combines the model's margin with the simulation's margin: high, medium or low. Low-confidence moments **never freeze the match**. On top of that, the **Fair Play lens** gives every miss a plain verdict: *Clear opportunity missed*, *Reasonable alternative*, or *Not enough evidence to judge*. | "High confidence 96%" badge and the Fair Play verdict under the player's name; verdicts on the report's decision rows |
| **AI that makes things up** | **Evidence-checked AI**: the AI only sees the engine's numbered facts, must cite the facts behind every claim, and its answer is checked before anyone sees it (every number must match a fact, every player named must be in the facts, and contradictions like "unmarked" when a defender was 2 m away are caught). Rejected answers are rewritten once, then replaced by an explanation written straight from the facts. | **Why we think this** under each explanation: each claim with its facts, and any rejected drafts |
| **It's only negative** | **Genius moments**: the hard, right ball that most players wouldn't find (green). | Green diamonds on the scrubber; "Genius moment" panel; "Moments of genius" in the report |
| **Numbers without reasons** | **Cause-based reasons**: which defender stepped out to press and left the gap, who was already running, where the overload was, the high line, what the next ball would have been. The AI is told to name the cause, not just the number. | "Key factors" list and the AI "Why it mattered" text |

---

## 3. Going a level above

### "You're the player" (fan interaction)
At each freeze, all the options appear as neutral lettered arrows (A–E) on the pitch, and the fan picks one **before** the reveal. Then they see four things side by side: **their pick, the engine's pick, what actually happened, and what everyone else picked**. Votes are saved on the server across sessions, and fans can tick **"I coach or play"**, which feeds the validation numbers. It works as a second-screen experience during a broadcast.
*Where:* header toggle **You're the player**; the panel shows the picker, then "Your call".

### Genius moments
The flip side of a ghost: the player chose the best option, it came off, it wasn't the safe, obvious ball, it reached much more dangerous ground, and it was hard to find (on the edge of their vision, line-breaking, into a runner's path, or a risky ball). Each one is confirmed by simulation, so their choice really did beat the obvious ball. They're rare by design: **0–2 per match live**, more in the report.
*Where:* green diamonds on the scrubber and timeline, the green panel ("What they found" vs "The obvious ball"), and "Moments of genius" in the report.

### Decision DNA
A new kind of player stat: **how a player chooses**, not what they did. Seven traits, each a **percentile against the other players** (so 80 means "more than 80% of players"): decision quality, risk appetite, progression, vision, under pressure, late in games, and unpredictability. Each trait comes with its fact in words ("best option 53% of the time under pressure, 59% overall"), plus a one-line style ("Progressive risk-taker", "Cool under pressure", "Safe recycler", …). It's available for **this match** or **across the player's last five matches** (the server simulates the club's other games).
*Where:* sidebar **Player** tab → Build Decision DNA; also on the standout player cards in the report.

### The what-if scoreline
"With the best available decisions, the expected score was 0.78–2.66. Actual: 0–2." In every attack, the biggest clear improvement the engine found (an option the player could see, worth at least 0.03) is added once, so no attack is counted twice. It's labelled as a model estimate. Example, seed 7 at 74': actual 0–2, xG 0.44–1.56, with the best decisions 0.78–2.66.
*Where:* report, "The what-if scoreline".

### Pundit sketch (studio mode)
A pundit draws their own alternative on the pitch and the engine scores it instantly with the same models: a pass to a teammate, a ball into space (who wins the race to it?), a run, or a shot. It's simulated 50 times with defenders reacting and gets an AI verdict. The result shows where the sketch ranks among every option ("#3 of 12") and whether it beats what the player did. Pundits' arrows become testable.
*Where:* panel → **Draw an option** → click the pitch. A white dashed arrow and a sketch card appear; **Play it** runs it on the pitch.

### Ghost trees
Every option is shown as **branching probabilities**, not a single answer: "78% comes off → 100% shot · 21% goal; 22% cut out → 0% counter-attack shot against". On the pitch, faint branches show where the follow-up shot comes from and where the ball is lost, with the counter-attack arrow.
*Where:* panel "Outcome tree"; branch tags on the pitch ("12% shot", "22% cut out").

### Evidence-checked AI ("why we think this")
Every moment's explanation is built from a **numbered fact sheet** taken from the engine: who chose what, the chances, the value left, the simulation result, what the player could see, the exact distance from the nearest defender to each receiver (from the freeze frame), defenders in the passing lane, the game state, confidence, the Fair Play verdict, and the cause-based reasons. The AI must answer in JSON, listing every claim with the fact ids it relies on, and a validator then checks:
- every number in the text matches a number in the facts;
- every player named appears in the facts;
- no contradictions: "unmarked" or "free" when a defender was under 3 m away, "saw it" when the option was behind them, offside when nobody was.

A rejected draft is regenerated once with the problems spelled out; if it fails again, the viewer gets an explanation written straight from the facts. When the Fair Play lens says there isn't enough evidence, the explanation says exactly that instead of inventing a reason. Studio lines, half- and full-time summaries, pulse lines, sketch verdicts and player one-liners are also number-checked against their facts.
In a real trial, 5 of 5 Gemini explanations passed first time, each claim traceable to its facts.
*Where:* **Why we think this** under "Why it mattered": the status (for example "Every claim checked against the engine · 18 facts"), each claim with its facts, and any rejected drafts.

### Fair Play lens
One plain verdict on every missed opportunity, so fairness is explicit on screen:
- **Clear opportunity missed**: in plain view, playable for this player, worth at least 0.03, and high confidence.
- **Reasonable alternative**: defensible either way, with the reason ("it was on the edge of their vision", "it was hard to execute", "the gain was small").
- **Not enough evidence to judge**: the model and the simulation don't clearly separate the options.

*Where:* under the player's name in the ghost panel; short labels on the report's decision rows.

### What-if timeline
From any frozen moment, **Watch both** plays what really happened over the next few seconds (the real players) and the ghost run (translucent players in the same kit colours, with a translucent ball) **at the same time**. Live readouts track the threat each version builds (xT), the chance it creates (xG), and whether it kept the ball, scored, or lost it. It's clearly labelled *"Plausible simulation, not a prediction: one of 50 runs with defenders reacting."* This is the money shot for the video.
*Where:* ghost panel, **What-if timeline → Watch both**; the label on the pitch explains solid vs translucent.

### Match pulse
Rolling metrics over the last five minutes for each side: **pressing** (per minute), **territory** (share of actions in the opponent's half), **threat** (xT + xG) and **predictability** (share of decisions that were the safe, obvious choice). The engine names the spell it adds up to: *sustained pressure*, *sustained pressure, but passing is becoming predictable*, *control without penetration*, *pressing high and pinning them back*, or *end to end*. An evidence-checked AI line follows when a new spell starts (at most every 8 minutes).
*Where:* Stats tab, **Match pulse** (from minute 3); PULSE items in the timeline and live insights.

### Real-time player tags
Name tags pop up over players when a threshold is hit: a **sprint** ("Kowalski · 27 km/h", the top 1% of speeds) or a **distance milestone** ("Moreau · 9.0 km covered, most on the pitch" at 3, 6, 9 and 12 km). About 10–20 a match, and they're also in the overlay cue feed for broadcasters.
*Where:* on the pitch during play; `player_tag` cues with `tag: sprint | distance`.

### Validation
The engine shows how far to trust it:
- **Model vs simulation**: of the moments the model flags, how many survive 50 runs with defenders reacting. Typically **60–70%**: the simulation is a real check, not a rubber stamp.
- **Model vs fans** and **model vs coaches**: from "You're the player" votes, how often the most popular pick matches the engine's.
- **Calibration**: the reactive simulation agrees with the pass model across the range (for example, passes the model gives 75% come off 75% of the time in simulation; 85% → 89–92%).

*Where:* report, "Validation" tiles; `GET /api/validation`.

---

## 4. Everything else it does (the five-stage pipeline)

**1. Ingest.** A seeded synthetic match generator: invented clubs and players with ratings and two seasons of stats; real formations; possession spells, pressing, marking and offside lines. Every event carries a freeze-frame of all 22 players with velocities. It's football-realistic: about 2.7 goals, about 18 shots and about 80% passing per match. The same seed always replays the same match. Events stream over WebSocket in real time at 1× to 60×, with a smooth interpolated playhead.

**2. Interpret.** Live stats: xG (calibrated so a penalty is about 0.76 and an 18 m central shot about 0.09), expected threat (xT), pass distance, accuracy and difficulty (1–10), ball speed, possession, pressure trends and momentum.

**3. Explain.** The ghost engine judges every on-ball decision (about 1,500 per match), freezes on the big ones (5–13 per match, rate-limited, each confirmed by simulation), and the AI writes "why it mattered". It also writes studio lines about control vs chaos at 15/30/60/75', half- and full-time summaries, and verdicts on pundit sketches. What-if simulations replay any option 50 times from the frozen frame.

**4. Render.** A 3D pitch (React Three Fiber) with four cameras: Broadcast, Tactical (top-down), Sideline (always the full width of the pitch) and Player (behind the ball). At a freeze the camera swoops over the moment, and the viewer can **drag to rotate, pan and zoom** (with **Reset view**). The pitch shows ghost, actual and alternative arrows, a target zone, the vision cone, tree branches and sketches. There's a goal banner and a broadcast-style lower third. **Timed, machine-readable overlay cues (JSON)** are streamed live and exportable for a whole match. Cues carry moment kind (miss/genius), confidence, game state and the vision cone, so a broadcaster could rebuild the graphics. The design is a dark analyst console (IBM Plex, flat, data-dense).

**5. Personalize.** Player focus mode: follow one player all match (purple ring, their own lower bar for moments, a decision score like "chose the best option 22 of 43 times", ratings, seasons, Decision DNA). "You're the player" mode. The full-time report has a story, KPIs, a momentum chart, the decisions that shaped the match, moments of genius, the what-if scoreline, validation, standout players with ratings and DNA, and an all-players table, with JSON exports.

---

## 5. Microsoft and GitHub

- **AI:** a single `askAI()` with providers `mock | gemini | azure`. The submission uses **Azure OpenAI through Microsoft Foundry** (`AI_PROVIDER=azure` plus 3 environment variables). Development used Gemini's free tier.
- **Hosting:** Azure (planned: Static Web Apps for the client, App Service for the WebSocket server).
- **GitHub:** monorepo with npm workspaces (engine / server / client), TypeScript end to end, 63 engine tests. (The brief asks the write-up to mention GitHub Copilot: say how you used it.)

---

## 6. Honest notes (worth saying on camera)

- **All data is synthetic**: invented clubs and players. The judging models are built to plug into real tracking data in the same shape.
- The vision cone is **estimated** from movement and the previous pass; there's no body-orientation data in event feeds. It's deliberately generous when the player had time on the ball.
- The what-if scoreline is a **model estimate**, not a prediction.
- Confidence and validation are shown **so viewers can disagree**: close calls are labelled, and the simulation rejects about a third of the model's flags.

---

## 7. A 3-minute video outline (suggestion)

1. **0:00–0:20, the hook.** Live match on the 3D pitch, then a freeze. "What if the AI could see the pass he missed?"
2. **0:20–0:50, a ghost moment** (seed 7, 0:27). Vision cone, better option on the edge of his vision, the Fair Play verdict, the AI "why it mattered", then **Watch both**: what happened against the ghost run, side by side.
3. **0:50–1:15, fair and honest.** Name the critics' points and show the answers on screen: what he could see, where players would be when the ball arrived, offside, game state, confidence, Fair Play. Open **Why we think this**: "every claim is checked against the engine's facts".
4. **1:15–1:35, genius** (seed 11, 12'). "It's not just about mistakes."
5. **1:35–2:00, "You're the player".** Pick, reveal, crowd. Then the pundit sketch: draw an arrow and the engine scores it.
6. **2:00–2:30, live and the report.** Match pulse and sprint tags during play, then the report: what-if scoreline, Decision DNA, validation numbers.
7. **2:30–3:00, under the hood.** Five-stage pipeline, overlay cue JSON, Azure OpenAI via Foundry, GitHub, synthetic data.

---

## 8. Build history (git)

| Commit | What |
| --- | --- |
| `70699e9` | Baseline: synthetic match engine, ghost decisions, live server, AI layer, report, overlay cues, dark analyst console, free camera, sideline camera |
| `15fa135` | Engine: vision cone, moving world, execution, game state, look-ahead, reactive simulation, confidence, causes, genius, DNA, what-if scoreline, sketch |
| `bd7341e` | Server: fan votes and validation, sketch scoring, Decision DNA, genius-aware AI prompts |
| `361bcb0` | Client: vision cone, genius, predict mode, sketch, ghost trees, DNA, report panels |
| `d7fe600` + | Evidence-checked AI, Fair Play lens, what-if timeline, match pulse, sprint and distance tags (branch `evidence-and-pulse`) |
