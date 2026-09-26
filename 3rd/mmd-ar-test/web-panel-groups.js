'use strict';

// 仅用于 HTTPS 测试页生成阶段：移动现有控件节点，不重建输入框或改变原 ID。
const LIGHTING_GROUPS = Object.freeze([
  ['基础光照', ['displayMmdLightingPreset', 'displayMmdPmxToonEnabled', 'displayMmdAmbientColor', 'displayMmdAmbientIntensity']],
  ['AO', ['displayMmdPmxAoColor', 'displayMmdPmxAoIntensity', 'displayMmdPmxAoRadiusPercent', 'displayMmdPmxAoResolution', 'displayMmdPmxAoSampleCount', 'displayMmdPmxAoBlurPassCount', 'displayMmdPmxAoBlurRadius1', 'displayMmdPmxAoBlurRadius2', 'displayMmdPmxAoBlurRadius3'], 'displayMmdPmxAoEnabled'],
  ['主光', ['displayMmdKeyColor', 'displayMmdKeyIntensity', 'displayMmdKeyDirectionLongitude'], 'displayMmdKeyShadowEnabled'],
  ['补光', ['displayMmdShadowSource', 'displayMmdFillColor', 'displayMmdFillIntensity', 'displayMmdFillDirectionLongitude'], 'displayMmdFillEnabled'],
  ['边缘光 1', ['displayMmdRim1Color', 'displayMmdRim1Intensity', 'displayMmdRim1DirectionLongitude'], 'displayMmdRim1Enabled'],
  ['边缘光 2', ['displayMmdRim2Color', 'displayMmdRim2Intensity', 'displayMmdRim2DirectionLongitude'], 'displayMmdRim2Enabled'],
  ['物理', ['displayMmdPhysicsFps', 'displayMmdRotationPhysicsLimit']],
]);

const TRACKING_GROUPS = Object.freeze([
  ['定位图与校准', ['displayArTargetSelect', 'displayArTargetName', 'displayArPhysicalWidth', 'displayArCalibrationButton', 'mmdArTrackingToggle', 'mmdArTargetPlaneMode']],
  ['跟踪操作', ['mmdArBenchmarkLive', 'displayArStartButton', 'displayArTargetMessage']],
  ['体感环绕', ['displayArMotionSensitivity', 'displayArMotionRecenter', 'displayArMotionMessage'], 'displayArMotionEnabled'],
  ['相机跟随', ['mmdArTranslationDeadZone', 'mmdArRotationDeadZone', 'mmdArSmoothingMs', 'mmdArCameraDistance']],
]);

const WEB_PANEL_GROUP_CSS = `
    .mmd-ar-panel-group { margin: 9px 0; border: 1px solid #758bff66; border-radius: 10px; background: #171a22aa; overflow: hidden; }
    .mmd-ar-panel-group-header { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 11px; background: #39455c; }
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
  groupPanel($, trackingPanel, 'display-mmd-ar-header', TRACKING_GROUPS);
}

module.exports = { groupWebPanels, WEB_PANEL_GROUP_CSS, WEB_PANEL_GROUP_JS };
