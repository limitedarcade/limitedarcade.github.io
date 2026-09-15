#ifndef BATTLEFI_UI_H
#define BATTLEFI_UI_H

/*
 * Battle for Independance — the broadcast
 *
 * The HUD is an election-night graphics package that has stopped pretending to
 * be impartial. It is not Street Fighter's two floating bars over open sky: it
 * is a chyron — an opaque navy plate bolted across the top of the screen with
 * the candidates' names, their APPROVAL ratings, and a network clock in the
 * middle. Round callouts and result cards are "calls" made by that broadcast.
 *
 * Three rules hold the whole thing together:
 *
 *   1. The fight is never obscured. The plate lives in rows 0..4 and the
 *      fighters stand in rows 16..24. Banners appear at rows 8..15, above
 *      their heads, and only when nobody is throwing a punch.
 *   2. Approval is legible twice over — by length and by colour. The bar is
 *      12 tiles of 8 pixels against 96 HP, so it is exactly one pixel per hit
 *      point, and it runs green -> yellow -> red at 64 and 32.
 *   3. Candidate colours identify sides, never health. Orange is Trump and
 *      teal is Carney wherever they appear, and nothing else uses them.
 *
 * BG0 is the stage, BG2 (pvsneslib bg 1) is this, BG3 stays free. The HUD uses
 * no OBJ sprites at all — the fighters need every one of them. Tile art comes
 * from tools/pipeline/make_hud_tiles.py; colours come from
 * docs/color-bible/rows/ui_hud.json and nowhere else.
 */

#include "ui_core.h"

/* ------------------------------------------------------------------------ */
/* Screen flow                                                               */
/*                                                                           */
/* An arcade fighter is mostly not fighting. The first build cut straight     */
/* from the title to live play and from the last punch to a text line, which  */
/* is why it read as a tech demo: no callout, no KO beat, no result card.     */
/* ------------------------------------------------------------------------ */

#define GS_TITLE 0
#define GS_INTRO 1     /* "ROUND n" then "DEBATE!"                */
#define GS_FIGHT 2
#define GS_PAUSE 3
#define GS_KO 4        /* the finishing blow hangs on screen      */
#define GS_ROUND_END 5
#define GS_MATCH_END 6

/* Frames at 60Hz. */
#define INTRO_ROUND_FRAMES 72 /* "ROUND n" holds for 1.2s  */
#define INTRO_FRAMES 144      /* then "DEBATE!" to 2.4s    */
#define KO_FRAMES 96          /* 1.6s on the knockdown     */
#define RESULT_LOCKOUT 48     /* START is dead for 0.8s so an input meant
                               * for the fight cannot skip the result card */

/* ------------------------------------------------------------------------ */
/* Palettes                                                                  */
/*                                                                           */
/* Seven palettes, one convention. Index 1 is the palette's light colour, 2   */
/* is ink in every single one, 3 is the dark shade, 4 is the flash/chip       */
/* colour and 5..7 are the plate. Because they all agree, one tile renders in */
/* any of these colours and no glyph or bar is ever drawn twice.              */
/* ------------------------------------------------------------------------ */

#define UI_PAL_TEXT 1   /* white body copy, plate chrome        */
#define UI_PAL_TRUMP 2  /* orange, Trump only                   */
#define UI_PAL_CARNEY 3 /* teal, Carney only                    */
#define UI_PAL_GOLD 4   /* clock, round label, callouts         */
#define UI_PAL_GREEN 5  /* approval above two-thirds            */
#define UI_PAL_YELLOW 6 /* approval one- to two-thirds          */
#define UI_PAL_RED 7    /* approval below one-third             */

/* Two shades the colour bible does not carry. Both are the dark half of a
 * gradient whose light half is already in the bible, and both exist only so
 * display type has a bottom half — see the note in make_hud_tiles.py. */
#define UI_C_TEAL_DARK 0x3DE2  /* #157A7A, under name_teal   */
#define UI_C_GREEN_DARK 0x0E24 /* #218C18, under hp_green    */

#define UI_PAL_BODY(light, dark, flash)                                        \
    UI_C_CLEAR, (light), UI_C_INK, (dark),                                     \
    (flash), UI_C_PANEL_DARK, UI_C_PANEL_MID, UI_C_PANEL_LIT,                  \
    UI_C_CLEAR, UI_C_CLEAR, UI_C_CLEAR, UI_C_CLEAR,                            \
    UI_C_CLEAR, UI_C_CLEAR, UI_C_CLEAR, UI_C_CLEAR

