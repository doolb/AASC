#!/usr/bin/env node
'use strict';

const {
    parseHeader,
    parseKeyValue,
    requestText,
    requireConfirmation,
    requireFile,
    runCli
} = require('./common');

function printHelp() {
    process.stdout.write(`用法：api-request.js METHOD PATH [选项]

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
  api-request.js GET /api/status
  api-request.js POST /api/tts/generate --json '{"text":"你好"}'
  api-request.js POST /upload-file --form displayId=display-1 --file file=./demo.mp4
`);
}

async function main(argv = process.argv.slice(2)) {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        printHelp();
        return;
    }
    if (argv.length < 2) {
        printHelp();
        process.exitCode = 2;
        return;
    }

    const method = String(argv[0]).toUpperCase();
    const route = argv[1];
    const fields = [];
    const files = [];
    const headers = {};
    let json;
    let confirmed = false;
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--json') {
            if (index + 1 >= argv.length) throw new Error('--json 缺少参数');
            json = argv[++index];
        } else if (arg === '--form') {
            if (index + 1 >= argv.length) throw new Error('--form 缺少参数');
            fields.push(parseKeyValue(argv[++index], '--form'));
        } else if (arg === '--file') {
            if (index + 1 >= argv.length) throw new Error('--file 缺少参数');
            const pair = parseKeyValue(argv[++index], '--file');
            files.push({ key: pair.key, path: requireFile(pair.value) });
        } else if (arg === '--header') {
            if (index + 1 >= argv.length) throw new Error('--header 缺少参数');
            const header = parseHeader(argv[++index]);
            headers[header.key] = header.value;
        } else if (arg === '--confirm') {
            confirmed = true;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            return;
        } else {
            throw new Error(`未知参数：${arg}`);
        }
    }

    requireConfirmation(method, route, confirmed);
    const response = await requestText(method, route, { json, fields, files, headers });
    process.stdout.write(response);
}

if (require.main === module) runCli(main);

module.exports = { main };
