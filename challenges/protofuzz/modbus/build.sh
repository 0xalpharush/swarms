#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HOME/.cargo/env" 2>/dev/null || true
LM="${LIBMODBUS:-$HOME/pf/src/libmodbus}"
OUT="${OUT:-$HERE/build}"; mkdir -p "$OUT" "$HERE/corpus"
echo "[build] rust decoder (rmodbus)"
( cd "$HERE/rustdec" && cargo build --release )
RLIB="$HERE/rustdec/target/release/librmodbus_dec.a"
NGLIB="$LM/src/.libs/libmodbus.a"; INC="$LM/src"
test -f "$NGLIB" || { echo "missing $NGLIB"; exit 1; }
echo "[build] libFuzzer harness"
clang++ -g -O1 -fno-omit-frame-pointer -fsanitize=fuzzer,address,undefined \
  -fno-sanitize-recover=undefined -I"$INC" "$HERE/harness.cc" "$RLIB" "$NGLIB" \
  -pthread -ldl -lm -o "$OUT/modbus-fuzz"
echo "[build] ok -> $OUT/modbus-fuzz"
# seeds
mkdir -p "$HERE/corpus"
printf '\x00\x00\x00\x00\x00\x06\x01\x03\x00\x00\x00\x05' > "$HERE/corpus/s_rdregs"
printf '\x00\x00\x00\x00\x00\x06\x01\x01\x00\x00\x00\x0a' > "$HERE/corpus/s_rdcoils"
printf '\x00\x00\x00\x00\x00\x06\x01\x06\x00\x01\x12\x34' > "$HERE/corpus/s_wrreg"
echo "[build] seeds: $(ls "$HERE/corpus" | wc -l)"
