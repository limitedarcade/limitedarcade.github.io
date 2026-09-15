/* Battle for Independance — TRUMP vs MARK CARNEY
 *
 * ---------------------------------------------------------------------------
 * Sprite box
 * ---------------------------------------------------------------------------
 * The sprite box is 128x64: eight 32x32 blocks, 4096 bytes, and gfx4snes -s 32
 * pads it to nothing. It is WIDER than the fighter is tall on purpose. A square
 * box clips limbs — measured across 84 frames, a thrown fist reaches 0.54 body
 * heights left of the planted feet, so a 64x64 box cuts the punch off at the
 * wrist and the kick at the shin. docs/sprite-geometry.md has the numbers.
 *
 * 4096 bytes x 4 slots is 16 KB, i.e. exactly all of OBJ VRAM. That is the
 * whole budget and it is why the box is not taller: 128x96 costs 6144 and
 * leaves room for two slots, which is one buffer per fighter and no room to
 * upload the next frame behind the one on screen.
 *
 * ---------------------------------------------------------------------------
 * Layer order
 * ---------------------------------------------------------------------------
 * Mode 1 resolves layers, highest first, as
 *
 *     OBJ3, BG1.hi, BG2.hi, OBJ2, BG1.lo, BG2.lo, OBJ1, BG3, OBJ0
 *
 * The fighters are drawn at OBJ priority 2 and the HUD is BG2 with the tile
 * priority bit set, which puts every banner above the fighters. That is the
 * point: at OBJ3 — where they used to be — a KO banner drew *behind* the two
 * men standing in the middle of the screen and was unreadable.
 *
 * This is only safe because the stage is BG1 with its priority bits clear:
 * res/lake.map is 2048 bytes of attribute bytes 0x00/0x01, palette 0, no 0x20
 * anywhere. If the stage ever gains priority tiles they will cover the
 * fighters, because BG1.hi outranks OBJ2.
 */
#include <snes.h>

#include "anim_frames.h"
#include "ui.h"

#define LAKE_TILE_BYTES 12448
#define LAKE_MAP_BYTES 2048
#define LAKE_PAL_BYTES 32

extern char lake_til, lake_map, lake_pal;

#define ST_IDLE 0
#define ST_PUNCH 1
#define ST_KICK 2
#define ST_HIT 3

/* Hold each 24fps source frame for 3 console frames (~60Hz). */
#define FRAME_HOLD 3

/* Four VRAM slots × 4096 bytes = 16 KB = all of OBJ VRAM. Addresses are in
 * WORDS, so a slot is 0x800 apart; tile numbers step by 128 (4096 / 32). */
#define V_SLOT0 0x0000
#define V_SLOT1 0x0800
#define V_SLOT2 0x1000
#define V_SLOT3 0x1800
#define T_SLOT0 0
#define T_SLOT1 128
#define T_SLOT2 256
#define T_SLOT3 384

/* The fighter's feet sit at the centre of the 128-wide box. */
#define BOX_W 128
#define BOX_HALF 64

/* Active attack windows in source-frame indices (fist/leg extended). */
#define HIT_ACTIVE_LO 8
#define HIT_ACTIVE_HI 14

#define HITSTOP_NORMAL 4
#define HITSTOP_KO 8
#define KB_PUNCH 8
#define KB_KICK 12
#define KB_KO 18

#define DMG_PUNCH 8
#define DMG_KICK 12
#define HP_MAX 96

/* Rounds needed to take the match. */
#define MATCH_WINS 2

/* Reach of an active attack, and how close the CPU walks before swinging.
 * These two numbers have to agree: the first build approached to 48 and
 * struck at 36, so the CPU stopped just outside its own range and threw
 * punches at the air forever. */
#define ATTACK_REACH 36
#define CPU_APPROACH 30

/* Fighters are solid. Without this they walk through each other and the
 * hit test fires from inside the opponent's chest. */
#define BODY_SEPARATION 28

/* Feet stay on screen with a body's width of margin either side. */
#define X_MIN 40
#define X_MAX 216

