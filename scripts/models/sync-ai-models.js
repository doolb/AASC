'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const common = require('./ai-model-common');

async function syncModels({ source = common.SOURCE_URL, root = common.MODEL_ROOT, groups = common.GROUPS,
    fetchImpl = fetch, mirrorManifest = false, log = message => process.stderr.write(`${message}\n`) } = {}) {
    if (!Array.isArray(groups) || !groups.length || groups.some(group => !common.GROUPS.includes(group))) {
        throw new Error('模型分类无效');
    }
    const manifest = await common.readManifest(source, fetchImpl);
    const files = manifest.files.filter(item => groups.includes(item.path.split('/')[0]));
    if (!files.length) throw new Error('远端清单没有所选分类');
    const report = { source: common.normalizeSource(source), root: path.resolve(root), reused: [], downloaded: [],
        totalBytes: files.reduce((total, item) => total + item.size, 0) };
    for (const item of files) {
        if (await common.matchesFile(root, item)) {
            report.reused.push(item.path); log(`[复用] ${item.path}`); continue;
        }
        const target = await common.safeFile(root, item.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        // 只写入本次独占临时文件，流完整校验之后才替换既有模型。
        const temporary = `${target}.download-${crypto.randomUUID()}`;
        const handle = await fs.open(temporary, 'wx');
        try {
            log(`[下载] ${item.path} (${item.size} bytes)`);
            await common.streamRemote(source, item, async chunk => {
                let offset = 0;
                while (offset < chunk.length) {
                    const result = await handle.write(chunk, offset, chunk.length - offset);
                    if (!result.bytesWritten) throw new Error('临时文件写入未推进');
                    offset += result.bytesWritten;
                }
            }, fetchImpl);
            await handle.sync(); await handle.close();
            await common.safeFile(root, item.path);
            await fs.rename(temporary, target);
            report.downloaded.push(item.path);
        } catch (error) {
            await handle.close().catch(() => {});
            throw error;
        } finally { await fs.rm(temporary, { force: true }); }
    }
    if (mirrorManifest) {
        report.manifest = await mirrorRootManifest(root, manifest);
    }
    return report;
}

async function mirrorRootManifest(root, manifest) {
    // 所有模型文件通过大小和哈希校验后才提交根清单，避免清单提前指向未就绪的文件。
    const target = await common.safeFile(root, 'manifest.json', { allowManifest: true });
    const bytes = common.manifestBytes(manifest);
    try {
        const current = await fs.readFile(target);
        if (current.equals(bytes)) return 'reused';
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${crypto.randomUUID()}`;
    const handle = await fs.open(temporary, 'wx', 0o644);
    try {
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        await common.safeFile(root, 'manifest.json', { allowManifest: true });
        await fs.rename(temporary, target);
        return 'written';
    } catch (error) {
        await handle.close().catch(() => {});
        throw error;
    } finally {
        await fs.rm(temporary, { force: true });
    }
}

async function main() {
    const args = common.parseArgs(process.argv.slice(2), ['source', 'root', 'groups', 'report']);
    if (args.help) {
        process.stdout.write('npm run sync:ai-models -- [--source HTTPS目录] [--root 模型目录] [--groups yolo11,sensevoice,...] [--report JSON路径]\n');
        return;
    }
    const report = await syncModels({ source: args.source, root: args.root, groups: args.groups?.split(',') });
    await common.saveReport(args.report, report);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
module.exports = { syncModels };
