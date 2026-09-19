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
    assert.equal(profile.verifyRuntime, true);
    assert.equal(Object.hasOwn(profile, 'tasks'), false);
    assert.equal(APK_PROFILES.allserver.offline, true);
});

test('profile 可以关闭首次 Runtime 内容校验', async (t) => {
    const projectRoot = await makeFixtureProject({
        'release/apkbuild/allserver/app.json': JSON.stringify({
            schemaVersion: 1,
            embeddedNode: true,
            features: ['llm'],
            models: [],
            verifyRuntime: false
        })
    });
    t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));

    const profile = await loadApkProfile({ projectRoot, profile: 'allserver' });

    assert.equal(profile.verifyRuntime, false);
});

test('正式 offline profile 默认关闭 Runtime 内容校验且其他 profile 保持开启', async () => {
    const projectRoot = path.resolve(__dirname, '..');
    const offlineProfile = await loadApkProfile({ projectRoot, profile: 'allserver' });
    const withServerProfile = await loadApkProfile({ projectRoot, profile: 'withserver' });
    const noServerProfile = await loadApkProfile({ projectRoot, profile: 'noserver' });

    assert.equal(offlineProfile.verifyRuntime, false);
    assert.equal(withServerProfile.verifyRuntime, true);
    assert.equal(noServerProfile.verifyRuntime, true);
});

test('allserver-min profile 是 update-only、无模型并使用递增 APK 版本', async () => {
    const projectRoot = path.resolve(__dirname, '..');
    const profile = await loadApkProfile({ projectRoot, profile: 'allserver-min' });

    assert.equal(profile.offline, true);
    assert.equal(profile.embeddedNode, true);
    assert.equal(profile.updateOnly, true);
    assert.deepEqual(profile.models, []);
    assert.equal(profile.versionCode, 19);
    assert.equal(profile.versionName, '0.2.17-offline-min');
});

test('full offline profile 内置声纹模型，供 Offline 原生注册复用', async () => {
    const projectRoot = path.resolve(__dirname, '..');
    const profile = await loadApkProfile({ projectRoot, profile: 'allserver' });

    assert.equal(profile.models.includes('voiceprint'), true);
});

test('allserver-min 必须显式声明 updateOnly 且不得内置模型', async (t) => {
    const projectRoot = await makeFixtureProject({
        'release/apkbuild/allserver-min/app.json': JSON.stringify({
            schemaVersion: 1,
            embeddedNode: true,
            features: ['display'],
            models: ['unexpected-model']
        })
    });
    t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));

    await assert.rejects(
        () => loadApkProfile({ projectRoot, profile: 'allserver-min' }),
        /updateOnly|models/u
    );
});

test('profile build script includes update-only APK command', async () => {
    const packageJson = JSON.parse(await fs.promises.readFile(path.join(__dirname, '../package.json'), 'utf8'));
    assert.equal(packageJson.scripts['build:apk:offline:min'], 'node scripts/ops/build-apk.js allserver-min');
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

test('目录型模型扫描跳过 .gitkeep 占位文件', async (t) => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-model-profile-'));
    const modelRoot = path.join(projectRoot, 'res', 'models');
    const modelDir = path.join(modelRoot, 'sensevoice');
    await fs.promises.mkdir(modelDir, { recursive: true });
    await fs.promises.writeFile(path.join(modelDir, '.gitkeep'), '', 'utf8');
    await fs.promises.writeFile(path.join(modelDir, 'model.onnx'), 'asr\n', 'utf8');
    t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));

    const files = await resolveSelectedModelFiles({
        modelRoot,
        modelIds: ['sensevoice']
    });

    assert.deepEqual(files.map((file) => file.relativePath), ['sensevoice/model.onnx']);
});

test('voiceprint 模型只选择原生引擎需要的 embedding 和 segmentation 文件', async (t) => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aasc-voiceprint-profile-'));
    const modelRoot = path.join(projectRoot, 'res', 'models');
    const voiceprintDir = path.join(modelRoot, 'voiceprint');
    await fs.promises.mkdir(voiceprintDir, { recursive: true });
    await fs.promises.writeFile(path.join(voiceprintDir, '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'), 'embedding\n');
    await fs.promises.writeFile(path.join(voiceprintDir, 'pyannote_segmentation_3_0_int8.onnx'), 'segmentation\n');
    await fs.promises.writeFile(path.join(voiceprintDir, '3dspeaker_speech_eres2net_large_sv_zh-cn_3dspeaker_16k.onnx'), 'unused\n');
    t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));

    const files = await resolveSelectedModelFiles({ modelRoot, modelIds: ['voiceprint'] });

    assert.deepEqual(files.map((file) => file.relativePath), [
        'voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
        'voiceprint/pyannote_segmentation_3_0_int8.onnx'
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
