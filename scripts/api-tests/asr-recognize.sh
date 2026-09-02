#!/usr/bin/env bash

# 上传音频到主服务器 ASR 接口并输出识别结果。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

show_help() {
    cat <<'EOF'
用法：asr-recognize.sh --audio FILE

调用 POST /api/asr/recognize，以 multipart 字段 audio 上传音频。
环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS
EOF
}

if [[ "${1:-}" == "--help" || "$#" -eq 0 ]]; then
    show_help
    [[ "$#" -eq 0 ]] && exit 2 || exit 0
fi

audio_path=""
while (( $# > 0 )); do
    case "$1" in
        --audio)
            [[ $# -ge 2 ]] || api_die '--audio 缺少参数'
            audio_path="$2"
            shift 2
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            api_die "未知参数：$1"
            ;;
    esac
done

[[ -n "$audio_path" ]] || api_die '必须指定 --audio'
api_require_file "$audio_path"
api_request POST /api/asr/recognize --form "audio=@${audio_path}"
