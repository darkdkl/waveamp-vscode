#!/usr/bin/env bash
set -euo pipefail

FAAD_VERSION="2.11.4"
EMSDK_VERSION="6.0.11"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/vendor/faad2"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAAD_SRC="${FAAD_SRC:-$WORK/faad2}"
EMSDK_DIR="${EMSDK_DIR:-$WORK/emsdk}"

if [ ! -d "$FAAD_SRC" ]; then
  git clone --quiet --depth 1 --branch "$FAAD_VERSION" https://github.com/knik0/faad2.git "$FAAD_SRC"
fi
if [ ! -d "$EMSDK_DIR" ]; then
  git clone --quiet --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
  "$EMSDK_DIR/emsdk" install "$EMSDK_VERSION" > /dev/null
fi
"$EMSDK_DIR/emsdk" activate "$EMSDK_VERSION" > /dev/null
source "$EMSDK_DIR/emsdk_env.sh" > /dev/null 2>&1

EXPORTS='["_wa_open","_wa_init_config","_wa_init_stream","_wa_decode","_wa_reset","_wa_init_rate","_wa_init_channels","_wa_consumed","_wa_samples","_wa_channels","_wa_rate","_wa_error","_wa_close","_malloc","_free"]'

mkdir -p "$OUT"
emcc -O3 \
  -DLC_ONLY_DECODER -DDISABLE_SBR \
  -DHAVE_INTTYPES_H=1 -DHAVE_MEMCPY=1 -DHAVE_STRING_H=1 -DHAVE_STRINGS_H=1 \
  -DHAVE_SYS_STAT_H=1 -DHAVE_SYS_TYPES_H=1 -DHAVE_LRINTF=1 \
  -DPACKAGE_VERSION="\"$FAAD_VERSION\"" \
  -I "$FAAD_SRC/include" -I "$FAAD_SRC/libfaad" \
  "$FAAD_SRC"/libfaad/*.c "$ROOT/scripts/faad/wrapper.c" \
  -s MODULARIZE=1 -s EXPORT_NAME=createFaad -s ENVIRONMENT=node \
  -s ALLOW_MEMORY_GROWTH=1 -s FILESYSTEM=0 \
  -s EXPORTED_FUNCTIONS="$EXPORTS" -s EXPORTED_RUNTIME_METHODS='["HEAPU8","HEAP16"]' \
  -o "$OUT/faad.cjs"

cp "$FAAD_SRC/COPYING" "$OUT/COPYING"
printf '%s\n' "$FAAD_VERSION" > "$OUT/VERSION.txt"
echo "Built $OUT/faad.cjs and $OUT/faad.wasm (FAAD2 $FAAD_VERSION, AAC-LC only)"
