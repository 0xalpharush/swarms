// Differential + sanitizer harness for libmodbus (C, target) vs rmodbus (Rust).
// A Modbus TCP ADU (MBAP + PDU) is fed to libmodbus through a preloaded
// socketpair (the real modbus_receive parse path) under ASan/UBSan, and to
// rmodbus. A sanitizer fault in libmodbus is the primary finding.
//
// FIELD-LEVEL differential (PF_STRICT to abort, else logged): rather than
// accept/reject (which is noise-dominated, see README), we compare the Modbus
// EXCEPTION CODE each stack raises for the same request after processing it
// against a full-range register map. Agreement here means the two stacks agree
// on which requests are *illegal* and *why*; a divergence is a real semantic
// difference (e.g. one enforces a quantity range the other does not).
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <unistd.h>
#include <sys/socket.h>
#include <vector>
#include <modbus.h>

extern "C" int rmodbus_parse_tcp(const uint8_t *, size_t);
extern "C" int rmodbus_eval_tcp(const uint8_t *, size_t);

static bool g_conly = false, g_strict = false, g_abort = true;

static void mismatch(const char *why, int c, int r) {
  fprintf(stderr, "MODBUS MISMATCH: %s (c=%d rust=%d)\n", why, c, r);
  if (g_abort) abort();
}

// Returns: -1 libmodbus rejected at framing (modbus_receive < 0);
//          >=0 the Modbus exception code from modbus_reply (0 = normal response).
static int c_eval(const uint8_t *data, size_t size) {
  int sv[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, sv) != 0) return -9;
  ssize_t w = write(sv[1], data, size);
  (void)w;
  shutdown(sv[1], SHUT_WR);
  modbus_t *ctx = modbus_new_tcp("127.0.0.1", 1502);
  int exc = -1;
  if (ctx) {
    modbus_set_socket(ctx, sv[0]);
    uint8_t req[MODBUS_TCP_MAX_ADU_LENGTH];
    int rv = modbus_receive(ctx, req);
    if (rv >= 0) {
      static modbus_mapping_t *map =
          modbus_mapping_new(0x10000, 0x10000, 0x10000, 0x10000);  // once
      if (map) modbus_reply(ctx, req, rv, map);
      // read back libmodbus's response from the peer end of the socketpair
      uint8_t rsp[MODBUS_TCP_MAX_ADU_LENGTH];
      ssize_t n = recv(sv[1], rsp, sizeof(rsp), MSG_DONTWAIT);
      if (n >= 9) exc = (rsp[7] & 0x80) ? rsp[8] : 0;   // exception vs normal
      else exc = 0;                                      // no/short response
    }
    modbus_free(ctx);
  }
  close(sv[0]);
  close(sv[1]);
  return exc;
}

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
  if (size == 0 || size > MODBUS_TCP_MAX_ADU_LENGTH) return 0;
  int c = c_eval(data, size);
  if (g_conly) return 0;
  int r = rmodbus_eval_tcp(data, size);

  // both must agree on parse-reject vs parse-accept
  bool c_rej = (c < 0), r_rej = (r < 0);
  if (c_rej != r_rej) {
    if (g_strict)
      mismatch(c_rej ? "C rejected framing, Rust accepted"
                     : "C accepted framing, Rust rejected", c, r);
    else fprintf(stderr, "DIFF framing c=%d r=%d\n", c, r);
    return 0;
  }
  // both accepted: compare the exception code (field-level semantic)
  if (!c_rej && !r_rej && c != r) {
    if (g_strict) mismatch("exception-code divergence", c, r);
    else fprintf(stderr, "DIFF exc c=%d r=%d\n", c, r);
  }
  return 0;
}

// ---- term-level mutator over Modbus TCP frames ----
static uint64_t g_rng;
static uint32_t rnd() {
  g_rng ^= g_rng << 13; g_rng ^= g_rng >> 7; g_rng ^= g_rng << 17;
  return (uint32_t)g_rng;
}
static const std::vector<std::vector<uint8_t>> &templates() {
  static std::vector<std::vector<uint8_t>> t = {
      {0,0, 0,0, 0,6, 1, 0x01, 0,0, 0,10},
      {0,0, 0,0, 0,6, 1, 0x02, 0,0, 0,10},
      {0,0, 0,0, 0,6, 1, 0x03, 0,0, 0,5},
      {0,0, 0,0, 0,6, 1, 0x04, 0,0, 0,5},
      {0,0, 0,0, 0,6, 1, 0x05, 0,1, 0xff,0},
      {0,0, 0,0, 0,6, 1, 0x06, 0,1, 0x12,0x34},
      {0,0, 0,0, 0,8, 1, 0x0f, 0,0, 0,2, 1, 0x03},
      {0,0, 0,0, 0,9, 1, 0x10, 0,0, 0,1, 2, 0x12,0x34},
      {0,0, 0,0, 0,2, 1, 0x11},
  };
  return t;
}
extern "C" size_t LLVMFuzzerMutate(uint8_t *, size_t, size_t);
extern "C" size_t LLVMFuzzerCustomMutator(uint8_t *data, size_t size,
                                          size_t maxsize, unsigned seed) {
  g_rng = seed ? seed : 0x9e3779b97f4a7c15ull;
  if ((rnd() & 1) == 0 || size < 7) return LLVMFuzzerMutate(data, size, maxsize);
  std::vector<uint8_t> f(data, data + size);
  switch (rnd() % 6) {
    case 0: { const auto &t = templates()[rnd() % templates().size()];
      f.assign(t.begin(), t.end()); break; }
    case 1: if (f.size() > 7) f[7] ^= (uint8_t)(1u << (rnd() % 8)); break;
    case 2: f[4] = (uint8_t)(rnd()); f[5] = (uint8_t)(rnd()); break;
    case 3: if (f.size() > 11) f[8 + rnd() % (f.size() - 8)] ^= (uint8_t)(rnd()); break;
    case 4: if (f.size() > 7) f.resize(7 + rnd() % (f.size() - 7)); break;
    default: for (int i = 0, n = 1 + rnd() % 8; i < n && f.size() < maxsize; i++)
               f.push_back((uint8_t)rnd()); break;
  }
  if (f.size() > maxsize) f.resize(maxsize);
  memcpy(data, f.data(), f.size());
  return f.size();
}
extern "C" int LLVMFuzzerInitialize(int *, char ***) {
  if (getenv("PF_CONLY")) g_conly = true;
  if (getenv("PF_STRICT")) g_strict = true;
  if (getenv("PF_NOABORT")) g_abort = false;
  return 0;
}
