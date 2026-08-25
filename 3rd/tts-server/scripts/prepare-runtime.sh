#!/usr/bin/env bash
set -euo pipefail

# 该脚本只负责准备 TTS 运行时，不删除旧适配器目录或任何已有运行时目录。
# SDK 从 Microsoft 官方下载入口获取；Wine prefix 使用 wineboot 创建，避免把旧 prefix 当成运行依赖。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LINUX_SDK_VERSION="${LINUX_SDK_VERSION:-1.51.2}"
LINUX_SDK_URL="${LINUX_SDK_URL:-https://aka.ms/csspeech/linuxembeddedbinary}"
LINUX_SDK_SHA256="${LINUX_SDK_SHA256:-}"
SDK_ARCHIVE_DIR="${SDK_ARCHIVE_DIR:-$ROOT/sdk-archives}"
LINUX_SDK_DIR="${LINUX_SDK_DIR:-$ROOT/linux/sdk/SpeechSDK-Embedded-Linux-$LINUX_SDK_VERSION}"

WINE_SDK_VERSION="${WINE_SDK_VERSION:-1.51.2}"
WINE_SDK_DIR="${WINE_SDK_DIR:-$ROOT/wine/runtime/sdk-win41}"
WINE_SDK_SHA256_SPEECH="${WINE_SDK_SHA256_SPEECH:-}"
WINE_SDK_SHA256_EMBEDDED_TTS="${WINE_SDK_SHA256_EMBEDDED_TTS:-}"
WINE_SDK_SHA256_ONNX="${WINE_SDK_SHA256_ONNX:-}"
WINE_SDK_SHA256_TELEMETRY="${WINE_SDK_SHA256_TELEMETRY:-}"
WINE_SPEECH_URL="${WINE_SPEECH_URL:-https://www.nuget.org/api/v2/package/Microsoft.CognitiveServices.Speech/${WINE_SDK_VERSION}}"
WINE_EMBEDDED_TTS_URL="${WINE_EMBEDDED_TTS_URL:-https://www.nuget.org/api/v2/package/Microsoft.CognitiveServices.Speech.Extension.Embedded.TTS/${WINE_SDK_VERSION}}"
WINE_ONNX_URL="${WINE_ONNX_URL:-https://www.nuget.org/api/v2/package/Microsoft.CognitiveServices.Speech.Extension.ONNX.Runtime/${WINE_SDK_VERSION}}"
WINE_TELEMETRY_URL="${WINE_TELEMETRY_URL:-https://www.nuget.org/api/v2/package/Microsoft.CognitiveServices.Speech.Extension.Telemetry/${WINE_SDK_VERSION}}"

WINE_PREFIX_DIR="${WINE_PREFIX_DIR:-$ROOT/wine/runtime/prefix}"
WINE_BIN_DIR="${WINE_BIN_DIR:-$ROOT/wine/bin}"
MODEL_DIR="${MODEL_DIR:-$ROOT/models/extracted}"
CACHE_DIR="${CACHE_DIR:-$ROOT/.cache/tts-runtime}"
LINUX_BUILD_DIR="${LINUX_BUILD_DIR:-$CACHE_DIR/build/linux}"
TEST_DIR="${TEST_DIR:-$CACHE_DIR/test}"
AASC_TTS_TMPDIR="${AASC_TTS_TMPDIR:-$CACHE_DIR/tmp}"

DRY_RUN=0
PREPARE_ONLY=0
BUILD_ONLY=0
TEST_ONLY=0
SKIP_TEST=0
FORCE=0
ALLOW_TEST_FAILURE=0
SERVER_PIDS=()

print_usage() {
    cat <<'USAGE'
用法：
  bash 3rd/tts-server/scripts/prepare-runtime.sh [选项]

选项：
  --dry-run             只打印下载、生成、构建和测试计划，不修改运行时
  --prepare-only       只下载 SDK 并生成 Wine prefix
  --build-only         准备运行时后只编译 Linux/Wine 二进制
  --test-only          使用现有运行时，只执行 Linux/Wine 测试
  --skip-test          准备和构建后跳过真实 WAV 测试
  --allow-test-failure 真实合成失败时打印结果但返回成功（适合 AVX 不兼容主机）
  --force               将已有 SDK 目录移动到缓存备份后重新准备
  -h, --help            显示帮助

可覆盖变量：
  LINUX_SDK_URL、LINUX_SDK_SHA256、WINE_*_URL、WINE_*_SHA256、SDK_ARCHIVE_DIR
  LINUX_SDK_DIR、WINE_SDK_DIR、WINE_PREFIX_DIR、WINE_BIN_DIR、MODEL_DIR、CACHE_DIR、AASC_TTS_TMPDIR
USAGE
}

