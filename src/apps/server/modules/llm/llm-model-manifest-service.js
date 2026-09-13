'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createModelError(message, code, statusCode = 400) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function normalizeText(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeFile(file) {
    const source = typeof file === 'string' ? { name: file } : file;
    if (!source || typeof source !== 'object') return null;
    const name = normalizeText(source.name);
    if (!name || path.basename(name) !== name) return null;
    return {
        name,
        expectedSize: Number.isInteger(source.size) && source.size >= 0
            ? source.size
            : null,
        expectedSha256: typeof source.sha256 === 'string'
            ? source.sha256.toLowerCase()
            : null
    };
}

function normalizeRemoteSource(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const provider = normalizeText(source.provider).toLowerCase();
    const repository = normalizeText(source.repository);
    const revision = normalizeText(source.revision, 'master');
    if (provider !== 'modelscope'
        || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository)
        || !/^[A-Za-z0-9._-]+$/.test(revision)) {
        return null;
    }
    return { provider, repository, revision };
}

function normalizeAliases(modelId, aliases) {
    if (!Array.isArray(aliases)) return [];
    return [...new Set(aliases
        .map((alias) => normalizeText(alias))
        .filter((alias) => alias && alias !== modelId))];
}

function normalizeDefinition(model) {
    if (!model || typeof model !== 'object') return null;
    const modelId = normalizeText(model.modelId || model.id);
    const directory = normalizeText(model.directory, modelId);
    const files = Array.isArray(model.files)
        ? model.files.map(normalizeFile).filter(Boolean)
        : [];
    const source = model.source === undefined ? null : normalizeRemoteSource(model.source);
    if (!modelId || path.basename(modelId) !== modelId
        || !directory || path.basename(directory) !== directory
        || files.length === 0
        || (model.source !== undefined && !source)) {
        return null;
    }
    return {
        modelId,
        displayName: normalizeText(model.displayName, modelId),
        aliases: normalizeAliases(modelId, model.aliases),
        engine: normalizeText(model.engine, 'mnn-llm'),
       architecture: normalizeText(model.architecture),
        multimodal: model.multimodal === true,
       revision: normalizeText(model.revision),
        directory,
        enabled: model.enabled !== false,
        files,
        source
    };
}

function validateDefinitionNames(definitions) {
    const names = new Map();
    for (const definition of definitions) {
        for (const name of [definition.modelId, ...definition.aliases]) {
            const previousModelId = names.get(name);
            if (previousModelId) {
                throw createModelError(
                    `LLM 模型名映射冲突: ${name} -> ${previousModelId} / ${definition.modelId}`,
                    'MODEL_ALIAS_CONFLICT',
                    500
                );
            }
            names.set(name, definition.modelId);
        }
    }
    return definitions;
}

function resolveExistingPath(filePath) {
    try {
        return fs.realpathSync(filePath);
    } catch (error) {
        return path.resolve(filePath);
    }
}

function isSafeRegularFile(filePath, realRoot) {
    try {
        if (!fs.statSync(filePath).isFile()) return false;
        const realFilePath = resolveExistingPath(filePath);
        const rootPrefix = realRoot.endsWith(path.sep)
            ? realRoot
            : `${realRoot}${path.sep}`;
        return realFilePath.startsWith(rootPrefix);
    } catch (error) {
        return false;
    }
}

class LlmModelManifestService {
    constructor({
        modelRoot,
        manifestPath = path.join(modelRoot, 'manifest.json'),
        clock = () => Date.now()
    }) {
        this.modelRoot = path.resolve(modelRoot);
        this.realModelRoot = resolveExistingPath(this.modelRoot);
        this.manifestPath = path.resolve(manifestPath);
        this.clock = clock;
        this.hashCache = new Map();
        this.manifestCache = null;
    }

    readDefinitions() {
        let stat;
        try {
            stat = fs.statSync(this.manifestPath);
        } catch (error) {
            return [];
        }

        if (this.manifestCache
            && this.manifestCache.mtimeMs === stat.mtimeMs
            && this.manifestCache.size === stat.size) {
            return this.manifestCache.definitions;
        }

        try {
            const document = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
            const definitions = validateDefinitionNames((Array.isArray(document) ? document : document.models)
                .map(normalizeDefinition)
                .filter(Boolean));
            this.manifestCache = { mtimeMs: stat.mtimeMs, size: stat.size, definitions };
            return definitions;
        } catch (error) {
            if (error && error.code) throw error;
            throw createModelError(`LLM 模型清单解析失败: ${error.message}`, 'MODEL_MANIFEST_INVALID', 500);
        }
    }

    findDefinition(modelId) {
        const normalizedId = normalizeText(modelId);
        return this.readDefinitions().find((definition) => definition.modelId === normalizedId) || null;
    }

    resolveModelId(modelName) {
        const normalizedName = normalizeText(modelName);
        if (!normalizedName) return null;
        const definition = this.readDefinitions().find((candidate) => (
            candidate.modelId === normalizedName || candidate.aliases.includes(normalizedName)
        ));
        return definition ? definition.modelId : null;
    }

