'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RAPID_OCR_FILES = [
    'PP-OCRv6_det_small.onnx',
    'ch_ppocr_mobile_v2.0_cls_mobile.onnx',
    'PP-OCRv6_rec_small.onnx',
    'ppocrv6_dict.txt'
];
const YOLO_MODEL_IDS = ['yolo11n', 'yolo11s', 'yolo11m', 'yolo11l', 'yolo11x'];
const GROUP_DEFINITIONS = Object.freeze({
    vision: Object.freeze([
        Object.freeze({ id: 'rapidocr', directory: 'rapidocr', files: RAPID_OCR_FILES }),
        ...YOLO_MODEL_IDS.map((id) => Object.freeze({
            id,
            directory: 'yolo11',
            files: [`${id}.onnx`]
        }))
    ]),
    'speech-enhancement': Object.freeze([
        Object.freeze({ id: 'gtcrn', directory: 'speech-enhancement', files: ['gtcrn_simple.onnx'] })
    ])
});

function createInvalidResourceError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

/**
 * 为正式 APK 提供固定白名单模型清单和安全文件解析。
 * 清单只暴露服务器实际存在且完整的模型，避免 APK 收到半套 OCR pipeline。
 */
class ModelManifestService {
    constructor({ modelRoot, clock = () => Date.now() }) {
        this.modelRoot = path.resolve(modelRoot);
        this.realModelRoot = resolveExistingPath(this.modelRoot);
        this.clock = clock;
        this.hashCache = new Map();
    }

    createManifest(groupName) {
        const definitions = this.getGroupDefinitions(groupName);
        const models = definitions
            .map((definition) => this.createModelManifest(definition))
            .filter((model) => model !== null);
        return {
            status: 'success',
            group: groupName,
            generatedAt: this.clock(),
            models
        };
    }

    resolveFile(groupName, modelId, filename) {
        const definition = this.findDefinition(groupName, modelId);
        if (!definition) {
            throw createInvalidResourceError(`非法模型 ID: ${modelId}`, 'MODEL_INVALID_ID');
        }
        if (!definition.files.includes(filename)) {
            throw createInvalidResourceError(`非法模型文件: ${filename}`, 'MODEL_INVALID_FILE');
        }
        if (!this.isDefinitionComplete(definition)) {
            throw createInvalidResourceError('模型文件不完整', 'MODEL_NOT_FOUND');
        }
        const filePath = this.resolveDefinitionFile(definition, filename);
        return filePath;
    }

    getGroupDefinitions(groupName) {
        const definitions = GROUP_DEFINITIONS[groupName];
        if (!definitions) {
            throw createInvalidResourceError(`非法模型分组: ${groupName}`, 'MODEL_INVALID_GROUP');
        }
        return definitions;
    }

    findDefinition(groupName, modelId) {
        return this.getGroupDefinitions(groupName).find((definition) => definition.id === modelId) || null;
    }

    createModelManifest(definition) {
        if (!this.isDefinitionComplete(definition)) return null;
        const files = definition.files.map((filename) => {
            const filePath = this.resolveDefinitionFile(definition, filename);
            const stat = fs.statSync(filePath);
            return {
                name: filename,
                size: stat.size,
                sha256: this.getSha256(filePath, stat)
            };
        });
        if (files.some((file) => file === null)) return null;
        return {
            id: definition.id,
            files
        };
    }

    isDefinitionComplete(definition) {
        return definition.files.every((filename) => {
            const filePath = this.resolveDefinitionFile(definition, filename);
            return isSafeRegularFile(filePath, this.realModelRoot);
        });
    }

    resolveDefinitionFile(definition, filename) {
        // definition 和 filename 都来自固定配置；再次 basename 检查使该约束不依赖调用方输入。
        if (path.basename(filename) !== filename) {
            throw createInvalidResourceError(`非法模型文件: ${filename}`, 'MODEL_INVALID_FILE');
        }
        return path.join(this.modelRoot, definition.directory, filename);
    }

    getSha256(filePath, stat) {
        const cached = this.hashCache.get(filePath);
        if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.sha256;
        const hash = crypto.createHash('sha256');
        // 清单接口需要同步生成稳定响应，因此使用分块同步读取，避免把大模型一次性读入内存。
        const descriptor = fs.openSync(filePath, 'r');
        try {
            const buffer = Buffer.allocUnsafe(1024 * 1024);
            let bytesRead = 0;
            while (bytesRead < stat.size) {
                const count = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, stat.size - bytesRead), bytesRead);
                if (count === 0) break;
                hash.update(buffer.subarray(0, count));
                bytesRead += count;
            }
        } finally {
            fs.closeSync(descriptor);
        }
        const sha256 = hash.digest('hex');
        this.hashCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, sha256 });
        return sha256;
    }
}

function isRegularFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch (error) {
        return false;
    }
}

function resolveExistingPath(filePath) {
    try {
        return fs.realpathSync(filePath);
    } catch (error) {
        return path.resolve(filePath);
    }
}

function isSafeRegularFile(filePath, realModelRoot) {
    if (!isRegularFile(filePath)) return false;
    if (fs.statSync(filePath).size <= 0) return false;
    const realFilePath = resolveExistingPath(filePath);
    const rootPrefix = realModelRoot.endsWith(path.sep) ? realModelRoot : `${realModelRoot}${path.sep}`;
    return realFilePath.startsWith(rootPrefix);
}

module.exports = {
    GROUP_DEFINITIONS,
    YOLO_MODEL_IDS,
    ModelManifestService
};