log() {
    printf '[prepare-runtime] %s\n' "$*"
}

run_command() {
    local label="$1"
    shift
    if ((DRY_RUN)); then
        printf '[dry-run] %s:' "$label"
        printf ' %q' "$@"
        printf '\n'
        return 0
    fi
    log "$label"
    "$@"
}

require_command() {
    local command_name="$1"
    if ! command -v "$command_name" >/dev/null 2>&1; then
        printf '缺少命令: %s\n' "$command_name" >&2
        exit 1
    fi
}

cleanup() {
    local pid
    for pid in "${SERVER_PIDS[@]:-}"; do
        if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
            kill "$pid" >/dev/null 2>&1 || true
            wait "$pid" >/dev/null 2>&1 || true
        fi
    done
    if [[ -n "${WORK_DIR:-}" && -d "$WORK_DIR" ]]; then
        rm -rf -- "$WORK_DIR"
    fi
}
trap cleanup EXIT INT TERM

ensure_directory() {
    if ((DRY_RUN == 0)); then
        mkdir -p "$1"
    fi
}

download_file() {
    local label="$1"
    local url="$2"
    local destination="$3"
    local expected_sha256="$4"
    local temporary_file="${destination}.part"

    ensure_directory "$(dirname "$destination")"
    if [[ -s "$destination" && "$FORCE" -eq 0 ]]; then
        log "$label 已存在，跳过下载: $destination"
    else
        run_command "$label" curl --fail --location --retry 3 --connect-timeout 30 --output "$temporary_file" "$url"
        if ((DRY_RUN == 0)); then
            mv -f -- "$temporary_file" "$destination"
        fi
    fi

    if ((DRY_RUN)); then
        return 0
    fi
    if [[ -n "$expected_sha256" ]]; then
        printf '%s  %s\n' "$expected_sha256" "$destination" | sha256sum --check --strict
    else
        log "$label SHA256: $(sha256sum "$destination" | awk '{print $1}')"
    fi
}

backup_existing_directory() {
    local destination="$1"
    if [[ ! -e "$destination" || "$FORCE" -eq 0 ]]; then
        return 0
    fi
    local backup_directory="$CACHE_DIR/backups/$(basename "$destination").$(date +%Y%m%d%H%M%S)"
    mkdir -p "$(dirname "$backup_directory")"
    mv -- "$destination" "$backup_directory"
    log "已有目录已移动到可恢复备份: $backup_directory"
}

directory_has_file() {
    [[ -f "$1" ]]
}

prepare_linux_sdk() {
    local archive="$SDK_ARCHIVE_DIR/SpeechSDK-Embedded-Linux-${LINUX_SDK_VERSION}.tar.gz"
    download_file download-linux-sdk "$LINUX_SDK_URL" "$archive" "$LINUX_SDK_SHA256"
    if directory_has_file "$LINUX_SDK_DIR/include/cxx_api/speechapi_cxx.h" \
        && directory_has_file "$LINUX_SDK_DIR/lib/x64/libMicrosoft.CognitiveServices.Speech.core.so" \
        && [[ "$FORCE" -eq 0 ]]; then
        log "Linux SDK 已就绪: $LINUX_SDK_DIR"
        return 0
    fi

    if ((DRY_RUN)); then
        run_command extract-linux-sdk tar --strip-components=1 -xzf "$archive" -C "$LINUX_SDK_DIR"
        return 0
    fi

    WORK_DIR="$(mktemp -d "$CACHE_DIR/linux-sdk.XXXXXX")"
    tar --strip-components=1 -xzf "$archive" -C "$WORK_DIR"
    directory_has_file "$WORK_DIR/include/cxx_api/speechapi_cxx.h"
    directory_has_file "$WORK_DIR/lib/x64/libMicrosoft.CognitiveServices.Speech.core.so"
    backup_existing_directory "$LINUX_SDK_DIR"
    mkdir -p "$(dirname "$LINUX_SDK_DIR")"
    mv -- "$WORK_DIR" "$LINUX_SDK_DIR"
    WORK_DIR=''
    log "Linux SDK 已准备: $LINUX_SDK_DIR"
}

