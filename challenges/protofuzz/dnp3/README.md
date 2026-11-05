# DNP3 — opendnp3 (C++) vs dnp3-rs

Scaffold; not yet run (opendnp3's C++ build needs a box). Follow `../README.md`.

## Fuzz units (mined signature)
- **link frame**: 0x0564, len, ctrl, dst, src, header-CRC, then data blocks each
  with a trailing CRC. Terms: the fixed header fields + per-16-byte data block +
  its CRC. Boundary mutations: len vs actual, bad CRC, dst/src, FIR/FIN/seq ctrl bits.
- **application fragment**: app control (FIR/FIN/CON/UNS/seq), function code,
  then objects (group/variation/qualifier/range/data). Terms: one object header
  + its range/prefix encoding. Rich bug surface: qualifier/range decoders.
- **transport trace** (stateful): a sequence of transport segments (FIN/FIR/seq)
  that reassemble into one application fragment — the DNP3 analogue of HPACK's
  shared dynamic table. Replay bugs live here.

## Differential
- C++: opendnp3 parsers (`LinkLayerParser`, `APDUParser`, `TransportRx`). Build
  with ASan/UBSan via its CMake (`-DCMAKE_CXX_FLAGS=-fsanitize=address,undefined`).
- Rust: `dnp3` crate internal parsers, exposed as a `staticlib` with a
  panic-safe `extern "C"` that decodes to the same canonical form.
- Oracle/tie-break: a strict spec decoder, or Wireshark's DNP3 dissector run
  headless, for contested fragments.

## Build recipe (box)
```
git clone --depth1 https://github.com/dnp3/opendnp3 && cd opendnp3
cmake -B build -DDNP3_TLS=OFF -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-sanitize-recover=undefined -g -O1"
cmake --build build -j
```
