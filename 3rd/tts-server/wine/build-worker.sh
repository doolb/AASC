#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_ROOT="${SDK_ROOT:-$ROOT/runtime/sdk-win41}"
WINE_BIN_DIR="${WINE_BIN_DIR:-$ROOT/bin}"
export TMPDIR="${TMPDIR:-$ROOT/.tmp}"

INCLUDE_DIR="$SDK_ROOT/speech/build/native/include/c_api"
LIB_DIR="$SDK_ROOT/speech/build/native/x64/Release"
EMBEDDED_LIB_DIR="$SDK_ROOT/embedded/build/native/x64/Release"
ONNX_LIB_DIR="$SDK_ROOT/onnx/build/native/x64/Release"
TELEMETRY_LIB_DIR="$SDK_ROOT/telemetry/build/native/x64/Release"

mkdir -p "$WINE_BIN_DIR"
mkdir -p "$TMPDIR"

x86_64-w64-mingw32-g++ \
  -std=c++17 -O2 -Wall -Wextra \
  -I"$INCLUDE_DIR" \
  -I"$SDK_ROOT/speech/build/native/include/cxx_api" \
  -L"$LIB_DIR" \
  -L"$EMBEDDED_LIB_DIR" \
  -L"$ONNX_LIB_DIR" \
  -L"$TELEMETRY_LIB_DIR" \
  "$ROOT/worker_tts_windows.cpp" \
  -o "$WINE_BIN_DIR/worker_tts_windows.exe" \
  -lMicrosoft.CognitiveServices.Speech.core \
  -lMicrosoft.CognitiveServices.Speech.extension.embedded.tts \
  -lMicrosoft.CognitiveServices.Speech.extension.onnxruntime \
  -lMicrosoft.CognitiveServices.Speech.extension.telemetry \
  -static-libgcc -static-libstdc++ \
  -lole32 -lwinmm -lws2_32 -lcrypt32 -lrpcrt4

echo "built $WINE_BIN_DIR/worker_tts_windows.exe"

MINGW_BIN_DIR="$(cd "$(dirname "$(command -v x86_64-w64-mingw32-g++)")/../x86_64-w64-mingw32/bin" && pwd)"
cp -f "$MINGW_BIN_DIR/libwinpthread-1.dll" "$WINE_BIN_DIR/libwinpthread-1.dll"
echo "staged $WINE_BIN_DIR/libwinpthread-1.dll"
