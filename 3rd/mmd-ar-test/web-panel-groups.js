'use strict';

const { CAMERA_SETTINGS_JS } = require('./camera-settings-template');
const SHADOW_BIAS = require('./web-shadow-bias');
const SHADOW_MAP = require('./web-shadow-map-size');
const WIND = require('./web-physics-wind');
const FILL_FACING_RANGE = require('./web-fill-facing-range');
const PHYSICS_SOLVER = require('./web-physics-solver');

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
  ['MindAR 抖动过滤', ['mmdArFilterMinCF', 'mmdArFilterBeta', 'mmdArFilterApplyHint']],
  ['IMU 相机预测', ['mmdArImuPanel']],
  ['MindAR 可信度（估算）', ['mmdArQualityPanel']],
  ['重力旋转', ['mmdArGravityCameraEnabled', 'mmdArGravityCameraMessage', 'mmdArGravityDeadZone', 'mmdArGravitySmoothing', 'displayArMotionRecenter', 'displayArMotionMessage'], 'displayArMotionEnabled'],
  ['相机跟随', ['mmdArTranslationDeadZone', 'mmdArRotationDeadZone', 'mmdArSmoothingMs', 'mmdArCameraDistance']],
]);

const MOTION_GROUPS = Object.freeze([
  ['动作', ['mmdArMotionPlayback', 'mmdArCameraMotionPlayback', 'mmdArMotionProgress', 'mmdArCameraMotionProgress']],
  ['物理', ['mmdArPhysicsEnabled', 'mmdArPhysicsSolver', 'mmdArPhysicsSolverStatus', 'mmdArVertexClothPanel', 'displayMmdPhysicsFps', 'mmdArPhysicsStabilityReference', 'mmdArPhysicsStabilityReferenceHint', 'displayMmdRotationPhysicsLimit', 'mmdArWindEnabled', 'mmdArWindStrength', 'mmdArWindLongitude', 'mmdArWindLatitude', 'mmdArWindGust', 'mmdArWindHint']],
  ['骨骼', ['mmdArSkeletonLegend', 'mmdArSkeletonSize', 'mmdArSkeletonOcclusionEnabled', 'mmdArSkeletonOccludedOpacity', 'mmdArSkeletonNamesEnabled', 'mmdArSkeletonJointParametersEnabled', 'mmdArSkeletonJointLegend', 'mmdArSkeletonJointDetails', 'mmdArSkeletonSelectionStatus', 'mmdArSkeletonClearContacts', 'mmdArSkeletonHint', 'mmdArRigidBodyEnabled', 'mmdArRigidBodyStatus', 'mmdArRigidBodyControls', 'mmdArRigidBodyLegend'], 'mmdArSkeletonEnabled'],
]);

const WEB_PANEL_GROUP_CSS = `
    .mmd-ar-panel-group { margin: 9px 0; border: 1px solid #758bff66; border-radius: 10px; background: color-mix(in srgb, #171a22 var(--display-mmd-panel-opacity, 50%), transparent); overflow: hidden; }
    .mmd-ar-panel-group-header { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 11px; background: color-mix(in srgb, #39455c var(--display-mmd-panel-opacity, 50%), transparent); }
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
    .mmd-ar-camera-clip { margin: 8px 0; padding: 8px 10px; border-radius: 7px; background: color-mix(in srgb, #26344a var(--display-mmd-panel-opacity, 50%), transparent); color: #dce8ff; font-size: 12px; font-variant-numeric: tabular-nums; }
    .mmd-ar-joint-scale { display: flex; align-items: center; gap: 6px; margin: 5px 0; }
    .mmd-ar-joint-ramp { width: 70px; height: 8px; background: linear-gradient(90deg,#3b82f6,#22d3ee,#facc15,#ff5a5a); border-radius: 4px; }
    .mmd-ar-joint-card { margin: 8px 0; padding: 6px; border: 1px solid #758bff55; border-radius: 6px; overflow-wrap: anywhere; }
    .mmd-ar-joint-values { display: flex; flex-wrap: wrap; gap: 6px; }
    .mmd-ar-joint-value { font-variant-numeric: tabular-nums; }
    .mmd-ar-joint-value::before { content: '■'; margin-right: 3px; }
    .mmd-ar-joint-actual { white-space: pre-line; font-variant-numeric: tabular-nums; }
    .mmd-ar-original-tracking-actions { display: none; }
    #mmdArTrackingToggle { width: 100%; min-height: 44px; }
    .mmd-ar-camera-setting input[type="range"] { width: 100%; }
    .mmd-ar-camera-setting small { color: #ccd6ee; line-height: 1.4; }
    .mind-basic-field { display: flex; flex-direction: column; gap: 5px; margin: 10px 0; font-size: 12px; }
    .mind-basic-field input[type="range"] { width: 100%; }
    .mind-basic-imu-options label { display: flex; align-items: center; gap: 6px; margin: 8px 0; font-size: 12px; }
    .mind-basic-imu-metrics { margin: 10px 0; font-size: 12px; font-variant-numeric: tabular-nums; }
    .mind-basic-imu-metrics > div { display: flex; justify-content: space-between; gap: 8px; margin: 6px 0; }
    .mind-basic-imu-metrics dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
    .mind-basic-note, .mind-basic-imu-status { font-size: 12px; line-height: 1.5; color: #ccd6ee; }
    .mmd-ar-plane-options { display: flex; gap: 6px; margin-top: 6px; }
    .mmd-ar-plane-options button { flex: 1; min-height: 38px; border: 1px solid #758bff88; border-radius: 7px; background: #222b3d; color: #d6e0f5; cursor: pointer; }
    .mmd-ar-plane-options button[aria-pressed="true"] { background: #5169a3; border-color: #a8bbff; color: #fff; }
    #mmdArMotionProgress, #mmdArCameraMotionProgress { width: 100%; height: 12px; accent-color: var(--accent-color); }
    .mmd-ar-mass-legend { display: flex; flex-direction: column; gap: 5px; margin: 8px 0; font-size: 12px; line-height: 1.5; color: #ccd6ee; }
    .mmd-ar-mass-legend[hidden] { display: none; }
    .mmd-ar-rigid-body-controls { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
    .mmd-ar-rigid-body-controls .mmd-ar-plane-options { margin-top: 0; }
    .mmd-ar-mass-bar { height: 10px; border-radius: 5px; background: linear-gradient(90deg, #3b82f6, #ff5a5a); }
    .mmd-ar-mass-zero i { display: inline-block; width: 9px; height: 9px; margin-right: 4px; border-radius: 50%; background: #d1d5db; }
    #mmdArSkeletonLegend { display: flex; flex-wrap: wrap; gap: 8px 12px; font-size: 12px; line-height: 1.6; }
    #mmdArSkeletonLegend i { display: inline-block; width: 9px; height: 9px; margin-right: 4px; border-radius: 50%; background: var(--bone-color); }
`;

