// Differential + sanitizer fuzzing of OPC-UA binary decoding:
//   open62541 (C, widely deployed in industrial/SCADA)  vs
//   async-opcua (Rust `async-opcua-types` 0.19).
// Each input is decoded as a top-level UA_Variant by both stacks. open62541 is
// compiled with ASan+UBSan+coverage, so a memory-safety fault in its decoder is
// the primary, self-evident finding on this far-less-fuzzed target.
//
// Differential = round-trip canonical-bytes equality. OPC-UA binary encoding is
// canonical, so if both stacks decode a buffer to the *same* value they must
// re-encode to *identical* bytes. We therefore decode with each stack, re-encode
// with the SAME stack, and compare: (a) accept/reject agreement, (b) when both
// accept, byte-for-byte equality of the re-encodings. A mismatch means one stack
// parsed a different value from the same bytes -- a real decoder bug, with no
// cross-implementation type-enum mapping needed.
//
// Env: PF_CONLY=1  run only the C decoder (pure memory-safety campaign);
//      PF_STRICT=1 abort on any divergence (differential campaign);
//      default     log divergences to stderr, keep fuzzing.
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <vector>
#include <open62541/types.h>

#define REBUF_CAP 65536
extern "C" struct ua_fp { int ok; int relen; };  // ok: 0 reject,1 accept,2 rust-panic
extern "C" void rust_ua_decode(const uint8_t *data, size_t size,
                               uint8_t *rebuf, int cap, struct ua_fp *out);

static bool g_conly, g_strict, g_init;
static void init_flags() {
  if (g_init) return;
  g_conly  = getenv("PF_CONLY")  != nullptr;
  g_strict = getenv("PF_STRICT") != nullptr;
  g_init = true;
}

// decode a Variant with open62541, then re-encode it; fill out + rebuf.
static void c_decode(const uint8_t *data, size_t size, uint8_t *rebuf, int cap,
                     struct ua_fp *out) {
  out->ok = 0; out->relen = -1;
  UA_Variant v; UA_Variant_init(&v);
  UA_ByteString src; src.length = size; src.data = const_cast<UA_Byte *>(data);
  UA_StatusCode rc = UA_decodeBinary(&src, &v, &UA_TYPES[UA_TYPES_VARIANT], nullptr);
  if (rc == UA_STATUSCODE_GOOD) {
    UA_ByteString re = UA_BYTESTRING_NULL;
    if (UA_encodeBinary(&v, &UA_TYPES[UA_TYPES_VARIANT], &re) == UA_STATUSCODE_GOOD) {
      out->ok = 1; out->relen = (int)re.length;
      if ((int)re.length <= cap) memcpy(rebuf, re.data, re.length);
    }
    UA_ByteString_clear(&re);
  }
  UA_Variant_clear(&v);
}

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
  init_flags();
  static uint8_t cbuf[REBUF_CAP];
  struct ua_fp c = {0, -1};
  c_decode(data, size, cbuf, REBUF_CAP, &c);
  if (g_conly) return 0;

  static uint8_t rbuf[REBUF_CAP];
  struct ua_fp r = {0, -1};
  rust_ua_decode(data, size, rbuf, REBUF_CAP, &r);

  if (r.ok == 2) {                                  // Rust panicked on this input
    fprintf(stderr, "RUST-PANIC size=%zu\n", size);
    if (g_strict) abort();
    return 0;
  }
  int c_ok = (c.ok == 1), r_ok = (r.ok == 1);
  if (c_ok != r_ok) {
    fprintf(stderr, "DIFF accept c=%d r=%d size=%zu\n", c_ok, r_ok, size);
    if (g_strict) abort();
  } else if (c_ok && r_ok) {
    bool same = (c.relen == r.relen) && c.relen <= REBUF_CAP &&
                memcmp(cbuf, rbuf, c.relen) == 0;
    if (!same) {
      fprintf(stderr, "DIFF value c_relen=%d r_relen=%d size=%zu\n",
              c.relen, r.relen, size);
      if (g_strict) abort();
    }
  }
  return 0;
}

// ---- term mutator: build valid-ish OPC-UA Variant encodings ----
// Variant wire format: byte0 = encoding mask (bits 0-5 = built-in type id 1..25,
// bit6 = has array dimensions, bit7 = is array), then (if array) Int32 length,
// then the encoded value(s). Templates produce well-formed scalars/arrays so
// inputs reach deep into the per-type decoders; corruption exercises the
// length/mask/dimension paths.
static uint64_t g_rng;
static uint32_t rnd() {
  g_rng ^= g_rng << 13; g_rng ^= g_rng >> 7; g_rng ^= g_rng << 17;
  return (uint32_t)g_rng;
}
static void put_i32(std::vector<uint8_t> &b, int32_t v) {
  for (int i = 0; i < 4; i++) b.push_back((uint8_t)(v >> (8 * i)));
}
static int scalar_width(uint8_t t) {
  switch (t) {
    case 1: case 2: case 3: return 1;
    case 4: case 5: return 2;
    case 6: case 7: case 10: return 4;
    case 8: case 9: case 11: case 13: return 8;
    default: return 0;   // variable/complex: length-prefixed body below
  }
}
extern "C" size_t LLVMFuzzerMutate(uint8_t *, size_t, size_t);
extern "C" size_t LLVMFuzzerCustomMutator(uint8_t *data, size_t size,
                                          size_t maxsize, unsigned seed) {
  g_rng = seed ? seed : 0x9e3779b97f4a7c15ull;
  if ((rnd() & 1) == 0) return LLVMFuzzerMutate(data, size, maxsize);

  std::vector<uint8_t> b;
  uint8_t t = (uint8_t)(1 + rnd() % 25);
  bool is_array = (rnd() & 1);
  bool has_dims = is_array && (rnd() & 3) == 0;
  uint8_t mask = (uint8_t)(t | (is_array ? 0x80 : 0) | (has_dims ? 0x40 : 0));
  b.push_back(mask);
  int w = scalar_width(t);
  if (is_array) {
    int32_t n = (int32_t)(rnd() % 8);
    if ((rnd() & 7) == 0) n = (int32_t)rnd();          // hostile length
    put_i32(b, n);
    for (int i = 0; i < n && i < 8 && w; i++)
      for (int k = 0; k < w; k++) b.push_back((uint8_t)rnd());
    if (has_dims) put_i32(b, (int32_t)(rnd() % 4));
  } else if (w) {
    for (int k = 0; k < w; k++) b.push_back((uint8_t)rnd());
  } else {
    int32_t n = (int32_t)(rnd() % 10) - 1;             // includes -1 (null)
    put_i32(b, n);
    for (int i = 0; i < n && i < 16; i++) b.push_back((uint8_t)rnd());
  }
  switch (rnd() % 8) {
    case 0: if (!b.empty()) b[0] = (uint8_t)rnd(); break;
    case 1: if (b.size() > 1) b[1] ^= 0xff; break;
    case 2: if (!b.empty()) b.resize(1 + rnd() % b.size()); break;
    case 3: for (int i = 0, n = rnd() % 4; i < n; i++) b.push_back((uint8_t)rnd()); break;
    default: break;
  }
  if (b.size() > maxsize) b.resize(maxsize);
  memcpy(data, b.data(), b.size());
  return b.size();
}
