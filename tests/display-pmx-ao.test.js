const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const PUBLIC_DIR = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public');

test('PMX AO target is half resolution with a 1280×720 budget', async () => {
  const moduleUrl = pathToFileURL(path.join(PUBLIC_DIR, 'js/display-pmx-ao-size.mjs')).href;
  const { calculatePmxAoSize } = await import(moduleUrl);
  assert.deepEqual(calculatePmxAoSize(1920, 1080), { width: 960, height: 540 });
  assert.deepEqual(calculatePmxAoSize(3840, 2160), { width: 1280, height: 720 });
  assert.deepEqual(calculatePmxAoSize(1080, 1920), { width: 405, height: 720 });
  assert.deepEqual(calculatePmxAoSize(0, 0), { width: 1, height: 1 });
  assert.deepEqual(calculatePmxAoSize(1920, 1080, 'full'), { width: 1920, height: 1080 });
  assert.deepEqual(calculatePmxAoSize(3840, 2160, 'full'), { width: 3840, height: 2160 });
  assert.deepEqual(calculatePmxAoSize(0, 0, 'full'), { width: 1, height: 1 });
});

test('PMX AO defaults on and a partial lighting update keeps its saved switch', () => {
  const source = fs.readFileSync(path.join(PUBLIC_DIR, 'js/display-mmd.js'), 'utf8');
  const context = { window: {}, console };
  vm.runInNewContext(source, context);
  const displayMmd = context.window.DisplayMmd;
  assert.equal(displayMmd.getLighting().pmxAoEnabled, true);
  assert.equal(displayMmd.getLighting().pmxAoColor, '#931231');
  assert.equal(displayMmd.getLighting().pmxAoIntensity, 0.6);
  assert.equal(displayMmd.getLighting().pmxAoRadiusPercent, 6);
  assert.equal(displayMmd.getLighting().pmxAoResolution, 'half');
  assert.equal(displayMmd.setLighting({ pmxAoEnabled: false }).pmxAoEnabled, false);
  assert.equal(displayMmd.setLighting({ ambientIntensity: 1.4 }).pmxAoEnabled, false);
  assert.equal(displayMmd.setLighting({ pmxAoEnabled: true }).pmxAoEnabled, true);
  const adjusted = displayMmd.setLighting({
    pmxAoColor: '#336699', pmxAoIntensity: 1.35, pmxAoRadiusPercent: 12
  });
  assert.equal(adjusted.pmxAoColor, '#336699');
  assert.equal(adjusted.pmxAoIntensity, 1.35);
  assert.equal(adjusted.pmxAoRadiusPercent, 12);
  assert.equal(displayMmd.setLighting({ keyIntensity: 2 }).pmxAoRadiusPercent, 12);
  assert.equal(displayMmd.setLighting({ pmxAoResolution: 'full' }).pmxAoResolution, 'full');
  assert.equal(displayMmd.setLighting({ keyIntensity: 2 }).pmxAoResolution, 'full');
  assert.equal(displayMmd.setLighting({ pmxAoResolution: 'invalid' }).pmxAoResolution, 'half');
  assert.equal(displayMmd.getLighting().rotationPhysicsLimit, 180);
  assert.equal(displayMmd.setLighting({ rotationPhysicsLimit: 5 }).rotationPhysicsLimit, 30);
  assert.equal(displayMmd.setLighting({ rotationPhysicsLimit: 725 }).rotationPhysicsLimit, 720);
  assert.equal(displayMmd.setLighting({ rotationPhysicsLimit: 184 }).rotationPhysicsLimit, 180);
  assert.equal(displayMmd.setLighting({ rotationPhysicsLimit: 'invalid' }).rotationPhysicsLimit, 180);
  const clamped = displayMmd.setLighting({
    pmxAoColor: 'not-a-color', pmxAoIntensity: 100, pmxAoRadiusPercent: -4
  });
  assert.equal(clamped.pmxAoColor, '#931231');
  assert.equal(clamped.pmxAoIntensity, 2);
  assert.equal(clamped.pmxAoRadiusPercent, 1);
});

