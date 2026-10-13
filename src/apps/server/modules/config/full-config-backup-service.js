'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { resolveReleaseRuntimeContext } = require('../../../../core/release-runtime-context');

const FORMAT = 'aasc-full-config';
const LIMITS = Object.freeze({ zipBytes: 100 * 1024 * 1024, totalBytes: 256 * 1024 * 1024,
    fileBytes: 64 * 1024 * 1024, manifestBytes: 1024 * 1024, files: 5000 });
const PREVIEW_TTL = 30 * 60 * 1000;
const SCOPES = ['config', 'userconfig'];
const EXCLUDED_DIRS = new Set(['logs', 'cache', '.cache', 'tmp', 'temp', 'backups',
    'aasc-user-backups', 'chat-history-backups', 'node_modules']);
const TOKEN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

function backupError(message, statusCode = 400) {
    return Object.assign(new Error(message), { statusCode });
}

function persistentPath(name) {
    return !name.split('/').some(part => EXCLUDED_DIRS.has(part.toLowerCase()))
        && !/(?:\.(?:log|pid|lock|tmp|sock|socket)$|\.tmp-|\.corrupt-)/iu.test(name);
}

function validatePath(name) {
    const parts = typeof name === 'string' ? name.split('/') : [];
    if (parts.length < 2 || !SCOPES.includes(parts[0]) || name.length > 1024
        || /[\x00-\x1f\x7f\\:]/u.test(name)
        || parts.some(part => !part || part === '.' || part === '..') || !persistentPath(name)) {
        throw backupError('ZIP 包含不允许的配置文件路径');
    }
    return name;
}

function mkdirPrivate(directory) {
    // 创建前逐级检查已有父目录，防止工作目录被链接引向配置范围以外。
    let ancestor = path.resolve(directory);
    while (true) {
        let details = null;
        try { details = fs.lstatSync(ancestor); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (details && (!details.isDirectory() || details.isSymbolicLink())) throw backupError('备份工作目录不允许链接或非普通目录');
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw backupError('备份工作目录类型错误');
}

// 所有导入目标都逐级检查，不能仅靠字符串前缀检查后跟随目录链接写到配置范围之外。
function safeTarget(roots, name, createParents = false) {
    const parts = validatePath(name).split('/');
    const root = roots[parts.shift()];
    let current = root;
    for (let index = 0; index <= parts.length; index += 1) {
        let stat = null;
        try { stat = fs.lstatSync(current); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (stat && (stat.isSymbolicLink() || (index < parts.length ? !stat.isDirectory() : !stat.isFile()))) {
            throw backupError('配置目标存在链接或非普通文件');
        }
        if (!stat && index < parts.length && createParents) mkdirPrivate(current);
        if (index < parts.length) current = path.join(current, parts[index]);
    }
    return current;
}

function fileDigest(filePath) {
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    const fd = fs.openSync(filePath, 'r');
    let size = 0;
    try {
        let count;
        while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
            size += count;
            hash.update(buffer.subarray(0, count));
        }
    } finally { fs.closeSync(fd); }
    return { size, sha256: hash.digest('hex') };
}

function atomicJson(filePath, data) {
    mkdirPrivate(path.dirname(filePath));
    const temporary = `${filePath}.tmp-${crypto.randomUUID()}`;
    let fd;
    try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(temporary, filePath);
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        fs.rmSync(temporary, { force: true });
    }
}

function atomicCopy(source, target) {
    mkdirPrivate(path.dirname(target));
    const temporary = `${target}.tmp-${crypto.randomUUID()}`;
    try {
        fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(temporary, 0o600);
        const fd = fs.openSync(temporary, 'r');
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, target);
    } finally { fs.rmSync(temporary, { force: true }); }
}