// 原灯光和定位面板会阻止点击向 document 冒泡，因此直接监听每个展开按钮。
// 同一标题行内的原生复选框仍由原业务脚本处理，不触发分类开合。
const WEB_PANEL_GROUP_JS = `
    ${PHYSICS_SOLVER.SOLVER_PANEL_JS}
    ${SHADOW_BIAS.PANEL_JS}
    ${SHADOW_MAP.PANEL_JS}
    ${FILL_FACING_RANGE.PANEL_JS}
    (() => {
      const toggle = document.getElementById('mmdArRigidBodyEnabled');
      const status = document.getElementById('mmdArRigidBodyStatus');
      const legend = document.getElementById('mmdArRigidBodyLegend');
      const massRange = document.getElementById('mmdArRigidBodyMassRange');
      if (!toggle || !status) return;
      const key = 'aasc.mmdArTest.rigidBodyVisible.v1';
      try { toggle.checked = localStorage.getItem(key) === 'true'; } catch (error) { toggle.checked = false; }
      // 质量数字按3位有效数字裁剪；色带渐变直接取运行时色带，避免两处颜色漂移。
      const formatMass = (value) => String(Number(Number(value).toPrecision(3)));
      const updateLegend = (state) => {
        if (!legend || !massRange) return;
        legend.hidden = !toggle.checked;
        if (!toggle.checked) return;
        const bar = legend.querySelector('.mmd-ar-mass-bar');
        if (bar && !bar.dataset.ready && Array.isArray(state?.massRamp) && state.massRamp.length > 1) {
          bar.dataset.ready = '1';
          bar.style.background = 'linear-gradient(90deg, '
            + state.massRamp.map((color) => '#' + color.toString(16).padStart(6, '0')).join(', ') + ')';
        }
        massRange.textContent = !state?.bodyCount ? '质量色阶：等待模型'
          : state.massScale ? '质量色阶（对数）：' + formatMass(state.massScale.min) + ' – ' + formatMass(state.massScale.max)
          : '无非零质量刚体（全部浅灰）';
      };
      const updateStatus = () => {
        if (!toggle.checked) { status.textContent = '碰撞体显示已关闭'; updateLegend(null); return; }
        const state = window.DisplayMmd?.getRigidBodyState?.();
        updateLegend(state);
        if (!state?.bodyCount) { status.textContent = '当前模型没有可显示的碰撞体'; return; }
        const modes = { physics: '实际物理姿态', preview: '未模拟，显示配置位置', mixed: '部分未模拟，包含配置位置预览', none: '等待模型显示' };
        status.textContent = (state.filtered ? state.visibleBodyCount + ' / ' : '') + state.bodyCount + ' 个碰撞体 · ' + (modes[state.poseMode] || modes.none);
      };
      window.DisplayMmd?.setRigidBodyVisible?.(toggle.checked);
      toggle.addEventListener('change', () => {
        window.DisplayMmd?.setRigidBodyVisible?.(toggle.checked);
        try { localStorage.setItem(key, String(toggle.checked)); } catch (error) { /* 存储受限时本次切换仍有效。 */ }
        updateStatus();
      });
      // 碰撞体样式：线框保持透过，实体与角色互相遮挡；均本地记忆并转发到当前runtime。
      const styleGroup = document.getElementById('mmdArRigidBodyStyle');
      const styleButtons = styleGroup ? Array.from(styleGroup.querySelectorAll('[data-rigid-body-style]')) : [];
      const hiddenToggle = document.getElementById('mmdArCharacterHiddenEnabled');
      const styleKey = 'aasc.mmdArTest.rigidBodyStyle.v1';
      let style = 'solid';
      try { style = localStorage.getItem(styleKey) === 'wireframe' ? 'wireframe' : 'solid'; } catch (error) { style = 'solid'; }
      const refreshStyle = () => styleButtons.forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.rigidBodyStyle === style)));
      const applyStyle = (value, persist = false) => {
        style = value === 'wireframe' ? 'wireframe' : 'solid';
        refreshStyle();
        window.DisplayMmd?.setRigidBodyStyle?.(style);
        if (!persist) return;
        try { localStorage.setItem(styleKey, style); } catch (error) { /* 存储受限时本次切换仍有效。 */ }
      };
      for (const button of styleButtons) {
        button.addEventListener('click', () => applyStyle(button.dataset.rigidBodyStyle, true));
      }
      applyStyle(style);
      if (hiddenToggle) {
        const hiddenKey = 'aasc.mmdArTest.characterHidden.v1';
        try { hiddenToggle.checked = localStorage.getItem(hiddenKey) === 'true'; } catch (error) { hiddenToggle.checked = false; }
        window.DisplayMmd?.setCharacterHidden?.(hiddenToggle.checked);
        hiddenToggle.addEventListener('change', () => {
          window.DisplayMmd?.setCharacterHidden?.(hiddenToggle.checked);
          try { localStorage.setItem(hiddenKey, String(hiddenToggle.checked)); } catch (error) { /* 存储受限时本次切换仍有效。 */ }
        });
      }
      // 只在动作面板打开时查询快照；不在每个渲染帧更新DOM。
      const panel = document.getElementById('mmdArMotionPanel');
      let timer = null;
      const sync = () => {
        if (timer !== null) clearInterval(timer);
        timer = null;
        updateStatus();
        if (panel && !panel.hidden) timer = setInterval(updateStatus, 500);
      };
      if (panel) new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
      window.addEventListener('pagehide', () => { if (timer !== null) clearInterval(timer); }, { once: true });
      sync();
    })();
    (() => {
      const toggle = document.getElementById('mmdArSkeletonEnabled');
      if (!toggle) return;
      const key = 'aasc.mmdArTest.skeletonVisible.v1';
      try { toggle.checked = localStorage.getItem(key) === 'true'; } catch (error) { toggle.checked = false; }
      window.DisplayMmd?.setSkeletonVisible?.(toggle.checked);
      toggle.addEventListener('change', () => {
        window.DisplayMmd?.setSkeletonVisible?.(toggle.checked);
        try { localStorage.setItem(key, String(toggle.checked)); } catch (error) { /* 存储受限时仍允许本次切换。 */ }
      });
    })();
    (() => {
      const size = document.getElementById('mmdArSkeletonSize');
      const names = document.getElementById('mmdArSkeletonNamesEnabled');
      const joints = document.getElementById('mmdArSkeletonJointParametersEnabled');
      const jointLegend = document.getElementById('mmdArSkeletonJointLegend');
      const jointDetails = document.getElementById('mmdArSkeletonJointDetails');
      const occlusion = document.getElementById('mmdArSkeletonOcclusionEnabled');
      const opacity = document.getElementById('mmdArSkeletonOccludedOpacity');
      const opacityOutput = document.getElementById('mmdArSkeletonOccludedOpacityValue');
      const status = document.getElementById('mmdArSkeletonSelectionStatus');
      const clear = document.getElementById('mmdArSkeletonClearContacts');
      const output = document.getElementById('mmdArSkeletonSizeValue');
      if (!size || !names || !joints || !jointLegend || !jointDetails || !occlusion || !opacity || !opacityOutput || !status || !clear || !output) return;
      const key = 'aasc.mmdArTest.skeletonDisplay.v1';
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; }
      catch (error) { /* 偏好损坏时使用明确默认值，允许本次操作。 */ }
      const normalize = value => typeof value === 'number' && Number.isFinite(value)
        ? Math.round(Math.max(0.2, Math.min(3, value)) * 10) / 10 : 1;
      const normalizeOpacity = value => typeof value === 'number' && Number.isFinite(value)
        ? Math.round(Math.max(0, Math.min(1, value)) * 100) / 100 : 0.5;
      // 旧偏好没有遮挡字段时默认关闭，保留原穿透显示；仅接受布尔true。
      const settings = { sizeMultiplier: normalize(saved.sizeMultiplier), namesVisible: saved.namesVisible === true,
        jointParametersVisible: saved.jointParametersVisible === true,
        occlusionEnabled: saved.occlusionEnabled === true, occludedOpacity: normalizeOpacity(saved.occludedOpacity) };
      size.value = String(settings.sizeMultiplier);
      names.checked = settings.namesVisible;
      joints.checked = settings.jointParametersVisible;
      occlusion.checked = settings.occlusionEnabled;
      opacity.value = String(Math.round(settings.occludedOpacity * 100));
      const apply = () => {
        output.textContent = settings.sizeMultiplier.toFixed(1) + ' 倍';
        opacityOutput.textContent = Math.round(settings.occludedOpacity * 100) + '%';
        window.DisplayMmd?.setSkeletonSize?.(settings.sizeMultiplier);
        window.DisplayMmd?.setSkeletonNamesVisible?.(settings.namesVisible);
        window.DisplayMmd?.setSkeletonJointParametersVisible?.(settings.jointParametersVisible);
        window.DisplayMmd?.setSkeletonOcclusion?.(settings.occlusionEnabled);
        window.DisplayMmd?.setSkeletonOccludedOpacity?.(settings.occludedOpacity);
      };
      const save = () => { try { localStorage.setItem(key, JSON.stringify(settings)); } catch (error) { /* 存储受限仍即时生效。 */ } };
      size.addEventListener('input', () => { settings.sizeMultiplier = normalize(Number(size.value)); apply(); save(); });
      names.addEventListener('change', () => { settings.namesVisible = names.checked; apply(); save(); });
      joints.addEventListener('change', () => { settings.jointParametersVisible = joints.checked; apply(); save(); updateJoints(); });
      occlusion.addEventListener('change', () => { settings.occlusionEnabled = occlusion.checked; apply(); save(); });
      const updateOpacity = () => { settings.occludedOpacity = normalizeOpacity(Number(opacity.value) / 100); apply(); save(); };
      opacity.addEventListener('input', updateOpacity);
      opacity.addEventListener('change', updateOpacity);
      const update = () => {
        const state = window.DisplayMmd?.getSkeletonState?.();
        const selected = state?.selectedBoneIndex >= 0;
        clear.disabled = !selected;
        if (!selected) { status.textContent = '轻点小球选中骨骼，点空白取消'; return; }
        const name = state.selectedBoneName || ('骨骼 #' + state.selectedBoneIndex);
        const detail = !state.ownBodyIndices?.length ? '无关联刚体'
          : state.contactError ? '接触记录暂不可用'
          : !state.contactActive ? '未模拟，显示自身配置位置'
          : '自身 ' + state.ownBodyIndices.length + ' · 累计碰撞 ' + state.contactBodyIndices.length;
        status.textContent = name + ' · ' + detail;
      };
      clear.addEventListener('click', () => { window.DisplayMmd?.clearSkeletonContacts?.(); update(); });
      // 静态DOM仅在模型/选择变化时建立；实时姿态单独刷新，模型名称只写textContent。
      const numeric = value => Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '—';
      const axes = ['X', 'Y', 'Z'];
      let jointKey = '';
      const readings = new Map();
      const node = (tag, text, className) => {
        const element = document.createElement(tag);
        element.textContent = text;
        if (className) element.className = className;
        return element;
      };
      const updateJoints = () => {
        const canRead = settings.jointParametersVisible
          && !jointDetails.closest('.mmd-ar-panel-group-body')?.hidden
          && !document.getElementById('mmdArMotionPanel')?.hidden;
        const state = canRead ? window.DisplayMmd?.getSkeletonJointState?.() : null;
        const visible = state?.active === true;
        jointLegend.hidden = !visible; jointDetails.hidden = !visible;
        if (!visible) {
          if (jointKey) { jointKey = ''; readings.clear(); jointDetails.replaceChildren(); }
          return;
        }
        const key = state.generation + ':' + state.selectedBoneIndex;
        if (jointKey !== key) {
          jointKey = key; readings.clear();
          const legend = document.createDocumentFragment();
          for (const [title, scale] of [['平移 K', state.translationScale], ['旋转 K', state.rotationScale]]) {
            const row = node('div', '', 'mmd-ar-joint-scale');
            row.append(node('span', title), node('i', '', 'mmd-ar-joint-ramp'),
              node('span', scale ? numeric(scale.min) + '～' + numeric(scale.max) : '全 0'));
            legend.append(row);
          }
          legend.append(node('div', '蓝低 → 红高 · 灰 K=0（弹簧关闭）；两组分别按全模型对数色阶。'));
          legend.append(node('div', '直箭头＝平移；圆弧＝旋转。短刻度1/2/3、圆弧小/中/大对应XYZ。'));
          legend.append(node('div', '区间/弧段＝限位，菱形＝锁定，虚线＝自由。白标＝实际变化，红标＝越界或超过平移显示范围。'));
          legend.append(node('div', '平移各轴按固定范围缩放；圆周按实际角度，精确值见选中读数。'));
          jointLegend.replaceChildren(legend);
          const fragment = document.createDocumentFragment();
          if (state.selectedBoneIndex < 0) fragment.append(node('p', '当前显示全部 ' + state.entries.length + ' 个关节；轻点骨骼查看实际变化。'));
          else if (!state.entries.length) fragment.append(node('p', '无关联关节'));
          else for (const entry of state.entries) {
            const card = node('div', '', 'mmd-ar-joint-card');
            card.append(node('strong', entry.name), node('div', entry.relation));
            for (const [r, title] of ['平移 K', '旋转 K'].entries()) {
              const row = node('div', title + ' ', 'mmd-ar-joint-values');
              for (const cell of entry.rows[r]) {
                const value = node('span', cell.text, 'mmd-ar-joint-value');
                value.style.color = cell.color;
                value.title = cell.value === 0 ? '弹簧关闭；硬限位仍有效' : 'PMX弹簧刚度';
                row.append(value);
              }
              card.append(row);
            }
            card.append(node('div', '平移限位（模型单位）：' + entry.limitRows[0]),
              node('div', '旋转限位：' + entry.limitRows[1]));
            const actual = node('div', '', 'mmd-ar-joint-actual');
            readings.set(entry.index, actual); card.append(actual); fragment.append(card);
          }
          fragment.append(node('p', 'XYZ 为关节局部轴；实际变化相对绑定姿态，平移为模型单位，旋转为度数。'));
          jointDetails.replaceChildren(fragment);
        }
        for (const [index, element] of readings) {
          const actual = state.actual.find(value => value.index === index);
          const text = actual?.translation && actual?.rotation
            ? '实际位移 ' + axes.map((axis, i) => axis + ' ' + numeric(actual.translation[i])).join(' · ')
              + '\\n实际角度 ' + axes.map((axis, i) => axis + ' ' + numeric(actual.rotation[i]) + '°').join(' · ')
            : state.poseError || actual?.status || '未模拟';
          if (element.textContent !== text) element.textContent = text;
        }
      };
      const panel = document.getElementById('mmdArMotionPanel');
      let jointTimer = null;
      let timer = null;
      const sync = () => {
        if (timer !== null) clearInterval(timer);
        if (jointTimer !== null) clearInterval(jointTimer);
        timer = null; jointTimer = null;
        update(); updateJoints();
        if (panel && !panel.hidden) { timer = setInterval(update, 500); jointTimer = setInterval(updateJoints, 100); }
      };
      if (panel) new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
      window.addEventListener('pagehide', () => { if (timer !== null) clearInterval(timer); if (jointTimer !== null) clearInterval(jointTimer); }, { once: true });
      apply(); sync();
    })();
    (() => {
      const key = 'aasc.mmdArTest.gravityFilter.v1';
      const defaults = { deadZoneDegrees: 0.5, smoothingMs: 20 };
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem(key) || '{}') || {}; }
      catch (error) { /* 存储损坏时只恢复本分类默认值。 */ }
      const settings = { ...defaults };
      const fields = [
        ['mmdArGravityDeadZone', 'deadZoneDegrees', 3, '°'],
        ['mmdArGravitySmoothing', 'smoothingMs', 500, ' ms']
      ];
      const apply = () => window.DisplayMmd?.setModelGravitySettings?.(settings);
      for (const [id, field, max, unit] of fields) {
        const input = document.getElementById(id);
        const output = document.getElementById(id + 'Value');
        if (!input || !output) continue;
        const storedValue = stored[field];
        settings[field] = typeof storedValue === 'number' && Number.isFinite(storedValue)
          ? Math.max(0, Math.min(max, storedValue)) : defaults[field];
        input.value = String(settings[field]);
        output.textContent = settings[field] + unit;
        input.addEventListener('input', () => {
          settings[field] = Math.max(0, Math.min(max, Number(input.value) || 0));
          output.textContent = settings[field] + unit;
          apply();
          try { localStorage.setItem(key, JSON.stringify(settings)); }
          catch (error) { /* 保存失败不影响当前页面的重力过滤。 */ }
        });
      }
      apply();
    })();
    (() => {
      const stage = document.getElementById('displayStageLayers');
      const inputs = Array.from(document.querySelectorAll('.display-mmd-panel-opacity-range'));
      if (!stage || inputs.length === 0) return;
      const storageKey = 'aasc.display.mmdPanelOpacity.v1';
      let opacity = 50;
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
      const button = document.getElementById('mmdArMotionToggle');
      const panel = document.getElementById('mmdArMotionPanel');
      const progress = document.getElementById('mmdArMotionProgress');
      const time = document.getElementById('mmdArMotionTime');
      const cameraProgress = document.getElementById('mmdArCameraMotionProgress');
      const cameraTime = document.getElementById('mmdArCameraMotionTime');
      if (!button || !panel) return;

      let timer = null;
      const formatTime = (seconds) => {
        const rounded = Math.max(0, Math.floor(seconds));
        return String(Math.floor(rounded / 60)).padStart(2, '0') + ':'
          + String(rounded % 60).padStart(2, '0');
      };
      // 角色动作与相机动作共用只读进度渲染；无数据时显示未知。
      const writeProgress = (bar, label, motion) => {
        if (!bar || !label) return;
        const duration = Number(motion?.durationSeconds);
        const current = Number(motion?.timeSeconds);
        if (!motion || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) {
          bar.value = 0;
          bar.max = 1;
          label.textContent = '--:-- / --:--';
          return;
        }
        bar.max = duration;
        bar.value = Math.max(0, Math.min(duration, current));
        label.textContent = formatTime(bar.value) + ' / ' + formatTime(duration);
      };
      const updateProgress = () => {
        writeProgress(progress, time, window.DisplayMmd?.getMotionProgress?.());
        writeProgress(cameraProgress, cameraTime, window.DisplayMmd?.getCameraMotionProgress?.());
      };
      const setOpen = (open) => {
        const nextOpen = open === true;
        panel.hidden = !nextOpen;
        button.setAttribute('aria-expanded', String(nextOpen));
        if (timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
        if (nextOpen && (progress || cameraProgress)) {
          updateProgress();
          timer = window.setInterval(updateProgress, 250);
        }
      };
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const nextOpen = panel.hidden;
        if (nextOpen) {
          window.DisplayMmdLighting?.close?.();
          window.DisplayMmdAr?.closePanel?.();
        }
        setOpen(nextOpen);
      });
      panel.addEventListener('click', (event) => event.stopPropagation());
      for (const buttonId of ['displayMmdLightingToggle', 'displayArTargetToggle']) {
        document.getElementById(buttonId)?.addEventListener('click', () => setOpen(false));
      }
      document.addEventListener('click', (event) => {
        if (panel.hidden || panel.contains(event.target) || button.contains(event.target)) return;
        setOpen(false);
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') setOpen(false);
      });
      setOpen(false);
      window.addEventListener('pagehide', () => {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
      }, { once: true });
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
      const input = document.getElementById('mmdArAoConcavityAngle');
      const output = document.getElementById('mmdArAoConcavityAngleValue');
      if (!input || !output) return;
      const storageKey = 'aasc.mmdArTest.aoConcavityAngle.v1';
      const defaultAngle = 45;
      // 缺失/空值不得经 Number(null) 误变成零；合法值按滑块步长和范围规范化。
      const normalize = (value) => {
        if (value == null || String(value).trim() === '') return defaultAngle;
        const number = Number(value);
        if (!Number.isFinite(number)) return defaultAngle;
        return Math.round(Math.min(45, Math.max(0, number)) * 2) / 2;
      };
      const apply = (value, persist) => {
        const angle = normalize(value);
        input.value = String(angle);
        output.textContent = angle.toFixed(1) + '°';
        // 沿用测试页 AO 诊断设置入口；渲染按角度换算门限，不改模型/重建法线。
        window.MmdArTestAoConcavityAngle = angle;
        if (!persist) return;
        try { localStorage.setItem(storageKey, String(angle)); } catch (error) { /* 存储受限时本次调整仍有效。 */ }
      };
      let saved = null;
      try { saved = localStorage.getItem(storageKey); } catch (error) { /* 存储不可用时使用默认角度。 */ }
      apply(saved, false);
      input.addEventListener('input', () => apply(input.value, true));
      input.addEventListener('change', () => apply(input.value, true));
      document.getElementById('displayMmdLightingReset')?.addEventListener('click', () => apply(defaultAngle, true));
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
      // 相机动作开关默认开启并沿用当前浏览器的偏好；无相机 VMD 时保持无效果。
      const toggle = document.getElementById('mmdArCameraMotionPlayback');
      if (!toggle) return;
      const storageKey = 'aasc.mmdArTest.cameraMotionPlayback.v1';
      let enabled = true;
      try { enabled = localStorage.getItem(storageKey) !== 'false'; } catch (error) { /* 隐私模式按默认值运行。 */ }
      toggle.checked = enabled;
      window.DisplayMmd?.setCameraMotionPlaybackEnabled?.(enabled);
      toggle.addEventListener('change', () => {
        enabled = toggle.checked;
        window.DisplayMmd?.setCameraMotionPlaybackEnabled?.(enabled);
        try { localStorage.setItem(storageKey, String(enabled)); } catch (error) { /* 隐私模式允许仅本次生效。 */ }
      });
    })();
    ${CAMERA_SETTINGS_JS}
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
    (() => {
      // 共用基准值：Ammo纠错Hz / XPBD每帧子步数，下限3、默认45；本地记忆。
      const input = document.getElementById('mmdArPhysicsStabilityReference');
      const output = document.getElementById('mmdArPhysicsStabilityReferenceValue');
      if (!input || !output) return;
      const storageKey = 'aasc.mmdArTest.physicsStabilityReference.v1';
      const normalize = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.round(Math.min(180, Math.max(3, number))) : 45;
      };
      let value = 45;
      try {
        const stored = localStorage.getItem(storageKey);
        // 缺失或空串用默认45；其余按3-180、步长1取整，非法回退45。
        value = stored === null || stored.trim() === '' ? 45 : normalize(stored);
      } catch (error) { value = 45; }
      const apply = (next, persist = false) => {
        value = normalize(next);
        input.value = String(value);
        output.textContent = value + (window.DisplayMmd?.getPhysicsSolver?.() !== 'ammo' ? ' 子步' : ' Hz');
        window.DisplayMmd?.setPhysicsStabilityReference?.(value);
        if (!persist) return;
        try { localStorage.setItem(storageKey, String(value)); } catch (error) { /* 存储受限时本次仍生效。 */ }
      };
      input.addEventListener('input', () => apply(input.value));
      input.addEventListener('change', () => apply(input.value, true));
      apply(value);
    })();
    ${WIND.WIND_PANEL_JS}
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
  SHADOW_BIAS.addShadowBiasControls($, lightingPanel);
  SHADOW_MAP.addShadowMapControls($, lightingPanel);
  FILL_FACING_RANGE.addFillFacingControls($, lightingPanel);
  const aoGroup = lightingPanel.find('button[data-group-title="AO"]').closest('.mmd-ar-panel-group');
  aoGroup.find('.mmd-ar-panel-group-body').prepend(
    '<label class="display-mmd-lighting-field mmd-ar-edge-correction"><input type="checkbox" checked><span>半分辨率边界修正 <small></small></span></label>' +
    '<label class="display-mmd-lighting-field mmd-ar-normal-preview"><input type="checkbox"><span>深度重建法线预览（颜色代表方向，跳过 AO 与模糊）</span></label>' +
    '<label class="mind-basic-field"><span>浅凹抑制 <output id="mmdArAoConcavityAngleValue">45.0°</output></span>' +
    '<input id="mmdArAoConcavityAngle" type="range" min="0" max="45" step="0.5" value="45" aria-label="AO 浅凹抑制角度">' +
    '<small>值越大，浅内凹的 AO 越弱；也会减弱真实浅凹槽。角度不改变模型法线。</small></label>'
  );
  const motionPanel = $('#mmdArMotionPanel').first();
  if (motionPanel.length) {
    motionPanel.append('<label class="display-mmd-lighting-field"><input id="mmdArSkeletonEnabled" type="checkbox"><span>显示骨骼（小球）</span></label>' +
      '<div id="mmdArSkeletonLegend" aria-label="骨骼物理类型图例">' +
      '<span><i style="--bone-color:#ff3333"></i>红 type0 · 跟随骨骼</span>' +
      '<span><i style="--bone-color:#ffd633"></i>黄 type2 · 物理旋转</span>' +
      '<span><i style="--bone-color:#33e066"></i>绿 type1 · 完全物理</span>' +
      '<span><i style="--bone-color:#9ca3af"></i>灰 · 无关联刚体</span></div>' +
      '<label class="mind-basic-field"><span>小球大小 <output id="mmdArSkeletonSizeValue">1.0 倍</output></span><input id="mmdArSkeletonSize" type="range" min="0.2" max="3" step="0.1" value="1" aria-label="骨骼小球大小"></label>' +
      '<label class="display-mmd-lighting-field"><input id="mmdArSkeletonOcclusionEnabled" type="checkbox"><span>小球相互遮挡</span></label>' +
      '<label class="mind-basic-field"><span>遮挡处不透明度 <output id="mmdArSkeletonOccludedOpacityValue">50%</output></span>' +
      '<input id="mmdArSkeletonOccludedOpacity" type="range" min="0" max="100" step="1" value="50" aria-label="骨骼小球被角色遮挡处不透明度"><small>被角色挡住的部分变淡，外露部分保持不透明。</small></label>' +
      '<label class="display-mmd-lighting-field"><input id="mmdArSkeletonNamesEnabled" type="checkbox"><span>显示骨骼名称</span></label>' +
      '<label class="display-mmd-lighting-field"><input id="mmdArSkeletonJointParametersEnabled" type="checkbox"><span>显示关节 K 值与限位</span></label>' +
      '<div id="mmdArSkeletonJointLegend" class="mind-basic-note" hidden></div>' +
      '<div id="mmdArSkeletonJointDetails" class="mind-basic-note" hidden></div>' +
      '<p id="mmdArSkeletonSelectionStatus" class="mind-basic-note" role="status">轻点小球选中骨骼，点空白取消</p>' +
      '<button id="mmdArSkeletonClearContacts" type="button" disabled>清空累计碰撞</button>' +
      '<p id="mmdArSkeletonHint" class="mind-basic-note">选中显示局部轴：X红、Y绿、Z蓝。碰撞体开启时仅显示自身与累计碰撞对象；拖动旋转模型。</p>' +
      '<label class="mind-basic-field"><span>纠错基准 Hz <output id="mmdArPhysicsStabilityReferenceValue">45 Hz</output></span>' +
      '<input id="mmdArPhysicsStabilityReference" type="range" min="3" max="180" step="1" value="45" aria-label="关节纠错基准频率"></label>' +
      '<p id="mmdArPhysicsStabilityReferenceHint" class="mind-basic-note">按该频率的关节纠错率换算到当前物理频率；只改纠错强度，不动弹簧/质量/阻尼。</p>' +
      '<label class="display-mmd-lighting-field"><input id="mmdArRigidBodyEnabled" type="checkbox"><span>显示碰撞体</span></label>' +
      '<p id="mmdArRigidBodyStatus" class="mind-basic-note" role="status">碰撞体显示已关闭</p>' +
      '<div id="mmdArRigidBodyControls" class="mmd-ar-rigid-body-controls">' +
      '<div id="mmdArRigidBodyStyle" class="mmd-ar-plane-options" role="group" aria-label="碰撞体样式">' +
      '<button type="button" data-rigid-body-style="wireframe" aria-pressed="false">线框（透过）</button>' +
      '<button type="button" data-rigid-body-style="solid" aria-pressed="true">实体（遮挡）</button>' +
      '</div>' +
      '<label class="display-mmd-lighting-field"><input id="mmdArCharacterHiddenEnabled" type="checkbox"><span>隐藏角色（可查看全部刚体）</span></label>' +
      '<p class="mind-basic-note">实体模式与角色互相遮挡；选中骨骼时穿透显示。</p>' +
      '</div>' +
      '<div id="mmdArRigidBodyLegend" class="mmd-ar-mass-legend" hidden>' +
      '<span class="mmd-ar-mass-bar" aria-hidden="true"></span>' +
      '<span id="mmdArRigidBodyMassRange">质量色阶：等待模型</span>' +
      '<span class="mmd-ar-mass-zero"><i></i>灰＝有效质量 0（跟随骨骼）</span>' +
      '</div>');
    motionPanel.append(WIND.WIND_PANEL_HTML);
    motionPanel.append(PHYSICS_SOLVER.SOLVER_PANEL_HTML);
    const motionGroups = [MOTION_GROUPS[0]];
    if ($('#mmdArExpressionPanel').length) motionGroups.push(['表情', ['mmdArExpressionPanel']]);
    if ($('#mmdArLipSyncPanel').length) motionGroups.push(['口型', ['mmdArLipSyncPanel']]);
    if ($('#mmdArMplPanel').length) motionGroups.push(['MPL 动作', ['mmdArMplPanel']]);
    motionGroups.push(...MOTION_GROUPS.slice(1));
    groupPanel($, motionPanel, 'display-mmd-lighting-header', motionGroups);
  }
  groupPanel($, trackingPanel, 'display-mmd-ar-header', TRACKING_GROUPS);
  const panels = [lightingPanel, $('#mmdArMotionPanel').first(), trackingPanel].filter((panel) => panel.length > 0);
  for (const panel of panels) {
    const panelId = panel.attr('id');
    const inputId = `${panelId}Opacity`;
    panel.prepend(`
      <label class="display-mmd-panel-opacity-control" for="${inputId}">
        <span>面板不透明度 <output>50%</output></span>
        <input id="${inputId}" class="display-mmd-panel-opacity-range" type="range" min="0" max="100" step="1" value="50" aria-label="面板不透明度">
      </label>
    `);
  }
}

function addLocalAssetPanel($) {
  $('#mmdArMotionPanel').append(`
    <section id="mmdArLocalAssets" class="mmd-ar-panel-group">
      <div class="mmd-ar-panel-group-header">
        <button class="mmd-ar-panel-group-toggle" type="button" data-group-title="本地资源" aria-controls="mmdArLocalAssetsBody" aria-expanded="false" aria-label="展开本地资源设置">
          <span>本地模型与动作</span><span class="mmd-ar-panel-group-arrow" aria-hidden="true">⌄</span>
        </button>
      </div>
      <div id="mmdArLocalAssetsBody" class="mmd-ar-panel-group-body" hidden>
        <div class="display-mmd-ar-actions">
          <button id="mmdArLocalDirectoryButton" class="display-mmd-ar-action" type="button">选择模型目录</button>
          <button id="mmdArLocalFilesButton" class="display-mmd-ar-action" type="button">多选 PMX＋贴图</button>
        </div>
        <input id="mmdArLocalDirectory" type="file" webkitdirectory multiple hidden>
        <input id="mmdArLocalFiles" type="file" multiple hidden>
        <label class="display-mmd-ar-field"><span>所选目录中的 PMX</span><select id="mmdArLocalPmx" disabled><option>请先选择文件</option></select></label>
        <p class="mind-basic-note">当前模型：<span id="mmdArLocalModelName">内置默认模型</span></p>
        <div class="display-mmd-ar-actions">
          <button id="mmdArLocalVmdButton" class="display-mmd-ar-action" type="button">选择 VMD 动作</button>
          <button id="mmdArLocalDefaultMotion" class="display-mmd-ar-action" type="button">恢复默认动作</button>
        </div>
        <input id="mmdArLocalVmd" type="file" accept=".vmd" hidden>
        <p class="mind-basic-note">当前动作：<span id="mmdArLocalMotionName">内置默认动作</span></p>
        <div class="display-mmd-ar-actions">
          <button id="mmdArLocalCameraVmdButton" class="display-mmd-ar-action" type="button">选择相机 VMD</button>
        </div>
        <input id="mmdArLocalCameraVmd" type="file" accept=".vmd" hidden>
        <p class="mind-basic-note">当前相机动作：<span id="mmdArLocalCameraMotionName">无相机动作</span></p>
        <button id="mmdArLocalDefaultModel" class="display-mmd-ar-action" type="button">恢复默认模型与动作</button>
        <p id="mmdArLocalMessage" class="mind-basic-note" role="status" style="overflow-wrap:anywhere">请选择完整模型目录，或一起多选 PMX 与贴图；文件不上传，刷新后需重新选择。</p>
      </div>
    </section>
  `);
}

module.exports = { groupWebPanels, addLocalAssetPanel, WEB_PANEL_GROUP_CSS, WEB_PANEL_GROUP_JS };
