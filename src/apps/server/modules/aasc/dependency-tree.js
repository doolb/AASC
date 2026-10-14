'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalJson, hash } = require('./shared-update-manifest');

async function hashFile(file) {
    const digest = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
    return digest.digest('hex');
}
/** 内容指纹只覆盖普通文件的路径与内容，排除npm元数据和工具链接。 */
async function treeFiles(directory, prefix = '') {
    const rootStat = await fs.promises.lstat(directory);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('依赖根目录不能为链接或非目录');
    const files = [];
    for (const name of (await fs.promises.readdir(directory)).sort()) {
        const relative = prefix ? `${prefix}/${name}` : name;
        const absolute = path.join(directory, name);
        const stat = await fs.promises.lstat(absolute);
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`依赖树含链接/特殊文件：${relative}`);
        if (stat.isDirectory()) files.push(...await treeFiles(absolute, relative));
        else files.push({ path: relative, sha256: await hashFile(absolute) });
    }
    return files;
}
async function contentHash(directory) { return hash(canonicalJson(await treeFiles(directory))); }
/** 合并仅接受互不重叠的普通文件；即使同内容也拒绝跨组覆盖。 */
async function mergeTree(source, destination) {
    const sourceStat = await fs.promises.lstat(source);
    const targetStat = await fs.promises.lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink() || targetStat?.isSymbolicLink()) throw new Error('依赖合并目录不能为链接');
    for (const name of await fs.promises.readdir(source)) {
        const from = path.join(source, name); const to = path.join(destination, name);
        const stat = await fs.promises.lstat(from);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('依赖层含链接/特殊文件');
        if (stat.isDirectory()) { await fs.promises.mkdir(to, { recursive: true }); await mergeTree(from, to); }
        else { await fs.promises.mkdir(path.dirname(to), { recursive: true }); await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL); }
    }
}
function assertNoLinks(root, target) {
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('依赖路径越界');
    let current = root;
    for (const part of ['', ...relative.split(path.sep)]) {
        if (part) current = path.join(current, part);
        try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('依赖路径含链接'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
}
module.exports = { hashFile, treeFiles, contentHash, mergeTree, assertNoLinks };
