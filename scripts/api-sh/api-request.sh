#!/usr/bin/env bash

# 通用 HTTP API 调用器，适合用户手动执行和 AI 组合调用。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

show_help() {
    cat <<'EOF'
用法：api-request.sh METHOD PATH [选项]

通用调用任意 AASC HTTP 接口。成功响应 JSON 写到 stdout，错误写到 stderr。

选项：
  --json JSON       发送 application/json 请求体
  --form KEY=VALUE  发送 multipart 字段
  --file KEY=FILE   发送 multipart 文件字段
  --header HEADER   增加 HTTP 请求头
  --confirm         确认执行删除、导入、停止或重启等高风险操作
  --help            显示帮助

环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS、API_CONFIRM

示例：
  api-request.sh GET /api/status
  api-request.sh POST /api/tts/generate --json '{"text":"你好"}'
  api-request.sh POST /upload-file --form displayId=display-1 --file file=./demo.mp4
EOF
}

if [[ "${1:-}" == "--help" || "$#" -eq 0 ]]; then
    show_help
    exit 0
fi

if (( $# < 2 )); then
    show_help >&2
    exit 2
fi

method="${1^^}"
route="$2"
shift 2
curl_arguments=()
confirmed=0

while (( $# > 0 )); do
    case "$1" in
        --json)
            [[ $# -ge 2 ]] || api_die '--json 缺少参数'
            curl_arguments+=(--header 'Content-Type: application/json' --data "$2")
            shift 2
            ;;
        --form)
            [[ $# -ge 2 && "$2" == *=* ]] || api_die '--form 格式必须是 KEY=VALUE'
            curl_arguments+=(--form "$2")
            shift 2
            ;;
        --file)
            [[ $# -ge 2 && "$2" == *=* ]] || api_die '--file 格式必须是 KEY=FILE'
            field_name="${2%%=*}"
            file_path="${2#*=}"
            [[ -n "$field_name" && -n "$file_path" ]] || api_die '--file 字段名和文件路径不能为空'
            api_require_file "$file_path"
            curl_arguments+=(--form "${field_name}=@${file_path}")
            shift 2
            ;;
        --header)
            [[ $# -ge 2 ]] || api_die '--header 缺少参数'
            curl_arguments+=(--header "$2")
            shift 2
            ;;
        --confirm)
            confirmed=1
            shift
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

if (( confirmed == 1 )); then
    API_CONFIRM=1
fi

case "${method}:${route}" in
    DELETE:*|POST:/api/restart*|POST:/api/chat/clear*|POST:/api/chat/round*|POST:/api/ai-roles/stop-all*|POST:/api/chat/history/import*|POST:/api/aasc-user/import*|POST:/api/voiceprint/remove*)
        api_require_confirmation "${method} ${route}"
        ;;
esac

api_request "$method" "$route" "${curl_arguments[@]}"
