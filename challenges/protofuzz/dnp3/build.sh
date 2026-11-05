#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OD="${OPENDNP3:-$HOME/pf/src/opendnp3}"
OUT="${OUT:-$HERE/build}"; mkdir -p "$OUT" "$HERE/corpus"
# include dirs: public headers + bundled ser4cpp
INCS="-I$OD/cpp/lib/include"
for d in "$OD"/build/_deps/*-src/src "$OD"/build/_deps/*-src/include "$OD"/cpp/lib/src; do
  [ -d "$d" ] && INCS="$INCS -I$d"
done
# all static libs opendnp3 produced (opendnp3 + bundled deps)
LIBS=$(find "$OD/build" -name '*.a' | tr '\n' ' ')
test -n "$LIBS" || { echo "no opendnp3 static libs"; exit 1; }
echo "[build] libs: $LIBS"
clang++ -std=c++17 -g -O1 -fno-omit-frame-pointer \
  -fsanitize=fuzzer,address,undefined -fno-sanitize-recover=undefined \
  $INCS "$HERE/harness.cc" -Wl,--start-group $LIBS -Wl,--end-group -pthread -ldl -lm -o "$OUT/dnp3-fuzz"
echo "[build] ok -> $OUT/dnp3-fuzz"
# seeds: a couple of valid link frames (built by a tiny C++ dry-run is overkill;
# the custom mutator synthesizes frames, so a minimal seed suffices)
printf '\x05\x64\x05\x44\x01\x00\x00\x04' > "$HERE/corpus/s_hdr"   # header only
echo "[build] seeds: $(ls "$HERE/corpus" | wc -l)"
