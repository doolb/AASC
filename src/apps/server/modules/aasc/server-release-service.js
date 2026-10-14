'use strict';

const fs = require('node:fs');
const path = require('node:path');
const shared = require('./shared-update-manifest');

/** 主服务器只分发共享发布根里的当前签名文件，HTTP请求不打包源码。 */
class ServerReleaseService {
    constructor(options = {}) {
        this.releaseRoot = path.resolve(options.releaseRoot || process.env.AASC_UPDATE_RELEASE_ROOT || '/mnt/aasc-offline');
        this.publicKeyPem = options.publicKeyPem || shared.PUBLIC_KEY;
        this.verifiedFiles = new Map();
    }
    _assertPath(file) {
        let current = this.releaseRoot;
        const relative = path.relative(current, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('发布文件路径越界');
        for (const segment of ['', ...relative.split(path.sep)]) {
            if (segment) current = path.join(current, segment);
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink()) throw new Error('共享发布路径不能包含符号链接');
        }
    }
    async _readManifest() {
        const file = path.join(this.releaseRoot, 'manifest.json');
        this._assertPath(file);
        if ((await fs.promises.stat(file)).size > 2 * 1024 ** 2) throw new Error('共享清单过大');
        const manifest = JSON.parse(await fs.promises.readFile(file, 'utf8'));
        shared.verifyManifest(manifest, this.publicKeyPem);
        return manifest;
    }
    async _openArtifact(entry) {
        const file = path.join(this.releaseRoot, entry.relativeUrl);
        this._assertPath(file);
        const handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size !== entry.size) throw new Error('共享发布文件大小不匹配');
            const key = [file, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, entry.sha256].join(':');
            if (!this.verifiedFiles.has(key)) {
                const crypto = require('node:crypto'); const digest = crypto.createHash('sha256');
                for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) digest.update(chunk);
                if (digest.digest('hex') !== entry.sha256) throw new Error('共享发布文件SHA-256不匹配');
                if (this.verifiedFiles.size >= 64) this.verifiedFiles.clear();
                this.verifiedFiles.set(key, true);
            }
            return { handle, filePath: file, size: stat.size, sha256: entry.sha256 };
        } catch (error) { await handle.close(); throw error; }
    }
    async getManifest() {
        const manifest = await this._readManifest();
        for (const entry of [manifest.payload.components.code, ...shared.dependencyArtifacts(manifest.payload.components.dependencies),
            ...Object.values(manifest.payload.components.taskDependencies || {})]) {
            const opened = await this._openArtifact(entry); await opened.handle.close();
        }
        return manifest;
    }
    /** 保留已有npm入口，它现在校验唯一发布文件，不再创建独立tar。 */
    async buildPackage() {
        const manifest = await this.getManifest();
        const code = manifest.payload.components.code;
        return { filePath: path.join(this.releaseRoot, code.relativeUrl), size: code.size, sha256: code.sha256, manifest };
    }
    async streamPackage(response, query = {}, group = null, taskId = null) {
        const manifest = await this._readManifest();
        const components = manifest.payload.components;
        if (group && !shared.GROUPS.includes(group)) throw new Error('未知依赖组');
        if (taskId && !Object.hasOwn(shared.TASK_DEPENDENCIES, taskId)) throw new Error('未知任务依赖');
        const entry = taskId ? components.taskDependencies?.[taskId] : group ? components.dependencies.groups?.[group] : components.code;
        if (!entry || String(query.version) !== String(entry.version) || query.sha256 !== entry.sha256) {
            const error = new Error('请求的发布版本已过期，请重新读取主服务器清单'); error.statusCode = 409; throw error;
        }
        const info = await this._openArtifact(entry);
        try {
            response.setHeader('Content-Type', 'application/zip');
            response.setHeader('Content-Length', String(info.size));
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Content-Disposition', `attachment; filename="${path.basename(info.filePath)}"`);
            const { pipeline } = require('node:stream/promises');
            await pipeline(info.handle.createReadStream({ autoClose: false, start: 0 }), response);
            return { filePath: info.filePath, size: info.size, sha256: info.sha256 };
        } finally { await info.handle.close(); }
    }
}
module.exports = { ServerReleaseService };
