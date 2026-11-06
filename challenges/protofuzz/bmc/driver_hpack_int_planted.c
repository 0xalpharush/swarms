// POSITIVE control: driver_hpack_int.c with the `shift >= 32` guard removed.
// `add <<= shift` with shift >= 32 is undefined behaviour on a 32-bit value;
// ESBMC must report a failure here. If it does NOT, the harness is not wired
// to catch the class of bug we are hunting, and every VERIFIED result on the
// real code is meaningless.
#include <stdint.h>
#include <stddef.h>
#include <limits.h>
uint8_t nondet_u8(void);
size_t nondet_sz(void);
static int decode_length(uint32_t *res, size_t *shift_ptr, int *fin,
                         uint32_t initial, size_t shift,
                         const uint8_t *in, const uint8_t *last, size_t prefix) {
  uint32_t k = (uint8_t)((1 << prefix) - 1);
  uint32_t n = initial;
  const uint8_t *start = in;
  *shift_ptr = 0; *fin = 0;
  if (n == 0) {
    if (((*in) & k) != k) { *res = (*in) & k; *fin = 1; return 1; }
    n = k;
    if (++in == last) { *res = n; return (int)(in - start); }
  }
  for (; in != last; ++in, shift += 7) {
    uint32_t add = (*in) & 0x7f;
    /* removed: if (shift >= 32) return -1; */
    add <<= shift;                 /* UB when shift >= 32 */
    if (UINT32_MAX - add < n) { *shift_ptr = shift; return -1; }
    n += add;
    if (((*in) & (1 << 7)) == 0) { *fin = 1; ++in; break; }
  }
  *shift_ptr = shift; *res = n; return (int)(in - start);
}
#define N 8
int main(void) {
  uint8_t buf[N];
  for (size_t i = 0; i < N; i++) buf[i] = nondet_u8();
  size_t len = nondet_sz(); __CPROVER_assume(len >= 1 && len <= N);
  uint32_t res; size_t shift; int fin;
  decode_length(&res, &shift, &fin, 0, 0, buf, buf + len, 5);
  return 0;
}