/* Approval bar chip trail: how long the ghost sits before it drains, and how
 * fast it catches up once it starts. */
#define GHOST_HOLD 24
#define GHOST_RATE 1

static s16 x1, x2, hp1, hp2;
static u8 st1, st2, face1, face2, wins1, wins2;
static u16 pad;
static u8 tick;
static u16 prev_pad;
static u8 round_clock, clock_tick, round_number;
static u8 round_winner;

/* Per-fighter animation / VRAM-slot state */
static u8 anim1, hold1, slot1; /* slot1: 0 or 1 within trump's pair */
static u8 anim2, hold2, slot2;
static u8 force1, force2; /* upload immediately on next fighter VBlank */

/* One connect per swing; freeze both fighters briefly on impact. */
static u8 hit_landed1, hit_landed2;
static u8 hitstop;

/* Hit feedback: stage shake on every connect; backdrop strobe on KO only. */
static u8 shake_t;
static u8 ko_flash_t;
static u16 fx_white;

/* Delayed "ghost" approval, in HP. Trails the real bar so the player can see
 * how much the last exchange cost. */
static s16 ghost1, ghost2;
static u8 ghost_wait1, ghost_wait2;

static const u16 slot_vram[4] = {V_SLOT0, V_SLOT1, V_SLOT2, V_SLOT3};
static const u16 slot_tile[4] = {T_SLOT0, T_SLOT1, T_SLOT2, T_SLOT3};

/* ------------------------------------------------------------------------ */
/* Game states                                                               */
/* ------------------------------------------------------------------------ */

static u8 game_state;
static u16 state_tick; /* frames spent in the current state */

static void enter_state(u8 next)
{
    game_state = next;
    state_tick = 0;
}

/* ------------------------------------------------------------------------ */

static void fx_hit(u8 ko)
{
    shake_t = ko ? 18 : 10;
    if (ko)
        ko_flash_t = 14;
}

static void fx_reset(void)
{
    shake_t = 0;
    ko_flash_t = 0;
    bgSetScroll(0, 0, 0);
    dmaCopyCGram((u8 *)&lake_pal, 0, 2);
}

/* Call once per VBlank while the stage is up. The HUD (BG2) never scrolls. */
static void fx_vblank(void)
{
    s16 sx = 0;
    s16 sy = 0;
    u8 amp;

    if (shake_t)
    {
        amp = (shake_t > 12) ? 4 : ((shake_t > 6) ? 2 : 1);
        sx = (shake_t & 1) ? (s16)amp : (s16)(-amp);
        sy = (shake_t & 2) ? (s16)(amp >> 1) : (s16)(-(amp >> 1));
        shake_t--;
    }
    bgSetScroll(0, (u16)sx, (u16)sy);

    if (ko_flash_t)
    {
        /* Two white pulses on color 0 (stage backdrop), then restore. */
        if (ko_flash_t > 7 || (ko_flash_t <= 5 && ko_flash_t > 2))
            dmaCopyCGram((u8 *)&fx_white, 0, 2);
        else
            dmaCopyCGram((u8 *)&lake_pal, 0, 2);
        ko_flash_t--;
        if (!ko_flash_t)
            dmaCopyCGram((u8 *)&lake_pal, 0, 2);
    }
}

/* DMA one ROM frame (any bank) into OBJ VRAM. Call only during VBlank. */
static void dma_far_to_vram(u8 bank, u16 addr, u16 vram_word, u16 nbytes)
{
    REG_VMAIN = 0x80;
    REG_VMADDLH = vram_word;
    REG_DMAP0 = 0x01;
    REG_BBAD0 = 0x18;
    REG_A1T0LH = addr;
    REG_A1B0 = bank;
    REG_DAS0LH = nbytes;
    REG_MDMAEN = 0x01;
}

