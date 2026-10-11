'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { hashFile } = require('./apk-artifact');

function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`统一灯光预设缺少唯一锚点：${anchor.slice(0, 90)}`);
    return source.replace(anchor, replacement);
}

function panel($) {
    const original = $('#displayMmdLightingPreset');
    if (original.length !== 1) throw new Error('统一灯光预设缺少旧预设入口');
    original.closest('label').remove();
    // 独立分类放在全部灯光分类之前，复用现有展开事件；保留select原ID。
    $('#displayMmdLightingPanel .display-mmd-lighting-header').after(`
      <section id="mmdArLightingPresets" class="mmd-ar-panel-group">
        <div class="mmd-ar-panel-group-header">
          <button class="mmd-ar-panel-group-toggle" type="button" data-group-title="灯光预设" aria-controls="mmdArLightingPresetsBody" aria-expanded="true" aria-label="收起灯光预设设置">
            <span>灯光预设</span><span class="mmd-ar-panel-group-arrow" aria-hidden="true">⌄</span>
          </button>
        </div>
        <div id="mmdArLightingPresetsBody" class="mmd-ar-panel-group-body">
        <label class="mind-basic-field"><span>灯光预设</span><select id="displayMmdLightingPreset"><option value="custom">当前设置（未保存）</option></select></label>
        <label class="mind-basic-field"><span>预设名称</span><input data-preset-name type="text" maxlength="64" placeholder="例如：暖色侧光" style="min-width:0;width:100%;box-sizing:border-box"></label>
        <div class="display-mmd-ar-actions" style="display:flex;flex-wrap:wrap;gap:6px">
          <button class="display-mmd-ar-action" type="button" data-preset-action="save">保存新预设</button>
          <button class="display-mmd-ar-action" type="button" data-preset-action="overwrite" disabled>覆盖所选</button>
          <button class="display-mmd-ar-action" type="button" data-preset-action="delete" disabled>删除所选</button>
          <button class="display-mmd-ar-action" type="button" data-preset-action="import">导入文件</button>
          <button class="display-mmd-ar-action" type="button" data-preset-action="export" disabled>导出所选</button>
          <button class="display-mmd-ar-action" type="button" data-preset-action="exportAll" disabled>导出全部</button>
        </div><input type="file" accept="application/json,.json" hidden>
        <p class="mind-basic-note" data-preset-status role="status" aria-live="polite" style="overflow-wrap:anywhere"></p>
      </div></section>`);
}

// 给已有闭包注册纯规范化、读取及批量应用入口，只改独立网页生成的面板脚本。
function panelScript(source) {
    let output = once(source,
        '      const applyInputs = () => apply(Object.fromEntries(controls.map(({ field, input }) => [field.key, input.value])), true);',
        `      window.MmdArLightingPresetGroups.keyShadowBias = {
        normalize: value => Object.fromEntries(shadowBiasFields.map(field => [field.key, normalizeShadowBias(value?.[field.key], field)])),
        read: () => ({ ...window.MmdArTestKeyShadowSettings }), apply: value => apply(value, true)
      };
      const applyInputs = () => apply(Object.fromEntries(controls.map(({ field, input }) => [field.key, input.value])), true);`);
    output = once(output, '      const applyInputs = () => apply({ size: input.value, previewEnabled: toggle.checked,',
        `      window.MmdArLightingPresetGroups.shadowMap = {
        normalize: value => ({ size: normalizeShadowMapSize(value?.size), cameraScale: normalizeShadowCameraScale(value?.cameraScale),
          previewEnabled: value?.previewEnabled === true, jointFit: normalizeJointFitEnabled(value?.jointFit) }),
        read: () => ({ ...window.MmdArTestShadowMapSettings }), apply: value => apply(value, true)
      };
      const applyInputs = () => apply({ size: input.value, previewEnabled: toggle.checked,`);
    output = once(output, "      for (const [input, key] of [[start, 'start'], [end, 'end']]) {",
        `      window.MmdArLightingPresetGroups.fillFacing = {
        normalize: normalizeFillFacingRange, read: () => ({ ...window.MmdArTestFillFacingRange }), apply: value => apply(value, true)
      };
      for (const [input, key] of [[start, 'start'], [end, 'end']]) {`);
    output = once(output, "      input.addEventListener('input', () => apply(input.value, true));",
        `      window.MmdArLightingPresetGroups.aoConcavity = {
        normalize: value => ({ angle: normalize(value?.angle) }),
        read: () => ({ angle: window.MmdArTestAoConcavityAngle }), apply: value => apply(value.angle, true)
      };
      input.addEventListener('input', () => apply(input.value, true));`);
    output = once(output, "      window.addEventListener('mmd-ar-ao-size', event => syncSize(event.detail.reduced));",
        `      window.MmdArLightingPresetGroups.aoEdgeCorrection = {
        normalize: value => ({ enabled: value?.enabled !== false }),
        read: () => ({ enabled: window.MmdArTestEdgeCorrection !== false }),
        apply: value => {
          enabled = value.enabled !== false;
          toggle.checked = enabled; window.MmdArTestEdgeCorrection = enabled;
          try { localStorage.setItem(storageKey, String(enabled)); } catch (error) { /* 本次边界修正仍生效。 */ }
          syncSize(resolution?.value !== 'full');
        }
      };
      window.addEventListener('mmd-ar-ao-size', event => syncSize(event.detail.reduced));`);
    output = once(output, '      window.MmdArTestNormalPreview = false;\n      toggle.checked = false;\n      toggle.addEventListener(\'change\', () => { window.MmdArTestNormalPreview = toggle.checked; });',
        `      const key = 'aasc.mmdArTest.aoNormalPreview.v1';
      const apply = value => {
        window.MmdArTestNormalPreview = value?.enabled === true;
        toggle.checked = window.MmdArTestNormalPreview;
        try { localStorage.setItem(key, JSON.stringify({ enabled: toggle.checked })); }
        catch (error) { /* 存储受限时法线预览仍生效。 */ }
      };
      window.MmdArLightingPresetGroups.aoPreview = {
        normalize: value => ({ enabled: value?.enabled === true }),
        read: () => ({ enabled: window.MmdArTestNormalPreview === true }), apply
      };
      try { const saved = JSON.parse(localStorage.getItem(key)); window.MmdArTestNormalPreview = saved?.enabled === true; }
      catch (error) { window.MmdArTestNormalPreview = false; }
      toggle.checked = window.MmdArTestNormalPreview;
      toggle.addEventListener('change', () => {
        try { apply({ enabled: toggle.checked }); } catch (error) { /* 当前预览仍生效；持久化失败由预设操作提示。 */ }
      });`);
    return output;
}

