'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { hashFile } = require('./apk-artifact');
const VERSION = '3.29.5';
const URL = `https://registry.npmjs.org/pinyin-pro/-/pinyin-pro-${VERSION}.tgz`;
const INTEGRITY = 'Fk5YoRmtdHqJWqAuzYVG/NzvzeCbaG+ZEwbY6Nbps3QAIrvQQEtcm49frcyCM8i2b5najnzPDtYqrHRYTTiuwQ==';
const CACHE = path.resolve(__dirname, '../../build/third_party/mmd-ar-lipsync', `pinyin-pro-${VERSION}.tgz`);
const verify = bytes => crypto.createHash('sha512').update(bytes).digest('base64') === INTEGRITY;

async function prepare() {
    let bytes;
    try { bytes = await fs.readFile(CACHE); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!bytes || !verify(bytes)) {
        const response = await fetch(URL, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`拼音资源下载失败 HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        if (!verify(bytes)) throw new Error('拼音资源SHA-512与固定版本不一致');
        await fs.mkdir(path.dirname(CACHE), { recursive: true });
        const temporary = `${CACHE}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, CACHE); }
        finally { await fs.rm(temporary, { force: true }); }
    }
    // 仅读取已通过整体完整性校验的归档；不解包链接、不执行代码、不接受越界路径。
    const tar = zlib.gunzipSync(bytes, { maxOutputLength: 4 * 1024 * 1024 });
    const files = [];
    const field = (block, start, size) => block.subarray(start, start + size).toString('utf8').split('\0')[0].trim();
    for (let offset = 0; offset + 512 <= tar.length;) {
        const header = tar.subarray(offset, offset + 512);
        const name = field(header, 0, 100), prefix = field(header, 345, 155);
        if (!name) break;
        const size = Number.parseInt(field(header, 124, 12) || '0', 8);
        if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('拼音归档长度无效');
        const fullName = prefix ? `${prefix}/${name}` : name;
        const regular = header[156] === 0 || header[156] === 48;
        if (regular && (fullName.startsWith('package/dist/esm/') || fullName === 'package/LICENSE')) {
            const relative = fullName.slice('package/'.length);
            if (path.posix.normalize(relative) !== relative || relative.startsWith('../') || relative.includes('\\')) throw new Error('拼音归档路径无效');
            files.push({ name: relative, bytes: Buffer.from(tar.subarray(offset + 512, offset + 512 + size)) });
        }
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    if (files.length !== 30 || !files.some(file => file.name === 'dist/esm/index.mjs') || !files.some(file => file.name === 'LICENSE')) {
        throw new Error('固定拼音归档的ESM依赖/许可证数量不一致');
    }
    return files;
}

function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`口型构建缺少唯一锚点：${anchor.slice(0, 70)}`);
    return source.replace(anchor, replacement);
}

async function stageRuntime(root, { webMode = false } = {}) {
    if (!webMode) return;
    const folder = path.join(root, 'js');
    const vendor = `vendor/pinyin-pro/${VERSION}`;
    const files = await prepare();
    for (const file of files) {
        const target = path.join(folder, vendor, file.name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.bytes);
    }
    await fs.writeFile(path.join(folder, vendor, 'SOURCE.json'), JSON.stringify({ name: 'pinyin-pro', version: VERSION,
        license: 'MIT', source: 'https://github.com/zh-lx/pinyin-pro', archive: URL, integrity: `sha512-${INTEGRITY}`,
        files: files.map(file => ({ name: file.name, bytes: file.bytes.length,
            sha256: crypto.createHash('sha256').update(file.bytes).digest('hex') })) }, null, 2) + '\n');
    // 只扩展生成副本：临时口型层在同一套动画基线恢复/物理前回调中应用。
    const controllerFile = path.join(folder, 'mmd-expressions.mjs');
    let controller = await fs.readFile(controllerFile, 'utf8');
    controller = once(controller, 'getHelper, onChanged })', 'getHelper, onChanged, onTransientChanged })');
    controller = once(controller, '    const selected = new Map();', '    const selected = new Map();\n    let transient = new Map();');
    controller = once(controller, '        mesh = next;', '        transient.clear();\n        mesh = next;');
    controller = once(controller, 'for (const [index, weight] of selected)', 'for (const [index, weight] of new Map([...selected, ...transient]))');
    controller = once(controller, '    return {\n        before,', `    // 口型仅替换自己的权重表；不改用户手动选择，也不触发每帧TAA历史清空。
    function setTransient(token, weights) {
        bind();
        if (!mesh || token !== mesh.uuid) return false;
        bindHelper(getHelper());
        if (!Array.isArray(weights) || weights.length > items.length) throw new Error('口型权重列表无效');
        const next = new Map();
        for (const pair of weights) {
            if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0])
                || !items[pair[0]]?.supported || !Number.isFinite(pair[1])) throw new Error('口型表情或强度无效');
            next.set(pair[0], Math.max(0, Math.min(1, pair[1])));
        }
        restore();
        transient = next;
        applied = false;
        apply();
        onTransientChanged?.();
        return true;
    }

    return {
        setTransient,
        before,`);
    controller = once(controller, 'dispose() { restore(); unhook(); selected.clear();', 'dispose() { restore(); unhook(); transient.clear(); selected.clear();');
    await fs.writeFile(controllerFile, controller);
    const runtimeFile = path.join(folder, 'display-pmx-runtime.js');
    let runtime = await fs.readFile(runtimeFile, 'utf8');
    runtime = once(runtime, '        getProfile: () => currentProfile,', '        getProfile: () => currentProfile,\n        onTransientChanged: () => startRendering(),');
    runtime = once(runtime, '        getManualExpressions: () => manualExpressions.getState(),',
        '        setLipSyncExpressions: (token, weights) => manualExpressions.setTransient(token, weights),\n        getManualExpressions: () => manualExpressions.getState(),');
    await fs.writeFile(runtimeFile, runtime);
    for (const name of ['web-lipsync-timeline.mjs', 'web-lipsync-ui.mjs']) {
        let source = await fs.readFile(path.join(__dirname, name), 'utf8');
        if (name.includes('timeline')) source = once(source, '__LIPSYNC_PINYIN_URL__', `./${vendor}/dist/esm/index.mjs`);
        else source = once(source, './web-lipsync-timeline.mjs', `./web-lipsync-timeline.mjs?v=${(await hashFile(path.join(folder, 'web-lipsync-timeline.mjs'))).sha256.slice(0, 12)}`);
        await fs.writeFile(path.join(folder, name), source);
    }
    const displayFile = path.join(folder, 'display-mmd.js');
    let display = await fs.readFile(displayFile, 'utf8');
    display = once(display, '        getManualExpressions: () =>', `        setLipSyncExpressions: (token, weights) => state.modelReady && state.runtimeType === 'pmx'
            && state.runtime?.setLipSyncExpressions?.(token, weights),
        getManualExpressions: () =>`);
    display += `\nimport('./web-lipsync-ui.mjs?v=${(await hashFile(path.join(folder, 'web-lipsync-ui.mjs'))).sha256.slice(0, 12)}').catch(error => console.warn('[MMD] 口型面板加载失败:', error));\n`;
    await fs.writeFile(displayFile, display);
}

module.exports = { prepare, stageRuntime };
if (require.main === module) prepare().then(files => process.stdout.write(`[mmd-ar-lipsync] 固定拼音资源已校验：${files.length}文件\n`))
    .catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
