'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const REVISION = 'c70d1ddbcd93c9bda8098268cc3554adf5e8dd4f';
const REPOSITORY = 'onnx-community/depth-anything-v2-small';
const SOURCE = 'depth-anything-v2-small';
const FILES = Object.freeze([
    { name: 'model_quantized.onnx', remote: 'onnx/model_quantized.onnx', size: 27258801, sha256: 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d' },
    { name: 'preprocessor_config.json', remote: 'preprocessor_config.json', size: 461, sha256: '03576db3c13dd0471fdf5f5e1428befcb95de063fe699879150b293dc9e0a2c6' },
    { name: 'config.json', remote: 'config.json', size: 38, sha256: '3aee5b9bc4f711ee885c2526d871f0c8c6c8c4b26b8e04253d0167f6a83264f5' },
    { name: 'README.md', remote: 'README.md', size: 1739, sha256: '5c03bcb41e047e7760916b47889de3a8273c6a925cb3c16e5dbdeefac25167cb' }
].map(file => Object.freeze(file)));
const MODELS = Object.freeze([FILES[0]]);
const LICENSE = Object.freeze({ name: 'LICENSE-APACHE-2.0.txt', size: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' });
const LIMITS = Object.freeze({ imageLongest: 1600, inputLongest: 1024, inputPixels: 518 * 1024 });
const projectRoot = path.resolve(__dirname, '../..');

async function valid(file, expected) {
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.size) return false;
        const bytes = await fs.readFile(file);
        return bytes.length === expected.size && crypto.createHash('sha256').update(bytes).digest('hex') === expected.sha256;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function assertWritableFile(file) {
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('拒绝覆盖非普通深度资源：' + file);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function installFile(source, destination, expected) {
    if (await valid(destination, expected)) return;
    await assertWritableFile(destination);
    await fs.copyFile(source, destination);
    if (!await valid(destination, expected)) throw new Error('复制后深度资源大小/SHA-256不符：' + expected.name);
}
async function downloadFixed(file, cache, fetchImpl) {
    // 只使用固定revision的白名单URL，精确大小+SHA-256双门禁；下载不会接受任意模型名、版本或URL。
    if (typeof fetchImpl !== 'function') throw new Error('缺少下载能力，请预先准备固定深度缓存');
    const url = `https://huggingface.co/${REPOSITORY}/resolve/${REVISION}/${file.remote}`;
    const destination = path.join(cache, file.name);
    const temporary = path.join(cache, '.' + file.name + '.' + crypto.randomUUID() + '.download');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000);
    let handle = null, reader = null;
    try {
        const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
        if (!response.ok) throw new Error('深度固定资源下载失败：HTTP ' + response.status);
        const length = response.headers?.get('content-length'), encoding = response.headers?.get('content-encoding')?.trim().toLowerCase();
        if ((!encoding || encoding === 'identity') && length !== null && length !== undefined
            && (!/^\d+$/.test(length) || Number(length) !== file.size)) throw new Error('深度下载大小不符：' + file.name);
        if (!response.body?.getReader) throw new Error('深度下载必须提供有界流式响应');
        handle = await fs.open(temporary, 'wx'); reader = response.body.getReader();
        let size = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > file.size) throw new Error('深度下载超过固定字节预算：' + file.name);
            await handle.writeFile(value);
        }
        if (size !== file.size) throw new Error('深度下载不完整：' + file.name);
        await handle.close(); handle = null;
        if (!await valid(temporary, file)) throw new Error('深度下载SHA-256不符：' + file.name);
        await assertWritableFile(destination);
        await fs.rename(temporary, destination);
        return destination;
    } catch (error) {
        if (reader) await reader.cancel().catch(() => {});
        throw error;
    } finally {
        clearTimeout(timer);
        reader?.releaseLock();
        if (handle) await handle.close();
        // 临时名由本函数在已知缓存根下唯一创建；不清理其它文件或用户模型。
        if (path.dirname(temporary) !== path.resolve(cache)) throw new Error('深度临时路径越界');
        await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
}
async function stageDepthAssets(root, {
    cacheRoot = path.join(__dirname, 'model-cache/depth-onnx'),
    preferredCacheRoot = path.join(projectRoot, 'tmp/mmd-pose/depth-eval/rigid-projection'),
    allowDownload = true, fetchImpl = globalThis.fetch
} = {}) {
    if (typeof root !== 'string' || !root.trim()) throw new Error('深度资源输出根目录无效');
    const cache = path.resolve(cacheRoot), output = path.join(path.resolve(root), 'js/vendor/depth');
    const preferred = preferredCacheRoot ? path.resolve(preferredCacheRoot) : null;
    const licenseSource = path.join(projectRoot, '3rd/tts-server/android-asr/web/vendor/licenses/Apache-2.0.txt');
    if (!await valid(licenseSource, LICENSE)) throw new Error('既有Apache-2.0许可证大小/SHA-256不符');
    await fs.mkdir(cache, { recursive: true }); await fs.mkdir(output, { recursive: true });
    for (const file of FILES) {
        const cached = path.join(cache, file.name), local = preferred ? path.join(preferred, file.name) : null;
        let source;
        // 已核对的本机模型作为优先缓存输入；正式部署只使用以下复制产物，不保留tmp路由依赖。
        if (local && await valid(local, file)) {
            await installFile(local, cached, file); source = cached;
        } else if (await valid(cached, file)) source = cached;
        else {
            if (!allowDownload) throw new Error('缺少通过大小/SHA-256校验的本机深度资源：' + file.name);
            source = await downloadFixed(file, cache, fetchImpl);
        }
        await installFile(source, path.join(output, file.name), file);
    }
    await installFile(licenseSource, path.join(output, LICENSE.name), LICENSE);
    // 深度不另复制ORT，始终复用pose-assets所复制的同一个实际安装版本及其WASM配套资源。
    const dist = path.dirname(require.resolve('onnxruntime-web'));
    const ortPackage = JSON.parse(await fs.readFile(path.join(dist, '../package.json'), 'utf8'));
    const manifest = { source: SOURCE, repository: REPOSITORY, revision: REVISION, license: 'Apache-2.0',
        licenseFile: LICENSE, runtime: ortPackage.version, backend: 'wasm-single-thread', limits: LIMITS,
        models: MODELS, files: FILES };
    const notices = `# Depth Anything V2 Small 整图相对深度\n\n` +
        `来源：https://huggingface.co/${REPOSITORY}/tree/${REVISION}\n\n` +
        '上游：https://github.com/DepthAnything/Depth-Anything-V2 （Small模型Apache-2.0）。\n\n' +
        '量化ONNX与固定配置按models.json逐文件校验；README.md保留模型卡，LICENSE-APACHE-2.0.txt保留完整许可。\n\n' +
        'RGB / DPT minimal / 518与14倍数 / ImageNet NCHW；分离式抗混叠双三次缩放不承诺与Pillow逐位一致。\n\n' +
        '输出仅整图可见表面相对深度：黄近蓝远，不是米制距离，不验证人体分割归属，不自动采用排序。\n';
    for (const [name, content] of [['models.json', JSON.stringify(manifest, null, 2) + '\n'], ['NOTICES.md', notices]]) {
        const destination = path.join(output, name); await assertWritableFile(destination);
        // 读取旧产物再比较，重复stage不会无故覆盖已有相同清单。
        let old = null;
        try { old = await fs.readFile(destination, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (old !== content) await fs.writeFile(destination, content);
    }
    return { output, manifest };
}
module.exports = { stageDepthAssets, MODELS, FILES, REVISION, REPOSITORY, SOURCE, LICENSE, LIMITS };