static void upload_frame(u8 fighter, u8 clip, u8 frame, u8 which_slot)
{
    u8 bank;
    u16 addr;
    u8 slot = (u8)(fighter * 2 + (which_slot & 1));

    /* Index the extern tables directly so the compiler emits the correct
     * LoROM bank for each symbol (do not go through a pointer table). */
    if (fighter == 0)
    {
        if (clip == ST_PUNCH)
        {
            bank = trump_punch_banks[frame];
            addr = trump_punch_addrs[frame];
        }
        else if (clip == ST_KICK)
        {
            bank = trump_kick_banks[frame];
            addr = trump_kick_addrs[frame];
        }
        else if (clip == ST_HIT)
        {
            bank = trump_hit_banks[frame];
            addr = trump_hit_addrs[frame];
        }
        else
        {
            bank = trump_idle_banks[frame];
            addr = trump_idle_addrs[frame];
        }
    }
    else
    {
        if (clip == ST_PUNCH)
        {
            bank = carney_punch_banks[frame];
            addr = carney_punch_addrs[frame];
        }
        else if (clip == ST_KICK)
        {
            bank = carney_kick_banks[frame];
            addr = carney_kick_addrs[frame];
        }
        else if (clip == ST_HIT)
        {
            bank = carney_hit_banks[frame];
            addr = carney_hit_addrs[frame];
        }
        else
        {
            bank = carney_idle_banks[frame];
            addr = carney_idle_addrs[frame];
        }
    }

    dma_far_to_vram(bank, addr, slot_vram[slot], FRAME_BYTES);
}

static void reset_anim(u8 fighter)
{
    if (fighter == 0)
    {
        st1 = ST_IDLE;
        anim1 = 0;
        hold1 = 0;
        slot1 = 0;
        force1 = 1;
    }
    else
    {
        st2 = ST_IDLE;
        anim2 = 0;
        hold2 = 0;
        slot2 = 0;
        force2 = 1;
    }
}

static void start_anim(u8 fighter, u8 state)
{
    if (fighter == 0)
    {
        st1 = state;
        anim1 = 0;
        hold1 = 0;
        force1 = 1;
        if (state == ST_PUNCH || state == ST_KICK)
            hit_landed1 = 0;
    }
    else
    {
        st2 = state;
        anim2 = 0;
        hold2 = 0;
        force2 = 1;
        if (state == ST_PUNCH || state == ST_KICK)
            hit_landed2 = 0;
    }
}

static void reset_round(void)
{
    /* x is the fighter's feet, not the sprite's left edge. */
    x1 = 80;
    x2 = 192;
    hp1 = HP_MAX;
    hp2 = HP_MAX;
    ghost1 = HP_MAX;
    ghost2 = HP_MAX;
    ghost_wait1 = 0;
    ghost_wait2 = 0;
    face1 = 0; /* trump starts on the left, facing right */
    face2 = 1; /* carney starts on the right, facing left */
    round_clock = 99;
    clock_tick = 0;
    round_winner = 0;
    hit_landed1 = 0;
    hit_landed2 = 0;
    hitstop = 0;
    fx_reset();
    reset_anim(0);
    reset_anim(1);
}

static u8 attack_active(u8 st, u8 frame)
{
    if (st != ST_PUNCH && st != ST_KICK)
        return 0;
    return (frame >= HIT_ACTIVE_LO && frame <= HIT_ACTIVE_HI) ? 1 : 0;
}

static s16 gap(void)
{
    s16 d = (s16)(x1 - x2);

    return d < 0 ? (s16)(-d) : d;
}

static void clamp_fighters(void)
{
    if (x1 < X_MIN)
        x1 = X_MIN;
    if (x1 > X_MAX)
        x1 = X_MAX;
    if (x2 < X_MIN)
        x2 = X_MIN;
    if (x2 > X_MAX)
        x2 = X_MAX;
}

/* Bodies are solid: split any overlap evenly, then re-clamp. Done after the
 * clamp so a fighter cornered against X_MIN pushes the other one out rather
 * than sinking into him. */
