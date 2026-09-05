'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const RELEASE_FILES = ['src', 'package.json', 'package-lock.json'];
const RELEASE_EXCLUDES = [
    'src/apps/android-display',
    'src/apps/voice-display-node/node_modules'
];

/**
 * 服务器代码发布服务。
 *
 * 发布包只面向局域网内的 Termux Bootstrap 使用，固定白名单避免把日志、用户
 * 配置、媒体、证书、模型和第三方工程暴露或复制到节点。认证属于后续阶段。
 */
class ServerReleaseService {
    constructor(options = {}) {
        const {
            projectRoot,
            cacheDir = path.join(projectRoot || process.cwd(), 'res', 'temp', 'aasc-server-release'),
            version = null
        } = options;

        if (typeof projectRoot !== 'string' || projectRoot.trim() === '') {
            throw new TypeError('projectRoot 必须是非空路径');
        }

        this.projectRoot = path.resolve(projectRoot);
        this.cacheDir = path.resolve(cacheDir);
        this.version = version || this._readProjectVersion();
        this.cachedPackage = null;
        this.packagePromise = null;
    }

    async getManifest() {
        const packageInfo = await this.createPackage();
        return {
            version: this.version,
            size: packageInfo.size,
            sha256: packageInfo.sha256,
            packageUrl: `/server/package?version=${encodeURIComponent(this.version)}`,
            files: RELEASE_FILES.slice()
        };
    }

    async createPackage() {
        if (this.cachedPackage && fs.existsSync(this.cachedPackage.filePath)) {
            return { ...this.cachedPackage };
        }

        if (this.packagePromise) {
            return { ...(await this.packagePromise) };
        }

        this.packagePromise = this._createPackage();
        try {
            return { ...(await this.packagePromise) };
        } finally {
            this.packagePromise = null;
        }
    }

    async _createPackage() {

        await fs.promises.mkdir(this.cacheDir, { recursive: true });
        const packagePath = path.join(this.cacheDir, `aasc-server-${this._safeVersion()}.tar.gz`);
        for (const releaseFile of RELEASE_FILES) {
            if (!fs.existsSync(path.join(this.projectRoot, releaseFile))) {
                throw new Error(`发布文件不存在: ${releaseFile}`);
            }
        }

        try {
            await execFileAsync('tar', [
                '-czf',
                packagePath,
                '-C',
                this.projectRoot,
                ...RELEASE_EXCLUDES.flatMap(exclude => [`--exclude=${exclude}`]),
                ...RELEASE_FILES
            ]);
            const packageInfo = await this._readPackageInfo(packagePath);
            this.cachedPackage = packageInfo;
            return { ...packageInfo };
        } catch (error) {
            try {
                await fs.promises.rm(packagePath, { force: true });
            } catch (cleanupError) {
                // 打包失败不应覆盖原始错误；临时目录可在下一次发布时复用。
            }
            throw new Error(`生成服务器代码包失败: ${error.message}`);
        }
    }

    async streamPackage(response) {
        const packageInfo = await this.createPackage();
        response.setHeader('Content-Type', 'application/gzip');
        response.setHeader('Content-Length', String(packageInfo.size));
        response.setHeader('Content-Disposition', `attachment; filename="${path.basename(packageInfo.filePath)}"`);

        await new Promise((resolve, reject) => {
            const stream = fs.createReadStream(packageInfo.filePath);
            stream.once('error', reject);
            response.once('finish', resolve);
            stream.pipe(response);
        });
        return packageInfo;
    }

    _readProjectVersion() {
        try {
            const packageJson = JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'package.json'), 'utf8'));
            return typeof packageJson.version === 'string' && packageJson.version.trim()
                ? packageJson.version.trim()
                : 'unknown';
        } catch (error) {
            return 'unknown';
        }
    }

    _safeVersion() {
        return String(this.version).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || 'unknown';
    }

    async _readPackageInfo(filePath) {
        const stat = await fs.promises.stat(filePath);
        const sha256 = await this._hashFile(filePath);
        return { filePath, size: stat.size, sha256 };
    }

    _hashFile(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);
            stream.on('data', chunk => hash.update(chunk));
            stream.once('error', reject);
            stream.once('end', () => resolve(hash.digest('hex')));
        });
    }
}

module.exports = {
    RELEASE_EXCLUDES,
    RELEASE_FILES,
    ServerReleaseService
};
