ifeq ($(strip $(PVSNESLIB_HOME)),)
$(error "Please create an environment variable PVSNESLIB_HOME. See rom/README.md")
endif

export ROMNAME := battlefi
export ROMTITLE := BATTLEFI
ROMSIZE := 0A
ROMBANKS := 32

include ${PVSNESLIB_HOME}/devkitsnes/snes_rules

.PHONY: all clean bitmaps

all: bitmaps $(ROMNAME).sfc

clean: cleanBuildRes cleanRom cleanGfx
	@rm -f res/frames/*.pic res/frames/*.pal res/frames/*.inc
	@rm -f res/frames_data.as res/lake.pic res/lake.pal res/lake.map
	@rm -f res/hud_font.pic res/hud_font.pal res/hud_font.inc

# Bitmap conversion is driven by tools/wsl_build_rom.sh (frame streaming).
bitmaps:
	@echo "bitmaps: use tools/wsl_build_rom.sh (converts res/frames/*.bmp)"