static void separate_fighters(void)
{
    s16 overlap;

    overlap = (s16)(BODY_SEPARATION - gap());
    if (overlap <= 0)
        return;

    overlap = (s16)((overlap + 1) >> 1);
    if (x1 <= x2)
    {
        x1 -= overlap;
        x2 += overlap;
    }
    else
    {
        x1 += overlap;
        x2 -= overlap;
    }
    clamp_fighters();
}

/* attacker 0 = trump, 1 = carney. Applies damage, knockback, hitstop, FX.
 * Returns 1 if the hit was a KO. */
static u8 land_hit(u8 attacker, u8 is_kick)
{
    s16 kb;
    u8 face;
    u8 ko = 0;

    if (attacker == 0)
    {
        hit_landed1 = 1;
        hp2 -= is_kick ? DMG_KICK : DMG_PUNCH;
        ghost_wait2 = GHOST_HOLD;
        if (hp2 <= 0)
        {
            hp2 = 0;
            ko = 1;
            round_winner = 1;
            wins1++;
        }
        face = face1;
        kb = ko ? KB_KO : (is_kick ? KB_KICK : KB_PUNCH);
        if (face == 0)
            x2 += kb;
        else
            x2 -= kb;
        face2 = face ? 0 : 1;
        start_anim(1, ST_HIT);
    }
    else
    {
        hit_landed2 = 1;
        hp1 -= is_kick ? DMG_KICK : DMG_PUNCH;
        ghost_wait1 = GHOST_HOLD;
        if (hp1 <= 0)
        {
            hp1 = 0;
            ko = 1;
            round_winner = 2;
            wins2++;
        }
        face = face2;
        kb = ko ? KB_KO : (is_kick ? KB_KICK : KB_PUNCH);
        if (face == 0)
            x1 += kb;
        else
            x1 -= kb;
        face1 = face ? 0 : 1;
        start_anim(0, ST_HIT);
    }

    clamp_fighters();
    hitstop = ko ? HITSTOP_KO : HITSTOP_NORMAL;
    fx_hit(ko);
    return ko;
}

/* Chip trail. The ghost waits GHOST_HOLD frames after the last hit, then
 * slides down to the real value — so a big exchange reads as one long drain
 * instead of an instant jump nobody sees. */
static void ghost_tick(void)
{
    if (ghost_wait1)
        ghost_wait1--;
    else if (ghost1 > hp1)
    {
        ghost1 -= GHOST_RATE;
        if (ghost1 < hp1)
            ghost1 = hp1;
    }

    if (ghost_wait2)
        ghost_wait2--;
    else if (ghost2 > hp2)
    {
        ghost2 -= GHOST_RATE;
        if (ghost2 < hp2)
            ghost2 = hp2;
    }
}

/*
 * Advance one fighter by one source frame (or finish an attack → idle).
 * DMA into the back slot, then flip.  Idle wraps 20 → 0 with no special case.
 */
static void anim_advance(u8 fighter)
{
    u8 st, frame, which, back;

    if (fighter == 0)
    {
        st = st1;
        frame = anim1;
        which = slot1;
    }
    else
    {
        st = st2;
        frame = anim2;
        which = slot2;
    }

    frame++;
    if (frame >= ANIM_NFRAMES)
    {
        /* Attacks and hit reactions return to idle; idle just wraps. */
        st = ST_IDLE;
        frame = 0;
    }

    back = which ^ 1;
    upload_frame(fighter, st, frame, back);

    if (fighter == 0)
    {
        st1 = st;
        anim1 = frame;
        slot1 = back;
        hold1 = 0;
        force1 = 0;
    }
    else
    {
        st2 = st;
        anim2 = frame;
        slot2 = back;
        hold2 = 0;
        force2 = 0;
    }
}

/* Hold both fighters every console frame. DMA at most one 4096-byte upload
 * per VBlank: if both are due, the other stays ready and goes next blank.
 * 4096 bytes is ~63% of the ~6.5 KB a 224-line NTSC VBlank can move, so one
 * fighter per blank is the budget, not a preference.
 *
 * Returns 1 if a frame was uploaded, so the caller knows how much of the
 * remaining VBlank the HUD may spend.
 *
 * (The old phase%3 path only incremented hold every 3rd blank, so FRAME_HOLD
 * 3 became a 9-frame hold — ~7fps, which read as slow motion.) */
