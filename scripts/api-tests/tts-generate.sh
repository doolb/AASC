#!/usr/bin/env bash

# 调用主服务器 TTS 生成接口，只返回生成结果，不自动播放。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

show_help() {
    cat <<'EOF'
用法：tts-generate.sh --text TEXT [--voice VOICE] [--speed NUMBER]

调用 POST /api/tts/generate，成功时输出包含 audioUrl 的 JSON。
环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS
EOF
}

if [[ "${1:-}" == "--help" || "$#" -eq 0 ]]; then
    show_help
    [[ "$#" -eq 0 ]] && exit 2 || exit 0
fi

text_value=""
voice_value=""
speed_value=""
while (( $# > 0 )); do
    case "$1" in
        --text)
            [[ $# -ge 2 ]] || api_die '--text 缺少参数'
            text_value="$2"
            shift 2
            ;;
        --voice)
            [[ $# -ge 2 ]] || api_die '--voice 缺少参数'
            voice_value="$2"
            shift 2
            ;;
        --speed)
            [[ $# -ge 2 ]] || api_die '--speed 缺少参数'
            speed_value="$2"
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

[[ -n "$text_value" ]] || api_die '必须指定 --text'
body="{\"text\":$(api_json_string "$text_value")"
if [[ -n "$voice_value" ]]; then
    body+=",\"voice\":$(api_json_string "$voice_value")"
fi
if [[ -n "$speed_value" ]]; then
    api_validate_number "$speed_value"
    body+=",\"speed\":${speed_value}"
fi
body+='}'

api_request POST /api/tts/generate --header 'Content-Type: application/json' --data "$body"
