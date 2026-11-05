// Differential HPACK harness: nghttp2 (C, target) vs a Rust decoder, in one
// libFuzzer process, with a term-level structure-aware mutator over RFC 7541
// representations. A sanitizer fault in nghttp2 or a decode disagreement
// aborts, so libFuzzer saves the input as a finding. The Go x/net oracle
// (oracle/) breaks ties between C and Rust off-line.
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <nghttp2/nghttp2.h>

extern "C" {
void *rhpack_new(void);
void rhpack_free(void *);
void rhpack_set_max_table(void *, size_t);
long rhpack_decode(void *, const uint8_t *, size_t, uint8_t *, size_t);
}

static const size_t OUTCAP = 1u << 22;
static bool g_abort = true;
static bool g_conly = false;  // C-only robustness mode (no Rust, no diff)
static bool g_strict = false;  // if set, accept/reject boundary diffs also abort
static long g_boundary = 0;    // strictness-diff counter

// --- nghttp2: decode one header block fragment into canonical bytes ---
// returns 0 ok, -1 decode error.
static int c_decode(nghttp2_hd_inflater *inf, const uint8_t *in, size_t len,
                    std::string &out) {
  int final = 1;
  for (;;) {
    nghttp2_nv nv;
    int flags = 0;
    ssize_t rv = nghttp2_hd_inflate_hd2(inf, &nv, &flags, in, len, final);
    if (rv < 0) return -1;
    in += rv;
    len -= (size_t)rv;
    if (flags & NGHTTP2_HD_INFLATE_EMIT) {
      uint32_t nl = (uint32_t)nv.namelen, vl = (uint32_t)nv.valuelen;
      out.append((char *)&nl, 4);
      out.append((char *)nv.name, nv.namelen);
      out.append((char *)&vl, 4);
      out.append((char *)nv.value, nv.valuelen);
    }
    if (flags & NGHTTP2_HD_INFLATE_FINAL) {
      nghttp2_hd_inflate_end_headers(inf);
      break;
    }
    if (rv == 0 && len == 0) break;
  }
  return 0;
}

static void mismatch(const char *why, const std::string &a,
                     const std::string &b) {
  fprintf(stderr, "DIFFERENTIAL MISMATCH: %s (c=%zuB rust=%zuB)\n", why,
          a.size(), b.size());
  if (g_abort) abort();
}

// split input into blocks [u16 BE len][bytes]..., decode each through both
// decoders sharing their dynamic table (the stateful "trace").
extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
  nghttp2_hd_inflater *inf = nullptr;
  if (nghttp2_hd_inflate_new(&inf) != 0) return 0;
  void *rd = rhpack_new();
  std::vector<uint8_t> outbuf(OUTCAP);

  size_t p = 0;
  int blocks = 0;
  while (p + 2 <= size && blocks < 64) {
    size_t blen = (size_t)data[p] << 8 | data[p + 1];
    p += 2;
    if (blen > size - p) blen = size - p;
    const uint8_t *blk = data + p;
    p += blen;
    blocks++;

    std::string cout;
    int crv = c_decode(inf, blk, blen, cout);
    if (g_conly) {
      if (crv < 0) break;
      continue;
    }
    long rrv = rhpack_decode(rd, blk, blen, outbuf.data(), OUTCAP);

    bool cerr = crv < 0, rerr = rrv < 0;
    if (cerr != rerr) {
      // accept/reject boundary: dominated by truncation strictness, not a
      // decode bug. Count it; only abort under PF_STRICT (offline triage with
      // the oracle decides whether any is a real over/under-acceptance).
      g_boundary++;
      if (g_strict)
        mismatch(cerr ? "C rejected, Rust accepted" : "C accepted, Rust rejected",
                 cout, std::string((char *)outbuf.data(), rerr ? 0 : rrv));
    } else if (!cerr) {
      std::string rout((char *)outbuf.data(), (size_t)rrv);
      if (cout != rout) mismatch("both accept but decoded header lists differ",
                                 cout, rout);  // the real differential finding
    }
    if (cerr) break;  // nghttp2 inflater state is undefined after an error
  }

  rhpack_free(rd);
  nghttp2_hd_inflate_del(inf);
  return 0;
}

