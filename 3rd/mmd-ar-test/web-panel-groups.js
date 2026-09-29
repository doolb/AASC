'use strict';

// 仅用于 HTTPS 测试页生成阶段：移动现有控件节点，不重建输入框或改变原 ID。
const LIGHTING_GROUPS = Object.freeze([
  ['基础光照', ['displayMmdLightingPreset', 'displayMmdPmxToonEnabled', 'displayMmdAmbientColor', 'displayMmdAmbientIntensity']],
  ['高光', []],
  ['AO', ['displayMmdPmxAoColor', 'displayMmdPmxAoIntensity', 'displayMmdPmxAoRadiusPercent', 'displayMmdPmxAoResolution', 'displayMmdPmxAoSampleCount', 'displayMmdPmxAoBlurPassCount', 'displayMmdPmxAoBlurRadius1', 'displayMmdPmxAoBlurRadius2', 'displayMmdPmxAoBlurRadius3'], 'displayMmdPmxAoEnabled'],
  ['主光', ['displayMmdKeyColor', 'displayMmdKeyIntensity', 'displayMmdKeyDirectionLongitude'], 'displayMmdKeyShadowEnabled'],
  ['补光', ['displayMmdShadowSource', 'displayMmdFillColor', 'displayMmdFillIntensity', 'displayMmdFillDirectionLongitude'], 'displayMmdFillEnabled'],
  ['边缘光 1', ['displayMmdRim1Color', 'displayMmdRim1Intensity', 'displayMmdRim1DirectionLongitude'], 'displayMmdRim1Enabled'],
  ['边缘光 2', ['displayMmdRim2Color', 'displayMmdRim2Intensity', 'displayMmdRim2DirectionLongitude'], 'displayMmdRim2Enabled'],
]);

const TRACKING_GROUPS = Object.freeze([
  ['定位图与校准', ['displayArTargetSelect', 'displayArTargetName', 'displayArPhysicalWidth', 'displayArCalibrationButton', 'mmdArTrackingToggle', 'mmdArTargetPlaneMode']],
  ['跟踪操作', ['mmdArBenchmarkLive', 'displayArStartButton', 'displayArTargetMessage']],
  ['体感环绕', ['displayArMotionSensitivity', 'displayArMotionRecenter', 'displayArMotionMessage'], 'displayArMotionEnabled'],
  ['相机跟随', ['mmdArTranslationDeadZone', 'mmdArRotationDeadZone', 'mmdArSmoothingMs', 'mmdArCameraDistance']],
]);