static const u16 ui_palettes[7][16] = {
    {UI_PAL_BODY(UI_C_WHITE, UI_C_PANEL_LIT, UI_C_FLASH)},
    {UI_PAL_BODY(UI_C_ORANGE, UI_C_RED, UI_C_FLASH)},
    {UI_PAL_BODY(UI_C_TEAL, UI_C_TEAL_DARK, UI_C_FLASH)},
    {UI_PAL_BODY(UI_C_PIP, UI_C_GOLD, UI_C_WHITE)},
    {UI_PAL_BODY(UI_C_GREEN, UI_C_GREEN_DARK, UI_C_WHITE)},
    {UI_PAL_BODY(UI_C_YELLOW, UI_C_GOLD, UI_C_WHITE)},
    {UI_PAL_BODY(UI_C_RED_LIT, UI_C_RED, UI_C_WHITE)}
};

/* ------------------------------------------------------------------------ */
/* Chyron geometry                                                           */
/* ------------------------------------------------------------------------ */

#define HUD_ROW_CAP 0   /* lit top bevel                        */
#define HUD_ROW_NAME 1  /* names, win pips, round label         */
#define HUD_ROW_BAR 2   /* approval bars + top half of clock    */
#define HUD_ROW_LABEL 3 /* "APPROVAL" + bottom half of clock    */
#define HUD_ROW_FOOT 4  /* inked bottom edge                    */

#define HUD_BAR1_X 1
#define HUD_BAR2_X 19
#define HUD_CLOCK_X 14
#define HUD_PIP1_X 7
#define HUD_PIP2_X 22

#define BANNER_TOP 6
#define BANNER_BOTTOM 17

/* ------------------------------------------------------------------------ */
/* Copy                                                                      */
/* ------------------------------------------------------------------------ */

static const char *const UI_TXT_APPROVAL = "APPROVAL";
static const char *const UI_TXT_TRUMP = "TRUMP";
static const char *const UI_TXT_CARNEY = "CARNEY";
static const char *const UI_TXT_START_TITLE = " PRESS START TO DEBATE ";

#define TITLE_PROMPT_ROW 18

/* ------------------------------------------------------------------------ */
/* Cached state — the HUD redraws only what changed.                         */
/* ------------------------------------------------------------------------ */

static u8 ui_last_hp1, ui_last_hp2;
static u8 ui_last_ghost1, ui_last_ghost2;
static u8 ui_last_wins1, ui_last_wins2;
static u8 ui_last_round, ui_last_clock;
static u8 ui_last_banner;      /* state+phase key; 0xFF forces a redraw   */
static u8 ui_last_flash;
static u8 ui_prompt_row;       /* 0xFF when the banner has no prompt      */
static const char *ui_prompt_text;
static u8 ui_prompt_pal;

/* ------------------------------------------------------------------------ */

static void ui_load_palettes(void)
{
    u8 i;

    for (i = 0; i < 7; i++)
        dmaCopyCGram((u8 *)ui_palettes[i], (u16)((i + 1) * 16), 32);
}

static void ui_forget(void)
{
    ui_last_hp1 = 0xFF;
    ui_last_hp2 = 0xFF;
    ui_last_ghost1 = 0xFF;
    ui_last_ghost2 = 0xFF;
    ui_last_wins1 = 0xFF;
    ui_last_wins2 = 0xFF;
    ui_last_round = 0xFF;
    ui_last_clock = 0xFF;
    ui_last_banner = 0xFF;
    ui_last_flash = 0xFF;
    ui_prompt_row = 0xFF;
}

static void ui_init(void)
{
    u8 row;

    for (row = 0; row < UI_MAP_ROWS; row++)
        ui_dirty_row[row] = 0;
    ui_scan = 0;
    ui_clear_all();

    bgInitTileSet(1, &hud_font_til, &hud_font_pal, UI_PAL_TEXT,
                  UI_TILES_BYTES, 32, BG_16COLORS, UI_TILES_VRAM);
    bgSetMapPtr(1, UI_MAP_VRAM, SC_32x32);
    bgSetScroll(1, 0, 0);
    ui_load_palettes();
    ui_forget();
}

