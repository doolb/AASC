#!/usr/bin/env node
// 下载 sherpa-onnx 官方 SenseVoice int8 模型到 res/models/sensevoice/。
//
// 原始模型来源：FunAudioLLM/SenseVoice（iic/SenseVoiceSmall）；
// 下载包由 k2-fsa/sherpa-onnx 发布并提供 model.int8.onnx。
// 用法：node scripts/models/download-sensevoice-model.js [--force]

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '../..');
const MODEL_DIR = path.join(ROOT, 'res', 'models', 'sensevoice');
const MODEL_FILENAME = 'model.int8.onnx';
const MODEL_PATH = path.join(MODEL_DIR, MODEL_FILENAME);
const HASH_FILENAME = 'model.int8.onnx.sha256';
const HASH_PATH = path.join(MODEL_DIR, HASH_FILENAME);
const MODEL_MEMBER = `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/${MODEL_FILENAME}`;
const ARCHIVE_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2';
const DEFAULT_SHA256 = 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51';
const MIN_MODEL_BYTES = 100 * 1024 * 1024;

function printHelp() {
    console.log(`用法: node scripts/models/download-sensevoice-model.js [选项]

下载 SenseVoice int8 ONNX 模型到 ${path.relative(ROOT, MODEL_PATH)}。

选项:
  --force  已存在模型时重新下载
  --help   显示帮助`);
}

function parseArgs(argv) {
    const options = { force: false };
    for (const arg of argv) {
        if (arg === '--force') {
            options.force = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`未知参数: ${arg}`);
        }
    }
    return options;
}

function downloadFile(url, destination) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? require('node:https') : require('node:http');
        const request = protocol.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                downloadFile(new URL(response.headers.location, url).toString(), destination)
                    .then(resolve)
                    .catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode} for ${url}`));
                return;
            }

            const output = fs.createWriteStream(destination);
            response.pipe(output);
            output.on('finish', () => output.close(resolve));
            output.on('error', reject);
            response.on('error', reject);
        });
        request.on('error', reject);
    });
}

function readExpectedSha256() {
    const configured = process.env.SENSEVOICE_MODEL_SHA256;
    const value = configured || (fs.existsSync(HASH_PATH)
        ? fs.readFileSync(HASH_PATH, 'utf8').trim().split(/\s+/)[0]
        : DEFAULT_SHA256);
    if (!/^[a-f0-9]{64}$/i.test(value)) {
        throw new Error(`无效的 SenseVoice SHA-256: ${value}`);
    }
    return value.toLowerCase();
}

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const input = fs.createReadStream(filePath);
        input.on('data', (chunk) => hash.update(chunk));
        input.on('error', reject);
        input.on('end', () => resolve(hash.digest('hex')));
    });
}

async function extractModel(archivePath, extractionDir) {
    await execFileAsync('tar', [
        '--extract',
        '--bzip2',
        '--file', archivePath,
        '--directory', extractionDir,
        '--strip-components=1',
        MODEL_MEMBER
    ]);
    const extractedPath = path.join(extractionDir, MODEL_FILENAME);
    if (!fs.existsSync(extractedPath)) {
        throw new Error(`下载包中缺少 ${MODEL_MEMBER}`);
    }
    return extractedPath;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }
    if (fs.existsSync(MODEL_PATH) && !options.force) {
        console.log(`模型已存在，跳过下载: ${MODEL_PATH}`);
        console.log('如需重新下载，请添加 --force');
        return;
    }

    const expectedSha256 = readExpectedSha256();
    const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-sensevoice-'));
    const archivePath = path.join(temporaryDir, 'sensevoice.tar.bz2');
    const extractionDir = path.join(temporaryDir, 'extracted');
    const stagedPath = path.join(MODEL_DIR, `.${MODEL_FILENAME}.download`);

    try {
        fs.mkdirSync(extractionDir, { recursive: true });
        fs.mkdirSync(MODEL_DIR, { recursive: true });
        console.log(`下载源: ${ARCHIVE_URL}`);
        await downloadFile(ARCHIVE_URL, archivePath);
        const extractedPath = await extractModel(archivePath, extractionDir);
        const size = fs.statSync(extractedPath).size;
        if (size < MIN_MODEL_BYTES) {
            throw new Error(`模型文件过小: ${size} bytes`);
        }

        fs.renameSync(extractedPath, stagedPath);
        const actualSha256 = await sha256File(stagedPath);
        if (actualSha256 !== expectedSha256) {
            throw new Error(`SHA-256 校验失败: 期望 ${expectedSha256}，实际 ${actualSha256}`);
        }

        fs.renameSync(stagedPath, MODEL_PATH);
        console.log(`校验通过: ${actualSha256}`);
        console.log(`已保存到: ${MODEL_PATH}`);
    } finally {
        try {
            fs.unlinkSync(stagedPath);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        fs.rmSync(temporaryDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(`下载失败: ${error.message}`);
    process.exitCode = 1;
});
