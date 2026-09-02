#!/usr/bin/env bash

# 查询主服务器基础运行状态。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

if [[ "${1:-}" == "--help" ]]; then
    cat <<'EOF'
用法：health.sh

调用 GET /api/status，成功时输出服务器 JSON 状态。
环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS
EOF
    exit 0
fi

(( $# == 0 )) || api_die "未知参数：$1"
api_request GET /api/status
