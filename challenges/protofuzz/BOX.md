# Running protofuzz on a boxctl box

Long campaigns run on a `boxctl` job-agent box. Two environment limits apply
and are the operator's to resolve (an agent under auto-mode cannot mutate a
shared box, and cannot exceed the active-box quota):

- **Box quota.** `boxctl create box` fails with `active box quota exceeded: 6`
  when 6 boxes already exist. Either reuse an idle box (`boxctl get boxes`) or
  free one first.
- **Shared-resource writes.** A job that `sudo apt-get install`s or builds on a
  shared box is a shared-resource mutation; run these yourself (in Claude Code,
  prefix with `!`) or grant a `Bash(boxctl run:*)` permission rule.

## 1. Pick/create a box

```
boxctl get boxes                       # reuse an idle fuzzing box, or:
boxctl create box --name protofuzz --keep-alive 12h --job-agent --wait
boxctl ctx <box>
```

## 2. Bootstrap (installs clang/go, builds the C target with ASan)

`boxctl run bootstrap.sh --context <box>` where bootstrap.sh does, for hpack:

```
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo apt-get install -y clang lld llvm cmake ninja-build pkg-config golang-go build-essential autoconf automake libtool git
. ~/.cargo/env
mkdir -p ~/pf/src && cd ~/pf/src
git clone --depth 1 https://github.com/nghttp2/nghttp2 && cd nghttp2
autoreconf -i && ./configure --enable-lib-only --enable-static --disable-shared --disable-threads \
  CC=clang CFLAGS="-g -O1 -fsanitize=fuzzer-no-link,address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined"
make -C lib -j"$(nproc)"
```

## 3. Build + run (jobs)

Copy the target dir to the box (git clone your branch, or heredoc the files in
the job), then:

```
NGHTTP2=~/pf/src/nghttp2 OUT=~/pf/build bash ~/pf/hpack/build.sh
# memory-safety campaign (highest signal), 12 workers:
PF_CONLY=1 PF_NOABORT=1 SECS=36000 JOBS=12 OUT=~/pf/build bash ~/pf/hpack/run.sh
# differential campaign:
SECS=7200 JOBS=12 OUT=~/pf/build bash ~/pf/hpack/run.sh
```

Fuzz jobs are long; each occupies the box's serial job queue, so use a
dedicated box. Pull `~/pf/<target>/findings/` back for triage.

## OPC-UA (4th target): open62541 vs async-opcua

open62541 must be built with the function-type UBSan check made *recoverable*
(its decoder dispatches every per-type decode through one generic function
pointer — benign type-punning that `-fsanitize=function` flags on every decode):

```
SAN="-g -O1 -fsanitize=fuzzer-no-link,address,undefined -fno-omit-frame-pointer \
  -fno-sanitize-recover=undefined -fsanitize-recover=function"
cd ~/pf/src/open62541 && rm -rf build && mkdir build && cd build
cmake -GNinja -DBUILD_SHARED_LIBS=OFF -DUA_ENABLE_AMALGAMATION=OFF \
  -DCMAKE_BUILD_TYPE=Debug -DUA_LOGLEVEL=600 \
  -DCMAKE_C_COMPILER=clang -DCMAKE_C_FLAGS="$SAN" .. && ninja
```

Real UBSan checks (bounds/overflow/shift/alignment) and ASan stay fatal; the
function check logs once and continues. The box's clang emits LLVM bitcode, so
the harness links the archive with `-fuse-ld=lld`.

```
O62=~/pf/src/open62541 OUT=~/pf/build/opcua bash ~/pf-repo/challenges/protofuzz/opcua/build.sh
# differential campaign (every divergence saved as a reproducer):
UBSAN_OPTIONS=halt_on_error=0:print_stacktrace=1 \
  PF_STRICT=1 SECS=1200 OUT=~/pf/build/opcua bash ~/pf-repo/challenges/protofuzz/opcua/run.sh
# memory-safety campaign:
PF_CONLY=1 SECS=36000 OUT=~/pf/build/opcua bash ~/pf-repo/challenges/protofuzz/opcua/run.sh
```
