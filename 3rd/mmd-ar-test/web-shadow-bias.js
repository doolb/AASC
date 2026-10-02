'use strict';

// 独立测试页的主光阴影参数集中定义，面板和生成 runtime 使用同一校验规则。
// 默认值沿用正式 runtime，不借本次调参改动正式显示端或独立补光的阴影参数。
const SHADOW_FIELDS = Object.freeze([
  Object.freeze({
    key: 'bias', id: 'mmdArKeyShadowBias', label: '阴影深度偏移 bias',
    min: -0.005, max: 0.005, step: 0.0001, digits: 4, defaultValue: -0.0005,
  }),
  Object.freeze({
    key: 'normalBias', id: 'mmdArKeyShadowNormalBias', label: '阴影法线偏移 normalBias',
    min: 0, max: 0.1, step: 0.001, digits: 3, defaultValue: 0.02,
  }),
]);

function normalizeShadowBias(value, field) {
  // 空值、布尔值和对象不参与 Number 隐式换算，避免误把坏存储值解释为零。
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return field.defaultValue;
  const number = Number(value);
  if (!Number.isFinite(number)) return field.defaultValue;
  const bounded = Math.min(field.max, Math.max(field.min, number));
  return Number((Math.round(bounded / field.step) * field.step).toFixed(field.digits));
}

// 函数没有闭包依赖；生成两处局部作用域，避免面板与 runtime 数值校验逐渐不一致。
const SETTINGS_JS = `
      const shadowBiasFields = ${JSON.stringify(SHADOW_FIELDS)};
      ${normalizeShadowBias.toString()}
`;

const PANEL_JS = `
    (() => {
      ${SETTINGS_JS}
      const controls = shadowBiasFields.map(field => ({
        field, input: document.getElementById(field.id), output: document.getElementById(field.id + 'Value')
      }));
      if (controls.some(control => !control.input || !control.output)) return;
      const storageKey = 'aasc.mmdArTest.keyShadowBias.v1';
      const apply = (value, persist) => {
        const settings = Object.fromEntries(shadowBiasFields.map(field => [
          field.key, normalizeShadowBias(value?.[field.key], field)
        ]));
        for (const { field, input, output } of controls) {
          input.value = String(settings[field.key]);
          output.textContent = settings[field.key].toFixed(field.digits);
        }
        // 冻结并替换整个设置对象；每帧可按身份快速判断，无全局回调或轮询定时器。
        window.MmdArTestKeyShadowSettings = Object.freeze(settings);
        if (!persist) return;
        try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch (error) { /* 存储受限时当前调整仍有效。 */ }
      };
      let saved = {};
      try {
        const text = localStorage.getItem(storageKey);
        if (text) saved = JSON.parse(text);
      } catch (error) { /* 缺失、坏 JSON 或存储受限时回到默认参数。 */ }
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
      apply(saved, false);
      const applyInputs = () => apply(Object.fromEntries(controls.map(({ field, input }) => [field.key, input.value])), true);
      for (const { input } of controls) {
        input.addEventListener('input', applyInputs);
        input.addEventListener('change', applyInputs);
      }
      document.getElementById('displayMmdLightingReset')?.addEventListener('click', () => apply({}, true));
    })();
`;

function addShadowBiasControls($, lightingPanel) {
  const group = lightingPanel.find('button[data-group-title="主光"]').closest('.mmd-ar-panel-group');
  const body = group.find('.mmd-ar-panel-group-body');
  if (body.length !== 1) throw new Error('主光阴影偏移控件缺少唯一的主光分组');
  body.append(SHADOW_FIELDS.map(field =>
    '<label class="mind-basic-field"><span>' + field.label + ' <output id="' + field.id + 'Value">'
      + field.defaultValue.toFixed(field.digits) + '</output></span>'
      + '<input id="' + field.id + '" type="range" min="' + field.min + '" max="' + field.max
      + '" step="' + field.step + '" value="' + field.defaultValue + '" aria-label="' + field.label + '"></label>'
  ).join('') + '<p class="mind-basic-note">条纹明显时，逐步把 bias 向负方向调，或增大 normalBias（场景单位）；一次调一项。偏移过大会让接触阴影脱离。</p>');
}

function addShadowBiasRuntime(source) {
  const replaceOnce = (anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error('主光阴影偏移注入锚点缺失或重复：' + anchor);
    source = source.replace(anchor, replacement);
  };
  const materialAnchor = '    const shadowMaterial = new THREE.ShadowMaterial({';
  replaceOnce(materialAnchor, `
    // 仅独立测试生成副本：渲染前读取主光设置，不改正式配置或补光自己的阴影。
    const syncTestKeyShadowBias = (() => {
      ${SETTINGS_JS}
      let appliedSettings = null;
      return () => {
        const settings = window.MmdArTestKeyShadowSettings;
        if (!settings || settings === appliedSettings) return;
        const bias = normalizeShadowBias(settings.bias, shadowBiasFields[0]);
        const normalBias = normalizeShadowBias(settings.normalBias, shadowBiasFields[1]);
        appliedSettings = settings;
        if (keyLight.shadow.bias === bias && keyLight.shadow.normalBias === normalBias) return;
        keyLight.shadow.bias = bias;
        keyLight.shadow.normalBias = normalBias;
        keyLight.shadow.needsUpdate = true;
      };
    })();
    syncTestKeyShadowBias();
${materialAnchor}`);
  const frameAnchor = '        const delta = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));';
  replaceOnce(frameAnchor, '        syncTestKeyShadowBias();\n' + frameAnchor);
  return source;
}

module.exports = { PANEL_JS, addShadowBiasControls, addShadowBiasRuntime };

// 正式源码已包含此功能时复用共享实现，仅更新构建指纹。
module.exports = require('./web-production-shared').reuseAdapters(module.exports);
