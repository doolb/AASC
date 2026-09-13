'use strict';

const path = require('node:path');
const {
    LlmModelManifestService
} = require('../../src/apps/server/modules/llm/llm-model-manifest-service');
const {
    LlmModelDownloadService
} = require('../../src/apps/server/modules/llm/llm-model-download-service');

function parseArguments(argv) {
    const options = { modelId: null, force: false };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--force') {
            options.force = true;
            continue;
        }
        if (argument === '--id' || argument === '--model-id') {
            options.modelId = argv[index + 1] || null;
            index += 1;
            continue;
        }
        if (!argument.startsWith('-') && !options.modelId) {
            options.modelId = argument;
            continue;
        }
        throw new Error(`未知参数: ${argument}`);
    }
    if (!options.modelId) {
        throw new Error('必须指定模型 ID，例如 --id qwen3.5-0.8b-claude-opus-distilled-mnn');
    }
    return options;
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const modelRoot = path.resolve(__dirname, '../../res/models/llm');
    const manifestService = new LlmModelManifestService({ modelRoot });
    const downloadService = new LlmModelDownloadService({
        manifestService,
        modelRoot
    });
    const result = await downloadService.downloadModel(options.modelId, {
        force: options.force,
        onFileComplete: ({ filename, size }) => {
            console.log(`已校验 ${filename} (${size} bytes)`);
        }
    });
    console.log(`${result.cached ? '模型缓存已就绪' : '模型下载完成'}: ${result.modelId}`);
    console.log(`缓存目录: ${result.directory}`);
}

main().catch((error) => {
    console.error(`LLM 模型下载失败 [${error.code || 'MODEL_DOWNLOAD_FAILED'}]: ${error.message}`);
    process.exitCode = 1;
});
