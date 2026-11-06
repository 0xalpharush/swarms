#!/usr/bin/env bash
# Bounded model checking of the trickiest parsing arithmetic with CBMC. The
# checks below find the Oath-article bug classes: out-of-bounds access, integer
# overflow, undefined shifts and conversions. driver_*_planted.c is a positive
# control (a real guard removed): CBMC MUST report it FAILED, or the harness is
# not discriminating and every SUCCESSFUL verdict is meaningless.
set -u
CBMC=${CBMC:-cbmc}
FLAGS="--unwind 20 --bounds-check --pointer-check --signed-overflow-check \
  --unsigned-overflow-check --conversion-check --undefined-shift-check \
  --div-by-zero-check --pointer-overflow-check"
here="$(cd "$(dirname "$0")" && pwd)"
for d in "$here"/driver_*.c; do
  name=$(basename "$d" .c)
  echo "======== $name ========"
  "$CBMC" "$d" $FLAGS 2>&1 | grep -E 'VERIFICATION|violated|\*\* [0-9]|line [0-9]+ (function|.*check)' | tail -20
  echo
done
