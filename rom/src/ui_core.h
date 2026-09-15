#ifndef BATTLEFI_UI_CORE_H
#define BATTLEFI_UI_CORE_H

/*
 * Tilemap engine for the HUD. Layout lives in ui.h; this file only knows how
 * to get tiles onto BG2 without blowing the VBlank.
 *
 * ---------------------------------------------------------------------------
 * The VBlank budget, which is the whole reason this file exists
 * ---------------------------------------------------------------------------
 * NTSC 224-line mode leaves ~38 blanked scanlines. A scanline is 1364 master
 * cycles and DMA moves one byte per 8 of them, so the hard ceiling is about
 *
 *     38 lines x 1364 / 8  ~=  6460 bytes
 *
 * and that is before any overhead. Three things want a share of it:
 *
 *     544 bytes   PVSnesLib's NMI ISR, which DMAs all of oamMemory to OAM
 *                 BEFORE WaitForVBlank() returns -- see interrupt.h. This is
 *                 not optional and it is already spent by the time any of our
 *                 code runs.
 *    4096 bytes   one fighter animation frame (128x64, streamed every 3rd
 *                 frame per fighter -- see the comment at the top of main.c)
 *       n bytes   this file
 *
 * The first HUD asked for all 28 tilemap rows in one go: 544 + 4096 + 1792 =
 * 6432 against a 6460 ceiling with zero overhead. The tail of that transfer
 * landed after VBlank ended, the PPU dropped it, and the result on hardware
 * was the title screen's text still sitting under the match HUD because the
 * full-screen clear in ui_begin_match() never actually reached VRAM.
 *
 * So: uploads are metered. ui_flush() takes a row budget and never exceeds it,
 * and main.c hands it a small budget on frames that also stream a fighter and
 * a large one on frames that do not. A full-screen change costs two or three
 * frames instead of one, which at 60Hz is 33-50ms and invisible.
 *
 * ---------------------------------------------------------------------------
 * Why a per-row flag array and not a first/last span
 * ---------------------------------------------------------------------------
 * The old tracker kept min and max dirty rows, so touching the top HUD and a
 * bottom prompt in the same frame re-sent all 28 rows between them. That is
 * what made a 1792-byte transfer reachable in the first place. One byte per
 * row costs 28 bytes of RAM and turns the common case (two rows changed at
 * opposite ends) into 128 bytes instead of 1792. Runs of adjacent dirty rows
 * are still coalesced into a single DMA, so a full redraw is not 28 calls.
 */

#include <snes.h>

#include "hud_tiles.h"

/* VRAM layout, in WORDS -- everything pvsneslib takes here is word-addressed.
 *
 *   0x0000..0x1FFF  OBJ tiles (16 KB, all four fighter slots -- full)
 *   0x2000..0x384F  stage tiles
 *   0x4000..0x5970  HUD tileset, 407 tiles (see src/hud_tiles.h)
 *   0x6800..0x6BFF  stage tilemap
 *   0x7000..0x73FF  HUD tilemap
 *
 * The HUD tileset ends at 0x5970 and the next thing up is the stage tilemap at
 * 0x6800, so there is room for about 240 more tiles before anything collides.
 */
#define UI_TILES_VRAM 0x4000
#define UI_MAP_VRAM 0x7000

#define UI_MAP_COLS 32
#define UI_MAP_ROWS 28
#define UI_MAP_WORDS (UI_MAP_COLS * 32)
#define UI_ROW_BYTES (UI_MAP_COLS * 2)

/* Tilemap entry bits 14 and 15. background.h defines NUM/PAL/PRIO but not
 * these two. */
#define UI_TIL_HFLIP (1 << 14)
#define UI_TIL_VFLIP (1 << 15)

/* Row budgets. 6 rows = 384 bytes, which alongside a 4096-byte fighter frame
 * and the ISR's 544-byte OAM transfer comes to 5024 -- comfortably inside the
 * ~6460-byte ceiling with room for call overhead. 20 rows = 1280 bytes and is
 * only used on frames where no fighter frame is streamed. */
