# UI direction — The Great Lake Debate

The interface should feel like a 1990s SNES fighter broadcast through an
overheated election-night graphics package. It is energetic and partisan in
presentation, but it never hides the fight.

## Color Bible

`docs/color-bible/rows/ui_hud.json` is the source of truth. Do not sample colors
from character renders or stage art for UI elements.

| Role | Color | Use |
|---|---:|---|
| UI ink | `#101018` | Outlines and maximum contrast |
| Panel navy | `#313152` → `#8484B5` | Frames, empty bars, inactive marks |
| Approval green | `#42D631` | Healthy fighter, above two-thirds |
| Approval yellow | `#FFD621` | Warning, one- to two-thirds |
| Approval red | `#E62121` | Danger, below one-third |
| Timer gold | `#E6B531` | Timer, round label, prompts |
| Trump orange | `#FF8421` | Trump name and winner messaging only |
| Carney teal | `#31B5B5` | Carney name and winner messaging only |
| Win-pip yellow | `#FFE652` | Round wins |
| White / flash | `#FFFFFF` / `#FFFFC6` | Neutral copy and emphasis |

Health is framed as **APPROVAL**. It moves green → yellow → red at 64 and 32
HP, so color reinforces urgency without being the only signal: the bar also
shrinks segment by segment. Candidate colors identify sides, not health.

## Screen language

- Title: **BATTLE FOR INDEPENDANCE** / **THE GREAT LAKE DEBATE**
- Start prompt: **PRESS START TO DEBATE**
- Pause: **RECOUNT IN PROGRESS**
- Round result: **DEBATE OVER** / `[CANDIDATE] TAKES THE ROUND`
- Match result: **MANDATE SECURED** / `[CANDIDATE] WINS THE MANDATE`

The project title keeps its intentional `Independance` spelling. UI copy stays
short, uppercase, and readable within the SNES 32×28 text grid.

## Technical boundaries

- Stage: BG0, 4bpp.
- UI: BG1, 4bpp, tiles at VRAM `0x4000`, map at `0x7000`.
- BG2 remains free for later effects.
- UI uses no OBJ sprites; fighter art retains the OBJ budget.
- Runtime uploads only dirty tilemap rows. A normal health/timer refresh is a
  few hundred bytes, leaving VBlank room for streamed fighter frames.
