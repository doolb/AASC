'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');

function safe(root, target) {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('受管路径越界');
    let current = path.resolve(root);
    for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
        if (part) current = path.join(current, part);
        try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('受管路径包含链接'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return target;
}
function read(root, relative, fallback = null, limit = 2 * 1024 ** 2) {
    const file = safe(root, path.join(root, relative));
    try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > limit) throw new Error('状态文件类型或大小无效');
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function atomic(root, relative, value) {
    const file = safe(root, path.join(root, relative));
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    const handle = await fs.promises.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    try { await fs.promises.rename(temporary, file); }
    finally { await fs.promises.rm(temporary, { force: true }); }
}
async function hash(file) {
    const digest = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
    return digest.digest('hex');
}
async function matches(root, file, entry) {
    safe(root, file);
    const stat = await fs.promises.stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    return !!stat?.isFile() && stat.size === entry.size && await hash(file) === entry.sha256;
}
function space(root, bytes, reserve = 128 * 1024 ** 2) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('空间需求无效');
    const stat = fs.statfsSync(root);
    if (stat.bavail * stat.bsize < bytes + reserve) throw new Error('设备空间不足，保留当前版本');
}
async function walk(root, relative = '') {
    const directory = safe(root, path.join(root, relative));
    const result = [];
    for (const name of (await fs.promises.readdir(directory)).sort()) {
        const file = safe(root, path.join(directory, name));
        const stat = await fs.promises.lstat(file);
        const key = relative ? `${relative}/${name}` : name;
        if (stat.isDirectory()) result.push(...await walk(root, key));
        else if (stat.isFile()) result.push({ path: key, size: stat.size, sha256: await hash(file) });
        else throw new Error('受管目录包含特殊文件');
    }
    return result;
}
async function copy(source, destination) {
    safe(source, source); safe(destination, destination);
    await fs.promises.mkdir(destination, { recursive: true });
    for (const name of await fs.promises.readdir(source)) {
        const from = safe(source, path.join(source, name));
        const to = safe(destination, path.join(destination, name));
        const stat = await fs.promises.lstat(from);
        if (stat.isDirectory()) await copy(from, to);
        else if (stat.isFile()) {
            await pipeline(fs.createReadStream(from), fs.createWriteStream(to, { flags: 'wx', mode: 0o600 }));
        } else throw new Error('复制源包含特殊文件');
    }
}
/** 只有持有此锁的JS控制器可修改服务组合；崩溃后按存活PID恢复，不按超时时长抢锁。 */
function lock(root) {
    const directory = safe(root, path.join(root, 'updates/.offline-js-lock'));
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    if (fs.existsSync(directory)) {
        const owner = read(root, 'updates/.offline-js-lock/owner.json');
        // 单一固定宿主串行启动控制器；没有owner的空目录只能来自上次进程在写owner前崩溃。
        if (owner) {
            if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('更新锁身份无效');
            try { process.kill(owner.pid, 0); throw new Error('更新事务正在执行'); }
            catch (error) { if (error.code !== 'ESRCH') throw error; }
            fs.unlinkSync(path.join(directory, 'owner.json'));
        }
        fs.rmdirSync(directory);
    }
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
    return () => { fs.unlinkSync(path.join(directory, 'owner.json')); fs.rmdirSync(directory); };
}
module.exports = { safe, read, atomic, hash, matches, space, walk, copy, lock };