const WEB_PANEL_GROUP_CSS = `
    .mmd-ar-panel-group { margin: 9px 0; border: 1px solid #758bff66; border-radius: 10px; background: color-mix(in srgb, #171a22 var(--display-mmd-panel-opacity, 96%), transparent); overflow: hidden; }
    .mmd-ar-panel-group-header { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 11px; background: color-mix(in srgb, #39455c var(--display-mmd-panel-opacity, 96%), transparent); }
    .mmd-ar-panel-group-switch { display: flex; flex: none; align-items: center; justify-content: center; width: 18px; min-height: 32px; margin: 0; cursor: pointer; }
    .mmd-ar-panel-group-switch input { flex: none; }
    .mmd-ar-panel-group-toggle { display: flex; flex: 1; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; min-height: 32px; padding: 0; border: 0; background: transparent; color: #f4f6fb; font: 600 13px/1.4 system-ui, sans-serif; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }
    .mmd-ar-panel-group-switch + .mmd-ar-panel-group-toggle { flex: 1; min-width: 0; }
    .mmd-ar-panel-group-toggle:focus-visible { outline: 2px solid #aebaff; outline-offset: 2px; }
    .mmd-ar-panel-group-arrow { color: #c6d1ff; font-size: 17px; line-height: 1; transform: rotate(-90deg); transition: transform 150ms ease; }
    .mmd-ar-panel-group-toggle[aria-expanded="true"] .mmd-ar-panel-group-arrow { transform: rotate(0deg); }
    .mmd-ar-panel-group-body { padding: 2px 11px 11px; border-top: 1px solid #758bff33; }
    .mmd-ar-panel-group-body[hidden] { display: none; }
    .mmd-ar-panel-group-body > :first-child { margin-top: 9px; }
    .mmd-ar-panel-group-body > :last-child { margin-bottom: 0; }
    .mmd-ar-camera-clip { margin: 8px 0; padding: 8px 10px; border-radius: 7px; background: color-mix(in srgb, #26344a var(--display-mmd-panel-opacity, 96%), transparent); color: #dce8ff; font-size: 12px; font-variant-numeric: tabular-nums; }
    .mmd-ar-original-tracking-actions { display: none; }
    #mmdArTrackingToggle { width: 100%; min-height: 44px; }
    .mmd-ar-camera-setting input[type="range"] { width: 100%; }
    .mmd-ar-camera-setting small { color: #ccd6ee; line-height: 1.4; }
    .mmd-ar-plane-options { display: flex; gap: 6px; margin-top: 6px; }
    .mmd-ar-plane-options button { flex: 1; min-height: 38px; border: 1px solid #758bff88; border-radius: 7px; background: #222b3d; color: #d6e0f5; cursor: pointer; }
    .mmd-ar-plane-options button[aria-pressed="true"] { background: #5169a3; border-color: #a8bbff; color: #fff; }
`;

