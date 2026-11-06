// BMC driver for the byte-count invariant every Modbus server must enforce on
// FC 0x10 (Write Multiple Registers) and 0x0F (Write Multiple Coils): the ADU
// carries quantity (2B) and a byte_count (1B), and the handler must verify
// byte_count == 2*quantity (registers) and that the frame actually holds
// byte_count more bytes before copying them. A server that trusts byte_count,
// or that trusts quantity without bounding it, reads/writes out of bounds.
// This is a faithful MODEL of that check (not extracted library source); on the
// box we run ESBMC against libmodbus's real modbus_reply where it can be
// isolated. Here ESBMC proves the guarded model is safe for all inputs.
#include <stdint.h>
#include <stddef.h>
uint8_t nondet_u8(void);
size_t nondet_sz(void);

#define FRAME 260            // Modbus TCP max ADU
#define MB_MAX_REGISTERS 123 // 0x007B, the protocol cap for FC 0x10

// returns 0 on accept (after a safe copy), -1 on reject.
static int handle_wmr(const uint8_t *pdu, size_t pdu_len, uint16_t regs[], size_t regcap) {
  if (pdu_len < 6) return -1;                 // fc + addr(2) + qty(2) + bc(1)
  uint16_t addr = (uint16_t)((pdu[1] << 8) | pdu[2]);
  uint16_t qty  = (uint16_t)((pdu[3] << 8) | pdu[4]);
  uint8_t  bc   = pdu[5];
  if (qty < 1 || qty > MB_MAX_REGISTERS) return -1;   // quantity bound
  if (bc != (uint8_t)(qty * 2)) return -1;            // byte_count consistency
  if ((size_t)6 + bc > pdu_len) return -1;            // frame actually holds data
  if ((size_t)addr + qty > regcap) return -1;         // destination bound
  for (uint16_t i = 0; i < qty; i++)
    regs[addr + i] = (uint16_t)((pdu[6 + 2*i] << 8) | pdu[6 + 2*i + 1]);
  return 0;
}

#define RC 0x10000
int main(void) {
  static uint16_t regs[RC];
  uint8_t pdu[FRAME];
  for (size_t i = 0; i < FRAME; i++) pdu[i] = nondet_u8();
  size_t len = nondet_sz();
  __CPROVER_assume(len <= FRAME);
  // all reads/writes inside handle_wmr must stay in bounds for every input
  handle_wmr(pdu, len, regs, RC);
  return 0;
}
