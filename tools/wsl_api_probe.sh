#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/local/usr/bin:/usr/bin:/bin"
INC="${HOME}/pvsneslib/pvsneslib/include"
grep -rn "dmaCopyVram\|dmaCopyCGram\|oamInitGfxSet\|OBJ_SIZE" "$INC" --include='*.h' | head -50
echo "==== sprites examples ===="
ls "${HOME}/pvsneslib/snes-examples/graphics/Sprites"
echo "==== dma.h ===="
sed -n '1,120p' "$INC/dma.h" 2>/dev/null || true
echo "==== sprite.h excerpt ===="
sed -n '1,200p' "$INC/sprite.h" 2>/dev/null || true
