'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
    APK_PROFILES,
    loadApkProfile,
    resolveSelectedModelFiles
} = require('../scripts/ops/apk-build-profile');

async function makeFixtureProject(files) {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-apk-profile-'));
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(projectRoot, relativePath);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, content, 'utf8');
    }
    return projectRoot;
}

test('profile 映射使用已有目录且不读取 tasks 字段', async (t) => {
    const projectRoot = await makeFixtureProject({
        'release/apkbuild/allserver/app.json': JSON.stringify({
            schemaVersion: 1,
            embeddedNode: true,
            features: ['llm'],
            models: ['qwen-test'],
            tasks: ['must-not-be-read']
        })
    });
    t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));

    const profile = await loadApkProfile({ projectRoot, profile: 'allserver' });

    assert.equal(profile.embeddedNode, true);
    assert.equal(profile.offline, true);
    assert.deepEqual(profile.models, ['qwen-test']);
    assert.equal(Object.hasOwn(profile, 'tasks'), false);
    assert.equal(APK_PROFILES.allserver.offline, true);
});

test('noserver 禁止 embeddedNode', async (t) => {
    const projectRoot = await makeFixtureProject({
        'release/apkbuild/noserver/app.json': JSON.stringify({
            schemaVersion: 1,
            embeddedNode: true,
            features: [],
            models: []
        })
    });
    t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));

    await assert.rejects(
        () => loadApkProfile({ projectRoot, profile: 'noserver' }),
        /noserver.*embeddedNode/u
    );
});

test('noserver 不允许内置模型', async (t) => {
    const projectRoot = await makeFixtureProject({
        'release/apkbuild/noserver/app.json': JSON.stringify({
            schemaVersion: 1,
            embeddedNode: false,
            features: ['display'],
            models: ['sensevoice']
        })
    });
    t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));

    await assert.rejects(
        () => loadApkProfile({ projectRoot, profile: 'noserver' }),
        /noserver.*models/u
    );
});

test('模型 ID 可从 LLM manifest 和一级模型目录解析', async (t) => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-model-profile-'));
    const modelRoot = path.join(projectRoot, 'res', 'models');
    await fs.promises.mkdir(path.join(modelRoot, 'llm', 'qwen-test'), { recursive: true });
    await fs.promises.mkdir(path.join(modelRoot, 'sensevoice', 'test_wavs'), { recursive: true });
    await fs.promises.mkdir(path.join(modelRoot, 'sensevoice', 'results'), { recursive: true });
    await fs.promises.writeFile(path.join(modelRoot, 'llm', 'manifest.json'), JSON.stringify({
        models: [{ modelId: 'qwen-test', directory: 'qwen-test', files: [{ name: 'model.bin' }] }]
    }), 'utf8');
    await fs.promises.writeFile(path.join(modelRoot, 'llm', 'qwen-test', '.manifest.json'), '{}\n', 'utf8');
    await fs.promises.writeFile(path.join(modelRoot, 'llm', 'qwen-test', 'model.bin'), 'qwen\n', 'utf8');
    await fs.promises.writeFile(path.join(modelRoot, 'sensevoice', 'model.onnx'), 'asr\n', 'utf8');
    await fs.promises.writeFile(path.join(modelRoot, 'sensevoice', 'test_wavs', 'sample.wav'), 'test\n', 'utf8');
    await fs.promises.writeFile(path.join(modelRoot, 'sensevoice', 'results', 'old.log'), 'old\n', 'utf8');
    await fs.promises.writeFile(path.join(modelRoot, 'sensevoice', 'cache.mmap'), 'cache\n', 'utf8');
    t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));

    const files = await resolveSelectedModelFiles({
        modelRoot,
        modelIds: ['qwen-test', 'sensevoice']
    });
    const relativePaths = files.map((file) => file.relativePath).sort();

    assert.deepEqual(relativePaths, [
        'llm/manifest.json',
        'llm/qwen-test/.manifest.json',
        'llm/qwen-test/model.bin',
        'sensevoice/model.onnx'
    ]);
});

test('未知模型 ID 明确失败', async (t) => {
    const modelRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-model-profile-'));
    t.after(() => fs.promises.rm(modelRoot, { recursive: true, force: true }));

    await assert.rejects(
        () => resolveSelectedModelFiles({ modelRoot, modelIds: ['missing-model'] }),
        /missing-model.*模型目录/u
    );
});