    resolveDefinitionFile(definition, filename) {
        if (!definition || path.basename(filename) !== filename) {
            throw createModelError(`非法模型文件: ${filename}`, 'MODEL_INVALID_FILE');
        }
        const filePath = path.resolve(this.modelRoot, definition.directory, filename);
        const rootPrefix = `${this.modelRoot}${path.sep}`;
        if (!filePath.startsWith(rootPrefix)) {
            throw createModelError(`非法模型文件: ${filename}`, 'MODEL_INVALID_FILE');
        }
        return filePath;
    }

    getFileHash(filePath, stat) {
        const cached = this.hashCache.get(filePath);
        if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
            return cached.sha256;
        }
        const hash = crypto.createHash('sha256');
        const descriptor = fs.openSync(filePath, 'r');
        try {
            const buffer = Buffer.allocUnsafe(1024 * 1024);
            let offset = 0;
            while (offset < stat.size) {
                const count = fs.readSync(
                    descriptor,
                    buffer,
                    0,
                    Math.min(buffer.length, stat.size - offset),
                    offset
                );
                if (count === 0) break;
                hash.update(buffer.subarray(0, count));
                offset += count;
            }
        } finally {
            fs.closeSync(descriptor);
        }
        const sha256 = hash.digest('hex');
        this.hashCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, sha256 });
        return sha256;
    }

    createFileManifest(definition, file) {
        if (definition.source) {
            if (!Number.isInteger(file.expectedSize) || file.expectedSize <= 0
                || !/^[0-9a-f]{64}$/i.test(file.expectedSha256 || '')) {
                return null;
            }
            return {
                name: file.name,
                size: file.expectedSize,
                sha256: file.expectedSha256
            };
        }
        const filePath = this.resolveDefinitionFile(definition, file.name);
        if (!isSafeRegularFile(filePath, this.realModelRoot)) return null;
        const stat = fs.statSync(filePath);
        const sha256 = this.getFileHash(filePath, stat);
        if (file.expectedSize !== null && file.expectedSize !== stat.size) return null;
        if (file.expectedSha256 && file.expectedSha256 !== sha256) return null;
        return { name: file.name, size: stat.size, sha256 };
    }

    createModelManifest(definition, { includeIncomplete = false } = {}) {
        if (!definition.enabled) return null;
        const files = definition.files.map((file) => this.createFileManifest(definition, file));
        if (!includeIncomplete && files.some((file) => file === null)) return null;
        const safeFiles = files.filter(Boolean);
        return {
            id: definition.modelId,
            modelId: definition.modelId,
            displayName: definition.displayName,
            aliases: definition.aliases,
           engine: definition.engine,
           architecture: definition.architecture,
            multimodal: definition.multimodal,
           revision: definition.revision,
            source: definition.source,
            ready: files.length === definition.files.length,
            totalBytes: safeFiles.reduce((total, file) => total + file.size, 0),
            files: safeFiles
        };
    }

    createManifest(options = {}) {
        const models = this.readDefinitions()
            .map((definition) => this.createModelManifest(definition, options))
            .filter(Boolean);
        return {
            status: 'success',
            group: 'llm',
            engine: 'mnn-llm',
            generatedAt: this.clock(),
            models
        };
    }

    resolveFile(modelId, filename) {
        const source = this.resolveDownload(modelId, filename);
        if (source.type === 'remote') return source.url;
        return source.path;
    }

    resolveDownload(modelId, filename) {
        const definition = this.findDefinition(modelId);
        if (!definition || !definition.enabled) {
            throw createModelError(`非法模型 ID: ${modelId}`, 'MODEL_INVALID_ID');
        }
        const file = definition.files.find((candidate) => candidate.name === filename);
        if (!file) {
            throw createModelError(`非法模型文件: ${filename}`, 'MODEL_INVALID_FILE');
        }
        const filePath = this.resolveDefinitionFile(definition, filename);
        const manifestFile = this.createFileManifest(definition, file);
        if (!manifestFile) {
            throw createModelError('模型文件不存在或校验失败', 'MODEL_NOT_FOUND', 404);
        }
        if (definition.source?.provider === 'modelscope') {
            const [owner, repository] = definition.source.repository.split('/');
            const remoteUrl = [
                'https://modelscope.cn/models',
                encodeURIComponent(owner),
                encodeURIComponent(repository),
                'resolve',
                encodeURIComponent(definition.source.revision),
                encodeURIComponent(filename)
            ].join('/');
            return {
                type: 'remote',
                url: remoteUrl,
                size: manifestFile.size,
                sha256: manifestFile.sha256
            };
        }
        return { type: 'local', path: filePath, ...manifestFile };
    }
}

module.exports = {
    LlmModelManifestService,
    createModelError,
    normalizeDefinition,
    normalizeRemoteSource
};
