'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const CATALOG_RELATIVE_PATH = 'src/apps/server/modules/model-distribution/offline-model-catalog.json';
const DEFINITIONS_RELATIVE_PATH = 'src/apps/server/modules/model-distribution/llm-model-definitions.json';
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

// 可信目录是可提交的小型元数据；构建无模型包时不读取或复制大型推理权重。
function validateCatalog(catalog) {
    if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.models) || !catalog.models.length) {
        throw new Error('Offline 模型目录无效');
    }
    const ids = new Set();
    for (const model of catalog.models) {
        if (!SAFE_NAME.test(model.modelId) || ids.has(model.modelId) || !model.revision
            || !Array.isArray(model.files) || !model.files.length) throw new Error('Offline 模型定义无效');
        ids.add(model.modelId);
        const names = new Set();
        let total = 0;
        for (const file of model.files) {
            if (!SAFE_NAME.test(file.name) || names.has(file.name)
                || typeof file.path !== 'string' || file.path.split('/').some(part => !SAFE_NAME.test(part))
                || file.path.split('/').at(-1) !== file.name
                || !Number.isSafeInteger(file.size) || file.size < 1
                || !/^[a-f0-9]{64}$/u.test(file.sha256)) throw new Error('Offline 模型文件定义无效');
            names.add(file.name); total += file.size;
        }
        if (!Number.isSafeInteger(total) || total !== model.totalBytes) throw new Error('Offline 模型总大小无效');
    }
    return catalog;
}

async function readOfflineModelCatalog(projectRoot) {
    return validateCatalog(JSON.parse(await fs.readFile(path.join(projectRoot, CATALOG_RELATIVE_PATH), 'utf8')));
}

module.exports = { CATALOG_RELATIVE_PATH, DEFINITIONS_RELATIVE_PATH, validateCatalog, readOfflineModelCatalog };
