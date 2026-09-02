#!/usr/bin/env node
'use strict';

const { requestText, requireFile, runCli } = require('./common');

function printHelp() {
    process.stdout.write(`用法：play.js --file FILE --display DISPLAY_ID

调用 POST /upload-file，以 multipart 上传文件并发送到显示端。
环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS
`);
}

async function main(argv = process.argv.slice(2)) {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        printHelp();
        if (argv.length === 0) process.exitCode = 2;
        return;
    }
    let filePath = '';
    let displayId = '';
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--file') {
            if (!argv[index + 1]) throw new Error('--file 缺少参数');
            filePath = argv[++index];
        } else if (arg === '--display' || arg === '--display-id') {
            if (!argv[index + 1]) throw new Error('--display 缺少参数');
            displayId = argv[++index];
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            return;
        } else {
            throw new Error(`未知参数：${arg}`);
        }
    }
    if (!filePath) throw new Error('必须指定 --file');
    if (!displayId) throw new Error('必须指定 --display');
    process.stdout.write(await requestText('POST', '/upload-file', {
        fields: [{ key: 'displayId', value: displayId }],
        files: [{ key: 'file', path: requireFile(filePath) }]
    }));
}

if (require.main === module) runCli(main);

module.exports = { main };