test('PMX AO checkbox applies and saves its value; reset restores the default', () => {
  const ids = [
    'displayMmdLightingToggle', 'displayMmdLightingPanel', 'displayMmdLightingReset',
    'displayMmdLightingPreset', 'displayMmdShadowEnabled', 'displayMmdPmxAoEnabled',
    'displayMmdPmxAoColor', 'displayMmdPmxAoIntensity', 'displayMmdPmxAoIntensityValue',
    'displayMmdPmxAoRadiusPercent', 'displayMmdPmxAoRadiusPercentValue',
    'displayMmdPmxAoResolution',
    'displayMmdPhysicsFps', 'displayMmdPhysicsFpsValue',
    'displayMmdRotationPhysicsLimit', 'displayMmdRotationPhysicsLimitValue', 'displayMmdAmbientColor',
    'displayMmdAmbientIntensity', 'displayMmdAmbientIntensityValue', 'displayMmdKeyColor',
    'displayMmdKeyIntensity', 'displayMmdKeyIntensityValue', 'displayMmdKeyDirectionLongitude',
    'displayMmdKeyDirectionLongitudeValue', 'displayMmdKeyDirectionLatitude',
    'displayMmdKeyDirectionLatitudeValue'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, {
    value: '', checked: false, hidden: true, textContent: '', handlers: {},
    addEventListener(name, callback) { this.handlers[name] = callback; },
    setAttribute() {}
  }]));
  const storage = new Map();
  const context = {
    console,
    window: { localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); }
    } },
    document: {
      readyState: 'complete',
      getElementById(id) { return elements[id] || null; },
      addEventListener() {}
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, 'js/display-mmd.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, 'js/display-mmd-lighting.js'), 'utf8'), context);
  assert.equal(elements.displayMmdPmxAoEnabled.checked, true);
  assert.equal(elements.displayMmdPmxAoColor.value, '#931231');
  assert.equal(elements.displayMmdPmxAoIntensity.value, '0.6');
  assert.equal(elements.displayMmdPmxAoRadiusPercent.value, '6');
  assert.equal(elements.displayMmdPmxAoResolution.value, 'half');
  assert.equal(elements.displayMmdRotationPhysicsLimit.value, '180');
  elements.displayMmdPmxAoColor.value = '#2b4769';
  elements.displayMmdPmxAoColor.handlers.input();
  elements.displayMmdPmxAoIntensity.value = '1.5';
  elements.displayMmdPmxAoIntensity.handlers.input();
  elements.displayMmdPmxAoRadiusPercent.value = '11';
  elements.displayMmdPmxAoRadiusPercent.handlers.input();
  elements.displayMmdPmxAoResolution.value = 'full';
  elements.displayMmdPmxAoResolution.handlers.change();
  assert.equal(context.window.DisplayMmd.getLighting().pmxAoColor, '#2b4769');
  assert.equal(context.window.DisplayMmd.getLighting().pmxAoIntensity, 1.5);
  assert.equal(context.window.DisplayMmd.getLighting().pmxAoRadiusPercent, 11);
  assert.equal(context.window.DisplayMmd.getLighting().pmxAoResolution, 'full');
  assert.equal(JSON.parse(storage.get('aasc.display.mmdLighting.v1')).pmxAoResolution, 'full');
  assert.equal(JSON.parse(storage.get('aasc.display.mmdLighting.v1')).pmxAoRadiusPercent, 11);
  elements.displayMmdRotationPhysicsLimit.value = '240';
  elements.displayMmdRotationPhysicsLimit.handlers.input();
  assert.equal(context.window.DisplayMmd.getLighting().rotationPhysicsLimit, 240);
  assert.equal(JSON.parse(storage.get('aasc.display.mmdLighting.v1')).rotationPhysicsLimit, 240);
  assert.equal(elements.displayMmdRotationPhysicsLimitValue.textContent, '240°/秒');
  elements.displayMmdLightingPreset.value = 'soft';
  elements.displayMmdLightingPreset.handlers.change();
  assert.equal(context.window.DisplayMmd.getLighting().rotationPhysicsLimit, 240);
  elements.displayMmdPmxAoEnabled.checked = false;
  elements.displayMmdPmxAoEnabled.handlers.input();
  assert.equal(context.window.DisplayMmd.getLighting().pmxAoEnabled, false);
  assert.equal(JSON.parse(storage.get('aasc.display.mmdLighting.v1')).pmxAoEnabled, false);
  elements.displayMmdLightingReset.handlers.click();
  assert.equal(context.window.DisplayMmd.getLighting().pmxAoEnabled, true);
  assert.equal(elements.displayMmdPmxAoEnabled.checked, true);
  assert.equal(elements.displayMmdPmxAoColor.value, '#931231');
  assert.equal(elements.displayMmdPmxAoIntensity.value, '0.6');
  assert.equal(elements.displayMmdPmxAoRadiusPercent.value, '6');
  assert.equal(elements.displayMmdPmxAoResolution.value, 'half');
  assert.equal(elements.displayMmdRotationPhysicsLimit.value, '180');
});

test('灯光面板包含快速旋转物理阈值滑块', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'display.html'), 'utf8');
  assert.match(html, /id="displayMmdRotationPhysicsLimit"[^>]*type="range"[^>]*min="30"[^>]*max="720"/u);
});
