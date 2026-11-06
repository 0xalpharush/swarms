# OPC-UA — open62541 (C) vs async-opcua (Rust), field-level differential

OPC-UA is the dominant industrial/SCADA interoperability protocol. open62541 is
the most widely deployed open-source C stack; `async-opcua` is the maintained
Rust stack. Both decode the OPC-UA binary encoding into typed values, which
makes a **field-level** differential possible — the method's strongest form, and
the reason this target was chosen (task 1 + a less-fuzzed target than nghttp2).

## Method: round-trip canonical-bytes equality

OPC-UA binary encoding is canonical: a given value has exactly one encoding. So
if both stacks decode a buffer to the *same* value, re-encoding that value must
yield *identical* bytes. The harness therefore, per input:

1. decodes a top-level `Variant` with each stack;
2. re-encodes the decoded value with the *same* stack;
3. compares (a) accept/reject agreement and (b), when both accept, the
   re-encoded bytes byte-for-byte.

A mismatch means one stack parsed a different value from the same bytes — a real
decoder bug — and needs **no cross-implementation type-enum mapping** (the thing
that makes naive differentials noisy). open62541 is compiled with ASan+UBSan and
libFuzzer coverage, so a memory-safety fault in its decoder is the primary,
self-evident finding regardless of the differential.

- `harness.cc` — libFuzzer target + term mutator over the Variant wire format
  (encoding-mask byte, array length, per-type bodies), plus corruption.
- `rustdec/` — `async-opcua-types` 0.19 FFI wrapper; decode+re-encode, panic-safe
  via `catch_unwind` (a Rust decoder panic is reported as a candidate, never
  unwound across the FFI boundary).
- `PF_CONLY=1` memory-safety campaign (C only); `PF_STRICT=1` abort on the first
  divergence (differential campaign); default logs divergences and keeps fuzzing.

## Build notes (the non-obvious parts)

- The box's clang emits **LLVM bitcode** objects (LTO), so open62541's
  `libopen62541.a` must be linked with `-fuse-ld=lld`; GNU `ld` reports
  "file format not recognized" on bitcode members.
- open62541's decoder dispatches every per-type decode through one generic
  function-pointer type (a table of casts). UBSan's `-fsanitize=function` check
  flags that idiom as UB on **every** decode, well-formed inputs included — it is
  benign type-punning, not a vulnerability, and open62541's own OSS-Fuzz build
  disables it. open62541 is therefore rebuilt with `-fno-sanitize=function`; the
  real UBSan checks (bounds, overflow, shift, alignment) stay on. This was the
  first thing the harness "found", and triaging it out (not reporting it) is the
  same discipline as the Modbus and HPACK false positives.
- Align decode limits: open62541 1.4 binary decode has no array/string length
  cap in `UA_DecodeBinaryOptions`; async-opcua's `ContextOwned::default()` may
  impose caps. A limit mismatch shows up as accept/reject divergence on large
  arrays/strings and is config noise, not a bug — a triage axis, not a finding.

See `../BOX.md` for the campaign recipe.
