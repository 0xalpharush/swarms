// Sanitizer + structure-aware fuzzing of opendnp3 (C++) via the public Decoder,
// which runs the full link -> transport -> application parse chain on raw bytes
// (opendnp3's own `decoder` tool entry). The term mutator builds DNP3 link
// frames with correct CRCs so inputs pass the link layer and reach the
// transport/app parsers; it also corrupts CRC/len/ctrl to exercise link
// robustness. A sanitizer fault in opendnp3 is the finding.
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <opendnp3/ConsoleLogger.h>
#include <opendnp3/decoder/Decoder.h>
#include <opendnp3/logging/LogLevels.h>

using namespace opendnp3;

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
  static Logger logger(ConsoleLogger::Create(), ModuleId(), "fz", LogLevels(0));
  IDecoderCallbacks cb;
  Decoder decoder(cb, logger);  // fresh transport/app state per input
  decoder.DecodeLPDU(Buffer(data, size));
  return 0;
}

// ---- DNP3 CRC (poly 0x3D65, reflected; xorout 0xFFFF), little-endian ----
static uint16_t dnp_crc(const uint8_t *b, size_t n) {
  uint16_t crc = 0;
  for (size_t i = 0; i < n; i++) {
    crc ^= b[i];
    for (int j = 0; j < 8; j++)
      crc = (crc & 1) ? (uint16_t)((crc >> 1) ^ 0xA6BC) : (uint16_t)(crc >> 1);
  }
  return (uint16_t)(~crc & 0xFFFF);
}
static void put_crc(std::vector<uint8_t> &f, size_t from, size_t to) {
  uint16_t c = dnp_crc(&f[from], to - from);
  f.push_back((uint8_t)(c & 0xff));
  f.push_back((uint8_t)(c >> 8));
}

static uint64_t g_rng;
static uint32_t rnd() {
  g_rng ^= g_rng << 13; g_rng ^= g_rng >> 7; g_rng ^= g_rng << 17;
  return (uint32_t)g_rng;
}

// assemble a valid DNP3 link frame around an application payload (transport
// header prepended): 0x0564 len ctrl dst(2) src(2) hdrCRC, then 16-byte data
// blocks each with a CRC.
static std::vector<uint8_t> frame(const std::vector<uint8_t> &app, uint8_t ctrl,
                                  uint16_t dst, uint16_t src, uint8_t tport) {
  std::vector<uint8_t> body;
  body.push_back(tport);
  body.insert(body.end(), app.begin(), app.end());
  std::vector<uint8_t> f;
  f.push_back(0x05); f.push_back(0x64);
  f.push_back((uint8_t)(5 + body.size()));  // len: ctrl+dst+src+body
  f.push_back(ctrl);
  f.push_back((uint8_t)(dst & 0xff)); f.push_back((uint8_t)(dst >> 8));
  f.push_back((uint8_t)(src & 0xff)); f.push_back((uint8_t)(src >> 8));
  put_crc(f, 0, 8);
  for (size_t off = 0; off < body.size(); off += 16) {
    size_t n = body.size() - off; if (n > 16) n = 16;
    size_t from = f.size();
    f.insert(f.end(), body.begin() + off, body.begin() + off + n);
    put_crc(f, from, from + n);
  }
  return f;
}

// canonical application payloads (app control + function + objects).
static const std::vector<std::vector<uint8_t>> &apps() {
  static std::vector<std::vector<uint8_t>> t = {
      {0xC0, 0x01},                               // READ, no objects
      {0xC0, 0x01, 0x01, 0x00, 0x00, 0x3C, 0x02}, // READ class-ish header
      {0xC0, 0x02, 0x32, 0x01, 0x07, 0x01, 0x00}, // WRITE time obj (g50v1)
      {0xC0, 0x05, 0x0C, 0x01, 0x17, 0x01, 0x01}, // DIRECT_OPERATE CROB-ish
      {0xC0, 0x14},                               // CONFIRM-ish
      {0xC0, 0x00},                               // unknown function
  };
  return t;
}

extern "C" size_t LLVMFuzzerMutate(uint8_t *, size_t, size_t);
extern "C" size_t LLVMFuzzerCustomMutator(uint8_t *data, size_t size,
                                          size_t maxsize, unsigned seed) {
  g_rng = seed ? seed : 0x9e3779b97f4a7c15ull;
  if ((rnd() & 1) == 0) return LLVMFuzzerMutate(data, size, maxsize);

  // build a fresh valid-ish frame from a template app, then maybe corrupt it.
  std::vector<uint8_t> app = apps()[rnd() % apps().size()];
  // perturb the app payload at the term level
  if (!app.empty() && (rnd() & 1)) {
    size_t i = rnd() % app.size();
    app[i] ^= (uint8_t)(1u << (rnd() % 8));
  }
  if ((rnd() & 3) == 0)  // append a random object byte or two
    for (int i = 0, n = 1 + rnd() % 6; i < n && app.size() < 240; i++)
      app.push_back((uint8_t)rnd());

  uint8_t ctrl = (rnd() & 1) ? 0x44 : (uint8_t)rnd();        // PRM+FC4, or random
  uint8_t tport = (rnd() & 1) ? 0xC0 : (uint8_t)rnd();       // FIR+FIN seq0, or random
  std::vector<uint8_t> f = frame(app, ctrl, (uint16_t)(rnd()), (uint16_t)(rnd()), tport);

  // deliberate link-layer corruptions to exercise CRC/len paths
  switch (rnd() % 8) {
    case 0: if (f.size() > 2) f[2] = (uint8_t)rnd(); break;     // len
    case 1: if (f.size() > 8) f[8] ^= 0xff; break;              // header CRC
    case 2: if (!f.empty()) f.resize(1 + rnd() % f.size()); break; // truncate
    case 3: f[3] = (uint8_t)rnd(); break;                       // ctrl
    default: break;                                             // keep valid
  }
  if (f.size() > maxsize) f.resize(maxsize);
  memcpy(data, f.data(), f.size());
  return f.size();
}
