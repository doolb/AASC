'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./files');
const { validateBaseline } = require('./seed-baseline');

const MAPPING = Object.freeze({ config: 'config', userconfig: 'home/.config/aasc-user', task: 'res/tasks' });
async function restoreSeeds(source, root) {
    if (!files.read(source, 'config/config.json')) throw new Error('初始配置缺失');
    for (const name of await fs.promises.readdir(source)) if (!Object.hasOwn(MAPPING, name)) throw new Error('种子根目录无效');
    const baseline = files.read(source, 'config/data-repair-state.json');
    let pending = files.read(root, 'data-repair/seed-initializing.json');
    if (pending && JSON.stringify(pending) !== JSON.stringify(baseline)) throw new Error('未完成的种子基线已改变');
    if (!pending && baseline && !fs.existsSync(path.join(root, 'config/config.json')) &&
        !fs.existsSync(path.join(root, 'home/.config/aasc-user/userconfig.json')) && !fs.existsSync(path.join(root, 'data-repair/state.json'))) {
        validateBaseline(baseline);
        for (const entry of baseline.files) if (!await files.matches(source, path.join(source, entry.path), entry)) throw new Error('种子基线与文件内容不一致');
        await files.atomic(root, 'data-repair/seed-initializing.json', baseline); pending = baseline;
    }
    const markers = [];
    async function merge(from, to, relative, group) {
        const stat = await fs.promises.lstat(files.safe(source, from));
        const latest = group === 'task' && /^[^/]+\/results\/latest$/.test(relative);
        // 仅既有latest链接可以保留；它的父目录仍必须逐层验证。
        files.safe(root, path.dirname(to));
        const old = await fs.promises.lstat(to).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (latest && old?.isSymbolicLink()) return;
        files.safe(root, to);
        if (stat.isDirectory()) {
            if (old && !old.isDirectory()) throw new Error('种子目录被非目录占用');
            await fs.promises.mkdir(to, { recursive: true });
            for (const name of await fs.promises.readdir(from)) await merge(path.join(from, name), path.join(to, name), relative ? `${relative}/${name}` : name, group);
        } else if (stat.isFile()) {
            await fs.promises.mkdir(path.dirname(to), { recursive: true });
            if (!old) await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL);
            if (latest) markers.push(to);
        } else throw new Error('种子包含链接或特殊文件');
    }
    for (const [name, target] of Object.entries(MAPPING)) await merge(path.join(source, name), path.join(root, target), '', name);
    for (const file of markers) {
        const id = (await fs.promises.readFile(file, 'utf8')).trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error('任务latest标记无效');
        const target = files.safe(root, path.join(path.dirname(file), id));
        if (!fs.statSync(target).isDirectory()) throw new Error('任务latest实例不存在');
        await fs.promises.unlink(file); await fs.promises.symlink(id, file);
    }
    if (pending) {
        if (!files.read(root, 'data-repair/state.json')) {
            for (const entry of pending.files) {
                const [group, ...parts] = entry.path.split('/');
                const target = path.join(root, MAPPING[group], ...parts);
                if (!await files.matches(root, target, entry)) throw new Error('落盘基线与种子内容不符');
            }
            await files.atomic(root, 'data-repair/state.json', { dataVersion: pending.dataVersion, latestRepairVersion: pending.latestRepairVersion,
                includedRepairs: pending.includedRepairs, appliedRepairs: [] });
        }
        await fs.promises.unlink(path.join(root, 'data-repair/seed-initializing.json'));
    }
}
module.exports = { restoreSeeds };
