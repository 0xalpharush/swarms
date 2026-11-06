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


## Differential result (honest)

The libmodbus-vs-rmodbus accept/reject differential is **noise-dominated and
not a useful bug signal**, for the same reason HPACK's raw diff was: the two
libraries draw the frame boundary differently.

- rmodbus silently **ignores frames not addressed to its unit id** and returns
  `Ok` (not "valid request"). The harness now addresses each frame to its own
  MBAP unit to remove this artifact (427 -> 361 divergences), but the rest are
  still semantic:
- rmodbus **early-returns `Ok` on broadcast** (unit 0) before any length check;
  libmodbus validates the full declared length.
- libmodbus **ignores trailing bytes** past the MBAP length and defers
  **unknown function codes** to the reply layer (exception response), while
  rmodbus surfaces them at parse time.
- rmodbus's parse API does not expose the decoded fields (function, address,
  quantity), so a decode-level comparison (the only high-signal differential)
  is not available without patching the crate.

Conclusion: for Modbus the **C-only sanitizer run is the signal** (libmodbus
under ASan/UBSan via `modbus_receive`+`modbus_reply` over a full-range mapping;
0 crashes). A meaningful differential would need field-level comparison and
matched framing semantics (completeness, broadcast, exception layer). Known
harness limitation: `modbus_reply` writes into an undrained socketpair, so
throughput is low (~3-4 exec/s); drain the peer or set the socket non-blocking
before a long campaign.