static u8 anim_vblank(void)
{
    if (force1)
    {
        upload_frame(0, st1, anim1, slot1 ^ 1);
        slot1 ^= 1;
        force1 = 0;
        hold1 = 0;
        return 1;
    }
    if (force2)
    {
        upload_frame(1, st2, anim2, slot2 ^ 1);
        slot2 ^= 1;
        force2 = 0;
        hold2 = 0;
        return 1;
    }

    hold1++;
    hold2++;

    /* hold1 is tested first, so the two fighters settle one frame apart and
     * each still advances every FRAME_HOLD frames — neither starves. */
    if (hold1 >= FRAME_HOLD)
    {
        anim_advance(0);
        return 1;
    }
    if (hold2 >= FRAME_HOLD)
    {
        anim_advance(1);
        return 1;
    }
    return 0;
}

/* A fighter is 128x64 of art drawn as EIGHT 32x32 sprites, not one big OBJ.
 *
 * gfx4snes -s 32 packs 32x32 blocks in reading order into the 16-tile-wide OBJ
 * name table, four blocks to a band. Measured by encoding one solid palette
 * index per block and decoding the .pic, a 128x64 frame lands at tile offsets
 *
 *     +0  +4  +8  +12      <- top row,    y
 *     +64 +68 +72 +76      <- bottom row, y + 32
 *
 * and occupies 4096 bytes with nothing wasted. Drawing a single OBJ_SMALL at
 * the frame base shows the top-left block only, i.e. a floating head.
 *
 * Flipped, the whole 128-wide sprite mirrors about its centre, so block column
 * c is drawn where column 3-c would be AND each block carries its own hflip.
 *
 * `cx` is the fighter's feet, at the centre of the box. The box therefore hangs
 * 64px either side and its outer columns run off screen at the edges of the
 * arena; a block whose x leaves 0..255 is hidden rather than drawn, because OAM
 * x is 9-bit and those columns are transparent margin in all but the widest
 * poses. Hiding costs nothing and avoids a wrapped sprite at the far side.
 *
 * This is the only place that touches sprite geometry.
 */
static const u16 block_tile[8] = {0, 4, 8, 12, 64, 68, 72, 76};

static void draw_fighter(u16 id, s16 cx, s16 y, u16 tile, u8 pal, u8 flip)
{
    s16 left = (s16)(cx - BOX_HALF);
    u8 b, col, row;
    s16 bx, by;

    for (b = 0; b < 8; b++)
    {
        col = (u8)(b & 3);
        row = (u8)(b >> 2);
        bx = (s16)(left + 32 * (flip ? (3 - col) : col));
        by = (s16)(y + 32 * row);
        if (bx < 0 || bx > 255)
        {
            oamSetEx((u16)(id + b * 4), OBJ_SMALL, OBJ_HIDE);
            continue;
        }
        /* Priority 2, not 3: see the layer-order note at the top of the file. */
        oamSet((u16)(id + b * 4), (u16)bx, (u16)by, 2, flip, 0,
               (u16)(tile + block_tile[b]), pal);
        oamSetEx((u16)(id + b * 4), OBJ_SMALL, OBJ_SHOW);
    }
}

/* ------------------------------------------------------------------------ */
/* Per-state logic                                                           */
/* ------------------------------------------------------------------------ */

static u8 pressed(u16 key)
{
    return (u8)((pad & key) && !(prev_pad & key));
}

/* Trump, on pad 0. */
static void player_update(void)
{
    if (st1 != ST_HIT)
    {
        if (pad & KEY_LEFT)
            x1 -= 2;
        if (pad & KEY_RIGHT)
            x1 += 2;
        /* Facing is locked for the length of a swing. Turning mid-punch used
         * to flip the hit test and let a fist connect behind the fighter. */
        if (st1 == ST_IDLE)
        {
            if (pad & KEY_LEFT)
                face1 = 1;
            if (pad & KEY_RIGHT)
                face1 = 0;
        }
    }

    if (st1 == ST_IDLE)
    {
        if (pad & (KEY_Y | KEY_B))
            start_anim(0, ST_PUNCH);
        else if (pad & (KEY_A | KEY_X))
            start_anim(0, ST_KICK);
    }
}

