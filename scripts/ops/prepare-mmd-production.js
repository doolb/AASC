'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { stageVendor } = require('./mmd-mpl-assets');
const { stage } = require('../../3rd/mmd-ar-test/web-human-actions-build');
const { STATIC_MMD_RELEASE } = require('../../src/apps/server/modules/mmd/mmd-resource-service');

// 正式包输入由固定源码和摘要生成，模型文件仍走已有代理，不把PMX/纹理复制进服务包。
async function prepareProductionMmd(projectRoot = path.resolve(__dirname, '../..')) {
    const target = path.join(projectRoot, 'src/apps/web-mediacenter/ui/public');
    await stageVendor(target);
    await stage(target);
    const [name, size, sha256] = STATIC_MMD_RELEASE.files.find(([name]) => name.endsWith('/miya-default.vmd'));
    const valid = bytes => bytes.length === size && crypto.createHash('sha256').update(bytes).digest('hex') === sha256;
    let dance;
    for (const candidate of [path.join(projectRoot, '3rd/mmd-ar-test/model-cache', STATIC_MMD_RELEASE.version, name), path.join(target, name)]) {
        try { const bytes = await fs.readFile(candidate); if (valid(bytes)) { dance = bytes; break; } }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!dance) {
        const response = await fetch('http://' + STATIC_MMD_RELEASE.host + STATIC_MMD_RELEASE.publicPath + name,
            { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error('正式跳舞资源下载失败：HTTP ' + response.status);
        dance = Buffer.from(await response.arrayBuffer());
        if (!valid(dance)) throw new Error('正式跳舞资源大小/SHA-256不一致');
    }
    await fs.writeFile(path.join(target, name), dance);
    const files = ['mmd-actions.json', 'mmd/motions/miya-idle.mpl', 'mmd/motions/miya-idle.vmd', name];
    const manifest = [];
    for (const name of files) {
        const data = await fs.readFile(path.join(target, name));
        manifest.push({ name, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
    }
    await fs.writeFile(path.join(target, 'mmd/actions-source.json'), JSON.stringify({ schema: 1, files: manifest }, null, 2) + '\n');
    return manifest;
}
module.exports = { prepareProductionMmd };
if (require.main === module) prepareProductionMmd().then(files => {
    process.stdout.write('[mmd-production] 编译器/许可证与待机/跳舞资源已校验：' + files.length + '项\n');
}).catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