prepare_wine_package() {
    local label="$1"
    local url="$2"
    local checksum="$3"
    local package_directory="$4"
    local marker="$5"
    local archive="$SDK_ARCHIVE_DIR/${package_directory}-${WINE_SDK_VERSION}.nupkg"

    download_file "download-wine-sdk-$package_directory" "$url" "$archive" "$checksum"

    if directory_has_file "$WINE_SDK_DIR/$package_directory/$marker" && [[ "$FORCE" -eq 0 ]]; then
        log "Wine SDK 组件已就绪: $package_directory"
        return 0
    fi

    if ((DRY_RUN)); then
        run_command "extract-wine-sdk-$package_directory" unzip -q "$archive" -d "$WINE_SDK_DIR/$package_directory"
        return 0
    fi

    WORK_DIR="$(mktemp -d "$CACHE_DIR/wine-sdk.XXXXXX")"
    unzip -q "$archive" -d "$WORK_DIR"
    directory_has_file "$WORK_DIR/$marker"
    backup_existing_directory "$WINE_SDK_DIR/$package_directory"
    mkdir -p "$WINE_SDK_DIR"
    mv -- "$WORK_DIR" "$WINE_SDK_DIR/$package_directory"
    WORK_DIR=''
    log "Wine SDK 组件已准备: $package_directory"
}

prepare_wine_sdk() {
    prepare_wine_package speech "$WINE_SPEECH_URL" "$WINE_SDK_SHA256_SPEECH" speech build/native/include/c_api/speechapi_c.h
    prepare_wine_package embedded "$WINE_EMBEDDED_TTS_URL" "$WINE_SDK_SHA256_EMBEDDED_TTS" embedded runtimes/win-x64/native/Microsoft.CognitiveServices.Speech.extension.embedded.tts.dll
    prepare_wine_package onnx "$WINE_ONNX_URL" "$WINE_SDK_SHA256_ONNX" onnx runtimes/win-x64/native/Microsoft.CognitiveServices.Speech.extension.onnxruntime.dll
    prepare_wine_package telemetry "$WINE_TELEMETRY_URL" "$WINE_SDK_SHA256_TELEMETRY" telemetry runtimes/win-x64/native/Microsoft.CognitiveServices.Speech.extension.telemetry.dll
}

prepare_wine_prefix() {
    if directory_has_file "$WINE_PREFIX_DIR/user.reg" && directory_has_file "$WINE_PREFIX_DIR/system.reg" && [[ "$FORCE" -eq 0 ]]; then
        log "Wine prefix 已就绪: $WINE_PREFIX_DIR"
        return 0
    fi
    ensure_directory "$(dirname "$WINE_PREFIX_DIR")"
    backup_existing_directory "$WINE_PREFIX_DIR"
    run_command wineboot-init env WINEARCH=win64 WINEPREFIX="$WINE_PREFIX_DIR" wineboot --init
}

build_linux() {
    require_command cmake
    ensure_directory "$LINUX_BUILD_DIR"
    run_command configure-linux cmake -S "$ROOT/linux" -B "$LINUX_BUILD_DIR" -DSPEECH_SDK_DIR="$LINUX_SDK_DIR"
    run_command build-linux cmake --build "$LINUX_BUILD_DIR" -j2
}

build_wine() {
    require_command x86_64-w64-mingw32-g++
    run_command build-wine env SDK_ROOT="$WINE_SDK_DIR" WINE_BIN_DIR="$WINE_BIN_DIR" bash "$ROOT/wine/build-worker.sh"
}

stage_wine_runtime_dlls() {
    local dll_source
    local dll_name
    local -a dll_sources=(
        "$WINE_SDK_DIR/speech/runtimes/win-x64/native/Microsoft.CognitiveServices.Speech.core.dll"
        "$WINE_SDK_DIR/embedded/runtimes/win-x64/native/Microsoft.CognitiveServices.Speech.extension.embedded.tts.dll"
        "$WINE_SDK_DIR/onnx/runtimes/win-x64/native/Microsoft.CognitiveServices.Speech.extension.onnxruntime.dll"
        "$WINE_SDK_DIR/telemetry/runtimes/win-x64/native/Microsoft.CognitiveServices.Speech.extension.telemetry.dll"
    )

    ensure_directory "$WINE_BIN_DIR"
    for dll_source in "${dll_sources[@]}"; do
        dll_name="$(basename "$dll_source")"
        if ((DRY_RUN)); then
            run_command "stage-wine-runtime-$dll_name" cp -f "$dll_source" "$WINE_BIN_DIR/$dll_name"
            continue
        fi
        [[ -f "$dll_source" ]]
        cp -f -- "$dll_source" "$WINE_BIN_DIR/$dll_name"
        [[ -s "$WINE_BIN_DIR/$dll_name" ]]
    done
    log "Wine SDK x64 DLL 已部署到: $WINE_BIN_DIR"
}

