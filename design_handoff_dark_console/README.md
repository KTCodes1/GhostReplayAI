# Handoff: Ghost Replay — Dark Analyst Console redesign

## Overview
Restyle the existing Ghost Replay client (`client/`) from its current "neon cyan, rounded, glowy" look into a sober, enterprise analytics console (fintech / Azure-portal feel). **Features, data flow, store, WebSocket protocol and engine do not change.** This is a visual + layout refactor of `client/src/styles.css`, the `client/src/ui/*.tsx` components, and the pitch colours in `client/src/pitch/Scene.tsx` / `Ghosts.tsx`.

## About the design files
`reference/Console Dark.dc.html` is a **design reference built in HTML** (open it in a browser over a local server, e.g. `npx serve reference`). It is not production code. Recreate it inside the existing React + Vite app using the existing component structure and the existing `className` approach in `styles.css`. Sample data lives in `reference/ghost-data.js`; the 2D pitch in `reference/pitch.js` is only a stand-in for the real 3D R3F canvas.

## Fidelity
**High-fidelity.** Match colours, type, spacing, radii and copy exactly as specified below.

---

## Design tokens (replace `:root` in `client/src/styles.css`)

```css
:root {
  --bg: #0a0c0f;        /* page, pitch column, score box */
  --s1: #0f1216;        /* header, match bar, scrubber, sidebars, cards */
  --s2: #14181d;        /* verdict tiles, inputs, segmented control track */
  --s3: #1a1f26;        /* secondary buttons */
  --s4: #262c35;        /* active segment */
  --chip: #1f252d;      /* role chips (CM, ST), meter track */
  --line: #20262e;      /* all hairline dividers */
  --line-2: #2b323c;    /* control borders, card borders inside panels */
  --text: #e6e8eb;
  --text-2: #a3aab4;
  --muted: #747d89;

  --ai: #5b9cf5;                       /* AI / ghost / better option / primary button */
  --ai-text: #8bb9f8;                  /* AI-coloured text on dark */
  --ai-dim: rgba(91,156,245,.12);
  --ai-faint: rgba(91,156,245,.05);
  --ai-line: rgba(91,156,245,.35);
  --on-ai: #07111f;                    /* text on --ai buttons */
  --actual: #ef7a6b;                   /* what the player actually chose */
  --gold: #e0b44a;                     /* goals, player of the match */
  --focus: #a48cf0;                    /* followed player, decision-score meters */
  --ok: #4cbb83;                       /* "connected" status dot */
  --away-on-dark: #3561b5;             /* use instead of a dark navy away colour for bars on dark bg */

  --r: 4px;            /* ALL radii: buttons, cards, panels, chips are 4px (chips 3px) */
  --font: 'IBM Plex Sans', system-ui, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, monospace;
  font-family: var(--font);
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}
```

Remove completely: `--shadow` usage on panels, all `linear-gradient` / `radial-gradient` / `conic-gradient` backgrounds, `box-shadow` glows, `backdrop-filter`, the `.brand-mark` conic gradient, radii of 8/10/12/14/16px, and `999px` pills (status pill is now 3px radius).

**Fonts** — in `client/index.html` replace the Inter link with:
```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
```
Rule: **every number** (scores, clock, minutes, xG, %, EV, ratings, table cells, speeds 1×/4×) uses `var(--mono)`. Labels and prose use Plex Sans. Max font-weight 600 (700 only on the 10px "GR" mark).

**Type scale**
| Use | Size / weight / extra |
|---|---|
| Section eyebrow | 10.5px / 600 / `letter-spacing:.08em; text-transform:uppercase; color:var(--muted)` |
| Body small / metric label | 12px / 400 / `--text-2` |
| Stat label | 11.5px / 400 / `--text-2` |
| Body / prose (AI text) | 13.5px / 400 / line-height 1.55 / `--text` |
| Tab, button | 12px / 500 |
| Team name | 15px / 600 |
| Player name (ghost panel) | 18px / 600 |
| Score | mono 26px / 600 (report: 30px) |
| Verdict number | mono 17px / 600 / `--ai-text` |
| KPI value (report) | mono 22px / 600 |
| Player rating | mono 28px / 600 (POTM in `--gold`) |

**Iconography** — remove all emoji/unicode glyph icons (⚽ ◎ ◆ ✦ ▶ ⏭ ⬇ ★ ●). Use text labels. The only marks are CSS shapes: a 6–8px square rotated 45° = ghost moment (`--ai`), a 7px circle = goal (`--gold`), a 3px × 28px vertical bar = club colour.

