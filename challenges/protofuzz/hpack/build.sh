#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HOME/.cargo/env" 2>/dev/null || true
NGHTTP2="${NGHTTP2:-$HOME/pf/src/nghttp2}"
OUT="${OUT:-$HERE/build}"
mkdir -p "$OUT" "$HERE/corpus"

echo "[build] rust decoder"
( cd "$HERE/rustdec" && cargo build --release )
RLIB="$HERE/rustdec/target/release/librhpack.a"

echo "[build] nghttp2 headers from $NGHTTP2"
INC="$NGHTTP2/lib/includes"
NGLIB="$NGHTTP2/lib/.libs/libnghttp2.a"
test -f "$NGLIB" || { echo "missing $NGLIB (build nghttp2 with ASan first)"; exit 1; }

echo "[build] libFuzzer harness (ASan+UBSan+fuzzer)"
clang++ -g -O1 -fno-omit-frame-pointer \
  -fsanitize=fuzzer,address,undefined -fno-sanitize-recover=undefined \
  -I"$INC" "$HERE/harness.cc" "$RLIB" "$NGLIB" \
  -pthread -ldl -lm -o "$OUT/hpack-fuzz"
echo "[build] ok -> $OUT/hpack-fuzz"

echo "[build] go oracle (optional)"
if command -v go >/dev/null; then
  ( cd "$HERE/oracle" && GOFLAGS=-mod=mod go build -o "$OUT/hpack-oracle" . ) \
    && echo "[build] oracle ok" || echo "[build] oracle skipped (build failed)"
else
  echo "[build] go missing, oracle skipped"
fi

# seed corpus: framed valid header blocks ([u16 BE len][block])
seed(){ printf "$1" > "$HERE/corpus/$2"; }
seed '\x00\x03\x82\x86\x84' s_get
seed '\x00\x05\x82\x86\x84\x41\x00' s_litname
seed '\x00\x06\x40\x02xy\x01z' s_literal
seed '\x00\x01\x20' s_tablesize
seed '\x00\x03\x82\x86\x84\x00\x02\x88\xc1' s_twoblock
echo "[build] seeds: $(ls "$HERE/corpus" | wc -l)"
