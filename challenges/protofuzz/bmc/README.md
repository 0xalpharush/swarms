# Bounded model checking (CBMC)

Fuzzing explores reachable states; bounded model checking *proves* (up to an
unwind bound) that a function has no out-of-bounds access, integer overflow,
undefined shift or bad conversion for **any** input. The Oath grid-bugs article
got its biggest yield here, not from fuzzing — unchecked arithmetic in parsing
leaf functions. This is the complement to the differential/sanitizer harnesses.

## Drivers

- `driver_hpack_int.c` — the real nghttp2 HPACK integer decoder (`decode_length`,
  RFC 7541 §5.1), reproduced verbatim. HPACK integer continuation is the classic
  overflow site; nghttp2 guards it. **Negative control** — expect SUCCESSFUL.
- `driver_hpack_int_planted.c` — the same code with the `shift >= 32` guard
  removed. **Positive control** — CBMC MUST report this FAILED (undefined shift).
  If it does not, the harness is not catching the bug class we hunt and every
  SUCCESSFUL verdict above is worthless. Same discipline as the HPACK
  differential's 951× negative control.
- `driver_modbus_wmr.c` — the byte-count/quantity/buffer invariant a Modbus
  server must enforce on FC 0x10/0x0F. A faithful model of the check (labelled
  as such); on the box we also run CBMC against libmodbus's real `modbus_reply`
  where it can be isolated.

## Run

```
sudo apt-get install -y cbmc
bash run.sh
```

## Why CBMC, not ESBMC

ESBMC ships only as a scraped GitHub release tarball with unstable asset names;
CBMC is one `apt-get` line, actively maintained, and its `--*-check` flags cover
the same bug classes. The drivers use `__CPROVER_assume`/`__CPROVER_assert` and
undefined `nondet_*` functions, which both tools treat as symbolic.

## Status

Real extracted library functions (open62541 binary-decode primitives, where the
less-hardened arithmetic actually lives) are the next drivers; those require the
target headers and are built on the box. See `../BOX.md`.