#define UI_BUDGET_FIGHT 6
#define UI_BUDGET_IDLE 20

/* ------------------------------------------------------------------------ */
/* Colours. Every value is the BGR15 word for a named entry in               */
/* docs/color-bible/rows/ui_hud.json: word = b << 10 | g << 5 | r.           */
/* Do not sample UI colours from character or stage art.                     */
/* ------------------------------------------------------------------------ */
#define UI_C_CLEAR 0x0000     /* transparent      */
#define UI_C_INK 0x0C42       /* #101018 outline  */
#define UI_C_PANEL_DARK 0x28C6 /* #313152         */
#define UI_C_PANEL_MID 0x414A  /* #525284         */
#define UI_C_PANEL_LIT 0x5A10  /* #8484B5         */
#define UI_C_RED_DARK 0x0850   /* #841010         */
#define UI_C_RED 0x109C        /* #E62121         */
#define UI_C_RED_LIT 0x215F    /* #FF5242         */
#define UI_C_YELLOW 0x135F     /* #FFD621         */
#define UI_C_GREEN 0x1B48      /* #42D631         */
#define UI_C_GOLD 0x1ADC       /* #E6B531         */
#define UI_C_ORANGE 0x121F     /* #FF8421 trump   */
#define UI_C_TEAL 0x5AC6       /* #31B5B5 carney  */
#define UI_C_PIP 0x2B9F        /* #FFE652         */
#define UI_C_WHITE 0x7FFF      /* #FFFFFF         */
#define UI_C_FLASH 0x63FF      /* #FFFFC6         */

/* ------------------------------------------------------------------------ */
/* State                                                                     */
/* ------------------------------------------------------------------------ */

extern char hud_font_til, hud_font_pal;

static u16 ui_map[UI_MAP_WORDS];
static u8 ui_dirty_row[UI_MAP_ROWS];
static u8 ui_scan;   /* rotating flush start, so no row can starve */
static u8 ui_budget; /* rows main.c will allow this frame */

/* ------------------------------------------------------------------------ */
/* Map writing. None of this touches VRAM; it all lands in ui_map and is     */
/* metered out by ui_flush().                                                */
/* ------------------------------------------------------------------------ */

static u16 ui_entry(u16 tile, u8 pal)
{
    /* BG_TIL_PRIO puts the HUD on BG2's high-priority layer. In Mode 1 that
     * sits above OBJ priority 2, which is what the fighters are drawn at, so
     * banners cover the fighters instead of the other way round. */
    return (u16)(BG_TIL_NUM(tile) | BG_TIL_PAL(pal) | BG_TIL_PRIO);
}

static void ui_touch(u8 row)
{
    if (row < UI_MAP_ROWS)
        ui_dirty_row[row] = 1;
}

/* A row is dirty when its CONTENT changed, not when something drew over it.
 *
 * This one comparison is what lets every screen redraw itself from scratch
 * every frame without costing any VRAM traffic: re-drawing the same chyron
 * writes the same words, nothing is marked dirty, and ui_flush() has nothing
 * to send. The first HUD instead kept a pile of ui_last_hp/ui_last_clock
 * caches and skipped drawing when they matched -- and a single mistake in
 * that bookkeeping meant a screen was never drawn at all, which is precisely
 * what happened. Content-derived dirtiness cannot get out of step with what
 * is actually on screen. */
static void ui_put(u8 x, u8 y, u16 tile, u8 pal)
{
    u16 idx;
    u16 entry;

    if (x >= UI_MAP_COLS || y >= UI_MAP_ROWS)
        return;
    idx = (u16)y * UI_MAP_COLS + x;
    entry = ui_entry(tile, pal);
    if (ui_map[idx] == entry)
        return;
    ui_map[idx] = entry;
    ui_dirty_row[y] = 1;
}

