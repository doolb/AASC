'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const root = path.resolve(__dirname, '../..');
async function main() {
    const folder = path.join(root, '3rd/mmd-ar-test/output/xishi');
    const source = path.join(folder, '西施 游龙清影.blend');
    await fs.access(source);
    // 禁止加载blend内自动脚本，源文件只读；Blender仅对内存副本烘焙并导出GLB。
    await new Promise((resolve, reject) => {
        const child = spawn(process.env.BLENDER_BIN || 'blender', ['--background', '--factory-startup', '--disable-autoexec', source,
            '--python-exit-code', '1', '--python', path.join(root, '3rd/mmd-ar-test/export-xishi.py'), '--', path.join(folder, 'xishi.glb')],
        { cwd: root, stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Blender导出失败：${code}`)));
    });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