function lightingSource(source) {
    const start = source.indexOf('    const PRESETS = Object.freeze({');
    const end = source.indexOf('    const state = {', start);
    if (start < 0 || end < 0) throw new Error('统一灯光预设缺少旧预设定义');
    let output = source.slice(0, start) + '    const DEFAULT_LIGHTING = root.DisplayMmd.DEFAULT_MMD_LIGHTING;\n\n' + source.slice(end);
    const oldHandler = output.slice(output.indexOf('    function handlePresetChange() {'), output.indexOf('    function markCustomPreset() {'));
    if (!oldHandler) throw new Error('统一灯光预设缺少旧选择事件');
    output = output.replace(oldHandler, '').replaceAll('PRESETS.default', 'DEFAULT_LIGHTING');
    output = once(output, "        state.elements.preset.value = 'custom';", '        // 命名预设的修改状态由统一面板管理。');
    output = once(output, "        elements.preset.addEventListener('change', handlePresetChange);", '');
    output = once(output, "            elements.preset.value = 'default';", "            elements.preset.value = 'custom';");
    output = once(output, "        state.elements.preset.value = saved ? 'custom' : 'default';", "        state.elements.preset.value = 'custom';");
    output = once(output, '        bindEvents();', `        const stripPhysics = value => {
            const { physicsFps, rotationPhysicsLimit, shadowEnabled, webFillShadowMode, ...lighting } = value;
            return lighting;
        };
        root.MmdArLightingPresetGroups.lighting = {
            normalize: value => stripPhysics(root.DisplayMmd.normalizeLightingPreset(value)),
            read: () => stripPhysics(root.DisplayMmd.getLighting()),
            apply: value => applyLighting(value)
        };
        bindEvents();`);
    return output;
}

async function stage(root, { webMode } = {}) {
    if (!webMode) return;
    const helperName = 'web-lighting-defaults.mjs';
    const { parseDefaultPresetFile } = await import(pathToFileURL(path.join(__dirname, helperName)).href);
    const defaultPreset = parseDefaultPresetFile(await fs.readFile(path.join(__dirname, 'web-lighting-default-preset.json'), 'utf8'));
    const folder = path.join(root, 'js');
    const displayPath = path.join(folder, 'display-mmd.js');
    await fs.writeFile(displayPath, once(await fs.readFile(displayPath, 'utf8'), '        DEFAULT_MMD_LIGHTING,',
        '        DEFAULT_MMD_LIGHTING,\n        normalizeLightingPreset: normalizeMmdLighting,'));
    const lightingPath = path.join(folder, 'display-mmd-lighting.js');
    await fs.writeFile(lightingPath, lightingSource(await fs.readFile(lightingPath, 'utf8')));
    const dataName = 'web-lighting-preset-library.mjs';
    await fs.copyFile(path.join(__dirname, dataName), path.join(folder, dataName));
    const defaultName = 'web-lighting-default-preset.mjs';
    // 将版本化JSON写成同源模块，浏览器运行不读取机器上的/mnt文件。
    await fs.writeFile(path.join(folder, defaultName), `export default ${JSON.stringify(defaultPreset)};\n`);
    const dataHash = (await hashFile(path.join(folder, dataName))).sha256.slice(0, 12);
    const helperSource = (await fs.readFile(path.join(__dirname, helperName), 'utf8')).replace(`./${dataName}`, `./${dataName}?v=${dataHash}`);
    await fs.writeFile(path.join(folder, helperName), helperSource);
    let source = await fs.readFile(path.join(__dirname, 'web-lighting-presets.mjs'), 'utf8');
    for (const name of [dataName, 'web-specular.mjs', helperName, defaultName]) {
        const hash = (await hashFile(path.join(folder, name))).sha256.slice(0, 12);
        source = source.replace(`./${name}`, `./${name}?v=${hash}`);
    }
    await fs.writeFile(path.join(folder, 'web-lighting-presets.mjs'), source);
}

module.exports = { panel, panelScript, lightingSource, stage };