/* ------------------------------------------------------------------------ */
/* Approval bar                                                              */
/* ------------------------------------------------------------------------ */

static u8 ui_bar_palette(s16 hp)
{
    if (hp > 64)
        return UI_PAL_GREEN;
    if (hp > 32)
        return UI_PAL_YELLOW;
    return UI_PAL_RED;
}

/*
 * 12 segments of 8 pixels against 96 HP: one pixel per hit point, so the bar
 * is exact and a punch (8) is precisely one segment.
 *
 * `ghost` is the chip trail — the approval already lost, still shown in flash
 * white behind the live value so an exchange reads as one drain rather than a
 * jump nobody sees. The solid part is pixel-exact; the trail quantises to
 * whole segments, because a tilemap cell cannot show solid, trail and empty
 * at once and the alternative was a boundary tile that over-draws by up to
 * seven pixels. Quantised looks deliberate; over-draw looks like a bug.
 *
 * `mirror` is player 2: the same tiles with the hflip bit, laid right to
 * left, so both bars drain towards the centre of the screen.
 */
static void ui_bar(u8 x, u8 y, s16 hp, s16 ghost, u8 mirror)
{
    u8 i, col, pal;
    u16 tile;
    s16 base, fill, trail;

    if (hp < 0)
        hp = 0;
    if (hp > 96)
        hp = 96;
    if (ghost < hp)
        ghost = hp;
    if (ghost > 96)
        ghost = 96;
    pal = ui_bar_palette(hp);

    for (i = 0; i < UI_BAR_TILES; i++)
    {
        base = (s16)((u16)i * 8);

        fill = (s16)(hp - base);
        if (fill < 0)
            fill = 0;
        if (fill > 8)
            fill = 8;

        trail = (s16)(ghost - base);
        if (trail < 0)
            trail = 0;
        if (trail > 8)
            trail = 8;

        tile = (u16)(((trail >= 8 && fill < 8) ? UI_T_BAR_GHOST : UI_T_BAR) +
                     fill);
        col = mirror ? (u8)(x + (UI_BAR_TILES - 1) - i) : (u8)(x + i);
        ui_put_flip(col, y, tile, pal, mirror);
    }
}

static void ui_pips(u8 x, u8 wins)
{
    u8 i;

    for (i = 0; i < 2; i++)
        ui_put((u8)(x + i), HUD_ROW_NAME,
               (u16)(i < wins ? UI_T_PIP_ON : UI_T_PIP_OFF),
               i < wins ? UI_PAL_GOLD : UI_PAL_TEXT);
}

/* ------------------------------------------------------------------------ */
/* The chyron                                                                */
/* ------------------------------------------------------------------------ */

static void ui_plate_row(u8 y)
{
    ui_span(0, y, UI_MAP_COLS, UI_T_PLATE, UI_PAL_TEXT);
}

static void ui_begin_match(void)
{
    ui_clear_all();
    ui_forget();
}

/* Rows 0..4. Redraws only when a displayed value actually changed — during a
 * quiet second that is nothing at all, and on a clock tick it is five rows
 * (320 bytes), which fits the 6-row fight budget with room to spare. */