---

## Screen 1 — Live match (`App.tsx` `.app`)

Fixed 100vh, rows: `48px header / 64px match bar / 36px scrubber / 1fr body`. All bars `background:var(--s1); border-bottom:1px solid var(--line)`.

### 1. Header — `TopBar` (split: the scoreboard moves to the match bar)
`height:48px; padding:0 16px; display:flex; align-items:center; gap:16px`
- **Brand** (`Brand` in Panels.tsx): 22×22 square, radius 4, bg `--ai`, text "GR" 10px/700 `--on-ai`; then "Ghost Replay" 13px/600; 1×16px divider `--line-2`; "Match Intelligence" 12px `--text-2`.
- **Breadcrumb** (margin-left 16px, 12px `--muted`, gap 8): `Matches / Seed {seed} / {home.name} v {away.name}` — last item `--text-2`.
- flex spacer
- **AI status chip**: `padding:4px 10px; border:1px solid var(--line); radius 4; 12px --text-2`, 6px circle dot `--ok`, text `Azure OpenAI · Microsoft Foundry`. (When provider is `template`, dot `--muted`, text `Template mode`.)
- Buttons: `Match report` (secondary) and `New match` (quiet).

**Buttons**
- Secondary: `bg --s3; border 1px --line-2; color --text; 12px/500; padding 6px 12px; radius 4`. Hover bg `--s4`.
- Quiet: transparent, `--text-2`, padding 6px 10px. Hover bg `--s3`.
- Primary: `bg --ai; border --ai; color --on-ai; 13px/600; padding 9px; radius 4`. Hover `#77aef7`.
- AI outline: `bg rgba(91,156,245,.1); border 1px --ai-line; color --ai-text; 12px/500`.
- Focus-visible: `outline:2px solid var(--ai); outline-offset:1px`.

### 2. Match bar — new row, replaces `.toolbar` and scoreboard
`height:64px; padding:0 16px; display:flex; align-items:center; gap:12px; white-space:nowrap`. All direct groups `flex:none`.
1. **Scoreboard** (gap 14):
   - Home: 3×28 bar in club primary, then column: name 15px/600, sub `NBA · 4-3-3 · Home` mono 11px `--muted`.
   - Score box: mono 26px/600, `padding:2px 14px; bg --bg; border 1px --line-2; radius 4`, dash `–` in `--muted` weight 400 with 8px side margins.
   - Away: mirrored (text right-aligned, bar after).
2. **Clock** (`padding-left:16px; border-left:1px solid var(--line)`): `63:12` mono 15px/600 over `2nd half` 11px `--muted`.
3. **Status pill** (`StatusPill`): `10.5px/600; letter-spacing .08em; padding 4px 9px; radius 3px`, 6px rotated-square icon.
   - Ghost: `bg --ai-dim; color --ai-text; border 1px --ai-line` → `GHOST MOMENT · PAUSED`
   - Live: `bg rgba(239,122,107,.12); color --actual; border rgba(239,122,107,.35)`, round dot pulsing → `LIVE`
   - Full time: gold equivalents → `FULL TIME`; Paused/Searching: `bg --s2; color --text-2; border --line-2`.
4. flex spacer
5. **Playback** (gap 8): eyebrow `PLAYBACK`; segmented speed control; AI-outline button `Next moment` (shows `Searching…` while fast-forwarding). Keep the pause/play button from the current Toolbar as a secondary button before the seg, label `Pause` / `Resume`.
   - **Segmented control**: track `bg --s2; border 1px --line-2; radius 4; padding 2px; gap 2px`; items `padding 3px 8px; --text-2` (speeds in mono 12px); active `bg --s4; color --text; radius 3`.
6. **Camera** (`padding-left:16px; border-left:1px solid var(--line)`): eyebrow `CAMERA` + seg `Broadcast | Tactical | Pitch level | Player` (12px Sans).

### 3. Match scrubber — replaces the 2px `.progress`
`height:36px; padding:0 16px; gap:12px; mono 11px --muted`
- `0'` … track … `90'`, then legend (Sans): ◇ `Ghost moment`, ● `Goal`.
- Track: `flex:1; height:4px; bg --s3; radius 2`. Fill `#3a6fb8` width = match progress. 1px half-time tick at 50% (`--line-2`, extends 5px above/below).
- Markers, absolutely positioned at `minute/90`: ghost = 8×8 `--ai` rotated 45°, goal = 8×8 circle `--gold`; both `box-shadow:0 0 0 2px var(--s1)`. Clicking a ghost marker calls `showMoment(m)` (same as Timeline).
- Data: `moments[]` (clockMs) and goal events from `ticker`.

