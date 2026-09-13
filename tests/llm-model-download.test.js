'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
    LlmModelManifestService
} = require('../src/apps/server/modules/llm/llm-model-manifest-service');
const {
    LlmModelDownloadService
} = require('../src/apps/server/modules/llm/llm-model-download-service');

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function createRemoteFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-llm-download-'));
    const files = {
        'config.json': Buffer.from('{"model":"test"}'),
        'weights.mnn': Buffer.from('server-cache-model')
    };
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
        models: [{
            modelId: 'download-test',
            directory: 'download-test',
            source: {
                provider: 'modelscope',
                repository: 'MNN/Download-Test',
                revision: 'fixed-revision'
            },
            files: Object.entries(files).map(([name, content]) => ({
                name,
                size: content.length,
                sha256: sha256(content)
            }))
        }]
    }));
    return { root, files };
}

test('服务器下载指定模型后才将 LLM 缓存标记为 ready', async () => {
    const fixture = createRemoteFixture();
    const manifestService = new LlmModelManifestService({ modelRoot: fixture.root });
    const calls = [];
    const downloadService = new LlmModelDownloadService({
        manifestService,
        modelRoot: fixture.root,
        processId: 101,
        clock: () => 20260913,
        downloadFile: async (url, destination) => {
            calls.push(url);
            const filename = decodeURIComponent(new URL(url).pathname.split('/').pop());
            fs.writeFileSync(destination, fixture.files[filename]);
        }
    });

    assert.equal(manifestService.createManifest().models[0].ready, false);
    const first = await downloadService.downloadModel('download-test');
    assert.equal(first.cached, true);
    assert.equal(calls.length, 2);
    assert.equal(manifestService.createManifest().models[0].ready, true);
    assert.equal(manifestService.createManifest().models[0].files.every((file) => file.cached), true);
    assert.equal(path.basename(manifestService.resolveDownload('download-test', 'weights.mnn').path), 'weights.mnn');

    await downloadService.downloadModel('download-test');
    assert.equal(calls.length, 2);
    await downloadService.downloadModel('download-test', { force: true });
    assert.equal(calls.length, 4);
});

test('服务器模型下载 hash 失败时保留旧缓存并清理 staging', async () => {
    const fixture = createRemoteFixture();
    const manifestService = new LlmModelManifestService({ modelRoot: fixture.root });
    let corrupt = false;
    const downloadService = new LlmModelDownloadService({
        manifestService,
        modelRoot: fixture.root,
        processId: 102,
        clock: () => 20260914,
        downloadFile: async (url, destination) => {
            const filename = decodeURIComponent(new URL(url).pathname.split('/').pop());
            fs.writeFileSync(
                destination,
                corrupt ? Buffer.alloc(fixture.files[filename].length, 0x78) : fixture.files[filename]
            );
        }
    });

    await downloadService.downloadModel('download-test');
    corrupt = true;
    await assert.rejects(
        () => downloadService.downloadModel('download-test', { force: true }),
        (error) => error.code === 'MODEL_HASH_MISMATCH'
    );
    assert.equal(manifestService.createManifest().models[0].ready, true);
    assert.equal(fs.existsSync(path.join(fixture.root, 'download-test.lock')), false);
    assert.equal(fs.readdirSync(fixture.root).some((name) => name.includes('.staging-')), false);
});
