'use strict';

// 四档选择、设备降档及默认值由同一声明生成面板/runtime，避免两端规则漂移。
function normalizeShadowMapSize(value, maxSize = 4096) {
  const sizes = [512, 1024, 2048, 4096];
  const requested = ['number', 'string'].includes(typeof value) && String(value).trim() !== ''
    && sizes.includes(Number(value)) ? Number(value) : 1024;
  const limit = Number.isFinite(Number(maxSize)) && Number(maxSize) >= 1 ? Number(maxSize) : 4096;
  const supported = sizes.filter(size => size <= limit && size <= requested);
  return supported.at(-1) || Math.min(512, 2 ** Math.floor(Math.log2(limit)));
}

const PANEL_JS = `
    (() => {
      ${normalizeShadowMapSize.toString()}
      const input = document.getElementById('mmdArShadowMapSize');
      const toggle = document.getElementById('mmdArShadowMapPreviewEnabled');
      const rows = document.getElementById('mmdArShadowMapPreviewRows');
      const sizeOutput = document.getElementById('mmdArShadowMapSizeValue');
      if (!input || !toggle || !rows || !sizeOutput) return;
      const key = 'aasc.mmdArTest.shadowMap.v1';
      const apply = (settings, persist) => {
        const limit = window.MmdArTestShadowMapLimit || 4096;
        const size = normalizeShadowMapSize(settings?.size, limit);
        const previewEnabled = settings?.previewEnabled === true;
        // 在极低设备上限下仍回显有效尺寸；常规档位保留但禁用不支持的选项。
        const automatic = input.querySelector('option[data-device-size]');
        automatic?.remove();
        for (const option of input.options) option.disabled = Number(option.value) > limit;
        if (![...input.options].some(option => Number(option.value) === size)) {
          const option = document.createElement('option');
          option.value = String(size); option.textContent = size + ' × ' + size + '（设备上限）';
          option.dataset.deviceSize = 'true'; input.append(option);
        }
        input.value = String(size);
        toggle.checked = previewEnabled;
        rows.hidden = !previewEnabled;
        sizeOutput.textContent = size + ' × ' + size;
        window.MmdArTestShadowMapSettings = Object.freeze({ size, previewEnabled });
        if (!persist) return;
        try { localStorage.setItem(key, JSON.stringify({ size, previewEnabled })); } catch (error) { /* 存储受限仍可当场调整。 */ }
      };
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (error) { /* 坏存储回默认。 */ }
      apply(saved, false);
      const applyInputs = () => apply({ size: input.value, previewEnabled: toggle.checked }, true);
      input.addEventListener('change', applyInputs);
      toggle.addEventListener('change', applyInputs);
      window.addEventListener('mmd-ar-shadow-map-limit', () => apply(window.MmdArTestShadowMapSettings, true));
      document.getElementById('displayMmdLightingReset')?.addEventListener('click', () => apply({}, true));
    })();
`;

function addShadowMapControls($, lightingPanel) {
  const body = lightingPanel.find('button[data-group-title="主光"]').closest('.mmd-ar-panel-group')
    .find('.mmd-ar-panel-group-body');
  if (body.length !== 1) throw new Error('阴影贴图尺寸缺少唯一主光分组');
  const rows = ['Key', 'Fill'].map((name, index) => '<figure style="margin:8px 0">'
    + '<figcaption id="mmdArShadowMap' + name + 'Status">' + (index ? '补光' : '主光') + '：等待阴影贴图</figcaption>'
    + '<canvas id="mmdArShadowMap' + name + 'Canvas" width="256" height="256" aria-label="'
    + (index ? '补光' : '主光') + '完整阴影贴图" style="display:block;width:100%;max-width:256px;height:auto;aspect-ratio:1;background:#fff;border:1px solid #888"></canvas></figure>').join('');
  body.append('<label class="mind-basic-field"><span>阴影贴图尺寸 <output id="mmdArShadowMapSizeValue">1024 × 1024</output></span>'
    + '<select id="mmdArShadowMapSize" aria-label="阴影贴图尺寸">'
    + [512, 1024, 2048, 4096].map(size => '<option value="' + size + '"' + (size === 1024 ? ' selected' : '')
      + '>' + size + ' × ' + size + '</option>').join('') + '</select></label>'
    + '<label class="display-mmd-lighting-field"><input id="mmdArShadowMapPreviewEnabled" type="checkbox"><span>显示 ShadowMap</span></label>'
    + '<div id="mmdArShadowMapPreviewRows" hidden>' + rows
    + '<p class="mind-basic-note">整张阴影贴图，不裁剪角色；深色为角色，白色为空白。覆盖比例按256×256采样估算，列表可见时每秒刷新4次。</p></div>'
    + '<p class="mind-basic-note">主光和补光共用此尺寸。尺寸越大细节越高，也会增加显存与渲染开销。</p>');
}