// 原灯光和定位面板会阻止点击向 document 冒泡，因此直接监听每个展开按钮。
// 同一标题行内的原生复选框仍由原业务脚本处理，不触发分类开合。
const WEB_PANEL_GROUP_JS = `
    (() => {
      const stage = document.getElementById('displayStageLayers');
      const inputs = Array.from(document.querySelectorAll('.display-mmd-panel-opacity-range'));
      if (!stage || inputs.length === 0) return;
      const storageKey = 'aasc.display.mmdPanelOpacity.v1';
      let opacity = 96;
      try {
        const stored = window.localStorage.getItem(storageKey);
        const parsed = stored === null || stored.trim() === '' ? NaN : Number(stored);
        if (Number.isFinite(parsed)) opacity = Math.max(0, Math.min(100, Math.round(parsed)));
      } catch (error) { /* 存储不可用时使用默认值，并保留当前页面调节能力。 */ }
      const applyOpacity = (value, persist = false) => {
        opacity = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
        stage.style.setProperty('--display-mmd-panel-opacity', opacity + '%');
        for (const input of inputs) {
          input.value = String(opacity);
          const output = input.closest('.display-mmd-panel-opacity-control')?.querySelector('output');
          if (output) output.textContent = opacity + '%';
        }
        if (!persist) return;
        try { window.localStorage.setItem(storageKey, String(opacity)); }
        catch (error) { /* 写入失败只影响刷新后的恢复，不影响本页面。 */ }
      };
      for (const input of inputs) {
        input.addEventListener('input', () => applyOpacity(input.value));
        input.addEventListener('change', () => applyOpacity(input.value, true));
      }
      applyOpacity(opacity);
    })();
    (() => {
      const field = document.querySelector('.mmd-ar-edge-correction');
      const toggle = field?.querySelector('input');
      const note = field?.querySelector('small');
      const resolution = document.getElementById('displayMmdPmxAoResolution');
      if (!toggle || !note) return;
      const storageKey = 'aasc.mmdArTest.aoEdgeCorrection.v1';
      let enabled = true;
      try { enabled = localStorage.getItem(storageKey) !== 'false'; } catch (error) { /* 存储不可用时默认开启。 */ }
      toggle.checked = enabled;
      window.MmdArTestEdgeCorrection = enabled;
      const syncSize = (reduced) => {
        toggle.disabled = !reduced;
        note.textContent = reduced ? '同时修正 AO 与法线预览边界' : '全分辨率无需修正；切回半分辨率恢复选择';
      };
      toggle.addEventListener('change', () => {
        window.MmdArTestEdgeCorrection = toggle.checked;
        try { localStorage.setItem(storageKey, String(toggle.checked)); } catch (error) { /* 不影响本次切换。 */ }
      });
      window.addEventListener('mmd-ar-ao-size', event => syncSize(event.detail.reduced));
      resolution?.addEventListener('change', () => syncSize(resolution.value !== 'full'));
      syncSize(resolution?.value !== 'full');
    })();
    (() => {
      const toggle = document.querySelector('.mmd-ar-normal-preview input');
      if (!toggle) return;
      // 诊断只在本次页面有效，不写入灯光配置；关闭时由原渲染分支恢复全部参数。
      window.MmdArTestNormalPreview = false;
      toggle.checked = false;
      toggle.addEventListener('change', () => { window.MmdArTestNormalPreview = toggle.checked; });
    })();
    (() => {
      const panel = document.getElementById('displayMmdLightingPanel');
      const label = panel?.querySelector('.mmd-ar-camera-clip');
      if (!panel || !label) return;
      let timer = null;
      const update = () => {
        if (window.DisplayMmd?.getState?.()?.modelReady !== true) {
          label.textContent = '当前 PMX 相机：模型未就绪';
          return;
        }
        const matrix = window.MmdArTestCameraProjection?.();
        if (!Array.isArray(matrix) || matrix.length !== 16) {
          label.textContent = '当前 PMX 相机：投影未就绪';
          return;
        }
        // WebGL 透视矩阵的 m22/m23 可直接反解裁剪面；AR 模式不能沿用 camera.near/far 字段。
        const m22 = matrix[10];
        const m23 = matrix[14];
        const near = m23 / (m22 - 1);
        const far = m23 / (m22 + 1);
        if (!matrix.every(Number.isFinite) || Math.abs(matrix[11] + 1) > 0.001
          || Math.abs(matrix[15]) > 0.001 || !Number.isFinite(near)
          || !Number.isFinite(far) || near <= 0 || far <= near) {
          label.textContent = '当前 PMX 相机：投影矩阵无法反解 near/far';
          return;
        }
        const ar = window.DisplayMmd?.getArCameraSyncState?.();
        const mode = ar?.active ? ar.trackingLost ? 'MindAR（失锁，沿用最后投影）' : 'MindAR 投影' : '普通相机';
        label.textContent = mode + ' · near=' + near.toPrecision(5) + ' · far=' + far.toPrecision(5);
      };
      const sync = () => {
        if (panel.hidden) {
          if (timer !== null) clearInterval(timer);
          timer = null;
          return;
        }
        update();
        if (timer === null) timer = setInterval(update, 500);
      };
      new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
      window.addEventListener('pagehide', () => { if (timer !== null) clearInterval(timer); }, { once: true });
      sync();
    })();
    (() => {
      const toggle = document.getElementById('mmdArPhysicsEnabled');
      if (!toggle) return;
      const storageKey = 'aasc.mmdArTest.physicsEnabled.v1';
      let enabled = true;
      try { enabled = localStorage.getItem(storageKey) !== 'false'; } catch (error) { /* 隐私模式按默认值运行。 */ }
      toggle.checked = enabled;
      window.DisplayMmd?.setPhysicsEnabled?.(enabled);
      toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        try {
          const applied = await window.DisplayMmd?.setPhysicsEnabled?.(toggle.checked);
          if (applied !== true) {
            toggle.checked = enabled;
            return;
          }
          enabled = toggle.checked;
          try { localStorage.setItem(storageKey, String(enabled)); } catch (error) { /* 隐私模式允许仅本次生效。 */ }
        } catch (error) {
          toggle.checked = enabled;
          console.warn('[MmdArTest] 切换 PMX 物理失败:', error);
        } finally {
          toggle.disabled = false;
        }
      });
    })();
    (() => {
      const toggle = document.getElementById('mmdArMotionPlayback');
      if (!toggle) return;
      const storageKey = 'aasc.mmdArTest.motionPlayback.v1';
      let enabled = true;
      try { enabled = localStorage.getItem(storageKey) !== 'false'; } catch (error) { /* 隐私模式按默认值运行。 */ }
      toggle.checked = enabled;
      window.DisplayMmd?.setMotionPlaybackEnabled?.(enabled);
      toggle.addEventListener('change', () => {
        enabled = toggle.checked;
        window.DisplayMmd?.setMotionPlaybackEnabled?.(enabled);
        try { localStorage.setItem(storageKey, String(enabled)); } catch (error) { /* 隐私模式允许仅本次生效。 */ }
      });
    })();
    (() => {
      // 测试页参数只保存于当前浏览器；无效存储值回退默认，不影响正式显示端配置。
      const storageKey = 'aasc.mmdArTest.cameraSettings.v1';
      const controls = [
        ['mmdArTranslationDeadZone', 'translationDeadZonePercent', 0.5, 0, 3, '%'],
        ['mmdArRotationDeadZone', 'rotationDeadZoneDegrees', 0.5, 0, 3, '°'],
        ['mmdArSmoothingMs', 'smoothingMs', 120, 0, 500, ' ms'],
        ['mmdArCameraDistance', 'distancePercent', 100, 50, 100, '%']
      ];
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (error) { stored = {}; }
      const settings = { targetPlane: stored.targetPlane === 'vertical' ? 'vertical' : 'floor' };
      const planeButtons = document.querySelectorAll('#mmdArTargetPlaneMode [data-target-plane]');
      const refreshPlaneButtons = () => planeButtons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.targetPlane === settings.targetPlane));
      });
      refreshPlaneButtons();
      planeButtons.forEach((button) => button.addEventListener('click', () => {
        settings.targetPlane = button.dataset.targetPlane;
        refreshPlaneButtons();
        window.DisplayMmd?.setArCameraSettings?.(settings);
        try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch (error) { /* 隐私模式允许仅本次生效。 */ }
      }));
      for (const [id, key, fallback, minimum, maximum, suffix] of controls) {
        const input = document.getElementById(id);
        const output = document.getElementById(id + 'Value');
        if (!input || !output) return;
        const candidate = Number(stored[key]);
        const value = stored[key] !== undefined && Number.isFinite(candidate)
          ? Math.min(maximum, Math.max(minimum, candidate)) : fallback;
        settings[key] = value;
        input.value = String(value);
        output.textContent = String(value) + suffix;
        input.addEventListener('input', () => {
          settings[key] = Number(input.value);
          output.textContent = input.value + suffix;
          window.DisplayMmd?.setArCameraSettings?.(settings);
          try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch (error) { /* 隐私模式允许仅本次生效。 */ }
        });
      }
      window.DisplayMmd?.setArCameraSettings?.(settings);
    })();
    (() => {
      const toggle = document.getElementById('mmdArTrackingToggle');
      const start = document.getElementById('displayArStartButton');
      const stop = document.getElementById('displayArStopButton');
      const status = document.getElementById('displayArTargetStatus');
      const calibration = document.getElementById('displayArCalibration');
      if (!toggle || !start || !stop) return;
      const isActive = (tracking) => tracking?.tracking === true
        || ['requestingCamera', 'searching', 'tracking', 'lost'].includes(tracking?.status)
        || (!stop.disabled && calibration?.hidden === true);
      const refresh = () => {
        const tracking = window.DisplayMmdAr?.getState?.();
        const active = isActive(tracking);
        toggle.textContent = active ? '结束定位' : '开始定位';
        toggle.disabled = !active && start.disabled;
        toggle.setAttribute('aria-label', toggle.textContent);
      };
      toggle.addEventListener('click', () => {
        const tracking = window.DisplayMmdAr?.getState?.();
        const active = isActive(tracking);
        if (active) void window.DisplayMmdAr?.stop?.();
        else start.click();
        refresh();
      });
      const observer = new MutationObserver(refresh);
      observer.observe(start, { attributes: true, attributeFilter: ['disabled'] });
      observer.observe(stop, { attributes: true, attributeFilter: ['disabled'] });
      if (status) observer.observe(status, { childList: true, subtree: true, characterData: true });
      refresh();
    })();
    document.querySelectorAll('.mmd-ar-panel-group-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const body = document.getElementById(button.getAttribute('aria-controls'));
        if (!body) return;
        body.hidden = !body.hidden;
        button.setAttribute('aria-expanded', String(!body.hidden));
        button.setAttribute('aria-label', (body.hidden ? '展开' : '收起') + button.dataset.groupTitle + '设置');
      });
    });
`;

