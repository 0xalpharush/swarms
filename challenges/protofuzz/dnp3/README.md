# DNP3 — opendnp3 (C++), sanitizer + BMC

Built + run on a boxctl box (static opendnp3 with ASan/UBSan + libFuzzer coverage).
30-min campaign: **6598 edges / 6739 features @ ~90k exec/s, 0 crashes** (CRC-correct
term frames drive link→transport→app). opendnp3 is OSS-Fuzz-hardened, so 0 is expected.

**A field-level differential for DNP3 is infeasible on both sides (determined 2026-11-06),
so DNP3 is a sanitizer + BMC target, not a differential one:**
- opendnp3's public `Decoder` emits parsed fields only as *log strings* — its
  `IDecoderCallbacks` interface is empty (just `PushIndent`/`PopIndent`), so there is no
  structured field oracle to compare against.
- The Rust `dnp3` crate (Step Function I/O) is session/tokio-oriented with **no public
  standalone decode API**, and ships under a **non-commercial, no-redistribution license** —
  unusable as a bundled differential oracle.

The sanitizer campaign (above) and the BMC drivers (`../bmc/`) are the DNP3 signal.

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

## Why sanitizer-only (not differential)
See the note above: neither opendnp3 (log-string output, empty callbacks) nor the
Rust `dnp3` crate (no public decode API, restrictive license) exposes a field oracle.
The deep CRC-aware term mutator still exercises the full link→transport→app parse chain
under ASan/UBSan, which is where opendnp3's memory-safety bugs would surface.

## Build recipe (box)
```
git clone --depth1 https://github.com/dnp3/opendnp3 && cd opendnp3
cmake -B build -DDNP3_TLS=OFF -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-sanitize-recover=undefined -g -O1"
cmake --build build -j
```