### 4. Body — `main`
`display:grid; grid-template-columns:300px minmax(0,1fr) 420px`. **The ghost panel is no longer an overlay**: it is the right column. When no ghost moment is open, the right column shows the Timeline tab content (or collapse to `300px 1fr` — preferred: keep 3 columns, right column shows `Live feed` = TimelineTab with a header `LIVE INSIGHTS`).

#### 4a. Left sidebar — `Sidebar.tsx`
`bg --s1; border-right 1px --line`.
- Tabs: grid 4 equal cols, 12px/500, `padding:11px 0`, inactive `--muted` with transparent 2px bottom border, active `--text` with `border-bottom:2px solid var(--ai)`. Counts in mono 10px `--text-2` (no pill background).
- Body: `padding:16px; gap:20px` between groups.
- Teams head: 12px/600, 8px square chips radius 2.
- **Stats group** (`StatsTab`): eyebrow + rows with `gap:11px`. Row: values mono 12.5px/500 left & right, label 11.5px `--text-2` centered; below, 3px bar track, `gap:2px`, home bar club colour, away bar club colour (if luminance too low on dark, use `--away-on-dark`), radius 1. **Bar widths must be percentages of the row** (home/(home+away)), not flex.
- Timeline items (`TimelineTab`): minute mono 12px `--muted`, 3px team bar, text 13px `--text-2`. Replace icon squares with: ghost = 6px rotated square `--ai`, goal = 7px circle `--gold`, studio = text tag `STUDIO` 10px/600 `--ai-text`. Row padding 9px 0, divider `--line`.
- Player tab & Feed tab: same tokens; `.focus-card` → `bg --s1; border 1px --line; border-top 2px club colour; radius 4`. Meters 3px, track `--chip`, fill `--focus`.

#### 4b. Centre — pitch (`section.stage`)
- Header row 40px (`border-bottom 1px --line`, padding 0 16px): `Pitch` 12px/600 · `{Camera} · frozen at 63:12.4` 12px `--muted` (clock mono `--text-2`; when live: `{Camera} · live`). Right: legend 11.5px `--text-2` with 16×2 swatches: `Chosen` (`--actual`), `Better option` (`--ai`), `Alternative` (2px dashed `#8b95a3`). Legend only while a ghost is open.
- Canvas area: `padding:20px; background:#0d1712`.
- Footer row 36px (`border-top 1px --line`), mono 11px `--muted`, gap 16: `EVT 0812` (`--text-2`) · `PASS` · `HALLORAN → MENSAH` · `13 m` · `DIFFICULTY 2/10` · `43 km/h` · `xT −0.021` (coloured `--actual` if negative, `--ai-text` if positive); right side `22 players · freeze-frame`. This **replaces the floating `EventChip`** (data from `lastEvent` + `lastMetrics`, uppercase).
- `LowerThird` stays on the canvas, restyled: `bg rgba(15,18,22,.96); border 1px --line-2; radius 4; no shadow, no blur`; tag cell `LIVE` → bg `--s3` text `--text-2`; `STUDIO` → bg `--ai` text `--on-ai`; 10px/600 .08em.
- `GoalBanner`: radius 4, no shadow; word cell club colours 22px/700 .08em; scorer cell `bg --s1; border 1px --line-2`.

**3D scene colours** (`pitch/Scene.tsx`, `Ghosts.tsx`):
- Grass base `#0d1712`, stripes alternating `#0f1b15` / `#112019` (muted, low contrast — analytic not TV).
- Lines `#e1ebe6` at ~0.45 opacity (or colour `#7d8a84`), lineWidth 1.2.
- Ghost arrow `#5b9cf5`, actual arrow `#ef7a6b`, alternative arrows `#8b95a3` dashed. No glow/bloom.
- Player badges: fill club colour, 1px white ring at 80%, role text white bold. Focused/ghost player: extra ring `#5b9cf5`.
- Name tags `.tag`: `bg rgba(10,12,15,.92); border 1px --line-2 (ghost: --ai); radius 3; 11px/600`, no box-shadow.
- Optional: translucent `#5b9cf5` @12% rectangle with dashed `#5b9cf5` stroke marking the ghost target zone.
- Scene background / fog `#0a0c0f`.

