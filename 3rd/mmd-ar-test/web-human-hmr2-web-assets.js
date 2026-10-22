'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { hashFile } = require('./apk-artifact');
const project = path.resolve(__dirname, '../..');
const catalog = require('../hmr2-node-onnx/core/model-catalog.json');
const MODEL_DIR = path.join(project, 'res/models/hmr2-node-onnx/fp32-op18-dml-static');
const ORT_FILES = ['ort.webgpu.min.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

// 只复制显式准备好的本机模型；普通构建缺模型仍成功，清单先置不可用以免中途失败留下旧ready。
async function stageHmrWebAssets(root, { modelDir = process.env.HMR2_MODEL_DIR || MODEL_DIR } = {}) {
    const output = path.join(path.resolve(root), 'js/vendor/hmr2');
    await fs.mkdir(output, { recursive: true });
    const manifest = { schemaVersion: 1, source: 'hmr2-web', available: false, reason: '模型未准备，请先运行 npm run download:hmr2-model，再构建网页',
        modelId: catalog.id, runtimeVersion: '1.26.0', files: [] };
    const save = async () => fs.writeFile(path.join(output, 'models.json'), JSON.stringify(manifest, null, 2) + '\n');
    await save();
    let model;
    try {
        const { verifyModel } = await import(pathToFileURL(path.join(project, '3rd/hmr2-node-onnx/core/model-files.mjs')).href);
        model = await verifyModel({ modelDir });
    } catch (error) {
        if (error.code !== 'model_missing') manifest.reason = '模型不完整或校验失败，请重新校验可选HMR模型后构建网页';
        await save(); return manifest;
    }
    try {
        const dist = path.dirname(require.resolve('onnxruntime-web'));
        const runtime = JSON.parse(await fs.readFile(path.join(dist, '../package.json'), 'utf8'));
        if (runtime.version !== manifest.runtimeVersion) throw new Error('HMR网页运行时要求ORT 1.26.0');
        const cvFile = require.resolve('@techstark/opencv-js', { paths: [path.join(project, '3rd/hmr2-node-onnx')] });
        const cvPackage = JSON.parse(await fs.readFile(path.join(path.dirname(cvFile), '../package.json'), 'utf8'));
        if (cvPackage.version !== '4.12.0-release.1') throw new Error('HMR网页预处理要求OpenCV 4.12.0');
        const sources = [...model.files.map(file => ({ name: file.path, source: path.join(model.modelDir, file.path), expected: file })),
            ...ORT_FILES.map(name => ({ name, source: path.join(dist, name) }))];
        for (const entry of sources) {
            const destination = path.join(output, entry.name);
            const stat = await fs.lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
            if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('拒绝覆盖非普通HMR资源');
            await fs.copyFile(entry.source, destination);
            const hash = await hashFile(destination);
            if (entry.expected && (hash.size !== entry.expected.bytes || hash.sha256 !== entry.expected.sha256)) throw new Error('HMR复制后校验失败');
            manifest.files.push({ name: entry.name, bytes: hash.size, sha256: hash.sha256 });
        }
        // UMD的顶层this在ESM中为undefined，仅替换全局对象锚点，数值/WASM内容保持原样。
        const source = await fs.readFile(cvFile, 'utf8');
        const anchor = '}(this, function () {';
        if (source.split(anchor).length !== 2) throw new Error('OpenCV网页包装锚点无效');
        const cvOutput = path.join(output, 'opencv.mjs');
        await fs.writeFile(cvOutput, source.replace(anchor, '}(globalThis, function () {'));
        const cvHash = await hashFile(cvOutput);
        manifest.files.push({ name: 'opencv.mjs', bytes: cvHash.size, sha256: cvHash.sha256 });
        await fs.copyFile(path.join(__dirname, 'hmr2-vendor/ORT-LICENSE'), path.join(output, 'ORT-LICENSE'));
        await fs.copyFile(path.join(path.dirname(cvFile), '../LICENSE'), path.join(output, 'OpenCV-package-LICENSE'));
        manifest.available = true; manifest.reason = '';
    } catch (error) {
        manifest.available = false; manifest.reason = 'HMR网页资源准备失败：' + error.message;
        await save(); throw error;
    }
    await save(); return manifest;
}
module.exports = { stageHmrWebAssets };
