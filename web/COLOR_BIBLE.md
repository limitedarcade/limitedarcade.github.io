# Battle for Independence — color bible

The arena is bright and dimensional. The surrounding ceremony is midnight ink, hot gold, and impact red. Blue identifies the second side; it does not imply a gameplay advantage. Colors always accompany labels, icons, or position.

| Token | Hex | Role |
|---|---|---|
| Ink | `#080C18` | Screen surround, letterboxing, text outlines |
| Panel | `#111A2A` | Pause menu, move list, debug surfaces |
| Paper | `#EEF3FF` | Main text on dark surfaces |
| Muted | `#B1BED0` | Descriptions and secondary labels |
| Gold | `#FFC63D` | Primary actions, round calls, victory |
| Gold light | `#FFE9A1` | Metallic highlight; top of title gradient |
| Gold deep | `#E8871A` | Title depth and warm edges |
| Red | `#D81F2A` | Impact, danger, fatality, first-side marker |
| Red deep | `#7C0D14` | Heavy shadows and fatality background |
| Blue | `#2F6BFF` | Second-side marker and secondary energy |
| Cyan | `#80DBFF` | Keyboard focus, debug selection, guard accent |

## Type

- **Fatal Fighter:** title, round slams, KO and major end cards. Short uppercase lines only.
- **Great Fighter Demo:** fighter names and versus identity. Short display text only; retain a system fallback for unsupported glyphs.
- **Single Fighter:** compact section titles and debug heading.
- **Segoe UI / system sans-serif:** instructions, move descriptions, controls, menus. Minimum 14px for functional text; body copy 16px.

## Rules

Use paper on ink for reading, ink on gold for actions. Red and blue are accents, not small body text. Keep gradients to display type and primary buttons. Focus uses a visible cyan outline. Flawless is gold, Double KO uses split red/blue, Fatality is red on ink, and ordinary Victory uses paper/gold. Reduced motion removes slam scaling, camera kicks, and animated sweeps while retaining each callout.

The source of truth is `game/src/render/palette.js`; it installs CSS custom properties and supplies canvas/Three.js ceremony colors. Source fonts, audio, and music remain untouched; runtime copies live under `game/public/`.


Impact vocabulary: blunt hits use warm white fractured rays; kicks use pale ice crescents; guard uses mint (#8fffc0) and white hexagons; counters use gold (#ffc63d) diamonds; KO uses a red/gold screen-edge burst. Danger zones use amber that shifts toward red before activation. These gameplay signals remain consistent across all stage grades.

Environment grades extend the same base: Lake is steel blue; marble courtyard is warm ivory against storm blue; palms use restrained violet and amber; the lawn is moonlit teal. New raster art follows the production prompt recorded in ART_DIRECTION.md. Body wear retains the underlying skin and fabric color, adding localized dark red, purple bruising and pale frayed threads.