/* Same, mirrored. Player 2's approval bar is player 1's tiles with this set,
 * so the two bars drain towards each other from one set of art. */
static void ui_put_flip(u8 x, u8 y, u16 tile, u8 pal, u8 hflip)
{
    u16 idx;
    u16 entry;

    if (x >= UI_MAP_COLS || y >= UI_MAP_ROWS)
        return;
    idx = (u16)y * UI_MAP_COLS + x;
    entry = ui_entry(tile, pal);
    if (hflip)
        entry = (u16)(entry | UI_TIL_HFLIP);
    if (ui_map[idx] == entry)
        return;
    ui_map[idx] = entry;
    ui_dirty_row[y] = 1;
}

/* Horizontal run of one tile. */
static void ui_span(u8 x, u8 y, u8 width, u16 tile, u8 pal)
{
    u8 i;

    for (i = 0; i < width; i++)
        ui_put((u8)(x + i), y, tile, pal);
}

static void ui_clear_rows(u8 first, u8 last)
{
    u16 pos;
    u16 end;
    u8 row;

    if (last >= UI_MAP_ROWS)
        last = UI_MAP_ROWS - 1;
    for (row = first; row <= last; row++)
    {
        pos = (u16)row * UI_MAP_COLS;
        end = pos + UI_MAP_COLS;
        while (pos < end)
        {
            if (ui_map[pos])
            {
                ui_map[pos] = 0;
                ui_dirty_row[row] = 1;
            }
            pos++;
        }
    }
}

static void ui_clear_all(void)
{
    ui_clear_rows(0, UI_MAP_ROWS - 1);
}

static u8 ui_len(const char *text)
{
    u8 length;

    length = 0;
    while (*text++)
        length++;
    return length;
}

/* `base` picks the face: UI_T_FONT floats over the stage with a drop shadow,
 * UI_T_PLATED carries its own opaque plate and is what the chyron and the
 * overlay panels are built from -- a tilemap cell holds one tile, so text
 * cannot be layered over a separate background tile. The plate has to be part
 * of the glyph. */
static void ui_text_base(u8 x, u8 y, const char *text, u8 pal, u16 base)
{
    u8 c;

    while (*text && x < UI_MAP_COLS)
    {
        c = (u8)*text++;
        if (c < 32 || c > 127)
            c = '?';
        ui_put(x++, y, (u16)(base + c - 32), pal);
    }
}

static void ui_text(u8 x, u8 y, const char *text, u8 pal)
{
    ui_text_base(x, y, text, pal, UI_T_FONT);
}

/* Plated text. Leading and trailing spaces extend the plate, so padding a
 * string is how an overlay panel gets its margins. */
static void ui_ptext(u8 x, u8 y, const char *text, u8 pal)
{
    ui_text_base(x, y, text, pal, UI_T_PLATED);
}

static void ui_text_center(u8 y, const char *text, u8 pal)
{
    ui_text((u8)((UI_MAP_COLS - ui_len(text)) >> 1), y, text, pal);
}

static void ui_ptext_center(u8 y, const char *text, u8 pal)
{
    ui_ptext((u8)((UI_MAP_COLS - ui_len(text)) >> 1), y, text, pal);
}

/* ------------------------------------------------------------------------ */
/* Display type: 16x16, two columns and two rows of tilemap per character.   */
/* ------------------------------------------------------------------------ */

/* Index into BIG_CHARS, " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!" — the order
 * make_hud_tiles.py emits. Anything unknown falls back to a space. */
static u8 ui_big_index(u8 c)
{
    if (c >= 'A' && c <= 'Z')
        return (u8)(c - 'A' + 1);
    if (c >= '0' && c <= '9')
        return (u8)(c - '0' + 27);
    if (c == '!')
        return 37;
    return 0;
}