function directPanelChild($, panel, controlId) {
  let node = panel.find(`#${controlId}`).first();
  if (!node.length) throw new Error(`网页分类缺少控件：${controlId}`);
  while (node.parent().length && node.parent()[0] !== panel[0]) {
    node = node.parent();
  }
  if (!node.parent().length || node.parent()[0] !== panel[0] || node.hasClass('mmd-ar-panel-group')) {
    throw new Error(`网页分类控件归属异常：${controlId}`);
  }
  return node;
}

function groupPanel($, panel, headerClass, groups) {
  const covered = new Set();
  for (const [index, [title, controlIds, switchId]] of groups.entries()) {
    const group = $('<section class="mmd-ar-panel-group"></section>');
    const header = $('<div class="mmd-ar-panel-group-header"></div>');
    let visibleTitle = title;
    if (switchId) {
      const switchLabel = directPanelChild($, panel, switchId);
      const switchText = switchLabel.find('span').first();
      if (!switchText.length) throw new Error(`网页分类开关缺少说明：${switchId}`);
      visibleTitle = switchText.text().trim();
      switchText.remove();
      switchLabel.find(`#${switchId}`).attr('aria-label', visibleTitle);
      covered.add(switchLabel[0]);
      header.append(switchLabel.addClass('mmd-ar-panel-group-switch'));
    }
    const bodyId = `${panel.attr('id')}Group${index + 1}`;
    const button = $('<button class="mmd-ar-panel-group-toggle" type="button"></button>')
      .attr('aria-controls', bodyId)
      .attr('aria-expanded', index === 0 ? 'true' : 'false')
      .attr('data-group-title', title)
      .attr('aria-label', `${index === 0 ? '收起' : '展开'}${title}设置`);
    button.append($('<span></span>').text(visibleTitle));
    button.append('<span class="mmd-ar-panel-group-arrow" aria-hidden="true">⌄</span>');
    header.append(button);
    const body = $('<div class="mmd-ar-panel-group-body"></div>');
    body.attr('id', bodyId);
    if (index !== 0) body.attr('hidden', '');
    for (const controlId of controlIds) {
      const node = directPanelChild($, panel, controlId);
      if (covered.has(node[0])) throw new Error(`网页分类重复控件：${controlId}`);
      covered.add(node[0]);
      body.append(node);
    }
    if (title === '基础光照' && panel.attr('id') === 'displayMmdLightingPanel') {
      // 测试专用读数不是原面板控件，不增加 ID，也不改变正式页控件清单。
      body.prepend(panel.children('.mmd-ar-camera-clip'));
    }
    if (title === '高光' && panel.attr('id') === 'displayMmdLightingPanel') {
      // 保留同一个设置容器，标题开关和正文参数继续复用原高光模块的事件与存储。
      group.addClass('mmd-ar-specular');
      header.prepend('<label class="mmd-ar-panel-group-switch"><input type="checkbox" data-specular="enabled" aria-label="启用自定义 Blinn-Phong 高光"></label>');
      body.append(`
        <label class="display-mmd-lighting-field"><span>高光颜色</span><input type="color" data-specular="color" value="#ffffff" disabled></label>
        <label class="display-mmd-lighting-field"><span>高光强度 <output>0.3</output></span><input type="range" data-specular="intensity" min="0" max="2" step="0.01" value="0.3" disabled></label>
        <label class="display-mmd-lighting-field"><span>高光锐度 <output>30</output></span><input type="range" data-specular="shininess" min="1" max="256" step="1" value="30" disabled></label>
        <small>关闭保留模型原高光；锐度越高光斑越集中。</small>
      `);
    }
    group.append(header, body);
    panel.append(group);
  }
  const ungrouped = panel.children().toArray().filter((node) => {
    const item = $(node);
    return !item.hasClass(headerClass) && !item.hasClass('mmd-ar-panel-group');
  });
  if (ungrouped.length) throw new Error(`网页面板仍有未分类控件：${ungrouped.map((node) => node.name).join(', ')}`);
}

