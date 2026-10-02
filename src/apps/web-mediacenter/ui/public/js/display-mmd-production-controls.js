/* 正式 MMD 用户控制：只含参数/状态，不含调试绘制与测时面板。 */
(function initializeProductionControls() {
    function initialize() {
        document.querySelectorAll('.mmd-ar-panel-group-toggle').forEach(button => {
            button.addEventListener('click', () => {
                const body = document.getElementById(button.getAttribute('aria-controls'));
                if (!body) return;
                body.hidden = !body.hidden;
                button.setAttribute('aria-expanded', String(!body.hidden));
            });
        });

    (() => {

      const shadowBiasFields = [{"key":"bias","id":"mmdArKeyShadowBias","label":"阴影深度偏移 bias","min":-0.005,"max":0.005,"step":0.0001,"digits":4,"defaultValue":-0.0005},{"key":"normalBias","id":"mmdArKeyShadowNormalBias","label":"阴影法线偏移 normalBias","min":0,"max":0.1,"step":0.001,"digits":3,"defaultValue":0.02}];
      function normalizeShadowBias(value, field) {
  // 空值、布尔值和对象不参与 Number 隐式换算，避免误把坏存储值解释为零。
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return field.defaultValue;
  const number = Number(value);
  if (!Number.isFinite(number)) return field.defaultValue;
  const bounded = Math.min(field.max, Math.max(field.min, number));
  return Number((Math.round(bounded / field.step) * field.step).toFixed(field.digits));
}

      const controls = shadowBiasFields.map(field => ({
        field, input: document.getElementById(field.id), output: document.getElementById(field.id + 'Value')
      }));
      if (controls.some(control => !control.input || !control.output)) return;
      const storageKey = 'aasc.display.mmd.keyShadowBias.v1';
      const apply = (value, persist) => {
        const settings = Object.fromEntries(shadowBiasFields.map(field => [
          field.key, normalizeShadowBias(value?.[field.key], field)
        ]));
        for (const { field, input, output } of controls) {
          input.value = String(settings[field.key]);
          output.textContent = settings[field.key].toFixed(field.digits);
        }
        // 冻结并替换整个设置对象；每帧可按身份快速判断，无全局回调或轮询定时器。
        window.DisplayMmdKeyShadowSettings = Object.freeze(settings);
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


    (() => {
      function normalizeShadowMapSize(value, maxSize = 4096) {
  const sizes = [512, 1024, 2048, 4096];
  const requested = ['number', 'string'].includes(typeof value) && String(value).trim() !== ''
    && sizes.includes(Number(value)) ? Number(value) : 1024;
  const limit = Number.isFinite(Number(maxSize)) && Number(maxSize) >= 1 ? Number(maxSize) : 4096;
  const supported = sizes.filter(size => size <= limit && size <= requested);
  return supported.at(-1) || Math.min(512, 2 ** Math.floor(Math.log2(limit)));
}
      function normalizeShadowCameraScale(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return 1;
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Number((Math.round(Math.max(0.1, Math.min(2, number)) * 100) / 100).toFixed(2));
}
      const input = document.getElementById('mmdArShadowMapSize');
      const sizeOutput = document.getElementById('mmdArShadowMapSizeValue');
      const cameraInput = document.getElementById('mmdArShadowCameraScale');
      const cameraOutput = document.getElementById('mmdArShadowCameraScaleValue');
      if (!input || !sizeOutput || !cameraInput || !cameraOutput) return;
      const key = 'aasc.display.mmd.shadowMap.v1';
      const apply = (settings, persist) => {
        const limit = window.DisplayMmdShadowMapLimit || 4096;
        const size = normalizeShadowMapSize(settings?.size, limit);
        const cameraScale = normalizeShadowCameraScale(settings?.cameraScale);
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
        sizeOutput.textContent = size + ' × ' + size;
        cameraInput.value = String(cameraScale);
        cameraOutput.textContent = cameraScale.toFixed(2) + ' ×';
        window.DisplayMmdShadowMapSettings = Object.freeze({ size, cameraScale });
        if (!persist) return;
        try { localStorage.setItem(key, JSON.stringify({ size, cameraScale })); } catch (error) { /* 存储受限仍可当场调整。 */ }
      };
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (error) { /* 坏存储回默认。 */ }
      apply(saved, false);
      const applyInputs = () => apply({ size: input.value, cameraScale: cameraInput.value }, true);
      input.addEventListener('change', applyInputs);
      cameraInput.addEventListener('input', applyInputs);
      cameraInput.addEventListener('change', applyInputs);
      window.addEventListener('mmd-ar-shadow-map-limit', () => apply(window.DisplayMmdShadowMapSettings, true));
      document.getElementById('displayMmdLightingReset')?.addEventListener('click', () => apply({}, true));
    })();


    (() => {
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
      const start = document.getElementById('mmdArFillFacingStart');
      const end = document.getElementById('mmdArFillFacingEnd');
      const startOutput = document.getElementById('mmdArFillFacingStartValue');
      const endOutput = document.getElementById('mmdArFillFacingEndValue');
      if (!start || !end || !startOutput || !endOutput) return;
      const storageKey = 'aasc.display.mmd.fillFacingRange.v1';
      const apply = (value, persist, editedKey = '') => {
        const settings = normalizeFillFacingRange(value, editedKey);
        start.value = String(settings.start);
        end.value = String(settings.end);
        startOutput.textContent = settings.start.toFixed(2);
        endOutput.textContent = settings.end.toFixed(2);
        window.DisplayMmdFillFacingRange = Object.freeze(settings);
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

    (() => {
      const key = 'aasc.display.mmd.gravityFilter.v1';
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
      const input = document.getElementById('mmdArAoConcavityAngle');
      const output = document.getElementById('mmdArAoConcavityAngleValue');
      if (!input || !output) return;
      const storageKey = 'aasc.display.mmd.aoConcavityAngle.v1';
      const defaultAngle = 10;
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
        // 使用正式 AO 参数入口；渲染按角度换算门限，不改模型/重建法线。
        window.DisplayMmdAoConcavityAngle = angle;
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
      // 共用基准值：Ammo纠错Hz / XPBD每帧子步数，下限3、默认45；本地记忆。
      const input = document.getElementById('mmdArPhysicsStabilityReference');
      const output = document.getElementById('mmdArPhysicsStabilityReferenceValue');
      if (!input || !output) return;
      const storageKey = 'aasc.display.mmd.physicsStabilityReference.v1';
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
    (() => {
      // 相机动作开关默认开启并沿用当前浏览器的偏好；无相机 VMD 时保持无效果。
      const toggle = document.getElementById('mmdArCameraMotionPlayback');
      if (!toggle) return;
      const storageKey = 'aasc.display.mmd.cameraMotionPlayback.v1';
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

    (() => {
        function normalizeWindSettings(value = {}) {
    const input = value && typeof value === 'object' ? value : {};
    const number = (key, fallback, min, max, step) => {
        const raw = input[key];
        if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return fallback;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return fallback;
        return Number((Math.round(Math.min(max, Math.max(min, parsed)) / step) * step).toFixed(2));
    };
    return { enabled: input.enabled === true,
        strength: number('strength', 0.3, 0, 30, 0.05),
        longitude: number('longitude', 0, -180, 180, 1),
        latitude: number('latitude', 0, -90, 90, 1),
        gust: number('gust', 0, 0, 100, 5) };
}
        const storageKey = 'aasc.display.mmd.wind.v1';
        const fields = { enabled: 'mmdArWindEnabled', strength: 'mmdArWindStrength',
            longitude: 'mmdArWindLongitude', latitude: 'mmdArWindLatitude', gust: 'mmdArWindGust' };
        const controls = Object.fromEntries(Object.entries(fields).map(([key, id]) => [key, document.getElementById(id)]));
        if (Object.values(controls).some((control) => !control)) return;
        let settings = normalizeWindSettings();
        try { settings = normalizeWindSettings(JSON.parse(localStorage.getItem(storageKey))); }
        catch (error) { /* 存储受限/损坏时使用默认关闭的风。 */ }
        const apply = (value, persist = false) => {
            settings = normalizeWindSettings(value);
            for (const [key, control] of Object.entries(controls)) {
                if (key === 'enabled') { control.checked = settings.enabled; continue; }
                control.value = String(settings[key]);
                const output = document.getElementById(fields[key] + 'Value');
                output.textContent = key === 'strength' ? settings[key].toFixed(2)
                    : String(settings[key]) + (key === 'gust' ? '%' : '°');
            }
            window.DisplayMmd?.setWindSettings?.(settings);
            if (!persist) return;
            try { localStorage.setItem(storageKey, JSON.stringify(settings)); }
            catch (error) { /* 隐私模式保留本次效果，不阻断物理。 */ }
        };
        const read = () => Object.fromEntries(Object.entries(controls).map(([key, control]) =>
            [key, key === 'enabled' ? control.checked : control.value]));
        for (const control of Object.values(controls)) {
            control.addEventListener('input', () => apply(read()));
            control.addEventListener('change', () => apply(read(), true));
        }
        apply(settings);
    })();

    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
