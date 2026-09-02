#!/usr/bin/env node
'use strict';

const { requestText, requireFile, runCli } = require('./common');

function printHelp() {
    process.stdout.write(`用法：asr-recognize.js --audio FILE

调用 POST /api/asr/recognize，以 multipart 字段 audio 上传音频。
环境变量：AASC_URL、AASC_INSECURE、AASC_TIMEOUT_SECONDS
`);
}

async function main(argv = process.argv.slice(2)) {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        printHelp();
        if (argv.length === 0) process.exitCode = 2;
        return;
    }
    let audioPath = '';
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--audio') {
            if (!argv[index + 1]) throw new Error('--audio 缺少参数');
            audioPath = argv[++index];
        } else if (argv[index] === '--help' || argv[index] === '-h') {
            printHelp();
            return;
        } else {
            throw new Error(`未知参数：${argv[index]}`);
        }
    }
    if (!audioPath) throw new Error('必须指定 --audio');
    process.stdout.write(await requestText('POST', '/api/asr/recognize', {
        files: [{ key: 'audio', path: requireFile(audioPath) }]
    }));
}

if (require.main === module) runCli(main);

module.exports = { main };
