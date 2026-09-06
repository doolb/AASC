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
const MANIFEST_FILE_NAME = 'manifest.json';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/**
 * 服务器代码发布服务。
 *
 * 发布包只面向局域网内的 Termux Bootstrap 使用，固定白名单避免把日志、用户
 * 配置、媒体、证书、模型和第三方工程暴露或复制到节点。认证属于后续阶段。
 *
 * 发布包必须由 npm run build:server-package 显式生成；HTTP 接口只读取已生成
 * 的 manifest.json 和 tar.gz，不在请求过程中扫描源码或执行 tar。
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
        this.manifestPath = path.join(this.cacheDir, MANIFEST_FILE_NAME);
        this.version = version || this._readProjectVersion();
        this.packagePromise = null;
    }

    async getManifest() {
        const preparedPackage = await this._readPreparedPackage();
        return { ...preparedPackage.manifest };
    }

    /**
     * 显式构建服务器发布包。
     *
     * 该方法只由 npm 发布脚本调用，不能从 HTTP 清单或下载接口间接触发。
     */
    async buildPackage() {
        if (this.packagePromise) {
            return { ...(await this.packagePromise) };
        }

        this.packagePromise = this._buildPackage();
        try {
            return { ...(await this.packagePromise) };
        } finally {
            this.packagePromise = null;
        }
    }

    async _buildPackage() {
        await fs.promises.mkdir(this.cacheDir, { recursive: true });
        const packageFileName = `aasc-server-${this._safeVersion()}.tar.gz`;
        const packagePath = path.join(this.cacheDir, packageFileName);
        const buildId = `${Date.now()}-${process.pid}`;
        const temporaryPackagePath = path.join(this.cacheDir, `.${packageFileName}.${buildId}.tmp`);
        const temporaryManifestPath = path.join(this.cacheDir, `.${MANIFEST_FILE_NAME}.${buildId}.tmp`);

        for (const releaseFile of RELEASE_FILES) {
            if (!fs.existsSync(path.join(this.projectRoot, releaseFile))) {
                throw new Error(`发布文件不存在: ${releaseFile}`);
            }
        }

        try {
            await execFileAsync('tar', [
                '-czf',
                temporaryPackagePath,
                '-C',
                this.projectRoot,
                ...RELEASE_EXCLUDES.flatMap(exclude => [`--exclude=${exclude}`]),
                ...RELEASE_FILES
            ]);

            const packageInfo = await this._readPackageInfo(temporaryPackagePath);
            const manifest = {
                version: this.version,
                size: packageInfo.size,
                sha256: packageInfo.sha256,
                packageUrl: `/server/package?version=${encodeURIComponent(this.version)}`,
                packageFileName,
                files: RELEASE_FILES.slice()
            };

            // 先发布压缩包，再原子替换清单；服务端不会看到只有半个文件的清单。
            await fs.promises.rename(temporaryPackagePath, packagePath);
            await fs.promises.writeFile(temporaryManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
            await fs.promises.rename(temporaryManifestPath, this.manifestPath);

            return {
                filePath: packagePath,
                size: packageInfo.size,
                sha256: packageInfo.sha256,
                manifest
            };
        } catch (error) {
            await this._removeIfExists(temporaryPackagePath);
            await this._removeIfExists(temporaryManifestPath);
            throw new Error(`生成服务器代码包失败: ${error.message}`);
        }
    }

    async streamPackage(response) {
        const packageInfo = await this._readPreparedPackage();
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

    async _readPreparedPackage() {
        let manifest;
        try {
            const content = await fs.promises.readFile(this.manifestPath, 'utf8');
            manifest = JSON.parse(content);
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error('服务器发布包不存在，请先执行 npm run build:server-package');
            }
            throw new Error(`读取服务器发布清单失败: ${error.message}`);
        }

        this._validateManifest(manifest);
        const packagePath = path.join(this.cacheDir, manifest.packageFileName);
        let packageInfo;
        try {
            packageInfo = await this._readPackageInfo(packagePath);
        } catch (error) {
            throw new Error(`服务器发布包不可读，请重新执行 npm run build:server-package: ${error.message}`);
        }

        if (packageInfo.size !== manifest.size || packageInfo.sha256 !== manifest.sha256) {
            throw new Error('服务器发布清单与代码包不一致，请重新执行 npm run build:server-package');
        }

        return {
            filePath: packagePath,
            size: packageInfo.size,
            sha256: packageInfo.sha256,
            manifest
        };
    }

    _validateManifest(manifest) {
        if (!manifest || typeof manifest !== 'object') {
            throw new Error('服务器发布清单格式无效');
        }
        if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
            throw new Error('服务器发布清单缺少 version');
        }
        if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0) {
            throw new Error('服务器发布清单 size 无效');
        }
        if (typeof manifest.sha256 !== 'string' || !SHA256_PATTERN.test(manifest.sha256)) {
            throw new Error('服务器发布清单 sha256 无效');
        }
        if (typeof manifest.packageUrl !== 'string' || manifest.packageUrl.trim() === '') {
            throw new Error('服务器发布清单缺少 packageUrl');
        }
        if (typeof manifest.packageFileName !== 'string'
            || manifest.packageFileName !== path.basename(manifest.packageFileName)) {
            throw new Error('服务器发布清单 packageFileName 无效');
        }
        if (!Array.isArray(manifest.files)
            || manifest.files.length !== RELEASE_FILES.length
            || manifest.files.some((file, index) => file !== RELEASE_FILES[index])) {
            throw new Error('服务器发布清单 files 无效');
        }
    }

    async _removeIfExists(filePath) {
        try {
            await fs.promises.rm(filePath, { force: true });
        } catch (error) {
            // 清理失败不应覆盖原始错误；下一次显式构建可以覆盖临时文件。
        }
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
