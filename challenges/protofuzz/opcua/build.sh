#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HOME/.cargo/env" 2>/dev/null || true
O62="${O62:-$HOME/pf/src/open62541}"
OUT="${OUT:-$HERE/build}"
mkdir -p "$OUT" "$HERE/corpus"

echo "[build] rust decoder (async-opcua-types 0.19)"
( cd "$HERE/rustdec" && cargo build --release )
RLIB="$HERE/rustdec/target/release/libua_rustdec.a"

echo "[build] open62541 from $O62"
UALIB="$(find "$O62/build" -name 'libopen62541.a' | head -1)"
test -n "$UALIB" || { echo "missing libopen62541.a (build open62541 with ASan first)"; exit 1; }
# public + generated headers (non-amalgamation build)
INCS=()
for d in "$O62/include" "$O62/build/src_generated" "$O62/plugins/include" "$O62/arch"; do
  [ -d "$d" ] && INCS+=("-I$d")
done
# generated headers may sit under build/src_generated/open62541; add parent of types_generated.h
GEN="$(find "$O62/build" -name 'types_generated.h' | head -1)"
[ -n "$GEN" ] && INCS+=("-I$(dirname "$(dirname "$GEN")")")

echo "[build] libFuzzer harness (ASan+UBSan+fuzzer)"
clang++ -g -O1 -fno-omit-frame-pointer -fuse-ld=lld \
  -fsanitize=fuzzer,address,undefined -fno-sanitize-recover=undefined \
  "${INCS[@]}" "$HERE/harness.cc" "$RLIB" "$UALIB" \
  -pthread -ldl -lm -o "$OUT/opcua-fuzz"
echo "[build] ok -> $OUT/opcua-fuzz"

# seed corpus: well-formed Variant encodings
seed(){ printf "$1" > "$HERE/corpus/$2"; }
seed '\x03\x2a'                                         s_byte          # Byte scalar 0x2a
seed '\x06\x01\x00\x00\x00'                             s_int32         # Int32 scalar = 1
seed '\x0b\x00\x00\x00\x00\x00\x00\xf0\x3f'             s_double        # Double 1.0
seed '\x86\x02\x00\x00\x00\x07\x00\x00\x00\x09\x00\x00\x00' s_int32arr   # Int32[2]
seed '\x0c\x03\x00\x00\x00\x61\x62\x63'                 s_string        # String "abc"
seed '\x0c\xff\xff\xff\xff'                             s_nullstr       # String null (-1)
seed '\x01\x01'                                         s_bool          # Boolean true
echo "[build] seeds: $(ls "$HERE/corpus" | wc -l)"