wait_for_server() {
    local port="$1"
    local attempt
    for attempt in $(seq 1 60); do
        if curl --fail --silent "http://127.0.0.1:$port/api/tts/status" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

post_tts_and_check_wav() {
    local label="$1"
    local port="$2"
    local output="$3"
    local response_code
    response_code="$(curl --silent --show-error --output "$output" --write-out '%{http_code}' \
        --header 'Content-Type: application/json' \
        --data '{"text":"运行时准备脚本测试"}' \
        "http://127.0.0.1:$port/api/tts")"
    if [[ "$response_code" != '200' ]]; then
        log "$label HTTP 测试失败，状态码: $response_code"
        return 1
    fi
    if ! file "$output" | grep -q 'WAVE audio'; then
        log "$label 输出不是 WAV: $output"
        return 1
    fi
    log "$label WAV 测试通过: $output"
}

test_linux() {
    require_command curl
    require_command file
    ensure_directory "$TEST_DIR"
    local port="${LINUX_TEST_PORT:-3302}"
    local log_file="$TEST_DIR/linux-server.log"
    local output="$TEST_DIR/linux.wav"
    if ((DRY_RUN)); then
        run_command test-linux env PORT="$port" TTS_LINUX_BIN="$LINUX_BUILD_DIR/tts_linux" TTS_LINUX_MODEL_DIR="$MODEL_DIR" TTS_LINUX_SDK_DIR="$LINUX_SDK_DIR/lib/x64" node "$ROOT/tts-linux.js"
        return 0
    fi

    PORT="$port" TTS_LINUX_BIN="$LINUX_BUILD_DIR/tts_linux" TTS_LINUX_MODEL_DIR="$MODEL_DIR" TTS_LINUX_SDK_DIR="$LINUX_SDK_DIR/lib/x64" node "$ROOT/tts-linux.js" >"$log_file" 2>&1 &
    SERVER_PIDS+=("$!")
    wait_for_server "$port"
    post_tts_and_check_wav Linux "$port" "$output"
}

test_wine() {
    require_command curl
    require_command file
    ensure_directory "$TEST_DIR"
    local port="${WINE_TEST_PORT:-3301}"
    local log_file="$TEST_DIR/wine-server.log"
    local output="$TEST_DIR/wine.wav"
    if ((DRY_RUN)); then
        run_command test-wine env PORT="$port" WINEPREFIX="$WINE_PREFIX_DIR" WINE_BIN_DIR="$WINE_BIN_DIR" node "$ROOT/tts-wine.js"
        return 0
    fi

    PORT="$port" WINEPREFIX="$WINE_PREFIX_DIR" WINE_BIN_DIR="$WINE_BIN_DIR" node "$ROOT/tts-wine.js" >"$log_file" 2>&1 &
    SERVER_PIDS+=("$!")
    wait_for_server "$port"
    post_tts_and_check_wav Wine "$port" "$output"
}

run_stage() {
    if ((TEST_ONLY == 0)); then
        prepare_linux_sdk
        prepare_wine_sdk
        prepare_wine_prefix
    fi
    if ((PREPARE_ONLY)); then
        return 0
    fi
    if ((TEST_ONLY == 0)); then
        build_linux
        build_wine
        stage_wine_runtime_dlls
    fi
    if ((BUILD_ONLY || SKIP_TEST)); then
        return 0
    fi
    if ((ALLOW_TEST_FAILURE)); then
        test_linux || log "Linux WAV 测试失败，按 --allow-test-failure 继续"
        test_wine || log "Wine WAV 测试失败，按 --allow-test-failure 继续"
        return 0
    fi
    test_linux
    test_wine
}

while (($# > 0)); do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --prepare-only) PREPARE_ONLY=1 ;;
        --build-only) BUILD_ONLY=1 ;;
        --test-only) TEST_ONLY=1 ;;
        --skip-test) SKIP_TEST=1 ;;
        --allow-test-failure) ALLOW_TEST_FAILURE=1 ;;
        --force) FORCE=1 ;;
        -h|--help) print_usage; exit 0 ;;
        *) printf '未知选项: %s\n' "$1" >&2; print_usage >&2; exit 2 ;;
    esac
    shift
done

if ((DRY_RUN == 0)); then
    require_command curl
    require_command tar
    require_command unzip
    require_command wineboot
    if ((TEST_ONLY == 0)); then
        mkdir -p "$SDK_ARCHIVE_DIR"
    fi
    mkdir -p "$AASC_TTS_TMPDIR"
    export TMPDIR="$AASC_TTS_TMPDIR"
fi

run_stage
log '运行时准备流程结束'
