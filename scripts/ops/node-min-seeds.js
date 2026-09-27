'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SEED_DIRECTORIES = ['config', 'userconfig', 'task'];
const TASK_INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isLatestMarker(relativePath) {
    const parts = relativePath.split('/');
    return parts.length === 4 && parts[0] === 'task' && parts[2] === 'results' && parts[3] === 'latest';
}

function normalizeLatestTarget(value, relativePath) {
    const instanceId = String(value || '').trim();
    if (!TASK_INSTANCE_ID_PATTERN.test(instanceId)) {
        throw new Error(`任务 latest marker 必须是安全的实例 ID: ${relativePath}`);
    }
    return instanceId;
}

async function copySeedEntry(sourceRoot, stagingRoot, relativePath) {
    const sourcePath = path.join(sourceRoot, ...relativePath.split('/'));
    const targetPath = path.join(stagingRoot, ...relativePath.split('/'));
    const stat = await fs.promises.lstat(sourcePath);
    if (stat.isDirectory()) {
        await fs.promises.mkdir(targetPath, { recursive: true });
        const children = (await fs.promises.readdir(sourcePath)).sort();
        for (const child of children) await copySeedEntry(sourceRoot, stagingRoot, `${relativePath}/${child}`);
        return;
    }

    if (stat.isSymbolicLink()) {
        if (!isLatestMarker(relativePath)) throw new Error(`Node min 种子不支持符号链接: ${relativePath}`);
        const linkTarget = await fs.promises.readlink(sourcePath);
        const resolvedTarget = path.resolve(path.dirname(sourcePath), linkTarget);
        const resultsRoot = path.dirname(sourcePath);
        if (path.dirname(resolvedTarget) !== resultsRoot) {
            throw new Error(`任务 latest 符号链接必须指向同一 results 目录的实例: ${relativePath}`);
        }
        const instanceId = normalizeLatestTarget(path.basename(resolvedTarget), relativePath);
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, `${instanceId}\n`, { flag: 'wx' });
        return;
    }

    if (!stat.isFile()) throw new Error(`Node min 种子包含不支持的文件类型: ${relativePath}`);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    if (isLatestMarker(relativePath)) {
        const instanceId = normalizeLatestTarget(await fs.promises.readFile(sourcePath, 'utf8'), relativePath);
        await fs.promises.writeFile(targetPath, `${instanceId}\n`, { flag: 'wx' });
        return;
    }
    await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
}

async function stageNodeMinSeeds(releaseRoot, stagingRoot) {
    const sourceRoot = path.resolve(releaseRoot);
    const targetRoot = path.resolve(stagingRoot);
    await fs.promises.mkdir(targetRoot, { recursive: false });
    for (const directory of SEED_DIRECTORIES) {
        const sourcePath = path.join(sourceRoot, directory);
        const stat = await fs.promises.lstat(sourcePath).catch(() => null);
        if (!stat?.isDirectory() || stat.isSymbolicLink()) {
            throw new Error(`Node min release 种子目录缺失或类型错误: ${sourcePath}`);
        }
        await copySeedEntry(sourceRoot, targetRoot, directory);
    }
    const configStat = await fs.promises.lstat(path.join(targetRoot, 'config', 'config.json')).catch(() => null);
    if (!configStat?.isFile() || configStat.isSymbolicLink()) {
        throw new Error('Node min release 种子缺少 config/config.json');
    }
    return targetRoot;
}

module.exports = {
    SEED_DIRECTORIES,
    stageNodeMinSeeds
};
