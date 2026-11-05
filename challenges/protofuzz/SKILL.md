---
name: protocol-term-fuzz
description: LLM-mined term-algebra differential + sanitizer fuzzing of well-supported open-source protocol stacks (C/C++) against a Rust port, for responsible disclosure of memory-safety and decode-logic bugs. Use when asked to fuzz a protocol library, build a differential harness, or hunt bugs in a parser/decoder. Models messages as a typed term algebra (tlspuffin-style) whose signature is mined from the spec + the library headers and validated against the real decoder before fuzzing.
---

# protocol-term-fuzz

Defensive security: find bugs in protocol stacks embedded in commercial
equipment, and hand every finding to a human for disclosure. Full method and a
validated worked example in `challenges/protofuzz/README.md`; box runs in
`challenges/protofuzz/BOX.md`.

## Do this, in order

1. **Pick the pair.** Target = the well-supported C/C++ stack. Oracle = a
   maintained Rust port. Tie-breaker = a third implementation (Go/pymodbus/
   dissector). Prefer a stateful protocol (shared decoder state ⇒ traces matter).
2. **Mine the signature from spec + headers**: typed constructors for each wire
   representation and its integer/string sub-encodings; a *trace* = a sequence
   of terms sharing decoder state.
3. **Validate every template against the real C decoder at startup.** A rejected
   template is not a sound constructor. This gate keeps hallucinated grammar out.
4. **Build**: C/C++ with `-fsanitize=address,undefined -fno-sanitize-recover=undefined`;
   Rust port as a `staticlib` with a **panic-safe** `extern "C"` decode
   (`catch_unwind`, never let a panic cross FFI); one libFuzzer binary links both.
5. **Term mutator** (`LLVMFuzzerCustomMutator`): parse the trace into
   representation boundaries; delete/duplicate/retype a term, push an integer to
   a boundary (0, max, overlong varint), toggle flag/Huffman bits, truncate,
   splice a validated template; defer to the byte mutator ~half the time.
6. **Robustness run first** (`PF_CONLY=1 PF_NOABORT=1`): C target + sanitizers
   only. A crash here is an unambiguous finding — triage and disclose.
7. **Differential run** next, then **three-way triage**: `oracle==C` ⇒ Rust bug;
   `oracle==Rust` ⇒ C candidate (inspect); all-differ ⇒ inspect.
8. **Normalize layer/validation differences before calling a diff a bug** — a
   raw cross-layer diff is noise-dominated (HPACK: 617/771 diffs were just
   nghttp2's extra HTTP/2 validation). ddmin, fingerprint by (op, field, crash
   site), human-disclose.

## Hard-won gotchas
- A Rust panic across `extern "C"` is UB and aborts → looks like hundreds of
  "crashes." Wrap in `catch_unwind` → error code.
- Separate memory-safety (sanitizer, self-evident) from behavioral diffs
  (oracle + normalization required). Lead with the former.
- `boxctl`: box quota and `sudo`/build on a shared box are operator actions;
  an auto-mode agent cannot do them — hand those steps to the operator.
