# protofuzz — LLM-mined term-algebra differential fuzzing of protocol stacks

Find memory-safety and decode-logic bugs in well-supported **open-source
protocol stacks** (the kind embedded in commercial equipment), for responsible
disclosure. The method is tlspuffin's idea — model messages as a typed *term
algebra* and fuzz *traces* of terms rather than raw bytes — but the signature
(the typed constructors + their wire encoders) is **mined by an LLM from the
RFC and the library's own headers, then mechanically validated against the real
decoder before any fuzzing**. A second implementation in Rust is run as a
differential oracle, and a third implementation breaks ties.

This is the executable sibling of the `challenges/` verified-challenge model:
the verifier is frozen code, submissions are inputs/patches, and a finding is a
sanitizer fault or an oracle-confirmed decode disagreement.

## Pipeline (per target)

1. **Mine the signature.** From the spec's message grammar + the C library's
   public decode API, derive typed constructors for each wire representation
   (e.g. HPACK's 6 representation types in RFC 7541 §6) and the integer/string
   sub-encodings. A *term* is one representation; a *trace* is a sequence that
   shares decoder state (dynamic table, transport reassembly, sequence number).
2. **Validate the signature.** At harness startup, decode every canonical
   template through the *real* C decoder and assert it is accepted. A
   constructor the target rejects is not a sound term — fix it before fuzzing.
   (This is the "mine, then verify" gate; it keeps hallucinated grammar out.)
3. **Build differentially with sanitizers + coverage.** Compile the C/C++
   target with `-fsanitize=fuzzer-no-link,address,undefined
   -fno-sanitize-recover=undefined` — `fuzzer-no-link` gives libFuzzer edge
   feedback *inside* the target (without it the fuzzer is coverage-blind on the
   library and only sees the harness). Expose the
   Rust port as a `staticlib` with an `extern "C"` decode that is
   **panic-safe** (`catch_unwind` → error code; a panic across FFI is UB). Link
   both into one libFuzzer binary.
4. **Term-level mutator.** `LLVMFuzzerCustomMutator` parses the trace into
   representation boundaries and mutates at that granularity — delete /
   duplicate / retype a representation, perturb an integer field to a boundary
   (0, max, overlong varint), toggle a Huffman/flag bit, truncate mid-term,
   splice a validated template — then re-frames. Half the time it defers to the
   byte mutator so raw-malformed coverage is not lost.
5. **Robustness run (C-only).** `PF_CONLY=1 PF_NOABORT=1`: only the C target,
   only the sanitizers. **Any crash here is an unambiguous memory-safety
   finding** — no oracle argument needed. This is the highest-signal run.
6. **Differential run.** Both decoders, state shared across the trace. A
   disagreement aborts and is saved.
7. **Triage + normalize.** For each disagreement, replay through C, Rust and
   the third-impl oracle. Classify: `oracle==C` → Rust-side bug;
   `oracle==Rust` → C-side candidate (**inspect**); all-differ → inspect.
   **Normalize layer/semantic differences** (see lesson below) so they do not
   masquerade as findings.
8. **Minimize + fingerprint + disclose.** ddmin the input; fingerprint by
   (op, differing field, sanitizer stack / crash site) not raw bytes; a human
   sends every disclosure.

## The lesson from HPACK (why raw diffs are noisy)

The first run (old `hpack` crate) produced 771 disagreements. None were nghttp2
bugs:

- Most were **truncation strictness**. nghttp2 strictly errors
  (`NGHTTP2_ERR_HEADER_COMP`) on a trailing *partial* representation; the old
  crate accepted it. (A quick probe settled it: nghttp2 *accepts* an empty
  header name — `{00 00 00}` decodes to `""=""`, `rc=0` — so this was never an
  empty-name validation difference; `{00}` fails only because the name length
  byte is missing.)
- The rest were bugs/panics in the unmaintained crate itself.

Two fixes turned noise into signal:

1. **A maintained oracle.** Swapping to `fluke-hpack` removed the crate's own
   bugs and panics. It agrees with nghttp2 on every fully-consumed input.
2. **Normalization.** A finding is defined as *both decoders accept and fully
   consume the input but emit different header lists*. Accept/reject boundaries
   (truncation strictness) are counted, not flagged (restore them with
   `PF_STRICT=1` for offline oracle triage). Memory-safety faults are a separate,
   self-evident signal from the C-only run.

Result: **771 raw disagreements → 0 false findings**, while a negative control
(a deliberately corrupted Rust output) was caught **951 times in 25 s** — the
differential is live and discriminating, not silently passing.

The general rule: lead with sanitizer findings (self-evident); for behavioral
diffs, pin the comparison to one layer (here: full-consume + decoded list) and
normalize known strictness differences before calling anything a bug.

## Status

| target | pair | state |
|---|---|---|
| `hpack/` | nghttp2 (C) vs `fluke-hpack` (Rust), Go x/net tie-breaker | **validated + refined locally** (Docker, arm64). C-only robustness: 0 crashes on nghttp2 (`f4c8edff`). Differential: 771 raw diffs → **0 false findings** after the fluke-hpack oracle + normalization; negative control caught 951/25 s. |
| `dnp3/` | opendnp3 (C++) — **sanitizer + BMC** | **run on a boxctl box.** opendnp3 built static with ASan/UBSan + coverage; `Decoder::DecodeLPDU` drives link→transport→app; CRC-aware term mutator. 30-min: **6598 edges / 6739 features @ ~90k exec/s, 0 crashes**. A differential is infeasible here (opendnp3 emits fields as log strings; Rust `dnp3` has no public decode API + a restrictive license) — see `dnp3/README.md`. |
| `modbus/` | libmodbus (C) vs `rmodbus` (Rust) | **run on a boxctl box.** libmodbus built static with ASan/UBSan + coverage; socketpair-driven `modbus_receive`+`modbus_reply` over a full-range mapping; term mutator over MBAP+PDU. Upgraded to a **field-level exception-code differential** (compare the Modbus exception each stack raises, not just accept/reject — the earlier accept/reject diffs were semantic noise). **0 crashes.** |
| `opcua/` | open62541 (C) vs `async-opcua` (Rust) | **4th target, run on a boxctl box.** The less-hardened industrial/SCADA stack. **Field-level round-trip differential**: decode a `Variant` with each stack, re-encode, compare canonical bytes (OPC-UA binary is canonical, so same value ⇒ same bytes — no cross-impl type mapping). open62541 with ASan/UBSan + coverage. C-only: **512 edges @ 200k exec/s, 0 memory-safety crashes.** |
| `bmc/` | CBMC on real parsing arithmetic | **validated.** Real nghttp2 HPACK integer decoder → **VERIFIED** safe; a planted-guard-removed copy → **FAILED** (positive control proves the checker discriminates); Modbus byte-count invariant → VERIFIED. The complement to fuzzing — proves bounded absence of overflow/OOB/UB, the Oath grid-bugs article's biggest-yield technique. |

`hpack/` was validated locally; `dnp3/`, `modbus/` and `opcua/` were built and run on a
boxctl box (ASan/UBSan + libFuzzer coverage); `bmc/` runs anywhere CBMC installs. The Rust
side is always a differential oracle, never a disclosure target — the disclosure target is
the well-supported C/C++ stack.

**Honest result so far: no confirmed memory-safety bugs** across nghttp2, opendnp3, libmodbus
(all OSS-Fuzz-hardened — 0 is the expected outcome) and open62541 on short campaigns. Every
candidate the harnesses surfaced was triaged *out* as noise, not reported: HPACK's 771 raw
diffs, Modbus's accept/reject diffs, and open62541's `-fsanitize=function` report on its
benign decode-dispatch idiom. Correctly rejecting false positives is the discipline the method
lives or dies on. The remaining bug-yield levers are longer campaigns on `opcua/` (the least
hardened), the field-level differentials, and extracting real less-hardened functions for `bmc/`.

## Run it

Local (one target, validation): `hpack/` has a self-contained `Dockerfile.local`.

```
cd hpack
docker build -f Dockerfile.local -t protofuzz-hpack .
docker run --rm -v "$PWD":/src -e NGHTTP2=/opt/nghttp2 -e OUT=/src/build protofuzz-hpack bash /src/build.sh
# robustness (memory safety only — highest signal):
docker run --rm -v "$PWD":/src -e NGHTTP2=/opt/nghttp2 -e OUT=/src/build -e PF_CONLY=1 -e PF_NOABORT=1 -e SECS=3600 protofuzz-hpack bash -c 'ASAN_OPTIONS=detect_leaks=0 bash /src/run.sh'
```

On a `boxctl` box (long campaigns), see `BOX.md`.
