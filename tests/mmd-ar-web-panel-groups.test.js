'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const { groupWebPanels, WEB_PANEL_GROUP_CSS, WEB_PANEL_GROUP_JS } = require('../3rd/mmd-ar-test/web-panel-groups');

const DISPLAY_SOURCE = path.join(__dirname, '../src/apps/web-mediacenter/ui/public/display.html');
const GENERATED_PAGE = path.join(__dirname, '../3rd/mmd-ar-test/web-dist/index.html');
const CHROME = [process.env.PUPPETEER_EXECUTABLE_PATH, '/usr/bin/chromium']
  .find((candidate) => candidate && fs.existsSync(candidate));
const CAMERA_CONTROL_IDS = ['mmdArTranslationDeadZone', 'mmdArRotationDeadZone', 'mmdArSmoothingMs', 'mmdArCameraDistance'];

function addCameraControls($) {
  // 测试网页构建器先移除正式页新控件，再注入测试专用的一套参数。
  for (const id of ['displayMmdPhysicsFps', 'displayMmdRotationPhysicsLimit']) {
    $('#displayMmdLightingPanel').append($(`#${id}`).closest('label'));
  }
  $('#displayMmdMotionToggle, #displayMmdMotionPanel').remove();
  for (const id of [
    'displayMmdSpecularEnabled', 'displayMmdSpecularColor',
    'displayMmdSpecularIntensity', 'displayMmdSpecularShininess',
    'displayMmdPmxAoEdgeCorrection', 'displayMmdKeyShadowEnabled'
  ]) $(`#${id}`).closest('label').remove();
  for (const id of [
    'displayArTrackerEngine', 'displayArTargetPlane', 'displayArTranslationDeadZone',
    'displayArRotationDeadZone', 'displayArSmoothing', 'displayArCameraDistance',
    'displayMmdMotionPlayback', 'displayMmdPhysicsEnabled'
  ]) $(`#${id}`).closest('label').remove();
  $('#displayMmdLightingPanel').prepend('<label><input id="mmdArMotionPlayback" type="checkbox" checked><span>播放动作</span></label>');
  $('#displayMmdPhysicsFps').closest('label').before('<label><input id="mmdArPhysicsEnabled" type="checkbox" checked><span>启用 PMX 物理</span></label>');
  $('#displayMmdLightingPanel').after('<section id="mmdArMotionPanel" class="display-mmd-lighting-panel" hidden><div class="display-mmd-lighting-header">动作与物理</div></section>');
  const motionPanel = $('#mmdArMotionPanel');
  motionPanel.append($('#mmdArMotionPlayback').closest('label'));
  motionPanel.append('<label><input id="mmdArCameraMotionPlayback" type="checkbox" checked><span>相机动作</span></label>');
  motionPanel.append('<label><progress id="mmdArMotionProgress" max="1" value="0"></progress><output id="mmdArMotionTime">--:-- / --:--</output></label>');
  motionPanel.append('<label><progress id="mmdArCameraMotionProgress" max="1" value="0"></progress><output id="mmdArCameraMotionTime">--:-- / --:--</output></label>');
  for (const id of ['mmdArPhysicsEnabled', 'displayMmdPhysicsFps', 'displayMmdRotationPhysicsLimit']) {
    motionPanel.append($(`#${id}`).closest('label'));
  }
  $('#displayArTargetPanel').append('<div id="mmdArTargetPlaneMode"></div>');
  $('#displayArTargetPanel').append(CAMERA_CONTROL_IDS.map((id) => `<label><input id="${id}" type="range"></label>`).join(''));
  // 补齐网页现有专用控件；夹具仍使用真实分组函数验证保留节点和未分类检查。
  $('#displayArMotionSensitivity').closest('label').remove();
  $('#displayArTargetPanel').append([
    'mmdArFilterMinCF', 'mmdArFilterBeta', 'mmdArFilterApplyHint',
    'mmdArImuPanel', 'mmdArQualityPanel', 'mmdArGravityCameraEnabled',
    'mmdArGravityCameraMessage', 'mmdArGravityDeadZone', 'mmdArGravitySmoothing'
  ].map((id) => `<div id="${id}"></div>`).join(''));
}

