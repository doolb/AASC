#!/usr/bin/env bash

# 查询服务器上传目录中的媒体文件。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

if [[ "${1:-}" == "--help" ]]; then
    cat <<'EOF'
用法：media-list.sh

调用 GET /media-list，成功时输出媒体列表 JSON。
EOF
    exit 0
fi

(( $# == 0 )) || api_die "未知参数：$1"
api_request GET /media-list
