#!/usr/bin/env node
'use strict';

const { formatVisionResult } = require('./vision-tui');
const { requestText, requireFile, runCli, validateShortSide } = require('./common');

function printHelp() {
    process.stdout.write(`用法：vision-ocr.js --image FILE [--display DISPLAY_ID] [--short-side PIXELS] [--tui]

调用 POST /api/vision/ocr，以 multipart 字段 image 上传图片。
--short-side 为 0 表示保持原图；指定正整数时按图片短边缩放。
--tui 将返回的 JSON 渲染为终端可读面板；不指定时输出原始 JSON。
环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS
`);
}

async function main(argv = process.argv.slice(2)) {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        printHelp();
        if (argv.length === 0) process.exitCode = 2;
        return;
    }
    let imagePath = '';
    let displayId;
    let shortSide;
    let tui = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--image' || arg === '--display' || arg === '--display-id' || arg === '--short-side') {
            if (!argv[index + 1]) throw new Error(`${arg} 缺少参数`);
            const value = argv[++index];
            if (arg === '--image') imagePath = value;
            if (arg === '--display' || arg === '--display-id') displayId = value;
            if (arg === '--short-side') shortSide = value;
        } else if (arg === '--tui') {
            tui = true;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            return;
        } else {
            throw new Error(`未知参数：${arg}`);
        }
    }
    if (!imagePath) throw new Error('必须指定 --image');
    if (shortSide !== undefined) validateShortSide(shortSide);
    const fields = [];
    if (displayId !== undefined) fields.push({ key: 'displayId', value: displayId });
    if (shortSide !== undefined) fields.push({ key: 'shortSide', value: shortSide });
    const response = await requestText('POST', '/api/vision/ocr', {
        fields,
        files: [{ key: 'image', path: requireFile(imagePath) }]
    });
    if (!tui) {
        process.stdout.write(response);
        return;
    }
    const payload = JSON.parse(response);
    process.stdout.write(`${formatVisionResult(payload, 'ocr')}\n`);
    if (payload.status === 'error' || payload.success === false) process.exitCode = 1;
}

if (require.main === module) runCli(main);

module.exports = { main };