/* Carney, on the CPU. Walks to CPU_APPROACH — inside ATTACK_REACH — then
 * throws. The cadence is deliberately loose so he does not read as a
 * metronome, but he is not meant to be hard. */
static void cpu_update(void)
{
    s16 dist;
    u8 beat;

    dist = gap();

    if (st2 != ST_HIT)
    {
        if (dist > CPU_APPROACH)
        {
            if (x2 < x1)
            {
                x2 += 2;
                face2 = 0;
            }
            else
            {
                x2 -= 2;
                face2 = 1;
            }
        }
        else if (st2 == ST_IDLE)
        {
            face2 = (x2 < x1) ? 0 : 1;
        }
    }

    if (st2 == ST_IDLE && dist <= ATTACK_REACH)
    {
        /* Vary the cadence with the round clock so repeated rounds do not
         * play back identically. */
        beat = (u8)((tick + round_clock) & 63);
        if (beat == 5 || beat == 37)
            start_anim(1, ST_PUNCH);
        else if (beat == 21)
            start_anim(1, ST_KICK);
    }
}

/* Returns 1 on a KO. */
static u8 resolve_hits(void)
{
    if (!hit_landed1 && attack_active(st1, anim1) && st2 != ST_HIT &&
        ((face1 == 0 && x2 >= x1) || (face1 == 1 && x2 <= x1)) &&
        gap() < ATTACK_REACH)
    {
        if (land_hit(0, (u8)(st1 == ST_KICK)))
            return 1;
    }

    if (!hit_landed2 && attack_active(st2, anim2) && st1 != ST_HIT &&
        ((face2 == 0 && x1 >= x2) || (face2 == 1 && x1 <= x2)) &&
        gap() < ATTACK_REACH)
    {
        if (land_hit(1, (u8)(st2 == ST_KICK)))
            return 1;
    }
    return 0;
}

/* Timer expiry judges on approval, exactly as an election night would.
 * Returns 1 when the round has ended on time. */
static u8 clock_update(void)
{
    clock_tick++;
    if (clock_tick < 60)
        return 0;

    clock_tick = 0;
    if (round_clock)
        round_clock--;
    if (round_clock)
        return 0;

    if (hp1 > hp2)
    {
        round_winner = 1;
        wins1++;
    }
    else if (hp2 > hp1)
    {
        round_winner = 2;
        wins2++;
    }
    else
    {
        round_winner = 0;
    }
    return 1;
}

static u8 match_over(void)
{
    return (u8)(wins1 >= MATCH_WINS || wins2 >= MATCH_WINS);
}

static void start_round(void)
{
    reset_round();
    ui_begin_match();
    enter_state(GS_INTRO);
}

static void start_match(void)
{
    wins1 = 0;
    wins2 = 0;
    round_number = 1;
    start_round();
}

