#!/usr/bin/env bash

# 所有 API 测试脚本共享的 curl、地址和错误处理逻辑。
# 该文件只应被其他脚本 source，不直接执行服务器请求。
set -euo pipefail

API_TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "${API_TESTS_DIR}/../.." && pwd -P)"

AASC_URL="${AASC_URL:-https://127.0.0.1:8081}"
AASC_INSECURE="${AASC_INSECURE:-1}"
AASC_TIMEOUT_SECONDS="${AASC_TIMEOUT_SECONDS:-120}"
AASC_CONNECT_TIMEOUT_SECONDS="${AASC_CONNECT_TIMEOUT_SECONDS:-5}"
CURL_BIN="${CURL_BIN:-curl}"

api_die() {
    printf '%s\n' "$*" >&2
    return 1
}

api_require_command() {
    local command_name="$1"
    command -v "$command_name" >/dev/null 2>&1 || api_die "缺少命令：${command_name}"
}

api_require_file() {
    local file_path="$1"
    [[ -f "$file_path" ]] || api_die "文件不存在：${file_path}"
    [[ -r "$file_path" ]] || api_die "文件不可读：${file_path}"
}

api_url() {
    local route="$1"
    if [[ "$route" == http://* || "$route" == https://* ]]; then
        printf '%s\n' "$route"
        return 0
    fi
    printf '%s/%s\n' "${AASC_URL%/}" "${route#/}"
}

api_curl_args=()
if [[ "$AASC_INSECURE" != "0" ]]; then
    api_curl_args+=(--insecure)
fi
api_curl_args+=(
    --silent
    --show-error
    # 代理环境变量可能没有设置 NO_PROXY；本机默认服务必须直连，避免代理返回 TLS EOF。
    --noproxy '127.0.0.1,localhost,::1'
    --connect-timeout "$AASC_CONNECT_TIMEOUT_SECONDS"
    --max-time "$AASC_TIMEOUT_SECONDS"
)

# 发起 HTTP 请求；成功时只把服务端响应体写到 stdout，HTTP 错误写到 stderr。
api_request() {
    local method="$1"
    local route="$2"
    shift 2

    api_require_command "$CURL_BIN"
    local response_file
    response_file="$(mktemp "${TMPDIR:-/tmp}/aasc-api-response.XXXXXX")"
    local request_url
    request_url="$(api_url "$route")"
    local http_code=""
    local curl_exit=0

    if http_code="$("$CURL_BIN" "${api_curl_args[@]}" -X "$method" "$@" \
        --output "$response_file" --write-out '%{http_code}' "$request_url")"; then
        curl_exit=0
    else
        curl_exit=$?
    fi

    if (( curl_exit != 0 )); then
        if [[ -s "$response_file" ]]; then
            cat "$response_file" >&2
        fi
        rm -f "$response_file"
        return "$curl_exit"
    fi

    if [[ ! "$http_code" =~ ^[0-9]{3}$ ]]; then
        printf '无法解析 HTTP 状态码：%s\n' "$http_code" >&2
        rm -f "$response_file"
        return 1
    fi

    if (( 10#$http_code >= 400 )); then
        cat "$response_file" >&2
        rm -f "$response_file"
        return 22
    fi

    cat "$response_file"
    rm -f "$response_file"
}

# 将任意文本编码成 JSON 字符串，优先使用 jq，未安装 jq 时使用 Node.js。
api_json_string() {
    local value="$1"
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$value" | jq -Rs .
        return 0
    fi
    api_require_command node
    printf '%s' "$value" | node -e '
const fs = require("node:fs");
process.stdout.write(JSON.stringify(fs.readFileSync(0, "utf8")));
'
}

api_validate_number() {
    local value="$1"
    [[ "$value" =~ ^-?[0-9]+([.][0-9]+)?$ ]] || api_die "数值参数无效：${value}"
}

api_validate_short_side() {
    local value="$1"
    [[ "$value" =~ ^[0-9]+$ ]] || api_die "OCR 短边必须是整数：${value}"
    if (( value != 0 && (value < 256 || value > 2048) )); then
        api_die 'OCR 短边必须为 0 或 256..2048 的整数'
    fi
}

api_require_confirmation() {
    local action="$1"
    [[ "${API_CONFIRM:-0}" == "1" ]] || api_die "操作“${action}”有副作用，请设置 API_CONFIRM=1 或传入 --confirm"
}
