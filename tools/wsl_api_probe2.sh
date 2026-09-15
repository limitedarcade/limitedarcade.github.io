#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/local/usr/bin:/usr/bin:/bin"
INC="${HOME}/pvsneslib/pvsneslib/include/snes"
sed -n '240,280p' "$INC/dma.h"
echo "==== oamInitGfxSet ===="
sed -n '280,320p' "$INC/sprite.h"
echo "==== SimpleSprite main ===="
find "${HOME}/pvsneslib/snes-examples/graphics/Sprites" -name '*.c' | head -5
echo "----"
head -120 "${HOME}/pvsneslib/snes-examples/graphics/Sprites/SimpleSprite/src/main.c"
echo "==== Animated ===="
head -160 "${HOME}/pvsneslib/snes-examples/graphics/Sprites/AnimatedSprite/src/main.c" 2>/dev/null || true