#### 4c. Right column — `GhostPanel.tsx`
`bg --s1; border-left 1px --line; display:flex; flex-direction:column`. No absolute positioning, no slide-in shadow (a 150ms opacity fade is fine).
- **Head** (`padding:16px 20px 14px; border-bottom 1px --line; gap 10px`):
  - Row: `◇ GHOST MOMENT 5 OF 6` eyebrow in `--ai-text` (index = position in `moments`) · right: `63' · 2nd half` mono 10.5px `--muted`.
  - Player: 3px club bar (stretch) + name 18px/600 + role chip (`mono 10.5px/600; --text-2; bg --chip; padding 1px 5px; radius 3`) / sub 12px `--text-2`: `{club} · #{number} · chose {choicePhrase} ({outcome})`.
- **Body** (`flex:1; min-height:0; overflow-y:auto; padding:0 20px 12px; gap:14px`):
  1. `SimulationStrip` (when playing) at top: `border 1px rgba(224,180,74,.45); bg rgba(224,180,74,.08); radius 4`; eyebrow gold.
  2. **Why it mattered**: eyebrow `WHY IT MATTERED` + right-aligned AI badge (`10.5px/500 --ai-text; border 1px --ai-line; radius 3; padding 1px 7px`, text = provider name `Azure OpenAI`; template → `Template` in `--muted`/`--line-2`). Paragraph 13.5px/1.55 `--text`. Pending: `Analysing the moment…` `--muted` italic.
  3. **Decision comparison**: header row = eyebrow `DECISION COMPARISON` + right link `All options (5)` 11.5px `--ai-text` (toggles the options table below).
     - One bordered box (`border 1px --line-2; radius 4; overflow hidden`), 2 equal columns:
       - CHOSEN: `padding 12px; border-top 2px --actual`; label 10.5px/600 .08em `--actual`; action 14px/600; 4 metric rows (12px `--text-2` label, mono `--text` value): `Chance it comes off`, `xG per attempt`, `Leads to a shot`, `Ball lost`; secondary button `Simulate`.
       - BETTER OPTION: same but `border-top 2px --ai; border-left 1px --line-2; bg --ai-faint`; label `--ai-text`; primary button `Simulate 50 runs`.
       - Playing state: `box-shadow: inset 0 0 0 1px var(--gold)`.
     - Verdict: 2-col grid gap 8, each tile `bg --s2; radius 4; padding 8px 12px; display:flex; align-items:baseline; gap:8px`: mono 17px/600 `--ai-text` `+0.142` + 11px `--text-2` `Expected value left on the table`; second `+0.119` `xG gained across 50 simulations`.
     - Options table (when toggled): 12px, header 10.5px uppercase `--muted`, rows divider `--line`, chosen row name `--actual`, best row name `--ai-text` with text tag `Best` instead of ★, playing row bg `rgba(224,180,74,.08)`; ▶ buttons become secondary buttons labelled `Run`.
  4. **Key factors**: eyebrow + list, each `grid 12px 1fr; gap 8; 12.5px/1.45 --text-2`, 5px dot `--ai` (ghost) or `--actual` (actual).
  5. `gp-note` 11.5px `--muted`.
- **Footer** (`padding:12px 20px; border-top 1px --line; grid 1fr auto; gap 8`): primary `Continue match` + secondary `Next moment`. Replay mode: primary `Back to report` / `Back to the match`.

---

## Screen 2 — Full-time report (`Report.tsx`)
Change from a modal over the pitch to a **full page** (replaces the body below the header; header breadcrumb last item becomes `Full-time report`; header buttons: `Export report JSON`, `Export overlay cues`, quiet `Back to match`). Container `padding:28px 32px 36px; gap:28px`, max content width 1376.