static void ui_hud(s16 hp1, s16 hp2, s16 ghost1, s16 ghost2, u8 wins1,
                   u8 wins2, u8 round_number, u8 clock)
{
    u8 h1, h2, g1, g2;
    u8 changed;
    char round_text[8];

    h1 = (u8)(hp1 < 0 ? 0 : hp1);
    h2 = (u8)(hp2 < 0 ? 0 : hp2);
    g1 = (u8)(ghost1 < 0 ? 0 : ghost1);
    g2 = (u8)(ghost2 < 0 ? 0 : ghost2);

    /* Spelled out one comparison at a time on purpose. As a single eight-term
     * && chain this returned early on the very first call, so the chyron was
     * never drawn once — tcc-816 does not reliably compile a boolean chain
     * that long. Do not "simplify" this back into one condition. */
    changed = 0;
    if (h1 != ui_last_hp1)
        changed = 1;
    if (h2 != ui_last_hp2)
        changed = 1;
    if (g1 != ui_last_ghost1)
        changed = 1;
    if (g2 != ui_last_ghost2)
        changed = 1;
    if (wins1 != ui_last_wins1)
        changed = 1;
    if (wins2 != ui_last_wins2)
        changed = 1;
    if (round_number != ui_last_round)
        changed = 1;
    if (clock != ui_last_clock)
        changed = 1;
    if (!changed)
        return;

    ui_span(0, HUD_ROW_CAP, UI_MAP_COLS, UI_T_PLATE_TOP, UI_PAL_TEXT);
    ui_plate_row(HUD_ROW_NAME);
    ui_plate_row(HUD_ROW_BAR);
    ui_plate_row(HUD_ROW_LABEL);
    ui_span(0, HUD_ROW_FOOT, UI_MAP_COLS, UI_T_PLATE_BOT, UI_PAL_TEXT);

    ui_ptext(1, HUD_ROW_NAME, UI_TXT_TRUMP, UI_PAL_TRUMP);
    ui_ptext(25, HUD_ROW_NAME, UI_TXT_CARNEY, UI_PAL_CARNEY);
    ui_pips(HUD_PIP1_X, wins1);
    ui_pips(HUD_PIP2_X, wins2);

    round_text[0] = 'R';
    round_text[1] = 'O';
    round_text[2] = 'U';
    round_text[3] = 'N';
    round_text[4] = 'D';
    round_text[5] = ' ';
    round_text[6] = (char)('0' + (round_number > 9 ? 9 : round_number));
    round_text[7] = 0;
    ui_ptext(12, HUD_ROW_NAME, round_text, UI_PAL_GOLD);

    ui_bar(HUD_BAR1_X, HUD_ROW_BAR, hp1, ghost1, 0);
    ui_bar(HUD_BAR2_X, HUD_ROW_BAR, hp2, ghost2, 1);

    ui_ptext(1, HUD_ROW_LABEL, UI_TXT_APPROVAL, UI_PAL_TEXT);
    ui_ptext(23, HUD_ROW_LABEL, UI_TXT_APPROVAL, UI_PAL_TEXT);

    /* The clock goes red under ten seconds — the only place red means time
     * rather than approval, and it is unambiguous because it is the only
     * thing in the middle of the plate. */
    ui_big_number_2(HUD_CLOCK_X, HUD_ROW_BAR, clock,
                    clock <= 10 ? UI_PAL_RED : UI_PAL_GOLD);

    ui_last_hp1 = h1;
    ui_last_hp2 = h2;
    ui_last_ghost1 = g1;
    ui_last_ghost2 = g2;
    ui_last_wins1 = wins1;
    ui_last_wins2 = wins2;
    ui_last_round = round_number;
    ui_last_clock = clock;
}

/* ------------------------------------------------------------------------ */
/* Title                                                                     */
/* ------------------------------------------------------------------------ */

static void ui_show_title(void)
{
    ui_clear_all();
    ui_forget();

    /* "Independance" is misspelled on purpose and stays that way. */
    ui_big_center(5, "BATTLE FOR", UI_PAL_GOLD);
    ui_big_center(8, "INDEPENDANCE", UI_PAL_TEXT);

    ui_ptext_center(11, " THE GREAT LAKE DEBATE ", UI_PAL_CARNEY);

    ui_ptext(4, 14, " TRUMP ", UI_PAL_TRUMP);
    ui_ptext_center(14, " VS ", UI_PAL_GOLD);
    ui_ptext(19, 14, " MARK CARNEY ", UI_PAL_CARNEY);

    ui_ptext_center(21, " Y/B PUNCH   A/X KICK ", UI_PAL_TEXT);
    ui_ptext_center(22, " D-PAD MOVE  START PAUSE ", UI_PAL_TEXT);

    /* Drawn here rather than left to the first ui_title_tick(), so the prompt
     * is on screen in the same frame as the rest of the title. */
    ui_ptext_center(TITLE_PROMPT_ROW, UI_TXT_START_TITLE, UI_PAL_TEXT);
    ui_last_flash = 0;
}

/* The prompt is the only thing that moves on the title screen: one plated row
 * repainted in a different palette every 32 frames. 64 bytes. */
static void ui_title_tick(u16 tick)
{
    u8 flash;

    flash = (u8)((tick >> 5) & 1);
    if (flash == ui_last_flash)
        return;
    ui_ptext_center(TITLE_PROMPT_ROW, UI_TXT_START_TITLE,
                    flash ? UI_PAL_GOLD : UI_PAL_TEXT);
    ui_last_flash = flash;
}

