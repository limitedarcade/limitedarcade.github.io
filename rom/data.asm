.include "hdr.asm"

; Per-frame sprite sections + bank/addr tables (auto-generated).
.include "res/frames_data.as"

.section ".rolake" superfree
lake_til:
.incbin "res/lake.pic"
lake_tilend:
lake_map:
.incbin "res/lake.map"
lake_mapend:
lake_pal:
.incbin "res/lake.pal"
lake_palend:
.ends

.section ".rohud" superfree
hud_font_til:
.incbin "res/hud_font.pic"
hud_font_tilend:
hud_font_pal:
.incbin "res/hud_font.pal"
hud_font_pal_end:
.ends
