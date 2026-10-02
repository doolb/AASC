'use strict';

// 面板与测试runtime共用同一规范化函数，避免坏存储或交叉滑块产生反向smoothstep。
function normalizeFillFacingRange(value = {}, editedKey = '') {
  const normalize = (input, fallback) => {
    if (!['number', 'string'].includes(typeof input) || String(input).trim() === '') return fallback;
    const number = Number(input);
    return Number.isFinite(number) ? Math.round(Math.max(-1, Math.min(1, number)) * 100) / 100 : fallback;
  };
  let start = Math.min(0.99, normalize(value?.start, -0.3));
  let end = Math.max(-0.99, normalize(value?.end, 0.3));
  if (end - start < 0.0099) {
    if (editedKey === 'end') start = Number((end - 0.01).toFixed(2));
    else end = Number((start + 0.01).toFixed(2));
  }
  return { start, end };
}

const PANEL_JS = `
    (() => {
      ${normalizeFillFacingRange.toString()}
      const start = document.getElementById('mmdArFillFacingStart');
      const end = document.getElementById('mmdArFillFacingEnd');
      const startOutput = document.getElementById('mmdArFillFacingStartValue');
      const endOutput = document.getElementById('mmdArFillFacingEndValue');
      if (!start || !end || !startOutput || !endOutput) return;
      const storageKey = 'aasc.mmdArTest.fillFacingRange.v1';
      const apply = (value, persist, editedKey = '') => {
        const settings = normalizeFillFacingRange(value, editedKey);
        start.value = String(settings.start);
        end.value = String(settings.end);
        startOutput.textContent = settings.start.toFixed(2);
        endOutput.textContent = settings.end.toFixed(2);
        window.MmdArTestFillFacingRange = Object.freeze(settings);
        if (persist) {
          try { localStorage.setItem(storageKey, JSON.stringify(settings)); }
          catch (error) { /* 存储受限时本次调参仍有效。 */ }
        }
      };
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); }
      catch (error) { /* 损坏或缺失的设置采用默认范围。 */ }
      apply(saved, false);
      for (const [input, key] of [[start, 'start'], [end, 'end']]) {
        const update = () => apply({ start: start.value, end: end.value }, true, key);
        input.addEventListener('input', update);
        input.addEventListener('change', update);
      }
      document.getElementById('displayMmdLightingReset')?.addEventListener('click', () => apply({}, true));
    })();
`;

function addFillFacingControls($, lightingPanel) {
  const body = lightingPanel.find('button[data-group-title="补光"]')
    .closest('.mmd-ar-panel-group').find('.mmd-ar-panel-group-body');
  if (body.length !== 1) throw new Error('补光过渡范围控件缺少唯一补光分组');
  body.append([['Start', '过渡起点', -0.3], ['End', '过渡终点', 0.3]].map(([suffix, label, value]) =>
    '<label class="mind-basic-field"><span>' + label + ' <output id="mmdArFillFacing' + suffix + 'Value">'
      + value.toFixed(2) + '</output></span><input id="mmdArFillFacing' + suffix
      + '" type="range" min="-1" max="1" step="0.01" value="' + value
      + '" aria-label="补光' + label + '"></label>'
  ).join('') + '<p class="mind-basic-note">沿用主光阴影时生效；起点处补光淡出，终点处完整保留。负值让过渡延伸到背光面。</p>');
}

function addFillFacingRuntime(source) {
  const once = (anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error('补光范围注入缺少唯一锚点：' + anchor);
    source = source.replace(anchor, replacement);
  };
  const modelAnchor = '    let currentMesh = null;';
  once(modelAnchor, `${modelAnchor}
    const syncTestFillFacingRange = (() => {
      ${normalizeFillFacingRange.toString()}
      let appliedSettings = null;
      let appliedMesh = null;
      return () => {
        const settings = window.MmdArTestFillFacingRange;
        if (!currentMesh || !settings || (settings === appliedSettings && currentMesh === appliedMesh)) return;
        const range = normalizeFillFacingRange(settings);
        let updated = false;
        currentMesh.traverse(object => {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            const uniform = material?.uniforms?.pmxFillKeyFacingRange;
            if (!uniform) continue;
            uniform.value.set(range.start, range.end);
            updated = true;
          }
        });
        // 材质尚未进入测试阴影路径时继续等待，不缓存未成功应用的模型。
        if (!updated) return;
        appliedSettings = settings;
        appliedMesh = currentMesh;
      };
    })();`);
  const frameAnchor = '        const delta = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));';
  once(frameAnchor, '        syncTestFillFacingRange();\n' + frameAnchor);
  return source;
}

module.exports = { PANEL_JS, addFillFacingControls, addFillFacingRuntime };

// 正式源码已包含此功能时复用共享实现，仅更新构建指纹。
module.exports = require('./web-production-shared').reuseAdapters(module.exports);
