#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${OUT:-$HERE/build}"
SECS="${SECS:-120}"
JOBS="${JOBS:-$(nproc)}"
mkdir -p "$HERE/findings"
export ASAN_OPTIONS="${ASAN_OPTIONS:-detect_leaks=0:abort_on_error=1}"
export UBSAN_OPTIONS="${UBSAN_OPTIONS:-print_stacktrace=1}"
echo "[run] fuzzing ${SECS}s x${JOBS} workers  (PF_CONLY=${PF_CONLY:-} PF_STRICT=${PF_STRICT:-})"
"$OUT/opcua-fuzz" -fork="$JOBS" -ignore_crashes=1 -max_total_time="$SECS" \
  -artifact_prefix="$HERE/findings/" -print_final_stats=1 \
  "$HERE/corpus" || true
echo "[run] crashes/mismatches saved:"; ls -1 "$HERE/findings" 2>/dev/null | head
