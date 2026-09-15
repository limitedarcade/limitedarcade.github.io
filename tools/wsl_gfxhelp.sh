#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/local/usr/bin:/usr/bin:/bin:${HOME}/pvsneslib/devkitsnes/tools:${HOME}/pvsneslib/devkitsnes/bin"
gfx4snes -h 2>&1 | head -80 || true
echo "==== snes_rules gfx ===="
grep -n "GFXCONV\|\.pic\|\.inc\|_.as" "${HOME}/pvsneslib/devkitsnes/snes_rules" | head -40
echo "==== console ===="
grep -n "console\|printf\|consoleDraw" "${HOME}/pvsneslib/pvsneslib/include/snes/"*.h | head -30
