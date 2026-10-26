# Demo video script (target 1:50, rules require under 2:00)

Demo link: `http://localhost:5173/?seed=7&speed=8&autostart&jump`
One story, one moment: Dunmore's blocked shot at 0:27, when the pass to Moreau was on.
About 260 words of voiceover, at a calm pace of about 150 words a minute.

## Before you record
- Add the Azure key first so the header shows **Azure OpenAI · Microsoft Foundry**, not "Template mode".
- Restart `npm run dev` and do one full dry run (warms the AI cache, so explanations appear instantly).
- Chrome full screen (F11), zoom 100%, 1920×1080, one tab, notifications off (Windows: Focus / Do not disturb).
- Record each scene as its own clip; join them in Clipchamp. Retakes are then cheap.

## Script

| Time | On screen | Voiceover |
| --- | --- | --- |
| 0:00–0:12 | Landing page, then the live match on the 3D pitch (Sideline camera). | "Football analytics tells you what happened. Ghost Replay shows what *could* have happened, live, while the match is still being played." |
| 0:12–0:40 | Freeze at 0:27. Camera swoops overhead, ghost arrows and the vision cone appear. Hover the two cards: CHOSE vs BETTER OPTION. | "Twenty-seven seconds in, Dunmore shoots, and it's blocked. The engine freezes play and finds a better option: the pass to Moreau. Every option is scored with expected goals and expected threat. And it's fair. That cone is Dunmore's modeled field of view. Moreau was at the edge of it, so the verdict isn't 'mistake'. It's 'reasonable alternative', with a confidence level shown." |
| 0:40–1:05 | Click **Watch both**. Real play and the translucent ghost run play together. Point the cursor at the readouts. | "But is that just a number? Here's what really happened, and the ghost version at the same time, with defenders reacting. Across fifty simulated runs, the pass produced more than twice as many goals as the shot. A plausible simulation, not a prediction." |
| 1:05–1:30 | Scroll to **Why it mattered**, open **Why we think this**, then click **Try to fool the checker**. | "The explanation is written by Azure OpenAI, but the AI never owns the numbers. Every claim is checked against the engine's facts. Watch me try to fool it: four false claims, four rejections." |
| 1:30–1:50 | Open **Match report** (Fair Play verdicts, illustrative xG, validation tiles), then the **Feed** tab with the overlay cue JSON. | "At full time, the report recaps the decisions that shaped the match, with validation you can rerun yourself. And everything ships as timed overlay cues a broadcaster can sync to their feed. Synthetic data, all five pipeline stages, built on Microsoft Foundry and GitHub." |
| 1:50–1:55 | Logo / title card. | "Ghost Replay. See the game that could have been." |

## Spare clips (only if you're under time)
- Seed 11, **Next moment** ×4: 38' Okafor, a moment of genius. "It's not only about mistakes."
- Seed 7, **Next moment** ×3: 17' Mensah, a clear opportunity missed.