function collectFiles(roots) {
    const files = [];
    for (const scope of SCOPES) {
        const walk = (directory, relative) => {
            const stat = fs.lstatSync(directory);
            if (stat.isSymbolicLink() || !stat.isDirectory()) throw backupError('配置根目录不是普通目录');
            for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                const name = `${relative}/${entry.name}`;
                if (!persistentPath(name) || entry.isSymbolicLink()) continue;
                const source = path.join(directory, entry.name);
                if (entry.isDirectory()) { walk(source, name); continue; }
                if (!entry.isFile()) continue;
                validatePath(name);
                const details = fs.statSync(source, { bigint: true });
                files.push({ path: name, source, size: Number(details.size),
                    stamp: `${details.ino}:${details.size}:${details.mtimeNs}:${details.ctimeNs}` });
            }
        };
        if (fs.existsSync(roots[scope])) walk(roots[scope], scope);
    }
    return files;
}

function validateManifest(manifest) {
    if (!manifest || manifest.format !== FORMAT || manifest.version !== 1
        || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > LIMITS.files) {
        throw backupError('全量配置 ZIP 的 manifest 格式或版本不支持');
    }
    const seen = new Set();
    let total = 0;
    for (const file of manifest.files) {
        validatePath(file?.path);
        const folded = file.path.toLowerCase();
        if (seen.has(folded)) throw backupError('ZIP 清单包含重复路径');
        seen.add(folded);
        if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > LIMITS.fileBytes
            || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(file.sha256)) {
            throw backupError('ZIP 清单文件大小或 SHA-256 无效');
        }
        total += file.size;
        if (total > LIMITS.totalBytes) throw backupError('ZIP 解压总大小超过限制');
    }
    if (!seen.has('config/config.json')) throw backupError('ZIP 缺少全局 config/config.json');
    return manifest;
}