function addShadowMapRuntime(source, moduleUrl) {
  const replaceOnce = (anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error('ShadowMap注入锚点缺失或重复：' + anchor);
    source = source.replace(anchor, replacement);
  };
  const anchor = '    const shadowMaterial = new THREE.ShadowMaterial({';
  replaceOnce(anchor, `
    ${normalizeShadowMapSize.toString()}
    const shadowMapLimit = renderer.capabilities.maxTextureSize;
    window.MmdArTestShadowMapLimit = shadowMapLimit;
    window.dispatchEvent(new CustomEvent('mmd-ar-shadow-map-limit'));
    const shadowMapPreview = createShadowMapPreview({ THREE, renderer,
        lights: [keyLight, fillLight], root: window,
        getStatus: (index, shadowEnabled) => {
            if (!shadowEnabled) return '阴影已关闭';
            if (index === 0) return keyLight.castShadow ? '' : '主光阴影已关闭';
            if (!lightingState.fillEnabled) return '补光已关闭';
            if (shadowSource === 'key') return keyLight.castShadow ? '沿用主光阴影（复用上图）' : '主光阴影已关闭';
            return fillLight.castShadow ? '' : '补光不生成阴影';
        } });
    const shadowMapDiagnostic = () => ({
        size: keyLight.shadow.mapSize.x, limit: shadowMapLimit,
        maps: [keyLight, fillLight].map(light => ({ width: light.shadow.map?.width || 0,
            height: light.shadow.map?.height || 0, castShadow: light.castShadow })),
        memory: { ...renderer.info.memory },
        preview: shadowMapPreview.getState()
    });
    window.MmdArTestShadowMapDiagnostic = shadowMapDiagnostic;
    const syncTestShadowMapSize = () => {
        const settings = window.MmdArTestShadowMapSettings;
        const size = normalizeShadowMapSize(settings?.size, shadowMapLimit);
        for (const light of [keyLight, fillLight]) {
            if (light.shadow.mapSize.x === size && light.shadow.mapSize.y === size) continue;
            releaseShadowTargets(light.shadow);
            light.shadow.mapSize.set(size, size);
            light.shadow.needsUpdate = true;
        }
        shadowMapPreview.setEnabled(settings?.previewEnabled === true);
    };
    syncTestShadowMapSize();
${anchor}`);
  const frameAnchor = '        const delta = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));';
  replaceOnce(frameAnchor, '        syncTestShadowMapSize();\n' + frameAnchor);
  const afterFrame = '            if (firstFramePivot) firstFramePivot.visible = firstFramePivotVisible;\n        }';
  replaceOnce(afterFrame, afterFrame + '\n        shadowMapPreview.update(now);');
  const disposeAnchor = '        ambientOcclusion.dispose();';
  replaceOnce(disposeAnchor, `        shadowMapPreview.dispose();
        for (const light of [keyLight, fillLight]) releaseShadowTargets(light.shadow);
        if (window.MmdArTestShadowMapDiagnostic === shadowMapDiagnostic) delete window.MmdArTestShadowMapDiagnostic;
${disposeAnchor}`);
  return `import { createShadowMapPreview, releaseShadowTargets } from ${JSON.stringify(moduleUrl)};\n` + source;
}

module.exports = { normalizeShadowMapSize, PANEL_JS, addShadowMapControls, addShadowMapRuntime };
