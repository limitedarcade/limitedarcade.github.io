#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/local/usr/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PVSNESLIB_HOME="${HOME}/pvsneslib"
echo "PVSNESLIB_HOME=$PVSNESLIB_HOME"
ls "$PVSNESLIB_HOME" | head
ls "$PVSNESLIB_HOME/devkitsnes/bin" | head
which make
make --version | head -1
which gfx4snes || ls "$PVSNESLIB_HOME/devkitsnes/bin/gfx4snes"*