/* ------------------------------------------------------------------------ */
/* Banners                                                                   */
/* ------------------------------------------------------------------------ */

static void ui_banner_clear(void)
{
    ui_clear_rows(BANNER_TOP, BANNER_BOTTOM);
}

/*
 * One centred callout per state. Redrawn only when the state or its phase
 * changes; the flashing "press START" line is repainted on its own so a flash
 * costs one row instead of twelve.
 *
 * Display type is transparent and outlined, so it reads over the ice, the sky
 * or a fighter's head without a plate behind it. The smaller lines use plated
 * glyphs, which carry their own strip — that is what the leading and trailing
 * spaces in the strings below are for.
 */
static void ui_banner(u8 state, u16 state_tick, u8 round_number, u8 winner)
{
    u8 key;
    u8 flash;
    char round_text[8];

    key = state;
    if (state == GS_INTRO)
        key = (u8)(GS_INTRO + (state_tick >= INTRO_ROUND_FRAMES ? 32 : 0));

    if (key != ui_last_banner)
    {
        ui_banner_clear();
        ui_prompt_row = 0xFF;
        ui_last_flash = 0xFF;

        switch (state)
        {
        case GS_INTRO:
            if (state_tick < INTRO_ROUND_FRAMES)
            {
                round_text[0] = 'R';
                round_text[1] = 'O';
                round_text[2] = 'U';
                round_text[3] = 'N';
                round_text[4] = 'D';
                round_text[5] = ' ';
                round_text[6] =
                    (char)('0' + (round_number > 9 ? 9 : round_number));
                round_text[7] = 0;
                ui_big_center(10, round_text, UI_PAL_GOLD);
            }
            else
            {
                ui_big_center(10, "DEBATE!", UI_PAL_GOLD);
            }
            break;

        case GS_PAUSE:
            ui_plate_row(9);
            ui_plate_row(10);
            ui_plate_row(11);
            ui_plate_row(12);
            ui_plate_row(13);
            ui_ptext_center(10, " RECOUNT IN PROGRESS ", UI_PAL_GOLD);
            ui_ptext_center(12, " PRESS START TO RESUME ", UI_PAL_TEXT);
            break;

        case GS_KO:
            ui_big_center(10, "CONCEDED", UI_PAL_RED);
            break;

        case GS_ROUND_END:
            if (winner == 1)
            {
                ui_big_center(9, "TRUMP", UI_PAL_TRUMP);
                ui_ptext_center(12, " TAKES THE ROUND ", UI_PAL_TRUMP);
            }
            else if (winner == 2)
            {
                ui_big_center(9, "CARNEY", UI_PAL_CARNEY);
                ui_ptext_center(12, " TAKES THE ROUND ", UI_PAL_CARNEY);
            }
            else
            {
                ui_big_center(9, "NO CALL", UI_PAL_TEXT);
                ui_ptext_center(12, " TOO CLOSE TO CALL ", UI_PAL_TEXT);
            }
            ui_prompt_row = 15;
            ui_prompt_text = " START: NEXT ROUND ";
            ui_prompt_pal = UI_PAL_GOLD;
            break;

        case GS_MATCH_END:
            ui_ptext_center(7, " MANDATE SECURED ", UI_PAL_GOLD);
            if (winner == 1)
            {
                ui_big_center(9, "TRUMP", UI_PAL_TRUMP);
                ui_ptext_center(12, " WINS THE MANDATE ", UI_PAL_TRUMP);
            }
            else
            {
                ui_big_center(9, "CARNEY", UI_PAL_CARNEY);
                ui_ptext_center(12, " WINS THE MANDATE ", UI_PAL_CARNEY);
            }
            ui_prompt_row = 15;
            ui_prompt_text = " START: NEW CAMPAIGN ";
            ui_prompt_pal = UI_PAL_GOLD;
            break;

        default:
            break;
        }
        ui_last_banner = key;
    }

    if (ui_prompt_row == 0xFF || state_tick < RESULT_LOCKOUT)
        return;

    flash = (u8)((state_tick >> 4) & 1);
    if (flash == ui_last_flash)
        return;
    ui_ptext_center(ui_prompt_row, ui_prompt_text,
                    flash ? ui_prompt_pal : UI_PAL_TEXT);
    ui_last_flash = flash;
}

#endif
