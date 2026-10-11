'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { prepare } = require('../../scripts/ops/mmd-mpl-assets');

// 用已固定且校验SHA-256的编译器生成待机，目录仍引用原舞蹈资源。
async function stage(root) {
    const cache = await prepare();
    const source = await fs.readFile(path.join(cache, 'mmd_mpl.js'));
    const compilerModule = await import('data:text/javascript;base64,' + source.toString('base64'));
    await compilerModule.default({ module_or_path: await fs.readFile(path.join(cache, 'mmd_mpl_bg.wasm')) });
    const compiler = new compilerModule.WasmMPLCompiler();
    try {
        const bytes = compiler.compile(await fs.readFile(path.join(__dirname, 'idle.mpl'), 'utf8'));
        // 编译器会输出未提及骨骼的默认轨道；待机仅保留双臂，避免固定头眼或写物理裙骨。
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const names = new Set(['左腕', '右腕', '左ひじ', '右ひじ', '左手首', '右手首']);
        const decoder = new TextDecoder('shift-jis'), frames = [];
        for (let index = 0; index < view.getUint32(50, true); index++) {
            const start = 54 + index * 111, nameBytes = bytes.subarray(start, start + 15);
            const end = nameBytes.indexOf(0);
            const name = decoder.decode(end < 0 ? nameBytes : nameBytes.subarray(0, end));
            if (names.has(name)) frames.push({ name, number: view.getUint32(start + 15, true), bytes: bytes.subarray(start, start + 111) });
        }
        if (!frames.length) throw new Error('编译待机缺少手臂轨道');
        const idle = new Uint8Array(54 + frames.length * 111 + 20);
        idle.set(bytes.subarray(0, 50)); new DataView(idle.buffer).setUint32(50, frames.length, true);
        frames.forEach((frame, index) => idle.set(frame.bytes, 54 + index * 111));
        const folder = path.join(root, 'mmd/motions');
        await fs.mkdir(folder, { recursive: true });
        await fs.writeFile(path.join(folder, 'miya-idle.vmd'), idle);
        // 源码与编译输入相同，界面编辑/预览不会遗漏手腕补偿。
        await fs.copyFile(path.join(__dirname, 'idle.mpl'), path.join(folder, 'miya-idle.mpl'));
    } catch (error) { throw new Error('待机MPL编译失败：' + String(error)); }
    finally { compiler.free(); }
    const catalog = JSON.parse(await fs.readFile(path.join(__dirname, 'server-actions.json'), 'utf8'));
    await fs.writeFile(path.join(root, 'mmd-actions.json'), JSON.stringify(catalog, null, 2) + '\n');
}
module.exports = { stage };
