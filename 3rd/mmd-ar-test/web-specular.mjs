import { Color } from 'three';

const DEFAULTS = Object.freeze({ enabled: false, color: '#ffffff', intensity: 0.3, shininess: 30 });
const STORAGE_KEY = 'aasc.mmdArTest.specular.v1';
const ORIGINAL = 'reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;';
let settings = { ...DEFAULTS };
let revision = 0;

export function normalizeSpecular(value) {
  const input = value && typeof value === 'object' ? value : {};
  const bounded = (key, min, max) => typeof input[key] === 'number' && Number.isFinite(input[key])
    ? Math.max(min, Math.min(max, input[key])) : DEFAULTS[key];
  return {
    enabled: input.enabled === true,
    color: typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color.toLowerCase() : DEFAULTS.color,
    intensity: bounded('intensity', 0, 2),
    shininess: bounded('shininess', 1, 256),
  };
}

export function setSpecular(value) {
  settings = normalizeSpecular(value);
  revision += 1;
  return { ...settings };
}

export function initSpecularPanel(root = document, storage = () => localStorage) {
  const panel = root.querySelector('.mmd-ar-specular');
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = 'true';
  try { setSpecular(JSON.parse(storage().getItem(STORAGE_KEY))); } catch (error) { setSpecular(DEFAULTS); }
  const fields = [...panel.querySelectorAll('[data-specular]')];
  const sync = () => {
    for (const field of fields) {
      const key = field.dataset.specular;
      if (key === 'enabled') field.checked = settings.enabled;
      else {
        field.value = settings[key];
        field.disabled = !settings.enabled;
      }
      const output = field.parentElement.querySelector('output');
      if (output) output.textContent = String(settings[key]);
    }
  };
  for (const field of fields) field.addEventListener('input', () => {
    const key = field.dataset.specular;
    const parsers = { enabled: () => field.checked, color: () => field.value };
    setSpecular({ ...settings, [key]: (parsers[key] || (() => Number(field.value)))() });
    sync();
    try { storage().setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (error) { /* 存储失败不阻断本次材质更新。 */ }
  });
  sync();
}

export function prepareTestSpecular(material) {
  if (!material?.isMMDToonMaterial || material.uniforms.testSpecularEnabled) return;
  if (material.fragmentShader.split(ORIGINAL).length !== 2) throw new Error('测试高光未找到唯一 Blinn-Phong 高光入口');
  // 在已有直射光函数中替换高光，阴影已乘入 directLight.color；不受 Toon 明暗分段影响。
  material.fragmentShader = `uniform float testSpecularEnabled;
uniform vec3 testSpecularColor;
uniform float testSpecularIntensity;
uniform float testSpecularShininess;
${material.fragmentShader.replace(ORIGINAL, `
if ( testSpecularEnabled > 0.5 ) {
  reflectedLight.directSpecular += max( dot( geometryNormal, directLight.direction ), 0.0 ) * directLight.color
    * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, testSpecularColor, testSpecularShininess ) * testSpecularIntensity;
} else {
  ${ORIGINAL}
}`)}`;
  Object.assign(material.uniforms, {
    testSpecularEnabled: { value: 0 }, testSpecularColor: { value: new Color() },
    testSpecularIntensity: { value: 0.3 }, testSpecularShininess: { value: 30 },
  });
  let appliedRevision = -1;
  const previous = material.onBeforeRender;
  material.onBeforeRender = function (...args) {
    previous?.apply(this, args);
    if (appliedRevision === revision) return;
    material.uniforms.testSpecularEnabled.value = settings.enabled ? 1 : 0;
    material.uniforms.testSpecularColor.value.set(settings.color);
    material.uniforms.testSpecularIntensity.value = settings.intensity;
    material.uniforms.testSpecularShininess.value = settings.shininess;
    material.uniformsNeedUpdate = true;
    appliedRevision = revision;
  };
  material.needsUpdate = true;
}

// 该模块只被测试网页的材质模块导入；无 document 的单元测试不触发页面行为。
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initSpecularPanel(), { once: true });
  else initSpecularPanel();
}