/* Occupies rows y and y+1. Quadrant order is TL, TR, BL, BR. */
static void ui_big_text(u8 x, u8 y, const char *text, u8 pal)
{
    u16 base;
    u8 c;

    while (*text && x + 1 < UI_MAP_COLS)
    {
        c = (u8)*text++;
        if (c >= 'a' && c <= 'z')
            c = (u8)(c - 32);
        base = (u16)(UI_T_BIG + (u16)ui_big_index(c) * 4);
        ui_put(x, y, base, pal);
        ui_put((u8)(x + 1), y, (u16)(base + 1), pal);
        ui_put(x, (u8)(y + 1), (u16)(base + 2), pal);
        ui_put((u8)(x + 1), (u8)(y + 1), (u16)(base + 3), pal);
        x = (u8)(x + 2);
    }
}

static void ui_big_center(u8 y, const char *text, u8 pal)
{
    ui_big_text((u8)((UI_MAP_COLS - (ui_len(text) << 1)) >> 1), y, text, pal);
}

/* Two plated display digits — the round clock. */
static void ui_big_number_2(u8 x, u8 y, u8 value, u8 pal)
{
    u16 base;
    u8 digit;
    u8 half;

    if (value > 99)
        value = 99;
    for (half = 0; half < 2; half++)
    {
        digit = half ? (u8)(value % 10) : (u8)(value / 10);
        base = (u16)(UI_T_BIGP + (u16)digit * 4);
        ui_put((u8)(x + half * 2), y, base, pal);
        ui_put((u8)(x + half * 2 + 1), y, (u16)(base + 1), pal);
        ui_put((u8)(x + half * 2), (u8)(y + 1), (u16)(base + 2), pal);
        ui_put((u8)(x + half * 2 + 1), (u8)(y + 1), (u16)(base + 3), pal);
    }
}

/* ------------------------------------------------------------------------ */
/* Metered upload                                                            */
/* ------------------------------------------------------------------------ */

/* Send at most `budget` tilemap rows, one row per DMA.
 * Call once per frame, straight after WaitForVBlank().
 *
 * Deliberately dull. An earlier version coalesced runs of adjacent dirty rows
 * into a single larger DMA, using `&ui_map[row * UI_MAP_COLS]` and a computed
 * transfer length. It compiled without a warning and uploaded nothing at all:
 * every screen that looked right was in fact being drawn by ui_flush_forced()
 * at init, and every runtime update — the flashing title prompt, the whole
 * chyron — was silently dropped. tcc-816 is a small compiler and this is the
 * hot path, so it now uses a shift instead of a multiply, a fixed transfer
 * size, and no nested loop. Measured against the coalesced version the cost is
 * five extra DMA setups per frame, which is nothing.
 *
 * ui_scan rotates so that a row can never starve: the HUD dirties rows 0..4
 * most frames, and a fixed scan from row 0 would let a six-row budget spend
 * itself there and never reach a banner. */
static void ui_flush(void)
{
    u8 row;
    u8 sent;
    u16 word;

    sent = 0;
    for (row = 0; row < UI_MAP_ROWS; row++)
    {
        if (sent >= ui_budget)
            return;
        if (ui_dirty_row[row])
        {
            word = (u16)row << 5; /* row * UI_MAP_COLS */
            dmaCopyVram((u8 *)(ui_map + word), (u16)(UI_MAP_VRAM + word),
                        UI_ROW_BYTES);
            ui_dirty_row[row] = 0;
            sent++;
        }
    }
}

/* Whole map in one shot. Only legal under force blank or before setScreenOn(),
 * where there is no VBlank to overrun. */
static void ui_flush_forced(void)
{
    u8 row;

    dmaCopyVram((u8 *)ui_map, UI_MAP_VRAM, UI_MAP_WORDS * 2);
    for (row = 0; row < UI_MAP_ROWS; row++)
        ui_dirty_row[row] = 0;
    ui_scan = 0;
}

static u8 ui_pending(void)
{
    u8 row;

    for (row = 0; row < UI_MAP_ROWS; row++)
        if (ui_dirty_row[row])
            return 1;
    return 0;
}

#endif