function validateJsonFile(filePath, name) {
    if (!name.endsWith('.json')) return;
    let value;
    try { value = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch (_) { throw backupError(`备份 JSON 文件格式错误: ${name}`); }
    if (['config/config.json', 'userconfig/userconfig.json'].includes(name)
        && (!value || typeof value !== 'object' || Array.isArray(value))) {
        throw backupError(`备份配置必须为 JSON 对象: ${name}`);
    }
    if (name === 'config/config.json' && value.server?.port !== undefined
        && (!Number.isInteger(value.server.port) || value.server.port < 1 || value.server.port > 65535)) {
        throw backupError('备份中的服务器端口无效');
    }
}

function createFullConfigBackupService(options = {}) {
    // Android的/data/user/0可能是系统别名；只解析受信任根，根内部仍逐级拒绝链接。
    const requestedRoot = path.resolve(options.projectRoot || process.env.AASC_PROJECT_ROOT || path.resolve(__dirname, '../../../../..'));
    const projectRoot = fs.realpathSync(requestedRoot);
    const projectPath = value => {
        const absolute = path.resolve(value);
        const relative = path.relative(requestedRoot, absolute);
        const withinRoot = relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
        return withinRoot ? path.join(projectRoot, relative) : absolute;
    };
    const context = options.context || resolveReleaseRuntimeContext({ projectRoot });
    const roots = { config: path.dirname(projectPath(context.configFile)), userconfig: projectPath(context.userConfigDir) };
    const stateRoot = projectPath(options.stateRoot || path.join(projectRoot, 'res/config-backup'));
    const uploadDir = path.join(stateRoot, 'uploads');
    const pendingPath = path.join(stateRoot, 'pending.json');
    const resultPath = path.join(stateRoot, 'last-result.json');
    let busy = false;

    const ownedDirectory = (category, id) => {
        if (!TOKEN.test(id || '')) throw backupError('导入预览标识无效');
        mkdirPrivate(path.join(stateRoot, category));
        const directory = path.join(stateRoot, category, id);
        if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw backupError('备份暂存目录不允许链接');
        return directory;
    };
    const requestPath = id => path.join(ownedDirectory('previews', id), 'request.json');
    const loadRequest = id => {
        let request;
        try { request = JSON.parse(fs.readFileSync(requestPath(id), 'utf8')); }
        catch (_) { throw backupError('导入预览不存在或已过期', 404); }
        validateManifest(request.manifest);
        if (!['merge', 'replace'].includes(request.mode)) throw backupError('导入模式无效');
        return request;
    };
    // 只回收本模块生成且已过期的未确认预览，不扫描或清理配置/聊天目录。
    const cleanupPreviews = () => {
        const root = path.join(stateRoot, 'previews');
        if (!fs.existsSync(root)) return;
        const pending = fs.existsSync(pendingPath) ? JSON.parse(fs.readFileSync(pendingPath, 'utf8')).id : null;
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !TOKEN.test(entry.name) || entry.name === pending) continue;
            const directory = ownedDirectory('previews', entry.name);
            try {
                const request = loadRequest(entry.name);
                if (request.status === 'preview' && Date.now() - request.createdAt > PREVIEW_TTL) fs.rmSync(directory, { recursive: true, force: true });
            } catch (_) { /* 异常事务保留，不能把待诊断数据当作过期预览删除。 */ }
        }
    };
    const withLock = async operation => {
        if (busy) throw backupError('正在处理另一项配置备份操作，请稍后重试', 409);
        busy = true;
        try { return await operation(); } finally { busy = false; }
    };

    async function exportArchive() {
        return withLock(async () => {
            await options.prepareExport?.();
            const id = crypto.randomUUID();
            const directory = ownedDirectory('exports', id);
            mkdirPrivate(directory);
            try {
                const before = collectFiles(roots);
                if (before.length > LIMITS.files || before.reduce((sum, file) => sum + file.size, 0) > LIMITS.totalBytes
                    || before.some(file => file.size > LIMITS.fileBytes)) throw backupError('配置备份大小或文件数量超过限制');
                const manifest = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), files: [] };
                for (const file of before) {
                    const copy = path.join(directory, 'snapshot', file.path);
                    mkdirPrivate(path.dirname(copy));
                    fs.copyFileSync(file.source, copy);
                    manifest.files.push({ path: file.path, ...fileDigest(copy) });
                }
                const after = collectFiles(roots);
                if (JSON.stringify(before) !== JSON.stringify(after)) throw backupError('配置正在变化，请稍后重新导出', 409);
                validateManifest(manifest);
                const manifestBytes = Buffer.from(JSON.stringify(manifest));
                if (manifestBytes.length > LIMITS.manifestBytes) throw backupError('ZIP 清单大小超过限制');
                const archivePath = path.join(directory, 'backup.zip');
                const { ZipFile } = require('yazl');
                const zip = new ZipFile();
                const output = fs.createWriteStream(archivePath, { flags: 'wx', mode: 0o600 });
                zip.on('error', error => zip.outputStream.destroy(error));
                zip.addBuffer(manifestBytes, 'manifest.json');
                for (const file of manifest.files) zip.addFile(path.join(directory, 'snapshot', file.path), file.path, { mode: 0o100600 });
                const finished = pipeline(zip.outputStream, output);
                zip.end();
                await finished;
                if (fs.statSync(archivePath).size > LIMITS.zipBytes) throw backupError('ZIP 备份大小超过限制');
                return { archivePath, filename: `aasc-full-config-${new Date().toISOString().replace(/[:.]/gu, '-')}.zip`,
                    manifest, dispose: () => fs.rmSync(directory, { recursive: true, force: true }) };
            } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
        });
    }

    async function previewArchive(archivePath, mode = 'merge') {
        return withLock(async () => {
            cleanupPreviews();
            if (!['merge', 'replace'].includes(mode)) throw backupError('导入模式无效');
            const stat = fs.lstatSync(archivePath);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.zipBytes) throw backupError('ZIP 上传文件无效或过大');
            const id = crypto.randomUUID();
            const directory = ownedDirectory('previews', id);
            const payloadDir = path.join(directory, 'payload');
            mkdirPrivate(payloadDir);
            const received = new Map();
            const seen = new Set();
            let total = 0;
            let manifest;
            try {
                const yauzl = require('yauzl');
                const zip = await new Promise((resolve, reject) => yauzl.open(archivePath,
                    { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value)));
                await new Promise((resolve, reject) => {
                    const fail = error => { zip.close(); reject(error); };
                    zip.on('error', fail);
                    zip.on('end', resolve);
                    zip.on('entry', async entry => {
                        try {
                            const name = entry.fileName;
                            const type = (entry.externalFileAttributes >>> 16) & 0o170000;
                            if ((type !== 0 && type !== 0o100000) || (entry.generalPurposeBitFlag & 1)
                                || seen.has(name.toLowerCase()) || seen.size >= LIMITS.files + 1) throw backupError('ZIP 包含链接、重复路径、加密或过多条目');
                            seen.add(name.toLowerCase());
                            if (name !== 'manifest.json') validatePath(name);
                            const max = name === 'manifest.json' ? LIMITS.manifestBytes : LIMITS.fileBytes;
                            if (entry.uncompressedSize > max || total + entry.uncompressedSize > LIMITS.totalBytes + LIMITS.manifestBytes) throw backupError('ZIP 解压大小超过限制');
                            const input = await new Promise((yes, no) => zip.openReadStream(entry, (error, value) => error ? no(error) : yes(value)));
                            const target = path.join(payloadDir, name);
                            mkdirPrivate(path.dirname(target));
                            let size = 0;
                            const hash = crypto.createHash('sha256');
                            const check = new Transform({ transform(chunk, encoding, callback) {
                                size += chunk.length;
                                if (size > max || total + size > LIMITS.totalBytes + LIMITS.manifestBytes) return callback(backupError('ZIP 解压大小超过限制'));
                                hash.update(chunk); callback(null, chunk);
                            } });
                            await pipeline(input, check, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
                            total += size;
                            if (name === 'manifest.json') {
                                try { manifest = JSON.parse(fs.readFileSync(target, 'utf8')); }
                                catch (_) { throw backupError('ZIP manifest 不是有效 JSON'); }
                            } else received.set(name, { size, sha256: hash.digest('hex') });
                            zip.readEntry();
                        } catch (error) { fail(error); }
                    });
                    zip.readEntry();
                });
                validateManifest(manifest);
                if (received.size !== manifest.files.length) throw backupError('ZIP 文件与 manifest 清单不一致');
                for (const file of manifest.files) {
                    const actual = received.get(file.path);
                    if (!actual || actual.size !== file.size || actual.sha256 !== file.sha256) throw backupError(`ZIP 文件 SHA-256 或大小不匹配: ${file.path}`);
                    validateJsonFile(path.join(payloadDir, file.path), file.path);
                    safeTarget(roots, file.path);
                }
                const current = collectFiles(roots);
                const existing = new Set(current.map(file => file.path));
                const incoming = new Set(manifest.files.map(file => file.path));
                const stats = { files: manifest.files.length, configFiles: manifest.files.filter(file => file.path.startsWith('config/')).length,
                    userFiles: manifest.files.filter(file => file.path.startsWith('userconfig/')).length,
                    overwritten: manifest.files.filter(file => existing.has(file.path)).length,
                    added: manifest.files.filter(file => !existing.has(file.path)).length,
                    deleted: mode === 'replace' ? current.filter(file => !incoming.has(file.path)).length : 0 };
                atomicJson(requestPath(id), { id, mode, manifest, createdAt: Date.now(), status: 'preview', stats });
                return { id, mode, ...stats, exportedAt: manifest.exportedAt };
            } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
        });
    }

    function commitPreview(id, mode, confirmed) {
        if (confirmed !== true) throw backupError('导入需要确认预览');
        if (fs.existsSync(pendingPath)) throw backupError('已有配置导入等待重启应用', 409);
        const request = loadRequest(id);
        if (request.status !== 'preview' || request.mode !== mode || Date.now() - request.createdAt > PREVIEW_TTL) throw backupError('预览已过期或导入模式已改变，请重新预览');
        atomicJson(pendingPath, { id });
        return { id, ...request.stats, restarting: true, restartRequired: true };
    }

    function status() {
        if (fs.existsSync(pendingPath)) return { status: 'pending', ...JSON.parse(fs.readFileSync(pendingPath, 'utf8')) };
        if (fs.existsSync(resultPath)) return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        return { status: 'idle' };
    }

    function rollback(id, journal) {
        const backupDir = ownedDirectory('backups', id);
        for (const file of journal) {
            const target = safeTarget(roots, file.path, true);
            if (file.existed) {
                const copy = path.join(backupDir, file.path);
                const actual = fileDigest(copy);
                if (actual.size !== file.size || actual.sha256 !== file.sha256) throw backupError('恢复前备份损坏，停止启动');
                atomicCopy(copy, target);
            } else fs.rmSync(target, { force: true });
        }
    }

    function applyPending() {
        if (!fs.existsSync(pendingPath)) return null;
        const { id } = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
        const request = loadRequest(id);
        const directory = ownedDirectory('previews', id);
        const payloadDir = path.join(directory, 'payload');
        let journal = null;
        let committed = false;
        try {
            if (request.status === 'applied') {
                if (request.result) atomicJson(resultPath, request.result);
                fs.rmSync(pendingPath, { force: true });
                return status();
            }
            if (request.status === 'applying') {
                journal = request.journal;
                throw backupError('上次配置恢复被中断，已回滚到原配置');
            }
            for (const file of request.manifest.files) {
                const source = safeTarget({ config: path.join(payloadDir, 'config'), userconfig: path.join(payloadDir, 'userconfig') }, file.path);
                const sourceStat = fs.lstatSync(source);
                if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw backupError('暂存配置不是普通文件');
                const actual = fileDigest(source);
                if (actual.size !== file.size || actual.sha256 !== file.sha256) throw backupError('暂存配置 SHA-256 校验失败');
                validateJsonFile(source, file.path);
                safeTarget(roots, file.path);
            }
            const incoming = new Set(request.manifest.files.map(file => file.path));
            const deleted = request.mode === 'replace' ? collectFiles(roots).filter(file => !incoming.has(file.path)).map(file => file.path) : [];
            const operations = [...incoming, ...deleted];
            journal = operations.map(name => {
                const target = safeTarget(roots, name);
                if (!fs.existsSync(target)) return { path: name, existed: false };
                const copy = path.join(ownedDirectory('backups', id), name);
                mkdirPrivate(path.dirname(copy));
                fs.copyFileSync(target, copy);
                fs.chmodSync(copy, 0o600);
                return { path: name, existed: true, ...fileDigest(copy) };
            });
            atomicJson(path.join(ownedDirectory('backups', id), 'journal.json'), journal);
            atomicJson(requestPath(id), { ...request, status: 'applying', journal });
            for (const file of request.manifest.files) {
                atomicCopy(path.join(payloadDir, file.path), safeTarget(roots, file.path, true));
                options.afterApplyFile?.(file.path);
            }
            for (const name of deleted) fs.rmSync(safeTarget(roots, name), { force: true });
            const result = { status: 'applied', id, mode: request.mode, ...request.stats, appliedAt: new Date().toISOString() };
            atomicJson(requestPath(id), { ...request, status: 'applied', result });
            committed = true;
            atomicJson(resultPath, result);
            fs.rmSync(pendingPath, { force: true });
            try { fs.rmSync(directory, { recursive: true, force: true }); }
            catch (_) { /* 已提交恢复不因临时目录清理失败回滚，备份和状态均保留。 */ }
            return result;
        } catch (error) {
            // 已提交时保留完成标识；下次启动补写结果，不能把已生效的数据回滚成旧配置。
            if (committed) throw error;
            // 回滚失败必须阻止模块加载，保留 applying 日志，不能启动一半新、一半旧的配置。
            if (journal) rollback(id, journal);
            const result = { status: 'failed', id, message: error.message, rolledBack: true };
            atomicJson(resultPath, result);
            fs.rmSync(pendingPath, { force: true });
            return result;
        }
    }

    function cancelPreview(id) {
        if (fs.existsSync(pendingPath) && JSON.parse(fs.readFileSync(pendingPath, 'utf8')).id === id) throw backupError('已确认的导入不能取消', 409);
        fs.rmSync(ownedDirectory('previews', id), { recursive: true, force: true });
    }

    const prepareUpload = () => { mkdirPrivate(stateRoot); mkdirPrivate(uploadDir); cleanupPreviews(); };
    return { exportArchive, previewArchive, commitPreview, cancelPreview, status, applyPending, prepareUpload,
        roots, stateRoot, uploadDir, limits: LIMITS };
}

function applyPendingConfigImport(options = {}) {
    return createFullConfigBackupService(options).applyPending();
}

module.exports = { createFullConfigBackupService, applyPendingConfigImport, validateManifest, LIMITS };
