// BMC driver for nghttp2's HPACK integer decoder (RFC 7541 section 5.1),
// the real `decode_length` algorithm from nghttp2_hd.c (commit f4c8edff),
// reproduced verbatim so ESBMC proves bounded memory- and arithmetic-safety
// over a fully symbolic input. HPACK integer continuation is the classic
// overflow site; nghttp2 guards it, so this driver is the NEGATIVE control:
// ESBMC should report VERIFICATION SUCCESSFUL. driver_hpack_int_planted.c is
// the same code with one guard removed (positive control): it must FAIL, which
// proves the harness actually discriminates.
#include <stdint.h>
#include <stddef.h>
#include <limits.h>

uint8_t nondet_u8(void);
size_t nondet_sz(void);

// RFC 7541 5.1 prefixed-integer decode (nghttp2's decode_length, trimmed to the
// single-fragment path; the overflow arithmetic is identical).
static int decode_length(uint32_t *res, size_t *shift_ptr, int *fin,
                         uint32_t initial, size_t shift,
                         const uint8_t *in, const uint8_t *last, size_t prefix) {
  uint32_t k = (uint8_t)((1 << prefix) - 1);
  uint32_t n = initial;
  const uint8_t *start = in;
  *shift_ptr = 0;
  *fin = 0;
  if (n == 0) {
    if (((*in) & k) != k) { *res = (*in) & k; *fin = 1; return 1; }
    n = k;
    if (++in == last) { *res = n; return (int)(in - start); }
  }
  for (; in != last; ++in, shift += 7) {
    uint32_t add = (*in) & 0x7f;
    if (shift >= 32) { *shift_ptr = shift; return -1; }
    if ((uint32_t)(UINT32_MAX >> shift) < add) { *shift_ptr = shift; return -1; }
    add <<= shift;
    if (UINT32_MAX - add < n) { *shift_ptr = shift; return -1; }
    n += add;
    if (((*in) & (1 << 7)) == 0) { *fin = 1; ++in; break; }
  }
  *shift_ptr = shift;
  *res = n;
  return (int)(in - start);
}

#define N 6
int main(void) {
  uint8_t buf[N];
  for (size_t i = 0; i < N; i++) buf[i] = nondet_u8();
  size_t len = nondet_sz();
  __CPROVER_assume(len <= N);
  size_t prefix = nondet_sz();
  __CPROVER_assume(prefix >= 1 && prefix <= 8);

  uint32_t res; size_t shift; int fin;
  // the function dereferences *in before the loop, so require a first byte
  __CPROVER_assume(len >= 1);
  int r = decode_length(&res, &shift, &fin, 0, 0, buf, buf + len, prefix);
  // property: a successful decode consumed at most `len` bytes (no OOB read)
  if (r > 0) { __CPROVER_assert(r <= (int)len, "decode consumed <= len bytes"); }
  return 0;
}