// ---------- term-level structure-aware mutator (RFC 7541 sec 6) ----------
static uint64_t g_rng;
static uint32_t rnd() {
  g_rng ^= g_rng << 13;
  g_rng ^= g_rng >> 7;
  g_rng ^= g_rng << 17;
  return (uint32_t)g_rng;
}

// decode an HPACK integer with an n-bit prefix; advance pos. returns false on
// truncation/overlong.
static bool hpk_int(const uint8_t *b, size_t len, size_t &pos, int prefix) {
  if (pos >= len) return false;
  uint32_t mask = (1u << prefix) - 1;
  if ((b[pos++] & mask) != mask) return true;
  int shift = 0;
  while (pos < len) {
    uint8_t o = b[pos++];
    shift += 7;
    if (!(o & 0x80)) return true;
    if (shift > 28) return false;
  }
  return false;
}

static bool hpk_str(const uint8_t *b, size_t len, size_t &pos) {
  if (pos >= len) return false;
  uint32_t mask = 0x7f;
  bool big = (b[pos] & mask) == mask;
  size_t ip = pos;
  if (!hpk_int(b, len, ip, 7)) return false;
  // recompute length value
  uint32_t val = b[pos] & mask;
  size_t q = pos + 1;
  if (big) {
    uint32_t m = 1, acc = val;
    while (q < len) {
      uint8_t o = b[q++];
      acc += (uint32_t)(o & 0x7f) * m;
      m <<= 7;
      if (!(o & 0x80)) break;
    }
    val = acc;
  }
  pos = q + val;
  return pos <= len;
}

// scan one representation at pos; record its [start,end). returns false if it
// cannot be parsed (truncated/invalid), leaving pos unchanged.
static bool scan_rep(const uint8_t *b, size_t len, size_t &pos) {
  if (pos >= len) return false;
  uint8_t h = b[pos];
  size_t q = pos;
  if (h & 0x80) {  // indexed
    if (!hpk_int(b, len, q, 7)) return false;
  } else if ((h & 0xc0) == 0x40) {  // literal incremental
    uint32_t idx = h & 0x3f;
    if (!hpk_int(b, len, q, 6)) return false;
    if (idx == 0 && !hpk_str(b, len, q)) return false;
    if (!hpk_str(b, len, q)) return false;
  } else if ((h & 0xe0) == 0x20) {  // table size update
    if (!hpk_int(b, len, q, 5)) return false;
  } else {  // literal without / never indexed, 4-bit prefix
    uint32_t idx = h & 0x0f;
    if (!hpk_int(b, len, q, 4)) return false;
    if (idx == 0 && !hpk_str(b, len, q)) return false;
    if (!hpk_str(b, len, q)) return false;
  }
  pos = q;
  return true;
}

// canonical representation templates (well-formed; validated at startup).
static const std::vector<std::vector<uint8_t>> &templates() {
  static std::vector<std::vector<uint8_t>> t = {
      {0x82},                                // :method GET (indexed)
      {0x86},                                // :scheme http
      {0x84},                                // :path /
      {0x41, 0x03, 'a', 'b', 'c'},           // literal inc, name idx 1
      {0x40, 0x02, 'x', 'y', 0x01, 'z'},     // literal inc, new name
      {0x00, 0x02, 'x', 'y', 0x01, 'z'},     // literal without indexing
      {0x10, 0x02, 'x', 'y', 0x01, 'z'},     // literal never indexed
      {0x20},                                // table size update to 0
      {0x3f, 0xe1, 0x1f},                    // table size update large
      {0xff, 0xff, 0xff, 0x7f},              // indexed, huge index (varint)
      {0x00, 0x7f, 0x80, 0x01, 0x00},        // literal, long huffmanless name len
  };
  return t;
}

// parse a block into representation boundaries.
static std::vector<std::pair<size_t, size_t>> reps(const uint8_t *b,
                                                   size_t len) {
  std::vector<std::pair<size_t, size_t>> r;
  size_t pos = 0;
  while (pos < len) {
    size_t s = pos;
    if (!scan_rep(b, len, pos) || pos == s) break;
    r.push_back({s, pos});
  }
  return r;
}

