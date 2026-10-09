'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('./apk-artifact');
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`TAA/倍率缺少唯一锚点：${anchor.slice(0, 80)}`);
    return source.replace(anchor, replacement);
}
async function stage(root) {
    const folder = path.join(root, 'js');
    for (const name of ['web-render-settings.mjs', 'web-temporal-aa-shader.mjs']) await fs.copyFile(path.join(__dirname, name), path.join(folder, name));
    const url = async name => `./${name}?v=${(await hashFile(path.join(folder, name))).sha256.slice(0, 12)}`;
    const settingsUrl = await url('web-render-settings.mjs'), shaderUrl = await url('web-temporal-aa-shader.mjs');
    let temporal = await fs.readFile(path.join(__dirname, 'web-temporal-aa.mjs'), 'utf8');
    temporal = temporal.replace('./web-temporal-aa-shader.mjs', shaderUrl).replace('./web-screen-lighting.mjs', await url('web-screen-lighting.mjs'));
    temporal = once(temporal, './web-render-settings.mjs', settingsUrl);
    await fs.writeFile(path.join(folder, 'web-temporal-aa.mjs'), temporal);
    const aoPath = path.join(folder, 'display-pmx-ao.mjs');
    let ao = await fs.readFile(aoPath, 'utf8');
    ao = `import { createTemporalAA } from '${await url('web-temporal-aa.mjs')}';\nimport { normalizeRenderSettings } from '${settingsUrl}';\n` + ao;
    ao = once(ao, '    let resources = null;', '    let resources = null;\n    let temporalContentKey = "";\n    const temporalAA = createTemporalAA({ THREE, renderer, camera });');
    ao = once(ao, '    const render = () => {', '    const renderSpatial = () => {');
    ao = once(ao, '    const renderSpatial = () => {\n        const normalPreview = window.MmdArTestNormalPreview === true;', `    const renderSpatial = () => {
        const normalPreview = window.MmdArTestNormalPreview === true;
        const settings = normalizeRenderSettings(window.MmdArRenderSettings);
        const upscale = camera.userData.mmdArTaaUpscaleActive === true && camera.userData.mmdArTaaBypass !== true && !normalPreview && renderer.capabilities.isWebGL2 === true;
        const outputSize = renderer.getDrawingBufferSize(new THREE.Vector2());
        const internalScale = upscale ? settings.fsr2Scale : 1;
        const internalWidth = Math.max(1, Math.floor(outputSize.x * internalScale));
        const internalHeight = Math.max(1, Math.floor(outputSize.y * internalScale));
        if (fullWidth !== internalWidth || fullHeight !== internalHeight) resize(internalWidth, internalHeight);`);
    // 场景目标已由正常透明混合预乘。变换前还原直色，变换后再预乘，
    // 让普通合成、TAA呈现和PNG导出保持同一语义；离屏变换为恒等映射。
    ao = once(ao, '    #include <tonemapping_fragment>\n    #include <colorspace_fragment>',
        '    gl_FragColor.rgb = gl_FragColor.a > 1e-6 ? gl_FragColor.rgb / gl_FragColor.a : vec3(0.);\n    #include <tonemapping_fragment>\n    #include <colorspace_fragment>\n    gl_FragColor.rgb *= gl_FragColor.a;');
    ao = once(ao, '!screenLighting.active()) || !supported)', '!screenLighting.active() && !temporalAA.active()) || !supported)');
    ao = once(ao, '    const setEnabled =', `    const render = (options = {}) => temporalAA.render(renderSpatial, () => resources?.depthTexture, {
        bypass: options.bypassTemporal === true || camera.userData.mmdArTaaBypass === true || window.MmdArTestNormalPreview === true || renderer.getRenderTarget() !== null,
        signature: JSON.stringify([enabled, resolutionMode, radius, intensity, sampleCount, blurPassCount, blurRadii,
            temporalContentKey, window.MmdArScreenLighting, scene.children.map(object => object.id)])
    });
    const setEnabled =`);
    ao = once(ao, '    const dispose = () => {', '    const dispose = () => {\n        temporalAA.dispose();');
    ao = once(ao, 'supported, resize, render, setEnabled, setResolution,', `supported, resize, render, setEnabled, setResolution,
        invalidateTemporal: temporalAA.invalidate, getTemporalState: temporalAA.getState,
        setTemporalContent: (mesh, motion, settings) => { temporalContentKey = JSON.stringify([mesh?.uuid, motion, settings]); },`);
    await fs.writeFile(aoPath, ao);
    const runtimePath = path.join(folder, 'display-pmx-runtime.js');
    let runtime = await fs.readFile(runtimePath, 'utf8');
    runtime = `import { calculateCanvasSize } from '${settingsUrl}';\nimport { runTemporalAction } from '${await url('web-temporal-aa.mjs')}';\n` + runtime;
    runtime = once(runtime, 'const pixelRatio = Math.min(2, Math.max(1, Number(devicePixelRatio) || 1));', `const gl = renderer.getContext();
        const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
        const renderSize = calculateCanvasSize(safeWidth, safeHeight, devicePixelRatio, window.MmdArRenderSettings?.canvasScale, limit);
        const pixelRatio = renderSize.pixelRatio;
        window.MmdArRenderInfo = { taaSupported: renderer.capabilities.isWebGL2 === true, ...renderSize };
        window.dispatchEvent(new Event('mmd-ar-render-capability'));`);
    runtime = once(runtime, '    const disposeCurrentModel = () => {', '    const disposeCurrentModel = () => {\n        ambientOcclusion.invalidateTemporal();');
    runtime = once(runtime, 'if (currentMesh) ambientOcclusion.render();', `if (currentMesh) {
                ambientOcclusion.setTemporalContent(currentMesh, currentMotionResourceId, lightingState);
                ambientOcclusion.render();
            }`);
    // 动作开关和切换清历史；连续动画依靠动态拒绝减轻拖影。
    runtime = once(runtime, 'const playMotion = async (resourceId) => loadMotion(resourceId);', 'const playMotion = async (resourceId) => await runTemporalAction(ambientOcclusion.invalidateTemporal, () => loadMotion(resourceId));');
    runtime = once(runtime, '    const setMotionPlaybackEnabled = (enabled) => {', '    const setMotionPlaybackEnabled = (enabled) => {\n        ambientOcclusion.invalidateTemporal();');
    await fs.writeFile(runtimePath, runtime);
}
function panel($) {
    // 倍率独占标题下一行，避免窄屏挤压实际分辨率与恢复默认按钮。
    $('#displayMmdRenderResolution').closest('.display-mmd-lighting-header').after(`<label class="mind-basic-field"><span>Canvas渲染倍率 <output data-render-value="canvasScale">1.00×</output></span><input type="range" data-render-setting="canvasScale" min="0.25" max="2" step="0.25" value="1"><small data-render-limit></small></label>`);
    $('#displayMmdLightingPanel').append(`<section id="mmdArTemporalAA" class="mmd-ar-panel-group">
      <div class="mmd-ar-panel-group-header"><label class="mmd-ar-panel-group-switch"><input type="checkbox" data-render-setting="taaEnabled" aria-label="启用抗锯齿"></label>
        <button class="mmd-ar-panel-group-toggle" type="button" aria-controls="mmdArTemporalAABody" aria-expanded="false" data-group-title="抗锯齿" aria-label="展开抗锯齿设置"><span>抗锯齿</span><span class="mmd-ar-panel-group-arrow" aria-hidden="true">⌄</span></button></div>
      <div id="mmdArTemporalAABody" class="mmd-ar-panel-group-body" hidden>
        <label class="mind-basic-field"><span>抗锯齿方式</span><select data-render-setting="aaMode"><option value="taa" selected>TAA</option><option value="fsr2">FSR2（无运动矢量）</option></select></label>
        <label class="mind-basic-field"><span>FSR2内部渲染比例 <output data-render-value="fsr2Scale">0.67×</output></span><input type="range" data-render-setting="fsr2Scale" min="0.5" max="1" step="0.01" value="0.67"></label>
        <label class="mind-basic-field"><span>TAA累积强度 <output data-render-value="taaHistoryWeight">0.90</output></span><input type="range" data-render-setting="taaHistoryWeight" min="0" max="0.95" step="0.05" value="0.9"></label>
        <label class="mind-basic-field"><span>抖动强度 <output data-render-value="taaJitterScale">1.00</output></span><input type="range" data-render-setting="taaJitterScale" min="0" max="2" step="0.05" value="1"></label>
        <label class="mind-basic-field"><span>抖动周期</span><select data-render-setting="taaJitterSamples"><option value="4">4帧</option><option value="8" selected>8帧</option><option value="16">16帧</option><option value="32">32帧</option></select></label>
        <p class="mind-basic-note">FSR2为普通WebGL2 Shader时域升采样近似，不接入AMD官方SDK；不使用物体运动矢量，动态角色可能残影。每帧仅绘制一次场景。</p>
        <p class="mind-basic-note">TAA强度0取消偏移但保留历史混合；较大抖动可能使画面变软。</p>
        <p class="mind-basic-note" data-taa-status></p></div></section>`);
}
module.exports = { stage, panel };
