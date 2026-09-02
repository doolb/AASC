#!/usr/bin/env bash

# 上传图片到服务器 OCR 接口，可按短边缩放后再由服务端推理。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

show_help() {
    cat <<'EOF'
用法：vision-ocr.sh --image FILE [--display DISPLAY_ID] [--short-side PIXELS]

调用 POST /api/vision/ocr，以 multipart 字段 image 上传图片。
--short-side 为 0 表示保持原图；指定正整数时按图片短边缩放。
环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS
EOF
}

if [[ "${1:-}" == "--help" || "$#" -eq 0 ]]; then
    show_help
    [[ "$#" -eq 0 ]] && exit 2 || exit 0
fi

image_path=""
display_id=""
short_side=""
while (( $# > 0 )); do
    case "$1" in
        --image)
            [[ $# -ge 2 ]] || api_die '--image 缺少参数'
            image_path="$2"
            shift 2
            ;;
        --display|--display-id)
            [[ $# -ge 2 ]] || api_die '--display 缺少参数'
            display_id="$2"
            shift 2
            ;;
        --short-side)
            [[ $# -ge 2 ]] || api_die '--short-side 缺少参数'
            short_side="$2"
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

[[ -n "$image_path" ]] || api_die '必须指定 --image'
api_require_file "$image_path"
form_arguments=(--form "image=@${image_path}")
if [[ -n "$display_id" ]]; then
    form_arguments+=(--form "displayId=${display_id}")
fi
if [[ -n "$short_side" ]]; then
    api_validate_short_side "$short_side"
    form_arguments+=(--form "shortSide=${short_side}")
fi

api_request POST /api/vision/ocr "${form_arguments[@]}"