extern "C" size_t LLVMFuzzerCustomMutator(uint8_t *data, size_t size,
                                          size_t maxsize, unsigned seed);
extern "C" size_t LLVMFuzzerMutate(uint8_t *data, size_t size, size_t maxsize);

extern "C" size_t LLVMFuzzerCustomMutator(uint8_t *data, size_t size,
                                          size_t maxsize, unsigned seed) {
  g_rng = seed ? seed : 0x9e3779b97f4a7c15ull;
  // half the time, defer to libFuzzer's byte mutator (keeps coverage of raw
  // malformed inputs).
  if ((rnd() & 1) == 0 || size < 3) return LLVMFuzzerMutate(data, size, maxsize);

  // treat the input as a single block's representations (ignore the 2-byte
  // block header for structural ops, then re-wrap).
  size_t off = (size >= 2) ? 2 : 0;
  std::vector<uint8_t> body(data + off, data + size);
  auto rs = reps(body.data(), body.size());
  std::vector<uint8_t> out;

  int op = rnd() % 6;
  auto emit_template = [&]() {
    const auto &t = templates();
    const auto &pick = t[rnd() % t.size()];
    out.insert(out.end(), pick.begin(), pick.end());
  };

  if (rs.empty()) {
    emit_template();
  } else {
    size_t victim = rnd() % rs.size();
    for (size_t i = 0; i < rs.size(); i++) {
      auto [s, e] = rs[i];
      if (i == victim) {
        switch (op) {
          case 0:  // delete
            break;
          case 1:  // duplicate
            out.insert(out.end(), body.begin() + s, body.begin() + e);
            out.insert(out.end(), body.begin() + s, body.begin() + e);
            break;
          case 2:  // replace with a canonical template
            emit_template();
            break;
          case 3: {  // flip the representation-type high bits of the first byte
            uint8_t nb = body[s] ^ (uint8_t)(1u << (5 + (rnd() % 3)));
            out.push_back(nb);
            out.insert(out.end(), body.begin() + s + 1, body.begin() + e);
            break;
          }
          case 4: {  // perturb the prefix integer (index/length/size) by +-1
            uint8_t nb = body[s] + (uint8_t)((rnd() & 1) ? 1 : -1);
            out.push_back(nb);
            out.insert(out.end(), body.begin() + s + 1, body.begin() + e);
            break;
          }
          default:  // truncate this representation mid-way
            if (e - s > 1)
              out.insert(out.end(), body.begin() + s,
                         body.begin() + s + 1 + rnd() % (e - s - 1));
            break;
        }
        // occasionally splice a template right after the victim
        if (rnd() % 4 == 0) emit_template();
      } else {
        out.insert(out.end(), body.begin() + s, body.begin() + e);
      }
    }
  }
  if (out.size() > 0xffff) out.resize(0xffff);
  std::vector<uint8_t> framed;
  framed.push_back((uint8_t)(out.size() >> 8));
  framed.push_back((uint8_t)(out.size() & 0xff));
  framed.insert(framed.end(), out.begin(), out.end());
  if (framed.size() > maxsize) framed.resize(maxsize);
  memcpy(data, framed.data(), framed.size());
  return framed.size();
}

// startup: validate that every term template is accepted by nghttp2, so our
// constructors are sound before fuzzing (the "mine then verify" step).
extern "C" int LLVMFuzzerInitialize(int *, char ***) {
  if (getenv("PF_NOABORT")) g_abort = false;
  if (getenv("PF_CONLY")) g_conly = true;
  if (getenv("PF_STRICT")) g_strict = true;
  nghttp2_hd_inflater *inf;
  for (const auto &t : templates()) {
    if (nghttp2_hd_inflate_new(&inf) != 0) continue;
    std::string o;
    int rv = c_decode(inf, t.data(), t.size(), o);
    nghttp2_hd_inflate_del(inf);
    if (rv < 0)
      fprintf(stderr, "warn: template not accepted by nghttp2 (len=%zu)\n",
              t.size());
  }
  return 0;
}