// 使用真正的生成页与全部业务脚本，确保面板 stopPropagation 等事件链进入回归。
async function startGeneratedPageServer() {
  const root = path.dirname(GENERATED_PAGE);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/mnt/mmd-ar/')) {
      response.writeHead(404).end();
      return;
    }
    const relative = decodeURIComponent(pathname.slice('/mnt/mmd-ar/'.length)) || 'index.html';
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const extension = path.extname(absolute).toLowerCase();
    const contentType = ({
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.wasm': 'application/wasm',
      '.png': 'image/png',
    })[extension] || 'application/octet-stream';
    response.setHeader('Content-Type', contentType);
    fs.createReadStream(absolute).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('测试网页灯光和定位控件按类折叠，原控件 ID 与按钮保留', () => {
  const $ = cheerio.load(fs.readFileSync(DISPLAY_SOURCE, 'utf8'));
  addCameraControls($);
  const panels = ['#displayMmdLightingPanel', '#mmdArMotionPanel', '#displayArTargetPanel'];
  const originalIds = new Map(panels.map((selector) => [
    selector,
    $(selector).find('[id]').map((_, node) => node.attribs.id).get().sort(),
  ]));
  $('#displayArTargetPanel .display-mmd-ar-header').after('<div class="mmd-ar-benchmark"><label><select id="mmdArInputScale"></select></label><p id="mmdArInputResolution"></p><p id="mmdArBenchmarkLive"></p></div>');
  $('#displayMmdKeyColor').closest('label').before('<label><input id="displayMmdKeyShadowEnabled" type="checkbox" checked><span>主光阴影（默认开启）</span></label>');
  originalIds.get('#displayMmdLightingPanel').push('displayMmdKeyShadowEnabled');
  originalIds.get('#displayMmdLightingPanel').sort();
  originalIds.get('#displayArTargetPanel').push('mmdArBenchmarkLive');
  originalIds.get('#displayArTargetPanel').push('mmdArInputScale', 'mmdArInputResolution');
  originalIds.get('#displayArTargetPanel').push('mmdArTrackingToggle');
  originalIds.get('#displayArTargetPanel').sort();

  groupWebPanels($);
  originalIds.get('#mmdArMotionPanel').push(...require('../3rd/mmd-ar-test/web-physics-wind').WIND_CONTROL_IDS);
  originalIds.get('#displayMmdLightingPanel').push('mmdArAoConcavityAngle', 'mmdArAoConcavityAngleValue');
  // 工作区已有补光角度控件和小球遮挡控件，完整ID校验夹具须包含这些现有节点。
  originalIds.get('#displayMmdLightingPanel').push('mmdArFillFacingStart', 'mmdArFillFacingStartValue',
    'mmdArFillFacingEnd', 'mmdArFillFacingEndValue');
  originalIds.get('#displayMmdLightingPanel').push('mmdArKeyShadowBias', 'mmdArKeyShadowBiasValue',
    'mmdArKeyShadowNormalBias', 'mmdArKeyShadowNormalBiasValue');
  originalIds.get('#mmdArMotionPanel').push('mmdArSkeletonEnabled', 'mmdArSkeletonLegend', 'mmdArRigidBodyEnabled', 'mmdArRigidBodyStatus');
  originalIds.get('#mmdArMotionPanel').push('mmdArSkeletonSize', 'mmdArSkeletonSizeValue', 'mmdArSkeletonNamesEnabled', 'mmdArSkeletonSelectionStatus', 'mmdArSkeletonClearContacts', 'mmdArSkeletonHint');
  originalIds.get('#mmdArMotionPanel').push('mmdArSkeletonOcclusionEnabled', 'mmdArSkeletonOccludedOpacity', 'mmdArSkeletonOccludedOpacityValue');
  originalIds.get('#mmdArMotionPanel').push('mmdArRigidBodyLegend', 'mmdArRigidBodyMassRange');
  originalIds.get('#mmdArMotionPanel').push('mmdArRigidBodyControls', 'mmdArRigidBodyStyle', 'mmdArCharacterHiddenEnabled');
  originalIds.get('#mmdArMotionPanel').push('mmdArPhysicsStabilityReference', 'mmdArPhysicsStabilityReferenceValue', 'mmdArPhysicsStabilityReferenceHint');
  for (const selector of panels) {
    originalIds.get(selector).push(`${selector.slice(1)}Opacity`);
    originalIds.get(selector).sort();
  }

  const expectedTitles = [
    ['基础光照', '高光', 'AO', '主光', '补光', '边缘光 1', '边缘光 2'],
    ['动作', '物理', '骨骼'],
    ['定位图与校准', '跟踪操作', 'MindAR 抖动过滤', 'IMU 相机预测', 'MindAR 可信度（估算）', '重力旋转', '相机跟随'],
  ];
  panels.forEach((selector, index) => {
    const panel = $(selector);
    const groups = panel.children('section.mmd-ar-panel-group');
    assert.deepEqual(groups.map((_, node) => $(node).find('button.mmd-ar-panel-group-toggle').attr('data-group-title')).get(), expectedTitles[index]);
    assert.equal(groups.find('button[aria-expanded="true"]').length, 1);
    assert.equal(groups.first().find('button').attr('aria-expanded'), 'true');
    assert.deepEqual(panel.find('[id]').filter((_, node) => !$(node).hasClass('mmd-ar-panel-group-body'))
      .map((_, node) => node.attribs.id).get().sort(), originalIds.get(selector));
  });
  for (const [controlId, title] of [
    ['displayMmdPmxAoEnabled', 'AO'],
    ['displayMmdKeyShadowEnabled', '主光'],
    ['displayMmdFillEnabled', '补光'],
    ['displayMmdRim1Enabled', '边缘光 1'],
    ['displayMmdRim2Enabled', '边缘光 2'],
    ['displayArMotionEnabled', '重力旋转'],
  ]) {
    const group = $(`#${controlId}`).closest('.mmd-ar-panel-group');
    assert.equal(group.find('.mmd-ar-panel-group-header').find(`#${controlId}`).length, 1);
    assert.equal(group.find('button.mmd-ar-panel-group-toggle').attr('data-group-title'), title);
    assert.equal(group.find('.mmd-ar-panel-group-switch').text().trim(), '');
    assert.ok(group.find('button.mmd-ar-panel-group-toggle > span').first().text().length > title.length);
    assert.equal(group.find(`#${controlId}`).attr('aria-label'), group.find('button.mmd-ar-panel-group-toggle > span').first().text());
  }
  assert.equal($('#displayArCalibrationButton').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '定位图与校准');
  assert.equal($('#displayArDeleteButton').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '定位图与校准');
  assert.equal($('#displayArStartButton').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '跟踪操作');
  assert.equal($('#displayArStopButton').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '跟踪操作');
  assert.equal($('#mmdArTrackingToggle').closest('.mmd-ar-panel-group').find('button.mmd-ar-panel-group-toggle').attr('data-group-title'), '定位图与校准');
  assert.equal($('#displayMmdShadowSource').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '补光');
  assert.equal($('#mmdArPhysicsEnabled').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '物理');
  assert.equal($('#mmdArSkeletonEnabled').closest('.mmd-ar-panel-group-header').length, 1);
  assert.equal($('#mmdArSkeletonEnabled').is('[checked]'), false);
  assert.match($('#mmdArSkeletonLegend').text(), /红 type0.*黄 type2.*绿 type1/u);
  assert.equal($('#mmdArRigidBodyEnabled').closest('.mmd-ar-panel-group-body').length, 1);
  assert.equal($('#mmdArRigidBodyEnabled').is('[checked]'), false);
  assert.equal($('#mmdArRigidBodyStatus').attr('role'), 'status');
  assert.equal($('#mmdArRigidBodyLegend').closest('.mmd-ar-panel-group-body').length, 1);
  assert.match($('#mmdArRigidBodyLegend').text(), /灰＝有效质量 0（跟随骨骼）/u);
  assert.equal($('#mmdArRigidBodyControls').closest('.mmd-ar-panel-group-body').length, 1);
  assert.equal($('#mmdArRigidBodyStyle button[aria-pressed="true"]').attr('data-rigid-body-style'), 'solid');
  assert.equal($('#mmdArRigidBodyStyle button[aria-pressed="false"]').attr('data-rigid-body-style'), 'wireframe');
  assert.equal($('#mmdArCharacterHiddenEnabled').is('[checked]'), false);
  assert.equal($('#mmdArPhysicsStabilityReference').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '物理');
  assert.equal($('#mmdArPhysicsStabilityReference').attr('min'), '30');
  assert.equal($('#mmdArPhysicsStabilityReference').attr('max'), '180');
  assert.equal($('#mmdArPhysicsStabilityReference').attr('value'), '45');
  assert.equal($('#mmdArSkeletonSize').attr('min'), '0.2');
  assert.equal($('#mmdArSkeletonSize').attr('max'), '3');
  assert.equal($('#mmdArSkeletonNamesEnabled').is('[checked]'), false);
  assert.equal($('#mmdArSkeletonClearContacts').is('[disabled]'), true);
  assert.equal($('#mmdArMotionProgress').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '动作');
  assert.equal($('#mmdArMotionPlayback').closest('#displayMmdLightingPanel').length, 0);
  assert.equal($('#mmdArCameraMotionPlayback').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '动作');
  assert.equal($('#mmdArCameraMotionPlayback').is('[checked]'), true);
  assert.equal($('#mmdArCameraMotionProgress').closest('.mmd-ar-panel-group').find('button').attr('data-group-title'), '动作');
  assert.match(WEB_PANEL_GROUP_CSS, /background: color-mix\(in srgb, #39455c var\(--display-mmd-panel-opacity, 50%\), transparent\)/u);
  const specular = $('.mmd-ar-specular');
  assert.equal(specular.is('section.mmd-ar-panel-group'), true);
  assert.equal(specular.find('.mmd-ar-panel-group-header [data-specular="enabled"]').length, 1);
  assert.equal(specular.find('.mmd-ar-panel-group-body [data-specular]').length, 3);
  assert.equal(specular.find('.mmd-ar-panel-group-body').is('[hidden]'), true);
  assert.equal(specular.prev().find('button').attr('data-group-title'), '基础光照');
});

test('新增未分类控件时停止网页构建，避免面板设置丢失', () => {
  const $ = cheerio.load(fs.readFileSync(DISPLAY_SOURCE, 'utf8'));
  addCameraControls($);
  $('#displayArTargetPanel .display-mmd-ar-header').after('<div class="mmd-ar-benchmark"><p id="mmdArBenchmarkLive"></p></div>');
  $('#displayMmdKeyColor').closest('label').before('<label><input id="displayMmdKeyShadowEnabled" type="checkbox" checked><span>主光阴影（默认开启）</span></label>');
  $('#displayMmdLightingPanel').append('<label><input id="newLightingControl"></label>');
  assert.throws(() => groupWebPanels($), /未分类控件/u);
});

test('手机宽度下分类可独立开合，控件值与面板滚动范围不变', {
  skip: !CHROME || !fs.existsSync(GENERATED_PAGE),
}, async () => {
  const $ = cheerio.load(fs.readFileSync(GENERATED_PAGE, 'utf8'));
  $('script, link[rel="stylesheet"]').remove();
  $('head').append(`<style>${fs.readFileSync(path.join(__dirname, '../src/apps/web-mediacenter/ui/public/css/display-mmd.css'), 'utf8')}</style>`);
  $('body').append(`<script>${WEB_PANEL_GROUP_JS}</script>`);
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
    await page.setContent($.html());
    await page.evaluate(() => { document.getElementById('displayMmdLightingPanel').hidden = false; });
    const before = await page.evaluate(() => ({
      lighting: document.getElementById('displayMmdLightingPreset').value,
      shadowSource: document.getElementById('displayMmdShadowSource').value,
    }));
    await page.click('#displayMmdLightingPanel [data-group-title="AO"] > span:first-child');
    const aoOpenedFromTitle = await page.evaluate(() => ({
      open: !document.getElementById('displayMmdPmxAoEnabled').closest('section').querySelector('.mmd-ar-panel-group-body').hidden,
      enabled: document.getElementById('displayMmdPmxAoEnabled').checked,
    }));
    await page.click('#displayMmdPmxAoEnabled');
    const aoStayedOpenFromSwitch = await page.evaluate(() => !document.getElementById('displayMmdPmxAoEnabled').closest('section').querySelector('.mmd-ar-panel-group-body').hidden);
    await page.click('#displayMmdLightingPanel [data-group-title="AO"] > span:first-child');
    const aoClosedFromTitle = await page.evaluate(() => document.getElementById('displayMmdPmxAoEnabled').closest('section').querySelector('.mmd-ar-panel-group-body').hidden);
    await page.click('#displayMmdFillEnabled');
    await page.evaluate(() => {
      document.getElementById('displayMmdLightingPanel').hidden = true;
      document.getElementById('displayArTargetPanel').hidden = false;
    });
    await page.click('#displayArTargetPanel .mmd-ar-panel-group:nth-of-type(2) .mmd-ar-panel-group-toggle > span:first-child');
    const after = await page.evaluate(() => ({
      lighting: document.getElementById('displayMmdLightingPreset').value,
      shadowSource: document.getElementById('displayMmdShadowSource').value,
      aoOpen: !document.getElementById('displayMmdPmxAoEnabled').closest('section').querySelector('.mmd-ar-panel-group-body').hidden,
      trackingOpen: document.querySelectorAll('#displayArTargetPanel .mmd-ar-panel-group-body')[1].hidden === false,
      firstLightingOpen: document.querySelector('#displayMmdLightingPanel .mmd-ar-panel-group-body').hidden === false,
      fillEnabled: document.getElementById('displayMmdFillEnabled').checked,
      fillGroupClosed: document.getElementById('displayMmdFillEnabled').closest('section').querySelector('.mmd-ar-panel-group-body').hidden,
      aoEnabled: document.getElementById('displayMmdPmxAoEnabled').checked,
      aoButtonLabel: document.querySelector('#displayMmdLightingPanel [data-group-title="AO"]').getAttribute('aria-label'),
      panelOpacity: getComputedStyle(document.getElementById('displayStageLayers')).getPropertyValue('--display-mmd-panel-opacity').trim(),
      panelWidth: document.getElementById('displayMmdLightingPanel').getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
    }));
    assert.deepEqual(aoOpenedFromTitle, { open: true, enabled: true });
    assert.equal(aoStayedOpenFromSwitch, true);
    assert.equal(aoClosedFromTitle, true);
    assert.equal(after.aoOpen, false);
    assert.equal(after.trackingOpen, true);
    assert.equal(after.firstLightingOpen, true);
    assert.equal(after.fillEnabled, true);
    assert.equal(after.fillGroupClosed, true);
    assert.equal(after.aoEnabled, false);
    assert.equal(after.aoButtonLabel, '展开AO设置');
    assert.equal(after.panelOpacity, '50%');
    assert.equal(after.lighting, before.lighting);
    assert.equal(after.shadowSource, before.shadowSource);
    assert.ok(after.panelWidth <= after.viewportWidth);
    await page.setViewport({ width: 320, height: 700, deviceScaleFactor: 3 });
    const narrowHeadersFit = await page.evaluate(() => Array.from(document.querySelectorAll('.mmd-ar-panel-group-header'))
      .every((header) => header.scrollWidth <= header.clientWidth + 1));
    assert.equal(narrowHeadersFit, true);
  } finally {
    await browser?.close();
  }
});

test('完整测试网页脚本存在时，灯光与定位分类仍能展开和收起', {
  skip: !CHROME || !fs.existsSync(GENERATED_PAGE),
}, async () => {
  const server = await startGeneratedPageServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
    // 分类事件不依赖模型二进制；阻止大型 PMX/VMD 下载，避免回归被渲染开销拖慢。
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`, { waitUntil: 'domcontentloaded' });
    assert.equal(await page.evaluate(() => Boolean(window.DisplayMmdImageTargetTracker?.start)), true);
    assert.equal(await page.evaluate(() => document.getElementById('mmdArTrackerEngine')), null);
    assert.equal(fs.existsSync(path.join(path.dirname(GENERATED_PAGE), 'js/display-mmd-image-tracker.js')), false);
    assert.equal(await page.$eval('#mmdArMotionPlayback', (node) => node.checked), true);
    assert.equal(await page.evaluate(() => window.DisplayMmd.getState().motionPlaybackEnabled), true);
    assert.equal(await page.$eval('#mmdArPhysicsEnabled', (node) => node.checked), true);
    assert.equal(await page.evaluate(() => window.DisplayMmd.getState().physicsEnabled), true);
    assert.equal(await page.$eval('#mmdArMotionTime', node => node.textContent), '--:-- / --:--');
    assert.equal(await page.$eval('#mmdArMotionProgress', node => node.value), 0);
    assert.equal(await page.$eval('#mmdArCameraMotionPlayback', (node) => node.checked), true);
    assert.equal(await page.$eval('#mmdArCameraMotionTime', node => node.textContent), '--:-- / --:--');
    assert.equal(await page.$eval('#mmdArCameraMotionProgress', node => node.value), 0);
    await page.evaluate(() => {
      window.__testMotionProgress = { durationSeconds: 12.4, timeSeconds: 3.7 };
      window.__testCameraProgress = { durationSeconds: 5.5, timeSeconds: 1.2 };
      const displayMmd = window.DisplayMmd;
      window.DisplayMmd = new Proxy({}, {
        get(_target, property) {
          if (property === 'getMotionProgress') return () => window.__testMotionProgress;
          if (property === 'getCameraMotionProgress') return () => window.__testCameraProgress;
          return Reflect.get(displayMmd, property);
        },
      });
    });
    await page.click('#mmdArMotionToggle');
    assert.equal(await page.$eval('#mmdArMotionPanel', node => node.hidden), false);
    assert.equal(await page.$eval('#mmdArMotionToggle', node => node.getAttribute('aria-expanded')), 'true');
    assert.deepEqual(await page.evaluate(() => ({
      progress: document.getElementById('mmdArMotionProgress').value,
      time: document.getElementById('mmdArMotionTime').textContent,
      motion: window.DisplayMmd.getMotionProgress(),
      cameraProgress: document.getElementById('mmdArCameraMotionProgress').value,
      cameraTime: document.getElementById('mmdArCameraMotionTime').textContent,
      cameraMotion: window.DisplayMmd.getCameraMotionProgress(),
    })), {
      progress: 3.7,
      time: '00:03 / 00:12',
      motion: { durationSeconds: 12.4, timeSeconds: 3.7 },
      cameraProgress: 1.2,
      cameraTime: '00:01 / 00:05',
      cameraMotion: { durationSeconds: 5.5, timeSeconds: 1.2 },
    });
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#mmdArMotionPanel', node => node.hidden), true);
    assert.equal(await page.$eval('#mmdArMotionToggle', node => node.getAttribute('aria-expanded')), 'false');
    await page.evaluate(() => {
      window.__testMotionProgress = { durationSeconds: 12.4, timeSeconds: 8.2 };
      window.__testCameraProgress = { durationSeconds: 5.5, timeSeconds: 4.4 };
    });
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(await page.$eval('#mmdArMotionProgress', node => node.value), 3.7);
    await page.click('#mmdArMotionToggle');
    assert.equal(await page.$eval('#mmdArMotionProgress', node => node.value), 8.2);
    assert.equal(await page.$eval('#mmdArCameraMotionProgress', node => node.value), 4.4);
    assert.equal(await page.$eval('#mmdArCameraMotionTime', node => node.textContent), '00:04 / 00:05');
    assert.equal(await page.$eval('#mmdArMotionPanel', node => node.hidden), false);
    await page.click('#mmdArMotionPlayback');
    assert.equal(await page.evaluate(() => window.DisplayMmd.getState().motionPlaybackEnabled), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('aasc.mmdArTest.motionPlayback.v1')), 'false');
    await page.click('#mmdArCameraMotionPlayback');
    assert.equal(await page.$eval('#mmdArCameraMotionPlayback', (node) => node.checked), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('aasc.mmdArTest.cameraMotionPlayback.v1')), 'false');
    await page.evaluate(() => document.querySelector('#mmdArMotionPanel [data-group-title="物理"]').click());
    assert.equal(await page.$eval('#displayMmdPhysicsFps', node => node.closest('#mmdArMotionPanel') !== null), true);
    // 纠错基准Hz滑条：默认45，改动即转发并本地保存。
    assert.equal(await page.$eval('#mmdArPhysicsStabilityReference', node => node.value), '45');
    const stabilityReference = await page.evaluate(() => {
      const input = document.getElementById('mmdArPhysicsStabilityReference');
      input.value = '130';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { label: document.getElementById('mmdArPhysicsStabilityReferenceValue').textContent,
        stored: localStorage.getItem('aasc.mmdArTest.physicsStabilityReference.v1') };
    });
    assert.equal(stabilityReference.label, '130 Hz');
    assert.equal(stabilityReference.stored, '130');
    await page.evaluate(() => document.getElementById('displayMmdLightingToggle').click());
    assert.equal(await page.evaluate(() => document.getElementById('displayMmdLightingPanel').hidden), false);
    assert.equal(await page.$eval('#mmdArMotionPanel', node => node.hidden), true);
    assert.equal(await page.$eval('#mmdArMotionToggle', node => node.getAttribute('aria-expanded')), 'false');
    const lightingTitle = '#displayMmdLightingPanel [data-group-title="高光"] > span:first-child';
    await page.evaluate((selector) => document.querySelector(selector).click(), lightingTitle);
    assert.equal(await page.evaluate(() => document.getElementById('displayMmdLightingPanelGroup2').hidden), false);
    await page.evaluate((selector) => document.querySelector(selector).click(), lightingTitle);
    assert.equal(await page.evaluate(() => document.getElementById('displayMmdLightingPanelGroup2').hidden), true);
    // 高光开关位于折叠标题外，切换不展开；展开也不能反向切换启用状态。
    await page.waitForSelector('.mmd-ar-specular[data-bound="true"]');
    const specularState = await page.evaluate(() => {
      const group = document.querySelector('.mmd-ar-specular');
      const toggle = group.querySelector('[data-specular="enabled"]');
      const body = group.querySelector('.mmd-ar-panel-group-body');
      toggle.click();
      const stayedClosed = body.hidden;
      group.querySelector('.mmd-ar-panel-group-toggle').click();
      const remainedEnabled = toggle.checked;
      const intensity = group.querySelector('[data-specular="intensity"]');
      intensity.value = '0.62'; intensity.dispatchEvent(new Event('input', { bubbles: true }));
      group.querySelector('.mmd-ar-panel-group-toggle').click();
      return { stayedClosed, remainedEnabled, closed: body.hidden, enabled: toggle.checked,
        disabled: intensity.disabled, saved: JSON.parse(localStorage.getItem('aasc.mmdArTest.specular.v1')).intensity };
    });
    assert.deepEqual(specularState, { stayedClosed: true, remainedEnabled: true, closed: true, enabled: true, disabled: false, saved: 0.62 });
    const keyShadow = await page.evaluate(() => {
      const toggle = document.getElementById('displayMmdKeyShadowEnabled');
      const initial = { checked: toggle.checked, value: window.DisplayMmd.getLighting().keyShadowEnabled };
      toggle.click();
      return { initial, checked: toggle.checked, value: window.DisplayMmd.getLighting().keyShadowEnabled,
        saved: JSON.parse(localStorage.getItem('aasc.display.mmdLighting.v1')).keyShadowEnabled };
    });
    assert.deepEqual(keyShadow, {
      initial: { checked: true, value: true }, checked: false, value: false, saved: false,
    });
    assert.match(fs.readFileSync(DISPLAY_SOURCE, 'utf8'), /displayMmdKeyShadowEnabled/u);

    await page.evaluate(() => document.getElementById('displayArTargetToggle').click());
    assert.equal(await page.evaluate(() => document.getElementById('displayArTargetPanel').hidden), false);
    const trackingTitle = '#displayArTargetPanel .mmd-ar-panel-group:nth-of-type(2) .mmd-ar-panel-group-toggle > span:first-child';
    await page.evaluate((selector) => document.querySelector(selector).click(), trackingTitle);
    assert.equal(await page.evaluate(() => document.getElementById('displayArTargetPanelGroup2').hidden), false);
    await page.evaluate((selector) => document.querySelector(selector).click(), trackingTitle);
    assert.equal(await page.evaluate(() => document.getElementById('displayArTargetPanelGroup2').hidden), true);
    const cameraSettings = await page.evaluate(() => {
      const group = document.querySelector('#displayArTargetPanel .mmd-ar-panel-group:nth-of-type(4)');
      group.querySelector('.mmd-ar-panel-group-toggle').click();
      const distance = document.getElementById('mmdArCameraDistance');
      distance.value = '65';
      distance.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        open: !group.querySelector('.mmd-ar-panel-group-body').hidden,
        value: document.getElementById('mmdArCameraDistanceValue').textContent,
        saved: JSON.parse(localStorage.getItem('aasc.mmdArTest.cameraSettings.v1')),
        accepted: window.DisplayMmd.setArCameraSettings({ distancePercent: 65 })
      };
    });
    assert.equal(cameraSettings.open, true);
    assert.equal(cameraSettings.value, '65%');
    assert.equal(cameraSettings.saved.distancePercent, 65);
    assert.equal(cameraSettings.saved.smoothingMs, 120);
    assert.equal(cameraSettings.saved.targetPlane, 'floor');
    assert.equal(cameraSettings.accepted, true);
    await page.$eval('#mmdArTargetPlaneMode [data-target-plane="vertical"]', (button) => button.click());
    assert.equal(await page.$eval('#mmdArTargetPlaneMode [data-target-plane="vertical"]', (button) => button.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('aasc.mmdArTest.cameraSettings.v1')).targetPlane), 'vertical');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.mmd-ar-specular[data-bound="true"]');
    assert.equal(await page.$eval('[data-specular="enabled"]', node => node.checked), true);
    assert.equal(await page.$eval('[data-specular="intensity"]', node => node.value), '0.62');
    assert.equal(await page.$eval('#mmdArMotionPlayback', (node) => node.checked), false);
    assert.equal(await page.evaluate(() => window.DisplayMmd.getState().motionPlaybackEnabled), false);
    assert.equal(await page.$eval('#mmdArPhysicsEnabled', (node) => node.checked), true);
    assert.equal(await page.$eval('#mmdArCameraDistance', (node) => node.value), '65');
    assert.equal(await page.$eval('#mmdArTargetPlaneMode [data-target-plane="vertical"]', (button) => button.getAttribute('aria-pressed')), 'true');
    await page.evaluate(() => localStorage.setItem('aasc.mmdArTest.motionPlayback.v1', 'invalid'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.$eval('#mmdArMotionPlayback', (node) => node.checked), true);
    assert.equal(await page.evaluate(() => window.DisplayMmd.getState().motionPlaybackEnabled), true);
    await page.evaluate(() => localStorage.setItem('aasc.mmdArTest.physicsEnabled.v1', 'false'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.$eval('#mmdArPhysicsEnabled', (node) => node.checked), false);
    assert.equal(await page.evaluate(() => window.DisplayMmd.getState().physicsEnabled), false);
    await page.evaluate(() => localStorage.setItem('aasc.mmdArTest.physicsEnabled.v1', 'invalid'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.$eval('#mmdArPhysicsEnabled', (node) => node.checked), true);
    assert.equal(await page.evaluate(() => window.DisplayMmd.getState().physicsEnabled), true);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('测试网页三个面板在横竖屏都停靠在按钮列左侧并从顶部对齐', {
  skip: !CHROME || !fs.existsSync(GENERATED_PAGE),
}, async () => {
  const server = await startGeneratedPageServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('displayStageLayers')?.dataset.panelOrientation === 'portrait');

    const readLayouts = () => page.evaluate(() => {
      const entries = [
        ['displayMmdLightingPanel', 'displayMmdLightingToggle'],
        ['mmdArMotionPanel', 'displayMmdLightingToggle'],
        ['displayArTargetPanel', 'displayMmdLightingToggle'],
      ];
      for (const [panelId] of entries) document.getElementById(panelId).hidden = false;
      return entries.map(([panelId, buttonId]) => {
        const panel = document.getElementById(panelId);
        const button = document.getElementById(buttonId);
        const panelRect = panel.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return {
          panelId,
          panelWidth: panelRect.width,
          panelTop: panelRect.top,
          panelRight: panelRect.right,
          buttonTop: buttonRect.top,
          buttonLeft: buttonRect.left,
        };
      });
    });
    const assertPanelsLeftOfButtons = (layouts) => {
      for (const layout of layouts) {
        assert.ok(layout.panelWidth > 0, `${layout.panelId} 应有可见宽度`);
        assert.ok(Math.abs(layout.panelTop - layout.buttonTop) <= 2, `${layout.panelId} 应与按钮列顶部对齐`);
        assert.ok(layout.panelRight <= layout.buttonLeft - 4, `${layout.panelId} 应位于按钮列左侧`);
      }
    };

    const portraitLayouts = await readLayouts();
    assertPanelsLeftOfButtons(portraitLayouts);
    for (const layout of portraitLayouts) {
      assert.equal(Math.round(layout.panelWidth), 320, `${layout.panelId} 竖屏保持标准面板宽度`);
    }
    await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 3 });
    await page.waitForFunction(() => document.getElementById('displayStageLayers')?.dataset.panelOrientation === 'landscape');
    const landscapeLayouts = await readLayouts();
    assertPanelsLeftOfButtons(landscapeLayouts);
    for (const layout of landscapeLayouts) {
      assert.equal(Math.round(layout.panelWidth), 320, `${layout.panelId} 横屏保持标准面板宽度`);
    }
    await page.setViewport({ width: 320, height: 700, deviceScaleFactor: 3 });
    await page.waitForFunction(() => document.getElementById('displayStageLayers')?.dataset.panelOrientation === 'portrait');
    assertPanelsLeftOfButtons(await readLayouts());
  } finally {
    await browser?.close();
    server.close();
  }
});

test('校准弹窗在窄竖屏内可滚动，定位切换只显示一个按钮', {
  skip: !CHROME || !fs.existsSync(GENERATED_PAGE),
}, async () => {
  const server = await startGeneratedPageServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 600, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.DisplayMmdAr?.getState?.().targetCount > 0);
    const result = await page.evaluate(() => {
      const calibration = document.getElementById('displayArCalibration');
      const dialog = calibration.querySelector('.display-mmd-ar-dialog');
      const toggle = document.getElementById('mmdArTrackingToggle');
      document.getElementById('displayStageLayers').style.setProperty('--display-safe-inset-top', '40px');
      document.getElementById('displayStageLayers').style.setProperty('--display-safe-inset-bottom', '24px');
      calibration.hidden = false;
      const initial = {
        dialog: dialog.getBoundingClientRect().toJSON(),
        viewport: window.innerHeight,
        toggleText: toggle.textContent,
        toggleDisabled: toggle.disabled,
        oldStartDisplay: getComputedStyle(document.querySelector('.mmd-ar-original-tracking-actions')).display,
      };
      window.DisplayMmdAr.setCameraEnabled(false);
      return { ...initial, disabledAfterCameraOff: toggle.disabled };
    });
    assert.ok(result.dialog.top >= -1, `弹窗顶边越界：${result.dialog.top}`);
    assert.ok(result.dialog.bottom <= result.viewport + 1, `弹窗底边越界：${result.dialog.bottom}`);
    assert.equal(result.oldStartDisplay, 'none');
    assert.equal(result.toggleText, '开始定位');
    assert.equal(result.toggleDisabled, false);
    await page.waitForFunction(() => document.getElementById('mmdArTrackingToggle').disabled);
    assert.equal(await page.$eval('#mmdArTrackingToggle', (node) => node.disabled), true);
    const active = await page.evaluate(async () => {
      const oldController = window.DisplayMmdAr;
      let stopped = 0;
      window.DisplayMmdAr = { getState: () => ({ tracking: true, status: 'tracking' }), stop: () => { stopped += 1; } };
      document.getElementById('displayArTargetStatus').textContent = '定位中';
      await new Promise((resolve) => setTimeout(resolve, 0));
      const toggle = document.getElementById('mmdArTrackingToggle');
      const label = toggle.textContent;
      toggle.click();
      window.DisplayMmdAr = oldController;
      return { label, disabled: toggle.disabled, stopped };
    });
    assert.deepEqual(active, { label: '结束定位', disabled: false, stopped: 1 });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('手机窄屏下定位面板可用触摸手势滚到下方操作', {
  skip: !CHROME || !fs.existsSync(GENERATED_PAGE),
}, async () => {
  const server = await startGeneratedPageServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 650, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`, { waitUntil: 'domcontentloaded' });
    const initial = await page.evaluate(() => {
      document.getElementById('displayArTargetToggle').click();
      document.querySelectorAll('#displayArTargetPanel .mmd-ar-panel-group-toggle[aria-expanded="false"]')
        .forEach((button) => button.click());
      const panel = document.getElementById('displayArTargetPanel');
      return {
        bodyTouch: getComputedStyle(document.body).touchAction,
        panelTouch: getComputedStyle(panel).touchAction,
        panelBottom: panel.getBoundingClientRect().bottom,
        scrollHeight: panel.scrollHeight,
        clientHeight: panel.clientHeight,
        rect: panel.getBoundingClientRect().toJSON(),
      };
    });
    assert.notEqual(initial.bodyTouch, 'none');
    assert.equal(initial.panelTouch, 'pan-y');
    assert.ok(initial.panelBottom <= 650);
    assert.ok(initial.scrollHeight > initial.clientHeight);
    const x = Math.round(initial.rect.left + initial.rect.width / 2);
    const y = Math.round(Math.min(initial.rect.bottom - 70, initial.rect.top + 280));
    const client = await page.createCDPSession();
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let offset = 20; offset <= 160; offset += 20) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - offset }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(await page.$eval('#displayArTargetPanel', (panel) => panel.scrollTop) > 0);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTPS 测试页内置官方目标且保留用户选图，正式页不带内置目标', {
  skip: !CHROME || !fs.existsSync(GENERATED_PAGE),
}, async () => {
  const generated = fs.readFileSync(GENERATED_PAGE, 'utf8');
  assert.match(generated, /MindAR 官方测试图/u);
  assert.match(generated, /DisplayMmdArBuiltInTargets/u);
  assert.doesNotMatch(fs.readFileSync(DISPLAY_SOURCE, 'utf8'), /MindAR 官方测试图/u);
  const server = await startGeneratedPageServer();
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/mnt/mmd-ar/mmd/')) void request.abort();
      else void request.continue();
    });
    const url = `http://127.0.0.1:${server.address().port}/mnt/mmd-ar/`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#displayArTargetSelect option[value="builtin:mindar-official-card"]'));
    const initial = await page.evaluate(() => ({
      value: document.getElementById('displayArTargetSelect').value,
      deleteDisabled: document.getElementById('displayArDeleteButton').disabled,
      link: document.querySelector('.mmd-ar-official-target-link').href,
    }));
    assert.equal(initial.value, 'builtin:mindar-official-card');
    assert.equal(initial.deleteDisabled, true);
    assert.equal(initial.link, `${url}assets/mindar-official-card.png`);
    const image = await page.evaluate(async () => {
      const response = await fetch(document.querySelector('.mmd-ar-official-target-link').href);
      const blob = await response.blob();
      return { ok: response.ok, type: blob.type, size: blob.size };
    });
    assert.deepEqual(image, { ok: true, type: 'image/png', size: 61689 });
    await page.evaluate(async () => {
      const blob = await (await fetch(document.querySelector('.mmd-ar-official-target-link').href)).blob();
      const request = indexedDB.open('aasc-mmd-ar', 1);
      const database = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('targets', 'readwrite');
        transaction.objectStore('targets').put({
          targetId: 'user-target', name: '用户定位图', referenceImageBlob: blob,
          selectedQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
          updatedAt: Date.now(),
        });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      localStorage.setItem('aasc.display.mmdAr.activeTarget.v1', 'user-target');
      database.close();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#displayArTargetSelect option[value="user-target"]'));
    assert.equal(await page.$eval('#displayArTargetSelect', (select) => select.value), 'user-target');
    assert.equal(await page.$eval('#displayArDeleteButton', (button) => button.disabled), false);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
