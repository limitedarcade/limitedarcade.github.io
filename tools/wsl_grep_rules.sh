#!/usr/bin/env bash
: "${SNES_PROJECT_ROOT:?Set SNES_PROJECT_ROOT to the emberveil project directory}"
BFI_BUILD_ROOT="${BFI_BUILD_ROOT:-${HOME}/bfi-build}"

grep -n 'ROMBANKS\|AUTOHDR\|ROMSIZE' "${HOME}/pvsneslib/devkitsnes/snes_rules" | head -40
echo '==== emberveil size ==='
ls -la "${SNES_PROJECT_ROOT}/rom/res/harbor.pic"
ls -la "${SNES_PROJECT_ROOT}/emberveil.sfc"
# try linking with bank usage report
cd "${BFI_BUILD_ROOT}/rom"
grep -n bank data.asm
# show what banks objects use
head -5 linkfile
cat linkfile