1. **Title row** (space-between, align end): left column gap 12 — eyebrow `FULL-TIME REPORT` (`--ai-text`; live: `REPORT SO FAR · 63'`), then team names 22px/600 with 3×26 club bars, score box mono 30px/600 (border `--line-2`, radius 4). Right: mono 12px `--muted` `Seed 7 · 90:00+ · 1,014 events · 6 ghost moments`.
2. **Match summary** (`grid 200px 1fr; gap 24; padding 18px 20px; bg --s1; border 1px --line; radius 4`): left eyebrow `MATCH SUMMARY` + 11px `--ai-text` `Generated by Azure OpenAI from engine facts`; right paragraph 15px/1.6 max-width 880. (Replaces the `.story` left-border-accent block.)
3. **KPI strip**: one bordered box (`bg --s1; border 1px --line; radius 4`), 4 equal cells separated by `border-right 1px --line`, each `padding 16px 18px; gap 10`: label 11.5px `--text-2`; values mono 22px/600 (away value `--text-2`), 3px split bar.
4. **Two-column row** `minmax(0,7fr) minmax(0,6fr)`, gap 20, both panels `bg --s1; border 1px --line; radius 4; padding 18px 20px`:
   - **Momentum** (`MomentumChart.tsx`): header eyebrow `MOMENTUM · xT PER 5 MIN` + legend (8px squares). Chart 200px tall, 18 bars gap 4: home bars grow up from the 1px centre line (`--line-2`), away bars grow down; HT vertical 1px `--line`. Goal labels row (20px, mono 10.5px `--text-2`, 7px gold dot + `23' Okafor`) positioned at minute/90. Axis row `0'  HT  90'` mono 10.5px `--muted`.
   - **The decisions that shaped the match**: eyebrow + right `EV lost` 11px `--muted`. Rows `grid 34px 3px 1fr auto auto; gap 10; padding 10px 0; border-top 1px --line; 13px/1.4`: minute mono 12px `--muted`, 20px club bar, `<b>Player</b> chose … when … was on` (`--text-2`, name `--text` 600), EV mono 12.5px `--ai-text` `+0.142`, `Replay` 12px `--muted` (hover `--ai-text`). Whole row clickable → `openMomentFromReport`.
5. **Standout performers**: eyebrow, then 3-col grid gap 16 (POTM, then highlights). Card `bg --s1; border 1px --line; border-top 2px {club colour | --gold for POTM}; radius 4; padding 16px 18px; gap 12`:
   - Head: tag eyebrow (`PLAYER OF THE MATCH` gold / `FOLLOWING` `--focus` / `{club} STANDOUT` `--muted`), name 16px/600 + role chip, club line 12px `--muted` `{club} · 10.8 km`; right: rating mono 28px/600 + `RATING` 10px .08em `--muted`.
   - One-liner 13px/1.5 `--text-2`.
   - Stats 4×2 grid gap `10px 8px`, `border-top/bottom 1px --line; padding 12px 0`: value mono 14px/500, label 10.5px `--muted`.
   - Decision score row 12px + 3px meter `--focus` on `--chip`.
   - Best moment / biggest miss rows: plain text rows, 12.5px; miss row is a button with `--ai-text` link `Replay`.
6. **All players** table (always visible, not behind a toggle): panel `bg --s1; border 1px --line; radius 4`. Header bar `ALL PLAYERS` + `Sorted by rating · 22 players`. Grid `minmax(0,2.2fr) repeat(9,1fr)`, header 10.5px/600 .06em `--muted` uppercase with `border-bottom 1px --line-2`; rows `padding 9px 18px; border-bottom 1px --line`, mono 12.5px right-aligned; player cell: 3×14 club bar, role mono 10.5px `--text-2` (26px wide), name Sans 13px. Rating column 600.

---

## Start screen (`App.tsx` `StartScreen`) — not mocked; apply the same system
- Full page `bg --bg`, no radial gradient. Same 48px header (brand + AI status chip).
- Centred 2-column (1.1fr / 0.9fr, max 1040, gap 40). Left: eyebrow `MATCH INTELLIGENCE`, h1 40px/600 letter-spacing -.01em (no coloured `<em>`; keep copy), lede 15px/1.6 `--text-2`, features as a 3-row list with 1px `--line` dividers and no icon squares (title 13px/600, text 12.5px `--text-2`).
- Right: setup card `bg --s1; border 1px --line; radius 4; padding 22px`, no shadow. Fields: label 10.5px/600 .08em uppercase `--muted`; inputs/selects `bg --s2; border 1px --line-2; radius 4; padding 8px 10px; 13px`. Primary button full width `Start live analysis`.

## Interactions & behaviour
Unchanged from the current app (store actions in `client/src/store.ts`). Only differences:
- Ghost panel is a layout column, not an overlay; the pitch no longer gets covered.
- Scrubber markers are clickable (open moment).
- Report is a page/view state (`reportOpen`) instead of a modal backdrop; `Back to match` = `closeReport`.
- Hover states: rows `bg --s2`; buttons as listed; tabs hover `color --text-2`. Transitions 120ms on background/border/color only.

## Files in this bundle
- `reference/Console Dark.dc.html` — the design (live screen + report). Serve the folder and open it.
- `reference/ghost-data.js` — sample data used by the mock (shape mirrors engine output).
- `reference/pitch.js` — 2D pitch stand-in; use only for colour reference.
- `reference/support.js` — runtime for the reference file; not for the app.
