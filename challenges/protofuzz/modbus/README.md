# Modbus — libmodbus (C) vs rodbus/tokio-modbus

Built + run on a boxctl box (static libmodbus with ASan/UBSan + coverage). socketpair modbus_receive+modbus_reply over a full-range mapping; 0 crashes in 60s. See ../README.md.

## Fuzz units (mined signature)
- **TCP ADU**: MBAP header (txn id, proto id, length, unit id) + PDU (function
  code + data). Terms: the header fields + the function-specific PDU body
  (coil/register counts, byte counts, addresses). Boundary mutations: MBAP
  length vs real, byte-count vs data-len, function code, quantity at limits.
- **RTU ADU**: addr + PDU + CRC16. Add CRC terms (correct/corrupt).
- **req/resp trace** (stateful): a request frame then a response frame for the
  same function; response parsers size their output from the request, so this
  reaches the count/length-mismatch bugs.

## Differential
- C: libmodbus response parsing. Its API is transport-coupled; the clean target
  is the internal `check_confirmation` / response-length logic. Either drive via
  a socketpair feeding frames, or compile the relevant TUs directly into the
  harness with ASan/UBSan (like the zlib challenge builds nghttp2's TUs).
- Rust: `rodbus` or `tokio-modbus` codec `decode`, panic-safe `extern "C"`.
- Oracle: pymodbus or a strict spec decoder for contested frames.

## Build recipe (box)
```
git clone --depth1 https://github.com/stephane/libmodbus && cd libmodbus
./autogen.sh && ./configure CC=clang \
  CFLAGS="-g -O1 -fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined"
make -j
```
