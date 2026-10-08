'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');
const once = (source, anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error(`角色接入缺少唯一锚点：${anchor.slice(0, 90)}`);
    return source.replace(anchor, replacement);
};
async function stageRuntime(root) {
    const sourceModel = path.join(__dirname, 'output/xishi/xishi.glb');
    const hash = (await hashFile(sourceModel)).sha256;
    const relative = `mmd/xishi/xishi-${hash.slice(0, 12)}.glb`;
    await fs.mkdir(path.join(root, 'mmd/xishi'), { recursive: true });
    await fs.copyFile(sourceModel, path.join(root, relative));
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
module.exports = { stageRuntime, patchDisplay, addPanel };
