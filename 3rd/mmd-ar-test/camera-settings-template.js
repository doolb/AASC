'use strict';

// APK与网页共用相机死区/缓动/图面设置，防止两套状态和默认值。
const CAMERA_SETTINGS_JS = `
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
`;

module.exports = { CAMERA_SETTINGS_JS };
