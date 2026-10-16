'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const run = promisify(execFile);
const REVISION = 'rtmpose-m_simcc-body7_pt-body7_420e-384x288-65e718c4_20230504';
const ARCHIVE = { name: REVISION + '.zip', size: 51280419,
    sha256: 'fc6a8ccabf7a1b1c1e851e8199af5d34167757a34c59a0bc0685a0476f559096' };
const MODEL_ENTRY = '20230831/rtmpose_onnx/' + REVISION + '/end2end.onnx';
const MODELS = Object.freeze([
    { name: 'rtmpose-m-body7-384x288.onnx', size: 54850856, sha256: 'a4c4f6fd983c0be353042a7a6b3845b0894ada22b8c02964373554afcdcd6e8e' }
]);
// 只读取固定ZIP条目并写入调用方指定文件，不把不可信归档路径用于文件系统操作。
async function extractModel(archive, destination) {
    const zip = await new Promise((resolve, reject) => yauzl.open(archive, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
    try {
        const entry = await new Promise((resolve, reject) => {
            zip.on('error', reject); zip.on('end', () => reject(new Error('RTMPose归档缺少固定模型条目')));
            zip.on('entry', item => {
                if (item.fileName === MODEL_ENTRY && item.uncompressedSize === MODELS[0].size) resolve(item);
                else zip.readEntry();
            });
            zip.readEntry();
        });
        const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, value) => error ? reject(error) : resolve(value)));
        await pipeline(stream, createWriteStream(destination));
    } finally { zip.close(); }
}
async function valid(file, model) {
    try { const bytes = await fs.readFile(file); return bytes.length === model.size && crypto.createHash('sha256').update(bytes).digest('hex') === model.sha256; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function stagePoseAssets(root) {
    const cache = path.join(__dirname, 'model-cache/pose-onnx'), output = path.join(root, 'js/vendor/pose');
    await fs.mkdir(cache, { recursive: true }); await fs.mkdir(output, { recursive: true });
    for (const model of MODELS) {
        const file = path.join(cache, model.name);
        if (!await valid(file, model)) {
            const url = 'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/' + ARCHIVE.name;
            const archive = path.join(cache, ARCHIVE.name), archiveDownload = archive + '.download';
            const temporary = file + '.download';
            try {
                // 固定URL只下载模型数据；curl兼容本机网络代理，失败不替换已验证缓存。
                if (!await valid(archive, ARCHIVE)) {
                    await run(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--fail', '--silent', '--show-error', '--location', '--retry', '2', '--connect-timeout', '15', '--max-time', '180', url, '-o', archiveDownload], { timeout: 240000 });
                    if (!await valid(archiveDownload, ARCHIVE)) throw new Error('RTMPose归档大小/SHA-256不符');
                    await fs.rename(archiveDownload, archive);
                }
                await extractModel(archive, temporary);
                if (!await valid(temporary, model)) throw new Error('姿态模型大小/SHA-256不符：' + model.name);
                await fs.rename(temporary, file);
            } catch (error) { await fs.unlink(temporary).catch(() => {}); await fs.unlink(archiveDownload).catch(() => {}); throw error; }
        }
        await fs.copyFile(file, path.join(output, model.name));
    }
    // 复用项目现有可选ORT依赖，部署只复制WASM单线程所需的匹配文件。
    const dist = path.dirname(require.resolve('onnxruntime-web'));
    for (const name of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) await fs.copyFile(path.join(dist, name), path.join(output, name));
    const project = path.resolve(__dirname, '../..');
    await fs.copyFile(path.join(project, '3rd/tts-server/android-asr/web/vendor/licenses/Apache-2.0.txt'), path.join(output, 'LICENSE-APACHE-2.0.txt'));
    await fs.copyFile(path.join(__dirname, 'pose-onnx-MIT.txt'), path.join(output, 'LICENSE-MIT.txt'));
    await fs.copyFile(path.join(__dirname, 'pose-onnx-NOTICES.md'), path.join(output, 'NOTICES.md'));
    const ortPackage = JSON.parse(await fs.readFile(path.join(dist, '../package.json'), 'utf8'));
    await fs.writeFile(path.join(output, 'models.json'), JSON.stringify({ revision: REVISION, runtime: ortPackage.version, models: MODELS }, null, 2) + '\n');
}
module.exports = { stagePoseAssets, MODELS };
