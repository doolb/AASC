#!/usr/bin/env bash

# 执行不修改服务器状态的常用 API 探测，输出一行一个 JSON 结果。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

show_help() {
    cat <<'EOF'
用法：run-all.sh

探测服务器状态、ASR、TTS、视觉、媒体和系统统计接口。
所有探测均为只读请求；成功输出 JSON Lines，任一接口失败时返回非零状态。
环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS
EOF
}

if [[ "${1:-}" == "--help" ]]; then
    show_help
    exit 0
fi
if (( $# > 0 )); then
    api_die "未知参数：$1"
fi

failed=0
run_probe() {
    local name="$1"
    local route="$2"
    local error_file
    local response
    local error_text
    error_file="$(mktemp "${TMPDIR:-/tmp}/aasc-api-probe.XXXXXX")"
    if response="$(api_request GET "$route" 2>"$error_file")"; then
        printf '{"name":%s,"ok":true,"response":%s}\n' \
            "$(api_json_string "$name")" "$response"
    else
        failed=1
        error_text="$(<"$error_file")"
        printf '{"name":%s,"ok":false,"error":%s}\n' \
            "$(api_json_string "$name")" "$(api_json_string "$error_text")"
    fi
    rm -f "$error_file"
}

run_probe server /api/status
run_probe asr /api/asr/status
run_probe tts /api/tts/config
run_probe vision /api/vision/status
run_probe media /media-list
run_probe actors /api/actors
run_probe system-stats /api/system-stats

exit "$failed"
