'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');
const once = (source, anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error(`角色接入缺少唯一锚点：${anchor.slice(0, 90)}`);
    return source.replace(anchor, replacement);
};
const crypto = require('node:crypto');
const PUBLIC_MMD_AR_ROOT = 'https://c.aasc.us/mnt/mmd-ar/';
const PUBLIC_MMD_AR_ORIGIN = new URL(PUBLIC_MMD_AR_ROOT).origin;
const PUBLIC_MODEL_MANIFEST = new URL('mmd-resources.json', PUBLIC_MMD_AR_ROOT).href;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_MANIFEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_MODEL_BYTES = 64 * 1024 * 1024;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function validateGlbBytes(bytes, label) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'glTF'
        || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
        const error = new Error(`${label}不是有效的GLB 2.0文件`);
        error.code = 'ERR_INVALID_GLTF';
        throw error;
    }
}
async function readResponseBytes(response, maxBytes, label) {
    if (!response?.ok) throw new Error(`${label}HTTP状态异常：${response?.status ?? '无响应'}`);
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error(`${label}超过大小上限${maxBytes}字节`);
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') throw new Error(`${label}响应没有可读取的正文`);
    const chunks = [];
    let totalBytes = 0;
    try {
        for await (const chunk of response.body) {
            const buffer = Buffer.from(chunk);
            totalBytes += buffer.length;
            if (totalBytes > maxBytes) throw new Error(`${label}超过大小上限${maxBytes}字节`);
            chunks.push(buffer);
        }
    } catch (error) {
        if (error.message.includes('超过大小上限')) throw error;
        throw new Error(`${label}响应读取失败：${error.message}`, { cause: error });
    }
    if (!totalBytes) throw new Error(`${label}响应内容为空`);
    return Buffer.concat(chunks, totalBytes);
}
async function fetchBytes(url, maxBytes, label, fetchImpl, timeoutMs) {
    let response;
    try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    } catch (error) {
        throw new Error(`${label}请求失败：${error.message}`, { cause: error });
    }
    return readResponseBytes(response, maxBytes, label);
}
async function fetchPublicXishiModel({ fetchImpl, timeoutMs, maxManifestBytes, maxModelBytes }) {
    const manifestBytes = await fetchBytes(PUBLIC_MODEL_MANIFEST, maxManifestBytes, '西施资源清单', fetchImpl, timeoutMs);
    let manifest;
    try { manifest = JSON.parse(manifestBytes.toString('utf8')); }
    catch (error) { throw new Error(`西施资源清单JSON无效：${error.message}`, { cause: error }); }
    if (manifest?.status !== 'success' || !Array.isArray(manifest.resources)) throw new Error('公网西施资源清单结构无效');
    const profile = manifest.resources.find(resource => resource?.resourceId === 'xishi-default');
    if (!profile || profile.modelType !== 'glb' || profile.staticModel !== true) {
        throw new Error('公网资源清单缺少xishi-default静态GLB角色');
    }
    if (typeof profile.version !== 'string' || !/^[a-f0-9]{64}$/u.test(profile.version)) {
        throw new Error('公网西施模型清单缺少有效SHA-256版本');
    }
    if (typeof profile.modelUrl !== 'string') throw new Error('公网西施模型清单缺少有效URL');
    let modelUrl;
    try { modelUrl = new URL(profile.modelUrl, PUBLIC_MMD_AR_ROOT); }
    catch (error) { throw new Error(`公网西施模型URL无效：${error.message}`, { cause: error }); }
    const expectedPath = `/mnt/mmd-ar/mmd/xishi/xishi-${profile.version.slice(0, 12)}.glb`;
    if (modelUrl.protocol !== 'https:' || modelUrl.origin !== PUBLIC_MMD_AR_ORIGIN
        || modelUrl.pathname !== expectedPath || modelUrl.search || modelUrl.hash
        || modelUrl.username || modelUrl.password) {
        throw new Error('公网西施模型URL不属于允许的HTTPS版本化资源路径');
    }
    const bytes = await fetchBytes(modelUrl.href, maxModelBytes, '西施GLB', fetchImpl, timeoutMs);
    validateGlbBytes(bytes, '公网西施模型');
    const digest = sha256(bytes);
    if (digest !== profile.version) throw new Error(`公网西施GLB SHA-256不匹配：清单=${profile.version}，实际=${digest}`);
    return { bytes, sha256: digest, source: 'remote', url: modelUrl.href };
}
async function resolveXishiModelBytes({ sourceModel, webMode = false, fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, maxManifestBytes = DEFAULT_MAX_MANIFEST_BYTES,
    maxModelBytes = DEFAULT_MAX_MODEL_BYTES }) {
    let localError;
    try {
        const bytes = await fs.readFile(sourceModel);
        validateGlbBytes(bytes, '本地西施模型');
        return { bytes, sha256: sha256(bytes), source: 'local', url: null };
    } catch (error) {
        if (!['ENOENT', 'EISDIR', 'ERR_INVALID_GLTF'].includes(error.code)) throw error;
        localError = error;
    }
    if (!webMode) throw new Error(`本地西施GLB缺失或无效，APK构建不启用公网回退：${localError.message}`, { cause: localError });
    if (typeof fetchImpl !== 'function') throw new Error(`本地西施GLB缺失或无效，当前Node环境没有fetch：${localError.message}`, { cause: localError });
    try { return await fetchPublicXishiModel({ fetchImpl, timeoutMs, maxManifestBytes, maxModelBytes }); }
    catch (error) {
        throw new Error(`本地西施GLB不可用且公网回退失败：${error.message}`, { cause: error });
    }
}
async function stageRuntime(root, { webMode = false, fetchImpl = globalThis.fetch } = {}) {
    const sourceModel = path.join(__dirname, 'output/xishi/xishi.glb');
    const model = await resolveXishiModelBytes({ sourceModel, webMode, fetchImpl });
    const hash = model.sha256;
    const relative = `mmd/xishi/xishi-${hash.slice(0, 12)}.glb`;
    if (model.source === 'remote') process.stdout.write(`[mmd-ar] 本地西施GLB不可用，已校验并使用公网模型 ${relative}\n`);
    await fs.mkdir(path.join(root, 'mmd/xishi'), { recursive: true });
    await fs.writeFile(path.join(root, relative), model.bytes);
    const js = path.join(root, 'js');
    for (const name of ['web-character-glb.mjs', 'web-character-panel.mjs', 'web-pmx-project-materials.mjs']) await fs.copyFile(path.join(__dirname, name), path.join(js, name));
    const materialFile = path.join(js, 'web-pmx-project-materials.mjs');
    await fs.writeFile(materialFile, (await fs.readFile(materialFile, 'utf8')).replace('./web-local-assets.mjs', `./web-local-assets.mjs?v=${(await hashFile(path.join(js, 'web-local-assets.mjs'))).sha256.slice(0, 12)}`));
    const loaderUrl = `./web-character-glb.mjs?v=${(await hashFile(path.join(js, 'web-character-glb.mjs'))).sha256.slice(0, 12)}`;
    const materialUrl = `./web-pmx-project-materials.mjs?v=${(await hashFile(path.join(js, 'web-pmx-project-materials.mjs'))).sha256.slice(0, 12)}`;
    const patchMaterials = source => once(`import { applyPmxProjectMaterials } from '${materialUrl}';\n` + source,
        '            stagedMesh = await loadModelMesh(profile.modelUrl, report);',
        '            stagedMesh = await loadModelMesh(profile.modelUrl, report);\n            await applyPmxProjectMaterials(stagedMesh, profile);');
    const resourcePath = path.join(js, 'mmd-model-runtime.mjs');
    let source = await fs.readFile(resourcePath, 'utf8');
    source = `import { loadStaticCharacter } from '${loaderUrl}';\n` + source;
    source = once(source, '    const load = async (profile, reportProgress = onProgress) => {',
        '    const load = async (profile, reportProgress = onProgress) => {\n        if (profile?.modelType === "glb") return loadStaticCharacter(context, profile, reportProgress);');
    source = once(source, '    const loadSelectedMotion = async (motion, reportProgress = onProgress) => {',
        '    const loadSelectedMotion = async (motion, reportProgress = onProgress) => {\n        if (context.currentProfile?.modelType === "glb") throw new Error("静态角色没有骨骼动作");');
    await fs.writeFile(resourcePath, patchMaterials(source));
    // 独立构建会展开共享模块；必须给实际执行的主闭包同样接入GLB。
    const runtimePath = path.join(js, 'display-pmx-runtime.js');
    let runtime = await fs.readFile(runtimePath, 'utf8');
    const loadAnchor = '    const load = async (profile, reportProgress = onProgress) => {';
    if (runtime.includes(loadAnchor)) {
        const stateNames = ['modelSequence', 'disposed', 'currentMesh', 'currentRotationPivot',
            'currentProfile', 'pendingInitialMotionHelper', 'currentMotionResourceId'];
        const accessors = stateNames.map(name => `get ${name}() { return ${name}; }, set ${name}(value) { ${name} = value; }`).join(',\n');
        const staticContext = `{ THREE, onProgress, disposeObject, createModelRotationPivot, scene,
            applyShadowFlags, clearFallback, disposeCurrentModel, helper, resetModelRotation,
            fitCameraToModel, fitShadowCamera, onStatus, startRendering, ${accessors} }`;
        runtime = `import { loadStaticCharacter } from '${loaderUrl}';\n` + runtime;
        runtime = once(runtime, loadAnchor, loadAnchor +
            `\n        if (profile?.modelType === 'glb') return loadStaticCharacter(${staticContext}, profile, reportProgress);`);
        runtime = once(runtime, '    const loadSelectedMotion = async (motion, reportProgress = onProgress) => {',
            '    const loadSelectedMotion = async (motion, reportProgress = onProgress) => {\n        if (currentProfile?.modelType === "glb") throw new Error("静态角色没有骨骼动作");');
        await fs.writeFile(runtimePath, patchMaterials(runtime));
    } else if (!runtime.includes('createPmxModelResources(')) {
        throw new Error('角色构建未找到实际模型加载入口');
    }
    const localPath = path.join(js, 'web-local-assets-ui.mjs');
    let local = await fs.readFile(localPath, 'utf8');
    local = once(local, "    window.addEventListener('pagehide', (event) => {", `    document.addEventListener('mmd-ar-server-character-selected', event => {
        if (!['miya-default', 'xishi-default'].includes(event.detail?.resourceId)) return;
        currentModel?.release(); currentModel = null; releaseMotion();
        window.DisplayMmd.clearCameraMotion?.(); releaseCameraMotion(); cameraMotionName.textContent = '无相机动作';
        modelName.textContent = event.detail.name || '米娅';
        motionName.textContent = event.detail.modelType === 'glb' ? '静态角色' : '内置默认动作';
    });
    window.addEventListener('pagehide', (event) => {`);
    await fs.writeFile(localPath, local);
    return [{ resourceId: 'xishi-default', name: '西施', modelType: 'glb', modelUrl: './' + relative, version: hash, staticModel: true }];
}
function patchDisplay(source) {
    source = once(source, '    async function resolveProfile(profile) {',
        '    async function resolveProfile(profile) {\n        if (profile?.modelType === "glb") return resolvePmxProfile({ resourceId: profile.resourceId });');
    source = once(source, "        if (!resource || resource.modelType !== 'pmx'", `        if (resource?.modelType === 'glb' && resource.staticModel === true
            && isSameOriginMmdAsset(resource.modelUrl, '.glb')) return { ...resource };
        if (!resource || resource.modelType !== 'pmx'`);
    source = once(source, "const modelType = resolvedProfile.modelType === 'pmx' ? 'pmx' : 'vrm';",
        "const modelType = ['pmx', 'glb'].includes(resolvedProfile.modelType) ? 'pmx' : 'vrm';");
    source = once(source, '        loadModel(DEFAULT_MODEL_PROFILE);', `        let selectedRole = DEFAULT_MODEL_PROFILE.resourceId;
        const roleIds = { miya: 'miya-default', xishi: 'xishi-default' };
        try {
            const stored = localStorage.getItem('aasc.mmdArTest.character.v1');
            const saved = stored === 'xishi2-default' ? 'xishi-default' : stored;
            if (Object.values(roleIds).includes(saved)) selectedRole = saved;
        } catch (error) { /* 存储受限时仍允许URL指定角色。 */ }
        const requested = new URLSearchParams(location.search).get('character')?.trim().toLowerCase();
        if (requested === 'xishi2') selectedRole = 'xishi-default';
        if (Object.hasOwn(roleIds, requested)) selectedRole = roleIds[requested];
        loadModel({ ...DEFAULT_MODEL_PROFILE, resourceId: selectedRole });`);
    source = once(source, "            state.modelProfile = resolvedProfile;", "            state.modelProfile = resolvedProfile;\n            document.dispatchEvent(new CustomEvent('mmd-ar-character-loaded', { detail: { ...resolvedProfile } }));");
    source = once(source, '            if (loaded === false) return false;', '            if (loaded === false) throw new Error("角色加载未完成");');
    source = once(source, '        const sequence = ++state.loadSequence;', "        if (state.characterLoading) return false;\n        state.characterLoading = true;\n        const sequence = ++state.loadSequence;");
    // loadModel负责唯一加载锁；所有入口共享，避免本地和服务器角色互相覆盖。
    source = once(source, "            return false;\n        }\n    }\n\n    function handleServerMessage", "            return false;\n        } finally { state.characterLoading = false; }\n    }\n\n    function handleServerMessage");
    return source;
}
function addPanel($) {
    $('#mmdArMotionToggle').before('<button id="mmdArCharacterToggle" class="display-stage-button" type="button" aria-controls="mmdArCharacterPanel" aria-expanded="false">角色</button>');
    $('#mmdArMotionPanel').before(`<section id="mmdArCharacterPanel" class="display-mmd-lighting-panel" hidden aria-label="角色选择">
        <div class="display-mmd-lighting-header"><strong>角色</strong><button type="button" id="mmdArCharacterClose" aria-label="关闭角色面板">关闭</button></div>
        <div id="mmdArCharacterList" style="display:grid;gap:8px"></div>
        <p id="mmdArCharacterStatus" role="status" aria-live="polite">正在读取角色列表…</p>
        <p style="font-size:12px">西施为静态角色；米娅支持动作和布料物理。</p>
        </section>`);
    $('#mmdArCharacterPanel').append($('#mmdArLocalAssets'));
}
module.exports = { stageRuntime, patchDisplay, addPanel, resolveXishiModelBytes };
