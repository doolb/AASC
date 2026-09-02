#!/usr/bin/env bash

# 上传并立即发送媒体到指定显示端。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

show_help() {
    cat <<'EOF'
用法：play.sh --file FILE --display DISPLAY_ID

调用 POST /upload-file，以 multipart 上传文件并发送到显示端。
环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS
EOF
}

if [[ "${1:-}" == "--help" || "$#" -eq 0 ]]; then
    show_help
    [[ "$#" -eq 0 ]] && exit 2 || exit 0
fi

file_path=""
display_id=""
while (( $# > 0 )); do
    case "$1" in
        --file)
            [[ $# -ge 2 ]] || api_die '--file 缺少参数'
            file_path="$2"
            shift 2
            ;;
        --display|--display-id)
            [[ $# -ge 2 ]] || api_die '--display 缺少参数'
            display_id="$2"
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

[[ -n "$file_path" ]] || api_die '必须指定 --file'
[[ -n "$display_id" ]] || api_die '必须指定 --display'
api_require_file "$file_path"
api_request POST /upload-file --form "file=@${file_path}" --form "displayId=${display_id}"
