# Ghost Replay: demo video script (1:55)

Judges may watch hundreds of entries, some with the sound off. So the video has to sell the idea in
the first 10 seconds, show every key feature on screen, and carry a caption for each beat.

About 235 words of voiceover over 1:55: a calm, confident pace with room to breathe.
**Bold** in the voiceover = lean on that word.

---

## The script

### 1 · Hook (0:00–0:08)
**Screen:** Live match on the 3D pitch, broadcast camera, ball moving. Hard cut in, no title card.
**Caption:** `Stats show what happened.`
**Voiceover:**
> Every match, players make hundreds of decisions. Stats tell you what they **did**. Never what they **could** have done.

### 2 · It's live (0:08–0:20)
**Screen:** Match running at speed. Sidebar **Stats** tab: xG, possession, pass difficulty ticking, then the **Match pulse** panel. Switch camera to **Sideline** for one second.
**Caption:** `Live: every event, every player, every second`
**Voiceover:**
> This is **Ghost Replay**. A synthetic match streams live, event by event, with expected goals, expected threat and pass difficulty updating as it happens.

### 3 · The freeze (0:20–0:45)
**Screen:** Play freezes at 0:27. Camera swoops overhead. Red arrow (the shot), cyan ghost arrow (the pass to Moreau), vision cone. Hover the CHOSE and BETTER OPTION cards. Zoom on the **Reasonable alternative** chip.
**Caption:** `The AI froze the play: a better option was on`
**Voiceover:**
> Then the AI spots a decision worth questioning, and **freezes play**. Dunmore shoots, and it's blocked. But the ghost shows the pass to Moreau was on, and every option is scored. It's also **fair**. This cone is what Dunmore could plausibly see. Moreau was at the edge of it, so the verdict is "reasonable alternative", not "mistake".

### 4 · Would it have worked? (0:45–1:02)
**Screen:** Click **Watch both**. The real play and the translucent ghost run play together on the same pitch; the ghost ends in a goal. Point at the readouts.
**Caption:** `50 simulations, defenders reacting`
**Voiceover:**
> But would it have **worked**? Watch both: what really happened, and the ghost, with defenders reacting. Across fifty simulations, the pass creates more than **twice** as many goals.

### 5 · AI you can trust (1:02–1:20)
**Screen:** **Why it mattered** text, open **Why we think this** (claims next to their facts), then click **Try to fool the checker**: four red rejections.
**Caption:** `Azure OpenAI explains. The engine fact-checks every claim.`
**Voiceover:**
> Azure OpenAI explains why it mattered, but it **can't make things up**. Every claim is checked against the engine's own facts. Try to fool it, and all four false claims get **rejected**.

### 6 · More than mistakes (1:20–1:38): fast montage, about 4 s per shot
**Screen:**
1. Seed 11, 38': green **Genius moment** (Ezeoha).
2. **You're the player** on: pick an option, then the reveal.
3. **Draw an option**: drag an arrow, the engine scores it.
4. **Player** tab: **Decision DNA** bars.

**Caption:** `Genius moments · Call the play · Draw your own · Decision DNA`
**Voiceover:**
> It celebrates **genius**, not just mistakes. Fans can call the play before the reveal, or **draw** their own option and have it scored. And every player gets a **decision profile**.

### 7 · Built for broadcast (1:38–1:50)
**Screen:** **Match report**: decisions that shaped the match, illustrative xG, validation tiles. Cut to the **Feed** tab with overlay cue JSON scrolling.
**Caption:** `Validated on unseen matches · Overlay cues, ready for broadcast`
**Voiceover:**
> At full time, the decisions that shaped the match, **validated** on matches the model never saw. And every insight ships as timed **overlay cues**, ready for a broadcast feed.

### 8 · Close (1:50–1:55)
**Screen:** Title card: **Ghost Replay**, with *Azure OpenAI · Microsoft Foundry · Azure · GitHub* underneath.
**Voiceover:**
> Ghost Replay. See the game that **could have been**.

---

## Shot list: what to record (record each as its own clip)

| Clip | How to get there | Length to capture |
| --- | --- | --- |
| A: live play + Stats + pulse | `localhost:5173/?seed=7&speed=8&autostart` (no jump). Let it reach minute 4+ so **Match pulse** is showing. | 20 s |
| B: the freeze, Watch both, evidence | `?seed=7&speed=8&autostart&jump`. Freezes at 0:27. Do sections 3 → 4 → 5 in one take. | 60 s |
| C: genius | `?seed=11&speed=20&autostart&jump`, press **Next moment** four times → 38' Ezeoha. | 5 s |
| D: You're the player | Header toggle **You're the player**, then `?seed=7&speed=8&autostart&jump`. Pick, then reveal. | 6 s |
| E: sketch | Any frozen moment → **Draw an option** → drag an arrow. | 5 s |
| F: DNA | Sidebar **Player** tab → **Decision DNA**. | 4 s |
| G: report + feed | **Match report**, scroll slowly; then **Feed** tab. | 12 s |

Record more than you need; cut tight in the editor.

## Recording setup
- **Add the Azure key first**, so the header shows *Azure OpenAI · Microsoft Foundry* and not *Template mode*.
- Restart `npm run dev` and do one dry run of clip B (warms the AI cache).
- Chrome full screen (F11), 1920×1080, zoom 100%, one tab, notifications off.
- Record screen in **Clipchamp** (built into Windows), voiceover separately in Clipchamp or on your phone in a quiet room. Recording voice separately is easier: no clicking noises, and you can redo lines.
- Add the captions as text overlays, white on a dark strip, at the bottom.
- Speed up the boring bits (1.5–2×); never the freeze or the reveal.
- Optional: quiet background music at about 10% volume.
- Export 1080p, upload to YouTube as **Unlisted**, check it's under 2:00.

If you used GitHub Copilot while building, add it to the closing card: *Built with GitHub Copilot*.