int main(void)
{
    u8 streamed;
    u8 show_stage;

    prev_pad = 0;
    tick = 0;
    fx_white = 0x7FFF;
    wins1 = 0;
    wins2 = 0;
    round_number = 1;
    reset_round();

    bgInitTileSet(0, &lake_til, &lake_pal, 0, LAKE_TILE_BYTES, LAKE_PAL_BYTES,
                  BG_16COLORS, 0x2000);
    bgInitMapSet(0, &lake_map, LAKE_MAP_BYTES, SC_32x32, 0x6800);

    /* OBJ tiles at VRAM 0; small=32x32 (four blocks make a fighter). */
    oamInitGfxAttr(V_SLOT0, OBJ_SIZE32_L64);
    upload_frame(0, ST_IDLE, 0, 0);
    upload_frame(0, ST_IDLE, 0, 1);
    upload_frame(1, ST_IDLE, 0, 0);
    upload_frame(1, ST_IDLE, 0, 1);
    dmaCopyCGram(&trump_fighter_pal, 128, 32);
    dmaCopyCGram(&carney_fighter_pal, 144, 32);
    slot1 = 0;
    slot2 = 0;
    force1 = 0;
    force2 = 0;

    ui_init();
    ui_show_title();
    ui_flush_forced();
    enter_state(GS_TITLE);

    setMode(BG_MODE1, 0);
    bgSetEnable(1);
    bgSetDisable(2);
    bgSetScroll(0, 0, 0);
    setScreenOn();

    while (1)
    {
        pad = padsCurrent(0);
        show_stage = (u8)(game_state != GS_TITLE);

        switch (game_state)
        {
        case GS_TITLE:
            ui_title_tick(state_tick);
            if (pressed(KEY_START))
                start_match();
            break;

        case GS_INTRO:
            /* Nobody moves during the callout; the fighters idle in place. */
            if (state_tick >= INTRO_FRAMES)
                enter_state(GS_FIGHT);
            break;

        case GS_FIGHT:
            if (pressed(KEY_START))
            {
                enter_state(GS_PAUSE);
                break;
            }
            if (!hitstop)
            {
                player_update();
                cpu_update();
                clamp_fighters();
                separate_fighters();
                if (resolve_hits())
                {
                    enter_state(GS_KO);
                    break;
                }
                if (clock_update())
                    enter_state(GS_ROUND_END);
            }
            break;

        case GS_PAUSE:
            /* ui_banner() keys off the state, so leaving the pause state is
             * what clears the panel — there is nothing extra to undo. */
            if (pressed(KEY_START))
                enter_state(GS_FIGHT);
            break;

        case GS_KO:
            /* Let the knockback and the hit clip play out under the banner. */
            if (state_tick >= KO_FRAMES)
                enter_state(GS_ROUND_END);
            break;

        case GS_ROUND_END:
            if (match_over())
            {
                enter_state(GS_MATCH_END);
                break;
            }
            if (state_tick >= RESULT_LOCKOUT && pressed(KEY_START))
            {
                round_number++;
                start_round();
            }
            break;

        case GS_MATCH_END:
            if (state_tick >= RESULT_LOCKOUT && pressed(KEY_START))
            {
                ui_show_title();
                enter_state(GS_TITLE);
            }
            break;
        }

        if (show_stage)
        {
            ghost_tick();
            ui_hud(hp1, hp2, ghost1, ghost2, wins1, wins2, round_number,
                   round_clock);
            ui_banner(game_state, state_tick, round_number, round_winner);

            /* y 128 puts the feet on the ground line at 192. Eight sprites
             * each now, so fighter 2 starts at OAM entry 8 (byte 32). */
            draw_fighter(0, x1, 128, slot_tile[slot1], 0, face1);
            draw_fighter(32, x2, 128, slot_tile[2 + slot2], 1, face2);
        }
        else
        {
            oamClear(0, 0);
        }

        prev_pad = pad;
        WaitForVBlank();

        streamed = 0;
        if (show_stage)
        {
            /* Poses freeze during hitstop and pause; shake/flash still run. */
            if (game_state != GS_PAUSE && !hitstop)
                streamed = anim_vblank();
            fx_vblank();
            if (hitstop)
                hitstop--;
        }

        /* The HUD gets whatever of the VBlank the fighter stream did not
         * take. See the budget note at the top of ui_core.h.
         *
         * Written as if/else, not `streamed ? A : B`. As a ternary this
         * handed ui_flush() a budget of 0 and the HUD never updated at all —
         * the title screen stayed on screen under the fight. Every screen
         * that looked correct was being drawn by ui_flush_forced() at boot. */
        ui_budget = UI_BUDGET_IDLE;
        if (streamed)
            ui_budget = UI_BUDGET_FIGHT;
        ui_flush();

        tick++;
        state_tick++;
    }
    return 0;
}
