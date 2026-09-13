'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

function createDownloadError(message, code, statusCode = 500) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function buildModelScopeUrl(source, filename) {
    if (!source || source.provider !== 'modelscope') {
        throw createDownloadError('模型没有可用的 ModelScope 下载源', 'MODEL_SOURCE_INVALID', 400);
    }
    const [owner, repository] = source.repository.split('/');
    return [
        'https://modelscope.cn/models',
        encodeURIComponent(owner),
        encodeURIComponent(repository),
        'resolve',
        encodeURIComponent(source.revision),
        encodeURIComponent(filename)
    ].join('/');
}

async function hashFile(filePath) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) {
        hash.update(chunk);
    }
    return hash.digest('hex');
}

function downloadRemoteFile(url, destination, { expectedSize, redirectCount = 0 } = {}) {
    if (redirectCount > 3) {
        return Promise.reject(createDownloadError('远端模型重定向次数过多', 'MODEL_REDIRECT_LIMIT'));
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch (error) {
        return Promise.reject(createDownloadError('远端模型地址无效', 'MODEL_SOURCE_INVALID'));
    }
    if (parsedUrl.protocol !== 'https:') {
        return Promise.reject(createDownloadError('远端模型地址必须使用 HTTPS', 'MODEL_SOURCE_INVALID'));
    }
    const transport = https;
    return new Promise((resolve, reject) => {
        const request = transport.get(parsedUrl, {
            headers: {
                'User-Agent': 'AASC-Model-Downloader/1.0',
                Accept: '*/*'
            }
        }, (response) => {
            const statusCode = response.statusCode || 0;
            const location = response.headers.location;
            if (statusCode >= 300 && statusCode < 400 && location) {
                response.resume();
                downloadRemoteFile(new URL(location, parsedUrl).toString(), destination, {
                    expectedSize,
                    redirectCount: redirectCount + 1
                }).then(resolve, reject);
                return;
            }
            if (statusCode !== 200) {
                response.resume();
                reject(createDownloadError(`远端模型文件不可用: HTTP ${statusCode}`, 'MODEL_SOURCE_UNAVAILABLE', 502));
                return;
            }
            const contentLength = Number(response.headers['content-length']);
            if (Number.isInteger(expectedSize)
                && expectedSize > 0
                && Number.isFinite(contentLength)
                && contentLength !== expectedSize) {
                response.resume();
                reject(createDownloadError('远端模型文件大小不匹配', 'MODEL_SIZE_MISMATCH', 502));
                return;
            }
            const output = fs.createWriteStream(destination, { flags: 'wx' });
            pipeline(response, output).then(resolve, reject);
        });
        request.setTimeout(60000, () => {
            request.destroy(createDownloadError('远端模型下载超时', 'MODEL_DOWNLOAD_TIMEOUT', 504));
        });
        request.on('error', reject);
    });
}

class LlmModelDownloadService {
    constructor({
        manifestService,
        modelRoot,
        downloadFile = downloadRemoteFile,
        clock = () => Date.now(),
        processId = process.pid
    }) {
        this.manifestService = manifestService;
        this.modelRoot = path.resolve(modelRoot);
        this.downloadFile = downloadFile;
        this.clock = clock;
        this.processId = processId;
    }

    async downloadModel(modelName, { force = false, onFileComplete = () => {} } = {}) {
        const modelId = this.manifestService.resolveModelId(modelName);
        const definition = modelId ? this.manifestService.findDefinition(modelId) : null;
        if (!definition || !definition.enabled) {
            throw createDownloadError(`未知或禁用的 LLM 模型: ${modelName}`, 'MODEL_INVALID_ID', 400);
        }
        if (!definition.source) {
            throw createDownloadError(`模型没有固定的远端下载源: ${modelId}`, 'MODEL_SOURCE_INVALID', 400);
        }

        await fs.promises.mkdir(this.modelRoot, { recursive: true });
        const modelDirectory = this.manifestService.getModelDirectory(modelId);
        const lockDirectory = `${modelDirectory}.lock`;
        try {
            await fs.promises.mkdir(lockDirectory);
        } catch (error) {
            if (error.code === 'EEXIST') {
                throw createDownloadError(`模型正在下载: ${modelId}`, 'MODEL_DOWNLOAD_BUSY', 409);
            }
            throw error;
        }

        const stagingDirectory = `${modelDirectory}.staging-${this.processId}-${this.clock()}`;
        try {
            if (!force && this.manifestService.isModelCacheReady(definition)) {
                return { modelId, directory: modelDirectory, cached: true };
            }
            await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
            await fs.promises.mkdir(stagingDirectory, { recursive: true });

            for (const file of definition.files) {
                const remote = this.manifestService.resolveRemoteDownload(modelId, file.name);
                const temporaryPath = path.join(stagingDirectory, `${file.name}.tmp`);
                const finalPath = path.join(stagingDirectory, file.name);
                await this.downloadFile(remote.url, temporaryPath, {
                    expectedSize: remote.size,
                    expectedSha256: remote.sha256
                });
                const stat = await fs.promises.stat(temporaryPath);
                if (stat.size !== remote.size) {
                    throw createDownloadError(`模型文件大小不匹配: ${file.name}`, 'MODEL_SIZE_MISMATCH', 502);
                }
                const sha256 = await hashFile(temporaryPath);
                if (sha256 !== remote.sha256) {
                    throw createDownloadError(`模型文件 SHA-256 不匹配: ${file.name}`, 'MODEL_HASH_MISMATCH', 502);
                }
                await fs.promises.rename(temporaryPath, finalPath);
                await onFileComplete({ modelId, filename: file.name, size: stat.size, sha256 });
            }

            const markerPath = path.join(stagingDirectory, '.manifest.json');
            const markerTemporaryPath = `${markerPath}.tmp`;
            await fs.promises.writeFile(markerTemporaryPath, JSON.stringify({
                version: 1,
                modelId,
                revision: definition.revision,
                files: definition.files.map((file) => ({
                    name: file.name,
                    size: file.expectedSize,
                    sha256: file.expectedSha256
                }))
            }, null, 2));
            await fs.promises.rename(markerTemporaryPath, markerPath);
            await this.replaceCacheDirectory(modelDirectory, stagingDirectory, modelId);
            return { modelId, directory: modelDirectory, cached: true };
        } finally {
            await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
            await fs.promises.rm(lockDirectory, { recursive: true, force: true });
        }
    }

    async replaceCacheDirectory(modelDirectory, stagingDirectory, modelId) {
        let backupDirectory = null;
        try {
            if (fs.existsSync(modelDirectory)) {
                backupDirectory = `${modelDirectory}.backup-${this.processId}-${this.clock()}`;
                await fs.promises.rename(modelDirectory, backupDirectory);
            }
            await fs.promises.rename(stagingDirectory, modelDirectory);
        } catch (error) {
            if (backupDirectory && !fs.existsSync(modelDirectory)) {
                await fs.promises.rename(backupDirectory, modelDirectory).catch(() => {});
            }
            throw createDownloadError(`模型缓存原子切换失败: ${modelId}`, 'MODEL_CACHE_INSTALL_FAILED', 500);
        }
        if (backupDirectory) {
            await fs.promises.rm(backupDirectory, { recursive: true, force: true });
        }
    }
}

module.exports = {
    LlmModelDownloadService,
    buildModelScopeUrl,
    downloadRemoteFile,
    hashFile,
    createDownloadError
};