function groupWebPanels($) {
  const lightingPanel = $('#displayMmdLightingPanel').first();
  const trackingPanel = $('#displayArTargetPanel').first();
  if (!lightingPanel.length || !trackingPanel.length) throw new Error('网页分类缺少灯光或定位面板');

  // 只在网页测试副本增加只读读数；原灯光控件与正式显示端页面不变。
  lightingPanel.find('.display-mmd-lighting-header').first().after(
    '<div class="mmd-ar-camera-clip" aria-live="polite">当前 PMX 相机：模型未就绪</div>'
  );

  // 将原按钮网格拆成校准与跟踪两组；保留按钮节点，原来的 ID 事件绑定继续有效。
  const actions = trackingPanel.find('.display-mmd-ar-actions').first();
  if (!actions.length) throw new Error('网页分类缺少定位操作按钮');
  const calibrationActions = $('<div class="display-mmd-ar-actions"></div>');
  const trackingActions = $('<div class="display-mmd-ar-actions mmd-ar-original-tracking-actions"></div>');
  for (const id of ['displayArCalibrationButton', 'displayArDeleteButton']) calibrationActions.append(actions.find(`#${id}`));
  for (const id of ['displayArStartButton', 'displayArStopButton']) trackingActions.append(actions.find(`#${id}`));
  actions.before(calibrationActions, trackingActions);
  calibrationActions.after('<button id="mmdArTrackingToggle" class="display-mmd-ar-action" type="button" disabled>开始定位</button>');
  actions.remove();

  groupPanel($, lightingPanel, 'display-mmd-lighting-header', LIGHTING_GROUPS);
  const aoGroup = lightingPanel.find('button[data-group-title="AO"]').closest('.mmd-ar-panel-group');
  aoGroup.find('.mmd-ar-panel-group-body').prepend(
    '<label class="display-mmd-lighting-field mmd-ar-edge-correction"><input type="checkbox" checked><span>半分辨率边界修正 <small></small></span></label>' +
    '<label class="display-mmd-lighting-field mmd-ar-normal-preview"><input type="checkbox"><span>深度重建法线预览（颜色代表方向，跳过 AO 与模糊）</span></label>'
  );
  groupPanel($, trackingPanel, 'display-mmd-ar-header', TRACKING_GROUPS);
  const panels = [lightingPanel, $('#mmdArMotionPanel').first(), trackingPanel].filter((panel) => panel.length > 0);
  for (const panel of panels) {
    const panelId = panel.attr('id');
    const inputId = `${panelId}Opacity`;
    panel.prepend(`
      <label class="display-mmd-panel-opacity-control" for="${inputId}">
        <span>面板不透明度 <output>96%</output></span>
        <input id="${inputId}" class="display-mmd-panel-opacity-range" type="range" min="0" max="100" step="1" value="96" aria-label="面板不透明度">
      </label>
    `);
  }
}

module.exports = { groupWebPanels, WEB_PANEL_GROUP_CSS, WEB_PANEL_GROUP_JS };
