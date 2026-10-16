'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const REVISION = '47534e27c9851bb1128ccc0102f1145e27f23f98';
const MODELS = Object.freeze([
    { name: 'person_detection_mediapipe_2023mar.onnx', folder: 'person_detection_mediapipe', size: 11990159, sha256: '47fd5599d6fa17608f03e0eb0ae230baa6e597d7e8a2c8199fe00abea55a701f' },
    { name: 'pose_estimation_mediapipe_2023mar.onnx', folder: 'pose_estimation_mediapipe', size: 5557238, sha256: '9d89c599319a18fb7d2e28451a883476164543182bafca5f09eb2cf767ed2f3f' }
]);
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
            const url = `https://github.com/opencv/opencv_zoo/raw/${REVISION}/models/${model.folder}/${model.name}`;
            const temporary = file + '.download';
            try {
                // 固定URL只下载模型数据；curl兼容本机网络代理，失败不替换已验证缓存。
                await run(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--fail', '--silent', '--show-error', '--location', '--retry', '2', '--connect-timeout', '15', '--max-time', '180', url, '-o', temporary], { timeout: 240000 });
                if (!await valid(temporary, model)) throw new Error('姿态模型大小/SHA-256不符：' + model.name);
                await fs.rename(temporary, file);
            } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
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
