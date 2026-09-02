#!/usr/bin/env node
'use strict';

const { formatVisionResult } = require('./vision-tui');
const { requestText, requireFile, runCli } = require('./common');

const MODEL_IDS = ['yolo11n', 'yolo11s', 'yolo11m', 'yolo11l', 'yolo11x'];

function printHelp() {
    process.stdout.write(`用法：vision-yolo.js --image FILE [--display DISPLAY_ID] [--model MODEL_ID] [--tui]

调用 POST /api/vision/yolo，以 multipart 字段 image 上传图片。
--model 可选 ${MODEL_IDS.join('、')}，默认 yolo11n。
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
    let model = 'yolo11n';
    let tui = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--image' || arg === '--display' || arg === '--display-id' || arg === '--model') {
            if (!argv[index + 1]) throw new Error(`${arg} 缺少参数`);
            const value = argv[++index];
            if (arg === '--image') imagePath = value;
            if (arg === '--display' || arg === '--display-id') displayId = value;
            if (arg === '--model') model = value;
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
    if (!MODEL_IDS.includes(model)) throw new Error(`--model 必须是 ${MODEL_IDS.join('、')} 之一`);
    const fields = [{ key: 'model', value: model }];
    if (displayId !== undefined) fields.push({ key: 'displayId', value: displayId });
    const response = await requestText('POST', '/api/vision/yolo', {
        fields,
        files: [{ key: 'image', path: requireFile(imagePath) }]
    });
    if (!tui) {
        process.stdout.write(response);
        return;
    }
    const payload = JSON.parse(response);
    process.stdout.write(`${formatVisionResult(payload, 'yolo')}\n`);
    if (payload.status === 'error' || payload.success === false) process.exitCode = 1;
}

if (require.main === module) runCli(main);

module.exports = { main };
