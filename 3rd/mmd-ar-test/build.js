#!/usr/bin/env node
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const cheerio = require('cheerio');
const { hashFile, inspectApk } = require('./apk-artifact');
const { RESOURCES: LOCAL_AR_RESOURCES, verifyBuffer: verifyLocalArBuffer } = require('../../scripts/ops/prepare-mmd-ar-vendor');
const {
  STATIC_MMD_RELEASE,
  createStaticMmdResourceProfile,
  resolveStaticMmdAssetUrl,
} = require('../../src/apps/server/modules/mmd/mmd-resource-service');
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ANDROID_PROJECT = __dirname;
const APP_PROJECT = path.join(ANDROID_PROJECT, 'app');
const SOURCE_PUBLIC = path.join(PROJECT_ROOT, 'src/apps/web-mediacenter/ui/public');
const WEB_MODE = process.argv.includes('--web');
const WEB_PANEL_GROUPS = require('./web-panel-groups');
const WEB_CAMERA_MOTION = require('./web-camera-motion-inject');
const WEB_GRAVITY_MODE = require('./web-gravity-mode');
const WEB_LOCAL_ASSETS = require('./web-local-assets-inject'), WEB_CHARACTERS = require('./web-characters-build');
const WEB_PHYSICS_LIFECYCLE = require('./web-physics-lifecycle');
const WEB_PHYSICS_RATE = require('./web-physics-rate');
const WEB_PHYSICS_SUBSTEPS = require('./web-physics-substeps');
const WEB_PHYSICS_STABILITY = require('./web-physics-stability');
const WEB_SKELETON_DEBUG = require('./web-skeleton-debug');
const WEB_RIGID_BODY_DEBUG = require('./web-rigid-body-debug');
const WEB_SHADOW_BIAS = require('./web-shadow-bias');
const WEB_SHADOW_MAP = require('./web-shadow-map-size');
const WEB_PHYSICS_WIND = require('./web-physics-wind');
const WEB_PHYSICS_SOLVER = require('./web-physics-solver');
const { stageXpbdPhysics } = require('./web-xpbd-build');
const { stageVertexCloth, addClothMotionSwitch } = require('./web-vertex-cloth-inject');
const WEB_FILL_FACING_RANGE = require('./web-fill-facing-range');
// 网页构建产物可挂载在任意目录；资源统一相对页面目录，APK 仍使用原本地路由。
const WEB_BASE_PATH = '.';
const GENERATED_ASSETS = WEB_MODE
  ? path.join(ANDROID_PROJECT, 'web-dist')
  : path.join(APP_PROJECT, 'build/generated/assets/www');
const MODEL_CACHE = path.join(ANDROID_PROJECT, 'model-cache', STATIC_MMD_RELEASE.version);
const OUTPUT_APK = path.join(ANDROID_PROJECT, 'output/aasc-mmd-ar-test.apk');
const MINDAR_VERSION = '1.2.5';
const OFFICIAL_TARGET_FILE = 'mindar-official-card.png';
const OFFICIAL_TARGET_SIZE = 61689;
const OFFICIAL_TARGET_SHA256 = 'f4253baa29270f36cf04aeff8be58d036cefffa3032e76bfbca0c08bcc046bdd';
const OFFICIAL_TARGET_PATH = `${WEB_BASE_PATH}/assets/${OFFICIAL_TARGET_FILE}`;
const MINDAR_FILES = Object.freeze([
  ['mindar-image.prod.js', 266, 'a21eef9a98ed73aee589a219b35e580c50b501c6f50f88d6eed16dcef9b8dec2'],
  ['controller-mGt1s8dJ.js', 2199370, '98a90806c01077a46fc5a3daddc6441ac9d61c5b85b3cc09d3f0b2087d228713'],
  ['ui-fBadYuor.js', 4552, 'aed9538fec28fecfb0a564da48fbf053ac2549d3314746e67182d381b3a24c31'],
  ['mind-ar-LICENSE', 1063, '4f3aa5215ac0346a823170c9f9677da25c3e8bdb8243693118a3711e157d7fff'],
]);
const MINDAR_TEST_SOURCE_FILES = Object.freeze([
  'display-mmd-ar-benchmark-compiler.js', 'display-mmd-ar-benchmark-metrics.js', 'display-mmd-ar-benchmark.js',
]);
const SOURCE_ASSET_FILES = Object.freeze([
  'display-mmd-settings.js', 'display-mmd.js', 'display-mmd-lighting.js', 'display-mmd-ar.js',
  'display-pmx-runtime.js', 'display-mmd-ar-pose.js', 'display-pmx-ao.mjs', 'display-pmx-ao-size.mjs',
  'display-pmx-lighting-mode.mjs', 'display-pmx-specular.mjs',
  'mmd-ammo-physics.mjs', 'mmd-pmx-helper.mjs', 'pmx-display-layout.mjs',
]);
const VENDOR_THREE_SOURCE = path.join(SOURCE_PUBLIC, 'js/vendor/three');
const DISPLAY_HTML_SOURCE = path.join(SOURCE_PUBLIC, 'display.html');
const MODEL_PUBLIC_BASE_URL = 'http://120.79.245.103/mnt/mmd/miya-v1/';
function log(message) {
  process.stdout.write(`[mmd-ar-${WEB_MODE ? 'web' : 'apk'}] ${message}\n`);
}
// 只重写网页输出副本；APK 的本地 HTTP 路由和正式显示端源码保持原样。
function webAssetText(source) {
  if (!WEB_MODE) return source;
  return source
    // 正式静态资源新增版本目录；独立网页文件仍放在本地mmd目录，不依赖服务API。
    .replace(/\/api\/mmd\/static\/[a-f0-9]{64}\/mmd\//giu, `${WEB_BASE_PATH}/mmd/`)
    .replaceAll('/api/mmd/static/mmd/', `${WEB_BASE_PATH}/mmd/`)
    .replaceAll('/models/mmd/', `${WEB_BASE_PATH}/mmd/`)
    .replaceAll('/api/mmd/resources', `${WEB_BASE_PATH}/mmd-resources.json`)
    .replaceAll('/js/', `${WEB_BASE_PATH}/js/`)
    .replaceAll('/css/', `${WEB_BASE_PATH}/css/`);
}
async function isVerifiedFile(filePath, expectedSize, expectedHash) {
  try {
    const info = await fs.stat(filePath);
    if (!info.isFile() || info.size !== expectedSize) return false;
    const digest = await hashFile(filePath);
    return digest.size === expectedSize && digest.sha256 === expectedHash;
  } catch (_error) {
    return false;
  }
}
async function downloadToFile(url, filePath, expectedSize, expectedHash) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(300000),
    headers: { 'Accept-Encoding': 'identity' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`资源请求失败 HTTP ${response.status}: ${url}`);
  }
  const temporaryPath = `${filePath}.download-${process.pid}-${Date.now()}`;
  const hash = crypto.createHash('sha256');
  let received = 0;
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > expectedSize) {
        callback(new Error(`资源长度超过清单声明：${filePath}`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(Readable.fromWeb(response.body), verifier, createWriteStream(temporaryPath, { flags: 'wx' }));
    const actualHash = hash.digest('hex');
    if (received !== expectedSize || actualHash !== expectedHash) {
      throw new Error(`资源校验失败 ${filePath}: size=${received}, sha256=${actualHash}`);
    }
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
async function getDownloadUrls(relativePath) {
  const urls = [];
  try {
    urls.push(await resolveStaticMmdAssetUrl(relativePath));
  } catch (error) {
    log(`域名解析源暂不可用，将尝试固定外网 IP：${error.message}`);
  }
  urls.push(`${MODEL_PUBLIC_BASE_URL}${relativePath}`);
  return [...new Set(urls)];
}
async function ensureModelFile([relativePath, expectedSize, expectedHash]) {
  const cachePath = path.join(MODEL_CACHE, relativePath);
  if (await isVerifiedFile(cachePath, expectedSize, expectedHash)) {
    log(`复用已校验模型资源：${relativePath}`);
    return cachePath;
  }
  const failures = [];
  for (const url of await getDownloadUrls(relativePath)) {
    try {
      log(`下载模型资源：${relativePath}`);
      await downloadToFile(url, cachePath, expectedSize, expectedHash);
      log(`资源 SHA-256 校验通过：${relativePath}`);
      return cachePath;
    } catch (error) {
      failures.push(error.message);
      log(`资源源失败：${error.message}`);
    }
  }
  throw new Error(`模型资源不可用 ${relativePath}\n${failures.join('\n')}`);
}
async function ensureMindArFile([fileName, expectedSize, expectedHash]) {
  // 测试 APK 和网页共用项目内固定版本；出包阶段无需再次访问公网依赖 CDN。
  const sourceName = fileName === 'mind-ar-LICENSE' ? 'LICENSE' : fileName;
  const sourcePath = path.join(SOURCE_PUBLIC, 'js/vendor', `mind-ar-${MINDAR_VERSION}`, sourceName);
  if (!await isVerifiedFile(sourcePath, expectedSize, expectedHash)) {
    throw new Error(`本地 MindAR ${MINDAR_VERSION} 资源校验失败：${sourcePath}`);
  }
  return sourcePath;
}
async function stageTextAssets() {
  const $ = cheerio.load(await fs.readFile(DISPLAY_HTML_SOURCE, 'utf8'));
  const arTrackingVideo = $('#displayArTrackingVideo').first();
  const mmdLayer = $('#displayMmdLayer').first().addClass('is-visible').attr('aria-hidden', 'false');
  const controls = $('.display-stage-lighting-control').first();
  $('[data-mmd-production-only]').remove();
  // 分类前取下正式预建渲染组，随后用同一参数清单生成独立页控件。
  $('#mmdArTemporalAA, #mmdArScreenLighting').remove();
  $('[data-render-setting="canvasScale"]').closest('label').remove();
  const calibration = $('#displayArCalibration').first();
  const arPanel = $('#displayArTargetPanel').first();
  const arHeader = arPanel.find('.display-mmd-ar-header').first();
  if (!arTrackingVideo.length || !mmdLayer.length || !controls.length || !calibration.length || !arPanel.length || !arHeader.length) {
    throw new Error('显示端 AR/MMD 页面缺少测试 harness 所需的控件节点');
  }
  if ($('#mmdArTrackerEngine').length || $('#mmdArBenchmarkResults').length) {
    throw new Error('显示端页面已包含 A/B 测试控件，测试 harness 不得重复注入');
  }
  // 正式页已有独立动作面板；保留共用物理滑条，测试 harness 使用自己的开关与存储键。
  for (const id of ['displayMmdPhysicsFps', 'displayMmdRotationPhysicsLimit']) {
    $('#displayMmdLightingPanel').append($(`#${id}`).closest('label'));
  }
  $('#displayMmdMotionToggle, #displayMmdMotionPanel').remove();
  // 测试页保留独立高光/AO 开关及测试存储；不复制正式页新增字段。
  for (const id of [
    'displayMmdSpecularEnabled', 'displayMmdSpecularColor',
    'displayMmdSpecularIntensity', 'displayMmdSpecularShininess',
    'displayMmdPmxAoEdgeCorrection', 'displayMmdKeyShadowEnabled'
  ]) $(`#${id}`).closest('label').remove();
  // 测试页有自己的 MindAR 参数和物理开关，避免复制正式页控件后出现两套状态。
  for (const id of [
    'displayArTrackerEngine', 'displayArTargetPlane', 'displayArTranslationDeadZone',
    'displayArRotationDeadZone', 'displayArSmoothing', 'displayArCameraDistance',
    'displayMmdMotionPlayback', 'displayMmdPhysicsEnabled'
  ]) $(`#${id}`).closest('label').remove();
  arHeader.after(`
    <div class="mmd-ar-benchmark">
      ${'<p class="mmd-ar-benchmark-live">定位采用 MindAR Basic 的 A-Frame 目标锚点；真实相机使用原始分辨率，模拟画面宽 960 像素、高度按所选原图比例计算。</p>'}
      <p id="mmdArBenchmarkLive" class="mmd-ar-benchmark-live" role="status" aria-live="polite">
        ${'A-Frame 定位尚未启动。'}
      </p>
    </div>
  `);
    arPanel.append(`
      <div id="mmdArTargetPlaneMode" class="display-mmd-ar-field mmd-ar-plane-setting" role="group" aria-label="定位图模式">
        <span>定位图模式</span>
        <div class="mmd-ar-plane-options">
          <button type="button" data-target-plane="floor" aria-pressed="true">底面</button>
          <button type="button" data-target-plane="vertical" aria-pressed="false">立面</button>
        </div>
      </div>
      <label class="display-mmd-ar-field mmd-ar-camera-setting" for="mmdArTranslationDeadZone">
        <span>平移死区 <output id="mmdArTranslationDeadZoneValue">0.5%</output></span>
        <input id="mmdArTranslationDeadZone" type="range" min="0" max="3" step="0.1" value="0.5">
      </label>
      <label class="display-mmd-ar-field mmd-ar-camera-setting" for="mmdArRotationDeadZone">
        <span>旋转死区 <output id="mmdArRotationDeadZoneValue">0.5°</output></span>
        <input id="mmdArRotationDeadZone" type="range" min="0" max="3" step="0.1" value="0.5">
      </label>
      <label class="display-mmd-ar-field mmd-ar-camera-setting" for="mmdArSmoothingMs">
        <span>相机缓动 <output id="mmdArSmoothingMsValue">120 ms</output></span>
        <input id="mmdArSmoothingMs" type="range" min="0" max="500" step="10" value="120">
      </label>
      <label class="display-mmd-ar-field mmd-ar-camera-setting" for="mmdArCameraDistance">
        <span>相机距定位图中心 <output id="mmdArCameraDistanceValue">100%</output></span>
        <input id="mmdArCameraDistance" type="range" min="50" max="100" step="5" value="100">
        <small>100% 为定位原始距离；减小数值沿相机到图中心的连线拉近。</small>
      </label>
      <label class="display-mmd-ar-field mmd-ar-camera-setting" for="mmdArFilterMinCF">
        <span>最低截止频率（filterMinCF） <output id="mmdArFilterMinCFValue">0.001</output></span>
        <input id="mmdArFilterMinCF" type="range" min="0.0001" max="0.02" step="0.0001" value="0.001">
        <small>调低通常能减少静止抖动；过低时快速移动会更拖后。</small>
      </label>
      <label class="display-mmd-ar-field mmd-ar-camera-setting" for="mmdArFilterBeta">
        <span>速度响应（filterBeta） <output id="mmdArFilterBetaValue">1000</output></span>
        <input id="mmdArFilterBeta" type="range" min="0" max="2000" step="10" value="1000">
        <small>调高可减少快速移动时的滞后，也可能让运动中的抖动更明显。</small>
      </label>
      <p id="mmdArFilterApplyHint" class="mmd-ar-benchmark-live">修改后停止并重新开始定位，新参数才会应用。</p>
    `);
    // 两个面板直接复用 Basic 的控件，算法/校准参数保持同一来源。
    const basic = cheerio.load(await fs.readFile(path.join(PROJECT_ROOT, '3rd/mind-basic/index.html'), 'utf8'));
    for (const [selector, id] of [
      ['#mindBasicImuTitle', 'mmdArImuPanel'],
      ['section[aria-label="MindAR 定位质量"]', 'mmdArQualityPanel']
    ]) {
      const panel = selector.startsWith('#') ? basic(selector).closest('section') : basic(selector);
      if (panel.length !== 1) throw new Error(`Basic 定位面板缺失：${selector}`);
      panel.attr('id', id).removeAttr('aria-labelledby');
      panel.find('h2').remove();
      arPanel.append(basic.html(panel).replaceAll('mindBasic', 'mmdAr'));
    }
  {
    $('#displayMmdPhysicsFps').attr({ max: '180', value: '90' });
    $('#displayMmdPhysicsFpsValue').text('90 Hz');
    $('#displayMmdLightingPanel').prepend(`
      <label class="display-mmd-lighting-shadow">
        <input id="mmdArMotionPlayback" type="checkbox" checked>
        <span>播放动作</span>
      </label>
    `);
    $('#displayMmdPhysicsFps').closest('label').before(`
      <label class="display-mmd-lighting-shadow">
        <input id="mmdArPhysicsEnabled" type="checkbox" checked>
        <span>启用 PMX 物理（切换时重新加载模型）</span>
      </label>
    `);
    // 测试网页将现有动作与物理控件移到独立面板；复用原节点及 ID，灯光事件仍可读取物理参数。
    controls.find('#displayMmdLightingToggle').after(
      '<button id="mmdArMotionToggle" class="display-stage-button" type="button" aria-controls="mmdArMotionPanel" aria-expanded="false">动作</button>'
    );
    controls.find('#displayMmdLightingPanel').after(`
      <section id="mmdArMotionPanel" class="display-mmd-lighting-panel" hidden aria-label="角色动作与物理设置">
        <div class="display-mmd-lighting-header"><strong>动作与物理</strong></div>
      </section>
    `);
    const motionPanel = $('#mmdArMotionPanel');
    if (WEB_MODE) require('./web-reply-panel').appendPanels(motionPanel);
    if (WEB_MODE) motionPanel.append(`
      <div id="mmdArExpressionPanel">
        <button type="button" class="display-mmd-ar-action" data-expression-clear disabled>清除手动表情</button>
        <p class="mind-basic-note">自动读取当前 PMX。点击表情可叠加，再点取消；拖动强度会启用该项。手动选择覆盖同名动作表情，取消或清除后恢复动作自带的表情。</p>
        <div class="mmd-ar-expression-list" data-expression-list></div>
        <p class="mind-basic-note" role="status" aria-live="polite">模型加载后自动读取表情。</p>
      </div>
    `);
    if (WEB_MODE) motionPanel.append(`
      <div id="mmdArLipSyncPanel">
        <label class="display-mmd-lighting-field" for="mmdArLipSyncText"><span>口型文本</span></label>
        <textarea id="mmdArLipSyncText" rows="4" maxlength="800" spellcheck="false"
          style="width:100%;box-sizing:border-box;resize:vertical;background:#171a22;color:#eef2ff;border:1px solid #758bff88;border-radius:6px;padding:8px"
          placeholder="输入内容，例如：你好，我是米娅，很高兴见到你。" aria-describedby="mmdArLipSyncHint">你好，我是米娅，很高兴见到你。</textarea>
        <div class="display-mmd-ar-actions">
          <button type="button" class="display-mmd-ar-action" data-lipsync-play disabled>播放口型</button>
          <button type="button" class="display-mmd-ar-action" data-lipsync-stop disabled>停止口型</button>
        </div>
        <progress max="1" value="0" style="width:100%" aria-label="口型播放进度"></progress>
        <p id="mmdArLipSyncHint" class="mind-basic-note">无声文字口型预览，可与 VMD/MPL 动作同时播放。中文按拼音与估算节奏开合，标点处停顿；停止后恢复原有表情。最多400字符，不调用TTS或LLM。</p>
        <details><summary>嘴型映射</summary><div data-lipsync-mapping></div></details>
        <p class="mind-basic-note" role="status" aria-live="polite" style="overflow-wrap:anywhere">模型加载后自动匹配嘴型。</p>
      </div>
    `);
    if (WEB_MODE) motionPanel.append(`
      <div id="mmdArMplPanel">
        <label class="display-mmd-lighting-field" for="mmdArMplSource"><span>MPL 动作代码</span></label>
        <textarea id="mmdArMplSource" rows="12" maxlength="65536" spellcheck="false" autocapitalize="off"
          style="width:100%;box-sizing:border-box;resize:vertical;background:#171a22;color:#eef2ff;border:1px solid #758bff88;border-radius:6px;padding:8px;font:12px/1.5 monospace"
          aria-describedby="mmdArMplHint"></textarea>
        <div class="display-mmd-ar-actions">
          <button type="button" class="display-mmd-ar-action" data-mpl="play">编译并播放</button>
          <button type="button" class="display-mmd-ar-action" data-mpl="stop" disabled>停止并恢复原动作</button>
          <button type="button" class="display-mmd-ar-action" data-mpl="sample">填入动作＋表情示例</button>
          <button type="button" class="display-mmd-ar-action" data-mpl="expression-sample">填入表情示例</button>
          <button type="button" class="display-mmd-ar-action" data-mpl="save" disabled>下载 VMD</button>
        </div>
        <p id="mmdArMplHint" class="mind-basic-note">粘贴已生成的 MPL；时间为秒，角度为度。pose 内可写 morph "PMX原始表情名" 0.8;，权重0–1，也支持纯表情。名称见「表情」分类；手动选择优先。播放会替换当前动作，沿用当前模型的播放方式；骨骼动作需要标准 MMD 骨骼的 PMX。</p>
        <p class="mind-basic-note" role="status" aria-live="polite" style="white-space:pre-wrap;overflow-wrap:anywhere">点击编译时才加载编译器；代码不上传服务器。</p>
      </div>
    `);
    motionPanel.append($('#mmdArMotionPlayback').closest('label'));
    // 相机动作与角色动作并列：独立开关、独立只读进度，仅普通预览生效。
    motionPanel.append(`
      <label class="display-mmd-lighting-shadow">
        <input id="mmdArCameraMotionPlayback" type="checkbox" checked>
        <span>相机动作</span>
      </label>
    `);
    motionPanel.append(`
      <label class="display-mmd-lighting-field">
        <span>播放进度 <output id="mmdArMotionTime">--:-- / --:--</output></span>
        <progress id="mmdArMotionProgress" max="1" value="0" aria-label="动作播放进度"></progress>
      </label>
    `);
    motionPanel.append(`
      <label class="display-mmd-lighting-field">
        <span>相机动作进度 <output id="mmdArCameraMotionTime">--:-- / --:--</output></span>
        <progress id="mmdArCameraMotionProgress" max="1" value="0" aria-label="相机动作播放进度"></progress>
      </label>
    `);
    for (const id of ['mmdArPhysicsEnabled', 'displayMmdPhysicsFps', 'displayMmdRotationPhysicsLimit']) {
      motionPanel.append($(`#${id}`).closest('label'));
    }
    $('#displayMmdKeyColor').closest('label').before(`
      <label class="display-mmd-lighting-shadow">
        <input id="displayMmdKeyShadowEnabled" type="checkbox" checked>
        <span>主光阴影（默认开启）</span>
      </label>
    `);
    $('#displayArMotionEnabled').closest('label').find('span').text('独立重力旋转（角色锚点）');
    $('#displayArMotionEnabled').closest('label').after(`
      <label class="display-mmd-ar-field" for="mmdArGravityCameraEnabled">
        <span>显示摄像头画面</span>
        <input id="mmdArGravityCameraEnabled" type="checkbox" disabled>
      </label>
      <p id="mmdArGravityCameraMessage" class="mind-basic-note" role="status">启用重力旋转后，可选择显示摄像头画面。</p>
    `);
    $('#displayArMotionSensitivity').closest('label').replaceWith(`
      <label class="display-mmd-ar-field" for="mmdArGravityDeadZone">
        <span>重力死区 <output id="mmdArGravityDeadZoneValue">0.5°</output></span>
        <input id="mmdArGravityDeadZone" type="range" min="0" max="3" step="0.1" value="0.5">
      </label>
      <label class="display-mmd-ar-field" for="mmdArGravitySmoothing">
        <span>重力缓动 <output id="mmdArGravitySmoothingValue">20 ms</output></span>
        <input id="mmdArGravitySmoothing" type="range" min="0" max="500" step="10" value="20">
      </label>
    `);
    $('#displayArMotionRecenter').text('重力居中');
    $('#displayArMotionMessage').text('重力旋转关闭，手动旋转保留');
    WEB_PANEL_GROUPS.groupWebPanels($);
    WEB_PANEL_GROUPS.addLocalAssetPanel($);
    arPanel.find('[data-group-title="重力旋转"]').closest('.mmd-ar-panel-group')
      .find('.mmd-ar-panel-group-body').append(
        '<p class="mind-basic-note">首次姿态为零点，按完整重力方向旋转锚点，与手动角度叠加。死区忽略微小变化，缓动控制跟随速度；参数为 0 时关闭对应过滤。居中或关闭只重置重力层。</p>'
      );
    $('#displayArTargetPanelGroup1').append(`
      <label class="display-mmd-ar-field" for="mmdArInputMode">
        <span>视频输入</span>
        <select id="mmdArInputMode"><option value="camera">真实摄像头</option><option value="simulated">模拟摄像头</option></select>
      </label>
      <div id="mmdArSimControls" class="mmd-ar-sim-controls" hidden>
        <label class="display-mmd-ar-field" for="mmdArSimFile"><span>模拟摄像头拍到的图片</span><input id="mmdArSimFile" type="file" accept="image/*"></label>
        <div class="mmd-ar-sim-view-controls">
          <label class="mmd-ar-sim-slider mmd-ar-sim-zoom" for="mmdArSimZoom"><span>缩放 <output id="mmdArSimZoomValue">100%</output></span><input id="mmdArSimZoom" type="range" min="60" max="220" value="100"></label>
          <div class="mmd-ar-sim-middle">
            <label class="mmd-ar-sim-slider mmd-ar-sim-longitude" for="mmdArSimLongitude"><span>经度 <output id="mmdArSimLongitudeValue">0°</output></span><input id="mmdArSimLongitude" type="range" min="-60" max="60" value="0"></label>
            <div id="mmdArSimPreview" class="mmd-ar-sim-preview">
              <canvas id="mmdArSimCanvas" width="960" height="540" aria-label="拖动平移模拟摄像头画面"></canvas>
            </div>
            <label class="mmd-ar-sim-slider mmd-ar-sim-latitude" for="mmdArSimLatitude"><span>纬度 <output id="mmdArSimLatitudeValue">0°</output></span><input id="mmdArSimLatitude" type="range" min="-60" max="60" value="0"></label>
          </div>
          <label class="mmd-ar-sim-slider mmd-ar-sim-horizontal-rotation" for="mmdArSimHorizontalRotation"><span>水平旋转 <output id="mmdArSimHorizontalRotationValue">0°</output></span><input id="mmdArSimHorizontalRotation" type="range" min="0" max="360" value="0"></label>
        </div>
        <button id="mmdArSimReset" class="display-mmd-ar-action" type="button">重置透视</button>
        <p id="mmdArSimStatus" class="mmd-ar-benchmark-live" role="status">请选择一张本地图片。图片不会上传。</p>
      </div>
    `);
    $('#displayMmdShadowSource').closest('label').find('span').first().text('补光阴影');
    $('#displayMmdShadowSource option[value="none"]').text('补光无阴影');
    $('#displayMmdShadowSource option[value="key"]').text('补光沿用主光阴影');
    $('#displayMmdShadowSource option[value="fill"]').text('补光自己的阴影');
    $('#displayArTargetSelect').closest('label').after(`
      <a class="mmd-ar-official-target-link" href="${OFFICIAL_TARGET_PATH}" target="_blank" rel="noopener noreferrer">查看 MindAR 官方测试图（请在另一屏幕显示或打印）</a>
    `);
  }
  const webResizeSupport = `
      const stage = document.getElementById('displayStageLayers');
      let previousWidth = 0;
      let previousHeight = 0;
      let previousPixelRatio = 0;
      let previousCanvasScale = 0;
      let resizeFrame = 0;
      const applyStageSize = () => {
        resizeFrame = 0;
        const bounds = stage.getBoundingClientRect();
        const viewport = window.visualViewport;
        const width = Math.max(1, Math.round(viewport?.width || bounds.width));
        const height = Math.max(1, Math.round(viewport?.height || bounds.height));
        const isLandscape = width > height;
        stage.dataset.panelOrientation = isLandscape ? 'landscape' : 'portrait';
        const controls = stage.querySelector('.display-stage-lighting-control');
        const controlsWidth = Math.ceil(controls?.getBoundingClientRect().width || 48);
        const panelWidth = 'min(320px, max(1px, calc(' + width +
          'px - var(--mmd-ar-safe-inset-left) - var(--mmd-ar-safe-inset-right) - ' + (controlsWidth + 18) + 'px)))';
        stage.style.setProperty('--display-stage-panel-width', panelWidth);
        stage.style.setProperty('--display-stage-panel-max-height',
          'min(620px, calc(' + height + 'px - var(--mmd-ar-safe-inset-top) - var(--mmd-ar-safe-inset-bottom) - 24px))');
        const pixelRatio = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
        const canvasScale = window.MmdArRenderSettings?.canvasScale || 1;
        if (width !== previousWidth || height !== previousHeight || pixelRatio !== previousPixelRatio || canvasScale !== previousCanvasScale) {
          previousWidth = width;
          previousHeight = height;
          previousPixelRatio = pixelRatio;
          previousCanvasScale = canvasScale;
          window.DisplayMmd.resize(width, height);
        }
      };
      const scheduleStageSize = () => {
        if (!resizeFrame) resizeFrame = window.requestAnimationFrame(applyStageSize);
      };
      window.addEventListener('resize', scheduleStageSize, { passive: true });
      window.addEventListener('mmd-ar-render-settings', scheduleStageSize);
      window.visualViewport?.addEventListener('resize', scheduleStageSize, { passive: true });
      if (window.ResizeObserver) new ResizeObserver(scheduleStageSize).observe(stage);
      scheduleStageSize();
  `;

  if (!WEB_MODE) $('#displayArStartButton').before(`
    <p id="mmdArNativeBackend" role="status">定位后端：MindAR</p>
    <div id="mmdArNativeCalibrationPanel" hidden>
      <label>相机 / IMU 标定 JSON<input id="mmdArNativeCalibrationFile" type="file" accept="application/json,.json"></label>
      <button id="mmdArNativeCalibrationClear" type="button">清除原生标定</button>
      <p id="mmdArNativeCalibrationHint" role="status"></p>
    </div>
  `);

  WEB_CHARACTERS.addPanel($); require('./web-screen-lighting-build').panel($); require('./web-render-settings-build').panel($);
  let extraCharacterProfiles;
  const assets = [
    ...(await fs.readdir(path.join(SOURCE_PUBLIC, 'js'))).filter(name => /^mmd-.*\.mjs$/u.test(name)).map(name => [path.join(SOURCE_PUBLIC, 'js', name), path.join(GENERATED_ASSETS, 'js', name)]),
    ...SOURCE_ASSET_FILES.map((fileName) => [
      path.join(SOURCE_PUBLIC, 'js', fileName),
      path.join(GENERATED_ASSETS, 'js', fileName),
    ]),
    [path.join(SOURCE_PUBLIC, 'css/display-mmd.css'), path.join(GENERATED_ASSETS, 'css/display-mmd.css')],
    ...MINDAR_TEST_SOURCE_FILES.map((fileName) => [
      path.join(ANDROID_PROJECT, fileName),
      path.join(GENERATED_ASSETS, 'js', fileName),
    ]),
    ...['display-mmd-ar-aframe.js', 'display-mmd-ar-imu.js', 'display-mmd-ar-native.js'].map((fileName) => [
      path.join(ANDROID_PROJECT, fileName), path.join(GENERATED_ASSETS, 'js', fileName),
    ]),
    ...['display-mmd-ar-sim-camera.js', 'display-mmd-ar-gravity-camera.js'].map((fileName) => [
      path.join(ANDROID_PROJECT, fileName), path.join(GENERATED_ASSETS, 'js', fileName),
    ]),
    ...['mind-basic-imu.js', 'mind-basic-quality.js'].map((fileName) => [
      path.join(PROJECT_ROOT, '3rd/mind-basic', fileName), path.join(GENERATED_ASSETS, 'js', fileName),
    ]),
  ];
  for (const [sourcePath, destinationPath] of assets) {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    if (WEB_MODE && /\.(?:js|mjs|css)$/u.test(sourcePath)) {
      await fs.writeFile(destinationPath, webAssetText(await fs.readFile(sourcePath, 'utf8')), 'utf8');
    } else {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
  let xpbdPhysicsVersion = '', vertexClothUrl = '', webglUrl = '';
  {
    // UI 和 PMX runtime 必须导入同一个带内容指纹的 ESM，避免生成两个独立文件注册表。
    for (const fileName of ['web-local-assets.mjs', 'web-local-assets-ui.mjs']) {
      await fs.copyFile(path.join(__dirname, fileName), path.join(GENERATED_ASSETS, 'js', fileName));
    }
    const localAssetsVersion = (await hashFile(path.join(GENERATED_ASSETS, 'js/web-local-assets.mjs'))).sha256.slice(0, 12);
    const localAssetsUrl = `./web-local-assets.mjs?v=${localAssetsVersion}`;
    const gravityPath = path.join(GENERATED_ASSETS, 'js/web-gravity-filter.mjs');
    await fs.copyFile(path.join(__dirname, 'web-gravity-filter.mjs'), gravityPath);
    const gravityUrl = `./web-gravity-filter.mjs?v=${(await hashFile(gravityPath)).sha256.slice(0, 12)}`;
    const physicsWindPath = path.join(GENERATED_ASSETS, 'js/web-physics-wind.mjs');
    await fs.copyFile(path.join(__dirname, 'web-physics-wind.mjs'), physicsWindPath);
    const physicsWindUrl = `./web-physics-wind.mjs?v=${(await hashFile(physicsWindPath)).sha256.slice(0, 12)}`;
    const physicsRatePath = path.join(GENERATED_ASSETS, 'js/web-physics-rate.mjs');
    await fs.copyFile(path.join(__dirname, 'web-physics-rate.mjs'), physicsRatePath);
    const physicsRateUrl = `./web-physics-rate.mjs?v=${(await hashFile(physicsRatePath)).sha256.slice(0, 12)}`;
    ({ xpbdPhysicsVersion, webglUrl } = await stageXpbdPhysics({
      generatedAssets: GENERATED_ASSETS, physicsWindUrl, physicsRateUrl }));
    vertexClothUrl = await stageVertexCloth({ generatedAssets: GENERATED_ASSETS, physicsWindUrl, physicsRateUrl });
    const selectionPath = path.join(GENERATED_ASSETS, 'js/web-skeleton-selection.mjs');
    await fs.copyFile(path.join(__dirname, 'web-skeleton-selection.mjs'), selectionPath);
    const selectionUrl = `./web-skeleton-selection.mjs?v=${(await hashFile(selectionPath)).sha256.slice(0, 12)}`;
    const characterDepthPath = path.join(GENERATED_ASSETS, 'js/web-skeleton-character-depth.mjs');
    await fs.copyFile(path.join(__dirname, 'web-skeleton-character-depth.mjs'), characterDepthPath);
    const characterDepthUrl = `./web-skeleton-character-depth.mjs?v=${(await hashFile(characterDepthPath)).sha256.slice(0, 12)}`;
    const jointPath = path.join(GENERATED_ASSETS, 'js/web-joint-stiffness-debug.mjs');
    await fs.copyFile(path.join(__dirname, 'web-joint-stiffness-debug.mjs'), jointPath);
    const jointUrl = `./web-joint-stiffness-debug.mjs?v=${(await hashFile(jointPath)).sha256.slice(0, 12)}`;
    const skeletonPath = path.join(GENERATED_ASSETS, 'js/web-skeleton-debug.mjs');
    await fs.writeFile(skeletonPath, (await fs.readFile(path.join(__dirname, 'web-skeleton-debug.mjs'), 'utf8'))
      .replace('./web-joint-stiffness-debug.mjs', jointUrl).replace('./web-skeleton-selection.mjs', selectionUrl)
      .replace('./web-skeleton-character-depth.mjs', characterDepthUrl));
    const skeletonUrl = `./web-skeleton-debug.mjs?v=${(await hashFile(skeletonPath)).sha256.slice(0, 12)}`;
    const rigidBodyPath = path.join(GENERATED_ASSETS, 'js/web-rigid-body-debug.mjs');
    await fs.writeFile(rigidBodyPath, (await fs.readFile(path.join(__dirname, 'web-rigid-body-debug.mjs'), 'utf8'))
      .replace('./web-skeleton-debug.mjs', skeletonUrl));
    const rigidBodyUrl = `./web-rigid-body-debug.mjs?v=${(await hashFile(rigidBodyPath)).sha256.slice(0, 12)}`;
    // 复用灯光重置按钮时也恢复90Hz，只修改生成的测试副本。
    const physicsLightingPath = path.join(GENERATED_ASSETS, 'js/display-mmd-lighting.js');
    await fs.writeFile(physicsLightingPath, WEB_PHYSICS_RATE.addPhysicsRateLighting(
      await fs.readFile(physicsLightingPath, 'utf8')));
    const pmxHelperPath = path.join(GENERATED_ASSETS, 'js/mmd-pmx-helper.mjs');
    await fs.writeFile(pmxHelperPath, WEB_PHYSICS_LIFECYCLE.addContinuousMotionHelper(
      WEB_PHYSICS_SOLVER.addSolverHelper(
        WEB_PHYSICS_RATE.addPhysicsRateHelper(await fs.readFile(pmxHelperPath, 'utf8'), physicsRateUrl)),
      { webMode: WEB_MODE }));
    const pmxHelperUrl = `./mmd-pmx-helper.mjs?v=${(await hashFile(pmxHelperPath)).sha256.slice(0, 12)}`;
    const motionSwitchPath = path.join(GENERATED_ASSETS, 'js/web-motion-switch.mjs');
    await fs.writeFile(motionSwitchPath, addClothMotionSwitch((await fs.readFile(path.join(__dirname, 'web-motion-switch.mjs'), 'utf8'))
      .replace('./web-physics-rate.mjs', physicsRateUrl)));
    const motionSwitchUrl = `./web-motion-switch.mjs?v=${(await hashFile(motionSwitchPath)).sha256.slice(0, 12)}`;
    const localUiPath = path.join(GENERATED_ASSETS, 'js/web-local-assets-ui.mjs');
    await fs.writeFile(localUiPath, (await fs.readFile(localUiPath, 'utf8')).replace('./web-local-assets.mjs', localAssetsUrl));
    // 测试网页单独验证手机深度采样精度；三个阶段必须一致，避免模糊和合成再次丢失精度。
    const aoPath = path.join(GENERATED_ASSETS, 'js/display-pmx-ao.mjs');
    const aoSource = await fs.readFile(aoPath, 'utf8');
    // AO 优化已进入正式显示端，测试页直接复制同一 shader；旧版源码仍允许构建期注入。
    if (!aoSource.includes('edgeSourcePixel')) {
      const depthSampler = 'uniform sampler2D tDepth;';
      if (aoSource.split(depthSampler).length !== 4) throw new Error('测试网页 AO 深度采样器数量应为三处');
      const { addAoNormalPreview } = require('./web-ao-preview');
      const { alignAoDepthTexels } = require('./web-ao-texel');
      const { fixAoNormalPreviewEdges } = require('./web-ao-preview-edges');
      const { addAoBoundaryCorrection } = require('./web-ao-boundary');
      const alignedAoSource = alignAoDepthTexels(aoSource.replaceAll(depthSampler, 'uniform highp sampler2D tDepth;'));
      await fs.writeFile(aoPath, addAoBoundaryCorrection(fixAoNormalPreviewEdges(addAoNormalPreview(alignedAoSource))));
    }
    await require('./web-screen-lighting-build').stage(GENERATED_ASSETS);
    await require('./web-render-settings-build').stage(GENERATED_ASSETS);
    const aoVersion = (await hashFile(aoPath)).sha256.slice(0, 12);
    // 静态站点可能长时间缓存同路径 ESM；先给阴影模块加内容指纹，再计算 runtime 指纹。
    const pmxRuntimePath = path.join(GENERATED_ASSETS, 'js/display-pmx-runtime.js');
    // 两端测试副本共用高光注入，正式显示端源码保持原样。
    const specularPath = path.join(GENERATED_ASSETS, 'js/web-specular.mjs');
    await fs.copyFile(path.join(__dirname, 'web-specular.mjs'), specularPath);
    const specularVersion = (await hashFile(specularPath)).sha256.slice(0, 12);
    const lightingPath = path.join(GENERATED_ASSETS, 'js/display-pmx-lighting-mode.mjs');
    const lightingSource = await fs.readFile(lightingPath, 'utf8');
    const specularAnchor = 'if (!material?.isMMDToonMaterial) return false;';
    if (lightingSource.split(specularAnchor).length !== 2) throw new Error('测试高光未找到唯一材质初始化入口');
    await fs.writeFile(lightingPath, `import { prepareTestSpecular } from './web-specular.mjs?v=${specularVersion}';\n` +
      lightingSource.replace(specularAnchor, `${specularAnchor}\n    prepareTestSpecular(material);`));
    const lightingModeVersion = (await hashFile(path.join(GENERATED_ASSETS, 'js/display-pmx-lighting-mode.mjs'))).sha256.slice(0, 12);
    const runtimeSource = await fs.readFile(pmxRuntimePath, 'utf8');
    const lightingModeImport = "'./display-pmx-lighting-mode.mjs'";
    const aoImport = "'./display-pmx-ao.mjs'";
    if (runtimeSource.split(aoImport).length !== 2) throw new Error('测试网页未找到唯一的 AO 模块入口');
    if (!runtimeSource.includes(lightingModeImport)) throw new Error('测试网页未找到 PMX 灯光模块入口');
    const cameraProbeAnchor = 'const ambientOcclusion = createPmxAmbientOcclusion({ THREE, renderer, scene, camera, keyLight });';
    if (runtimeSource.split(cameraProbeAnchor).length !== 2) throw new Error('测试网页未找到唯一的 PMX 相机诊断锚点');
    // 只改测试网页/APK生成副本：面板只读当前投影，不把近远裁面写进正式显示端源码或灯光配置。
    const shadowPreviewPath = path.join(GENERATED_ASSETS, 'js/web-shadow-map-preview.mjs');
    await fs.copyFile(path.join(__dirname, 'web-shadow-map-preview.mjs'), shadowPreviewPath);
    const shadowPreviewVersion = (await hashFile(shadowPreviewPath)).sha256.slice(0, 12);
    const runtimeWithProbe = WEB_SHADOW_MAP.addShadowMapRuntime(WEB_FILL_FACING_RANGE.addFillFacingRuntime(WEB_SHADOW_BIAS.addShadowBiasRuntime(runtimeSource.replace(cameraProbeAnchor, `${cameraProbeAnchor}
    window.MmdArTestCameraProjection = () => camera.projectionMatrix.toArray();`))),
    `./web-shadow-map-preview.mjs?v=${shadowPreviewVersion}`);
    if (!runtimeWithProbe.includes('getMotionProgress: () =>')) throw new Error('正式 PMX runtime 缺少 VMD 进度入口');
    await fs.writeFile(pmxRuntimePath, WEB_PHYSICS_STABILITY.addStabilityRuntime(WEB_RIGID_BODY_DEBUG.addRigidBodyRuntime(WEB_CAMERA_MOTION.addCameraMotionRuntime(WEB_SKELETON_DEBUG.addSkeletonRuntime(WEB_PHYSICS_SUBSTEPS.addSubstepRuntime(WEB_PHYSICS_RATE.addPhysicsRateRuntime(
      WEB_LOCAL_ASSETS.addLocalRuntime(WEB_GRAVITY_MODE.addGravityRuntime(runtimeWithProbe, gravityUrl), localAssetsUrl, motionSwitchUrl), physicsRateUrl)), skeletonUrl), localAssetsUrl)
      .replace('./mmd-pmx-helper.mjs', pmxHelperUrl).replace(lightingModeImport,
      `'./display-pmx-lighting-mode.mjs?v=${lightingModeVersion}'`).replace(aoImport,
      `'./display-pmx-ao.mjs?v=${aoVersion}'`), rigidBodyUrl)));
    await fs.writeFile(pmxRuntimePath, WEB_CAMERA_MOTION.preserveCameraOnResize(await fs.readFile(pmxRuntimePath, 'utf8')));
    await fs.writeFile(pmxRuntimePath, WEB_PHYSICS_WIND.addWindRuntime(
      await fs.readFile(pmxRuntimePath, 'utf8'), physicsWindUrl));
    await fs.writeFile(pmxRuntimePath, WEB_PHYSICS_SOLVER.addSolverRuntime(await fs.readFile(pmxRuntimePath, 'utf8'), webglUrl));
    extraCharacterProfiles = await WEB_CHARACTERS.stageRuntime(GENERATED_ASSETS, { webMode: WEB_MODE }); await require('./web-editor-build').stage(GENERATED_ASSETS, { webMode: WEB_MODE });
    await require('./web-expressions-build').stageRuntime(GENERATED_ASSETS, { webMode: WEB_MODE });
    await require('./web-reply-build').stageRuntime(GENERATED_ASSETS, { webMode: WEB_MODE });
    await require('./web-lipsync-build').stageRuntime(GENERATED_ASSETS, { webMode: WEB_MODE });
    await fs.writeFile(pmxRuntimePath, await require('./web-production-shared').fingerprintProductionImports(
      await fs.readFile(pmxRuntimePath, 'utf8'), GENERATED_ASSETS));
    // 显示模块动态导入 PMX runtime；给该 URL 加内容指纹，避免旧缓存继续使用原阴影逻辑。
    const mmdScriptPath = path.join(GENERATED_ASSETS, 'js/display-mmd.js');
    const runtimeVersion = (await hashFile(path.join(GENERATED_ASSETS, 'js/display-pmx-runtime.js'))).sha256.slice(0, 12);
    const current = await fs.readFile(mmdScriptPath, 'utf8');
    const runtimeImport = "'./display-pmx-runtime.js'";
    if (!current.includes(runtimeImport)) throw new Error('测试网页未找到 PMX runtime 动态导入入口');
    if (!current.includes('getMotionProgress: () =>')) throw new Error('正式显示模块缺少 VMD 进度入口');
    // 相机动作显示注入依赖本地资源注入产出的入口文本，必须排在其后。
    await fs.writeFile(mmdScriptPath, WEB_PHYSICS_STABILITY.addStabilityDisplay(WEB_RIGID_BODY_DEBUG.addRigidBodyDisplay(WEB_CAMERA_MOTION.addCameraMotionDisplay(WEB_SKELETON_DEBUG.addSkeletonDisplay(WEB_PHYSICS_RATE.addPhysicsRateDisplay(WEB_LOCAL_ASSETS.addLocalDisplay(WEB_GRAVITY_MODE.addGravityDisplay(current), localAssetsUrl)))))
      .replace(runtimeImport, `'./display-pmx-runtime.js?v=${runtimeVersion}'`)));
    await fs.writeFile(mmdScriptPath, WEB_PHYSICS_WIND.addWindDisplay(await fs.readFile(mmdScriptPath, 'utf8')));
    await fs.writeFile(mmdScriptPath, WEB_PHYSICS_SOLVER.addSolverDisplay(await fs.readFile(mmdScriptPath, 'utf8')));
    await fs.writeFile(mmdScriptPath, WEB_CHARACTERS.patchDisplay(await fs.readFile(mmdScriptPath, 'utf8')));
    const arScriptPath = path.join(GENERATED_ASSETS, 'js/display-mmd-ar.js');
    await fs.writeFile(arScriptPath, WEB_GRAVITY_MODE.addGravityControls(await fs.readFile(arScriptPath, 'utf8')));
  }
  await fs.cp(VENDOR_THREE_SOURCE, path.join(GENERATED_ASSETS, 'js/vendor/three'), { recursive: true });
  const webExpressionLoaderVersion = await require('./web-expressions-build').stageVendor(GENERATED_ASSETS, { webMode: WEB_MODE });
  // MPL表情编码依赖已复制的MMDParser，再生成Worker/UI与入口指纹。
  await require('./web-mpl-build').stage(GENERATED_ASSETS, { webMode: WEB_MODE });
  await require('./web-reply-build').stage(GENERATED_ASSETS, { webMode: WEB_MODE });
  let webPhysicsHelperVersion = '';
  {
    // 给两端测试副本补齐 native 物理所有权；依赖和 importmap 逐级带指纹，避免继续加载旧缓存。
    const animationDirectory = path.join(GENERATED_ASSETS, 'js/vendor/three/animation');
    const physicsPath = path.join(animationDirectory, 'MMDPhysics.js');
    const helperPath = path.join(animationDirectory, 'MMDAnimationHelper.js');
    await fs.writeFile(physicsPath, WEB_PHYSICS_STABILITY.addPhysicsStability(
        WEB_PHYSICS_SUBSTEPS.addPhysicsSubsteps(WEB_PHYSICS_LIFECYCLE.addPhysicsLifecycle(await fs.readFile(physicsPath, 'utf8')))));
    const windVersion = (await hashFile(path.join(GENERATED_ASSETS, 'js/web-physics-wind.mjs'))).sha256.slice(0, 12);
    await fs.writeFile(physicsPath, WEB_PHYSICS_WIND.addPhysicsWind(
      await fs.readFile(physicsPath, 'utf8'), `../../../web-physics-wind.mjs?v=${windVersion}`));
    const physicsVersion = (await hashFile(physicsPath)).sha256.slice(0, 12);
    await fs.writeFile(helperPath, WEB_PHYSICS_LIFECYCLE.addAnimationLifecycle(
      await fs.readFile(helperPath, 'utf8'), `../animation/MMDPhysics.js?v=${physicsVersion}`));
    await fs.writeFile(helperPath, WEB_PHYSICS_SOLVER.addSolverAnimationHelper(
      await fs.readFile(helperPath, 'utf8'), `../../../web-xpbd-physics.mjs?v=${xpbdPhysicsVersion}`, vertexClothUrl, webglUrl.replace('./', '../../../')));
    webPhysicsHelperVersion = (await hashFile(helperPath)).sha256.slice(0, 12);
  }

  const scriptVersion = new Map();
  {
    for (const fileName of ['web-render-settings.mjs', 'web-screen-lighting-panel.mjs', 'web-character-panel.mjs', 'display-mmd-settings.js', 'web-local-assets-ui.mjs', 'display-mmd.js', 'display-mmd-lighting.js', 'display-mmd-ar-benchmark.js', 'display-mmd-ar-sim-camera.js', 'display-mmd-ar-gravity-camera.js', 'display-mmd-ar-aframe.js', 'display-mmd-ar-imu.js', 'display-mmd-ar-native.js', 'mind-basic-imu.js', 'mind-basic-quality.js', 'display-mmd-ar.js']) {
      scriptVersion.set(fileName, (await hashFile(path.join(GENERATED_ASSETS, 'js', fileName))).sha256.slice(0, 12));
    }
  }
  const scriptUrl = (fileName) => `/js/${fileName}${scriptVersion.has(fileName) ? `?v=${scriptVersion.get(fileName)}` : ''}`;

  const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#111318">
  <title>MMD AR 独立测试</title>
  <link rel="stylesheet" href="/css/display-mmd.css">
  <script src="/js/vendor/aframe-1.5.0/aframe.min.js"></script><script src="/js/vendor/mind-ar-1.2.5/mindar-image-aframe.prod.js"></script>
  <script type="importmap">{"imports":{"three":"/js/vendor/three/three.module.js","three/addons/":"/js/vendor/three/"${`,"three/addons/animation/MMDAnimationHelper.js":"/js/vendor/three/animation/MMDAnimationHelper.js?v=${webPhysicsHelperVersion}"`}${webExpressionLoaderVersion ? `,"three/addons/loaders/MMDLoader.js":"/js/vendor/three/loaders/MMDLoader.js?v=${webExpressionLoaderVersion}"` : ''}}}</script>
  <style>
    :root {
      color-scheme: dark;
      --bg-primary: #111318;
      --bg-secondary: #20242e;
      --border-color: #475066;
      --text-primary: #f4f6fb;
      --text-secondary: #c2c8d4;
      --accent-color: #758bff;
      --danger-color: #ff7474;
      --mmd-ar-safe-inset-top: 0px;
      --mmd-ar-safe-inset-right: 0px;
      --mmd-ar-safe-inset-bottom: 0px;
      --mmd-ar-safe-inset-left: 0px;
    }
    * { box-sizing: border-box; }
    button, input, select, textarea { -webkit-tap-highlight-color: transparent; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; }
    body { background: radial-gradient(ellipse at 50% 42%, #303442 0%, #171920 58%, #101116 100%); color: var(--text-primary); font: 14px/1.45 system-ui, sans-serif; touch-action: manipulation; }
    /* 三个面板入口在短屏上占用三行，预留额外一行高度给面板内部滚动。 */
    .display-stage-layers { --display-stage-panel-max-height: min(620px, calc(100dvh - var(--display-stage-panel-top-gap) - var(--mmd-ar-safe-inset-top) - var(--mmd-ar-safe-inset-bottom) - 72px)); }
    /* 校准弹窗只占真实可视区；短屏时收缩预览并允许弹窗内部滚动。 */
    #displayArCalibration { position: fixed; inset: 0; width: 100vw; height: 100dvh; min-height: 0; overflow: hidden; }
    #displayArCalibration .display-mmd-ar-dialog { width: min(920px, 100%); max-height: calc(100dvh - max(12px, var(--display-safe-inset-top)) - max(12px, var(--display-safe-inset-bottom))); min-height: 0; overscroll-behavior: contain; }
    #displayArCalibration .display-mmd-ar-preview { min-height: 0; max-height: min(50dvh, 480px); }
    #displayArCalibration .display-mmd-ar-camera, #displayArCalibration .display-mmd-ar-canvas { max-height: min(50dvh, 480px); }
    .display-mmd-lighting-panel, .display-mmd-ar-panel { touch-action: pan-y; }
    .display-stage-layers .display-stage-lighting-control { top: calc(var(--mmd-ar-safe-inset-top) + 14px); }
    .display-stage-layers .display-stage-lighting-control > .display-mmd-lighting-panel,
    .display-stage-layers .display-stage-lighting-control > .display-mmd-lighting-panel,
    .display-stage-layers .display-stage-lighting-control > .display-mmd-ar-panel { position: absolute; top: 0; right: calc(100% + 4px); z-index: 2; }
    .display-stage-layers { z-index: 10; }
    .display-mmd-layer { background: transparent; }
    .display-mmd-status { --bg-secondary: #20242e; --border-color: #475066; --text-secondary: #c2c8d4; }
    .display-stage-lighting-control { top: calc(var(--mmd-ar-safe-inset-top) + 14px); right: calc(var(--mmd-ar-safe-inset-right) + 14px); }
    .mmd-ar-test-label { position: fixed; left: calc(var(--mmd-ar-safe-inset-left) + 14px); top: calc(var(--mmd-ar-safe-inset-top) + 14px); z-index: 20; padding: 8px 12px; border: 1px solid #ffffff2b; border-radius: 12px; background: #171a22c9; color: #e8ebf4; font-size: 12px; pointer-events: none; }
    @media (orientation: portrait) {
      .mmd-ar-test-label { right: calc(var(--mmd-ar-safe-inset-right) + 82px); }
    }
    .display-mmd-ar-background { z-index: 2; }
    .mmd-ar-benchmark { display: grid; gap: 8px; margin: 4px 0 12px; padding: 10px; border: 1px solid #758bff66; border-radius: 10px; background: color-mix(in srgb, #171a22 var(--display-mmd-panel-opacity, 50%), transparent); }
    .mmd-ar-benchmark-live { margin: 0; color: #d3d9e8; font-size: 12px; line-height: 1.45; }
    .mmd-ar-benchmark-results { display: grid; gap: 6px; }
    .mmd-ar-benchmark-result { display: grid; gap: 3px; color: #d3d9e8; font-size: 11px; }
    .mmd-ar-benchmark-result strong { color: #ffffff; font-size: 12px; }
    .mmd-ar-loading-progress { position: fixed; z-index: 90; left: max(10vw, 14px); right: max(10vw, 14px); bottom: calc(var(--mmd-ar-safe-inset-bottom) + 48px); max-width: 440px; margin: 0 auto; padding: 10px 14px; border: 1px solid #ffffff40; border-radius: 12px; background: #171a22eb; color: #f4f6fb; font-size: 13px; pointer-events: none; }
    .mmd-ar-loading-progress[hidden] { display: none; }
    .mmd-ar-loading-track { height: 6px; margin-top: 8px; overflow: hidden; border-radius: 999px; background: #ffffff35; }
    .mmd-ar-loading-fill { width: 0; height: 100%; border-radius: inherit; background: #758bff; transition: width 160ms ease-out; }
    ${`
    .mmd-ar-loading-progress[data-indeterminate="true"] .mmd-ar-loading-fill { animation: mmd-ar-loading-busy 1.1s linear infinite; }
    .mmd-ar-loading-progress[data-state="error"] { border-color: #ef7777; }
    @keyframes mmd-ar-loading-busy { from { transform: translateX(-100%); } to { transform: translateX(400%); } }
    @media (prefers-reduced-motion: reduce) { .mmd-ar-loading-progress[data-indeterminate="true"] .mmd-ar-loading-fill { animation: none; } }
    `}

    .mmd-ar-official-target-link { display: block; width: fit-content; max-width: 100%; padding: 6px 0; color: #bfcaff; text-decoration: underline; overflow-wrap: anywhere; }
    ${`
    .display-stage-layers { --display-mmd-panel-opacity: 50%; }
    #mmdArGravityCameraVideo { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 1; pointer-events: none; }
    #mmdArGravityCameraVideo[hidden] { display: none; }
    .mmd-ar-gravity-hide-camera #mmdArAframeHost video { opacity: 0; }
    .mmd-ar-sim-controls { display: grid; gap: 10px; margin-top: 10px; }
    .mmd-ar-sim-controls[hidden] { display: none; }
    .mmd-ar-sim-view-controls { display: grid; gap: 7px; min-width: 0; }
    .mmd-ar-sim-middle { display: flex; align-items: stretch; gap: 8px; min-width: 0; }
    .mmd-ar-sim-slider { display: flex; gap: 6px; color: #e8ebf4; font-size: 12px; }
    .mmd-ar-sim-slider output { color: #bfcaff; font-variant-numeric: tabular-nums; }
    .mmd-ar-sim-slider input { accent-color: #758bff; }
    .mmd-ar-sim-zoom, .mmd-ar-sim-horizontal-rotation { align-items: center; }
    .mmd-ar-sim-zoom input, .mmd-ar-sim-horizontal-rotation input { flex: 1; min-width: 0; }
    .mmd-ar-sim-longitude, .mmd-ar-sim-latitude { flex-direction: column; align-items: center; justify-content: center; min-width: 42px; }
    .mmd-ar-sim-longitude input, .mmd-ar-sim-latitude input { flex: none; height: 100px; min-height: 0; max-height: 100%; width: 20px; writing-mode: vertical-lr; direction: rtl; }
    .mmd-ar-sim-preview { position: relative; flex: 1; min-width: 0; aspect-ratio: 16 / 9; overflow: hidden; border: 1px solid #758bff; border-radius: 8px; background: #555; }
    #mmdArSimCanvas { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
    #mmdArSimCanvas:active { cursor: grabbing; }
    #mmdArAframeHost { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    #mmdArAframeHost[hidden] { display: none; }
    #mmdArAframeHost video { z-index: 2 !important; pointer-events: none; }
    #mmdArAframeScene { position: absolute; inset: 0; z-index: 5; width: 100%; height: 100%; background: transparent !important; pointer-events: none; }
    #mmdArAframeScene canvas { background: transparent !important; pointer-events: none; }
    `}
    ${WEB_PANEL_GROUPS.WEB_PANEL_GROUP_CSS}
    body.mmd-native-slam-live, body.mmd-native-slam-live #displayStage,
    body.mmd-native-slam-live #displayStageLayers, body.mmd-native-slam-live .display-stage {
      background: transparent !important;
    }
    body.mmd-native-slam-live #displayArTrackingVideo,
    body.mmd-native-slam-live #mmdArAframeHost { display: none !important; }
    #mmdArAframeHost { position: absolute; inset: 0; pointer-events: none; }
    #mmdArAframeHost[hidden] { display: none; }
    #mmdArAframeHost video { z-index: 2 !important; pointer-events: none; }
    #mmdArAframeScene { position: absolute; inset: 0; background: transparent !important; }
    #mmdArNativeCalibrationPanel[hidden] { display: none; }
  </style>
</head>
<body>
  ${'<video id="mmdArGravityCameraVideo" autoplay muted playsinline hidden aria-label="重力模式摄像头背景"></video>'}
  <div id="mmdArLoadingProgress" class="mmd-ar-loading-progress" role="progressbar" aria-label="${'模型与动作加载进度'}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden>
    <span id="mmdArLoadingText">准备模型 0%</span>
    <div class="mmd-ar-loading-track"><div id="mmdArLoadingFill" class="mmd-ar-loading-fill"></div></div>
  </div>
  ${arTrackingVideo.toString()}
  <div id="displayStageLayers" class="display-stage-layers" aria-label="MMD AR 测试舞台">
    ${mmdLayer.toString()}
    <div id="displayInteractionLayer" class="display-interaction-layer">
      ${controls.toString()}
    </div>
    ${calibration.toString()}
    <div id="mmdArAframeHost" hidden aria-label="MindAR 定位图蓝色标记">
      <a-scene id="mmdArAframeScene" embedded mindar-image="imageTargetSrc: ; autoStart: false; uiLoading: no; uiScanning: no; uiError: no;"
        renderer="colorManagement: true; alpha: true" vr-mode-ui="enabled: false" device-orientation-permission-ui="enabled: false">
        <a-entity id="mmdArAframeCameraRig">
          <a-camera position="0 0 0" look-controls="enabled: false" wasd-controls="enabled: false"></a-camera>
        </a-entity>
        <a-entity id="mmdArAframeAnchor" mindar-image-target="targetIndex: 0"></a-entity>
        <a-entity id="mmdArAframeWorldTarget" visible="false">
          <a-plane id="mmdArAframeTargetRect" width="1" height="1" material="color: #229cff; opacity: 0.35; transparent: true; side: double" position="0 0 0"></a-plane>
          <a-plane id="mmdArAframeCrossH" width="0.22" height="0.009" material="color: #d8f2ff; side: double" position="0 0 0.01"></a-plane>
          <a-plane id="mmdArAframeCrossV" width="0.009" height="0.22" material="color: #d8f2ff; side: double" position="0 0 0.01"></a-plane>
        </a-entity>
      </a-scene>
    </div>
  </div>
  ${'<script>window.MmdArTestWebFillShadow = true;</script>'}
  <script src="${scriptUrl('display-mmd-settings.js')}"></script>
  <script src="${scriptUrl('display-mmd.js')}"></script>
  <script src="${scriptUrl('display-mmd-lighting.js')}"></script>
  <script>
    window.MmdArTestMindArOnly = true;
    window.MmdArLocationMarkerTest = true;
    window.MmdArTestAframeMode = true;
  </script>
  <script src="/js/display-mmd-ar-benchmark-compiler.js"></script>
  <script src="/js/display-mmd-ar-benchmark-metrics.js"></script>
  <script src="${scriptUrl('display-mmd-ar-benchmark.js')}"></script>
  ${`<script src="${scriptUrl('display-mmd-ar-sim-camera.js')}"></script>`}
  ${`<script src="${scriptUrl('display-mmd-ar-gravity-camera.js')}"></script>`}
  <script src="${scriptUrl('mind-basic-imu.js')}"></script>
  <script src="${scriptUrl('mind-basic-quality.js')}"></script>
  <script src="${scriptUrl('display-mmd-ar-imu.js')}"></script>
  <script src="${scriptUrl('display-mmd-ar-aframe.js')}"></script>
  <script src="${scriptUrl('display-mmd-ar-native.js')}"></script>
  <script>
    // 独立APK与网页共用原定位图，正式显示端不接收此内置目标配置。
    window.DisplayMmdArBuiltInTargets = async () => {
      const response = await fetch('${OFFICIAL_TARGET_PATH}');
      if (!response.ok) throw new Error('官方测试图 HTTP ' + response.status);
      const referenceImageBlob = await response.blob();
      if (referenceImageBlob.type !== 'image/png' || referenceImageBlob.size !== ${OFFICIAL_TARGET_SIZE}) {
        throw new Error('官方测试图格式或大小不符');
      }
      return [{
        targetId: 'builtin:mindar-official-card',
        name: 'MindAR 官方示例',
        readOnly: true,
        referenceImageBlob,
        selectedQuad: [
          { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
        ],
        physicalWidthMm: null,
        compiledTargetData: null,
        updatedAt: 0
      }];
    };
  </script>
  <script src="${scriptUrl('display-mmd-ar.js')}"></script>
  ${`<script type="module" src="${scriptUrl('web-local-assets-ui.mjs')}"></script><script type="module" src="${scriptUrl('web-character-panel.mjs')}"></script><script type="module" src="${scriptUrl('web-screen-lighting-panel.mjs')}"></script><script type="module" src="${scriptUrl('web-render-settings.mjs')}"></script>`}
  <script>
    ${WEB_PANEL_GROUPS.WEB_PANEL_GROUP_JS}
    (() => {
      const controls = new Map([
        ['displayMmdLightingToggle', 'displayMmdLightingPanel'],
        ['mmdArMotionToggle', 'mmdArMotionPanel'],
        ['displayArTargetToggle', 'displayArTargetPanel']
      ]);
      const findControl = (target) => {
        if (!(target instanceof Element)) return null;
        const button = target.closest('#displayMmdLightingToggle, #mmdArMotionToggle, #displayArTargetToggle');
        return button && controls.has(button.id) ? button : null;
      };

      document.addEventListener('pointerdown', (event) => {
        const button = findControl(event.target);
        const target = event.target instanceof Element ? event.target : null;
        const inControlCorner = event.clientX >= window.innerWidth * 0.55 && event.clientY <= window.innerHeight * 0.5;
        if (!button && !inControlCorner) return;
        const bounds = button ? button.getBoundingClientRect() : null;
        console.info(
          '[MmdArTest][touch] pointerdown id=' + (button ? button.id : 'none') +
          ' target=' + (target ? target.tagName + '#' + target.id : 'unknown') +
          ' point=' + event.clientX + ',' + event.clientY +
          (bounds ? ' bounds=' + Math.round(bounds.left) + ',' + Math.round(bounds.top) + ',' +
            Math.round(bounds.right) + ',' + Math.round(bounds.bottom) : '')
        );
      }, true);

      document.addEventListener('click', (event) => {
        const button = findControl(event.target);
        const target = event.target instanceof Element ? event.target : null;
        const inControlCorner = event.clientX >= window.innerWidth * 0.55 && event.clientY <= window.innerHeight * 0.5;
        if (!button && !inControlCorner) return;
        console.info(
          '[MmdArTest][touch] click-target id=' + (button ? button.id : 'none') +
          ' target=' + (target ? target.tagName + '#' + target.id : 'unknown') +
          ' point=' + event.clientX + ',' + event.clientY
        );
        if (!button) return;
        window.setTimeout(() => {
          const panel = document.getElementById(controls.get(button.id));
          console.info(
            '[MmdArTest][touch] click id=' + button.id +
            ' panelOpen=' + Boolean(panel && !panel.hidden)
          );
        }, 0);
      }, true);
    })();

    document.addEventListener('DOMContentLoaded', () => {
      const canvas = document.getElementById('displayMmdCanvas');
      const status = document.getElementById('displayMmdStatus');
      ${`window.DisplayMmd.init({ canvas, status, onLoadProgress: (detail) => {
        // 默认模型与物理重载复用本地选择模块的进度视图，避免两套收起定时器互相覆盖。
        document.dispatchEvent(new CustomEvent('mmd-ar-load-progress', { detail }));
      } });`}
      window.DisplayMmd.setVisible(true);
      window.DisplayMmd.setPointerEnabled(true);
      ${webResizeSupport}
    }, { once: true });
  </script>
</body>
</html>`;
  const generatedPage = webAssetText(page);
  // 两端共用灯光脚本；缺少任一必需节点会导致初始化静默退出，必须在出包前阻止。
  const generatedDom = cheerio.load(generatedPage);
  const seenIds = new Set();
  generatedDom('[id]').each((_index, node) => {
    const id = generatedDom(node).attr('id');
    if (seenIds.has(id)) throw new Error(`测试页面重复控件ID：${id}`);
    seenIds.add(id);
  });
  const lightingSource = await fs.readFile(path.join(GENERATED_ASSETS, 'js/display-mmd-lighting.js'), 'utf8');
  const requiredIds = new Set([...lightingSource.matchAll(/byId\('([^']+)'\)/gu)].map((match) => match[1]));
  for (const id of WEB_PHYSICS_SOLVER.SOLVER_CONTROL_IDS) requiredIds.add(id);
  for (const id of ['mmdArMotionToggle', 'mmdArMotionPanel', 'mmdArLocalAssets',
    'mmdArCameraMotionPlayback', 'mmdArGravityCameraEnabled', 'mmdArSkeletonEnabled', 'mmdArRigidBodyEnabled',
    'mmdArRigidBodyLegend', 'mmdArRigidBodyControls', 'mmdArPhysicsStabilityReference',
    'mmdArFillFacingStart', 'mmdArFillFacingEnd', 'mmdArSkeletonOccludedOpacity', 'mmdArSkeletonJointParametersEnabled', 'mmdArSkeletonJointLegend', 'mmdArSkeletonJointDetails']) requiredIds.add(id);
  for (const id of ['mmdArShadowMapSize', 'mmdArShadowMapSizeValue', 'mmdArShadowMapPreviewEnabled',
    'mmdArShadowMapPreviewRows', 'mmdArShadowMapKeyStatus', 'mmdArShadowMapKeyCanvas',
    'mmdArShadowMapFillStatus', 'mmdArShadowMapFillCanvas',
    'mmdArShadowCameraScale', 'mmdArShadowCameraScaleValue']) requiredIds.add(id);
  for (const id of requiredIds) {
    if (!seenIds.has(id)) throw new Error(`测试页面缺少必需控件：${id}`);
  }
  if (!generatedPage.includes('window.MmdArTestMindArOnly = true;')
    || generatedPage.includes('display-mmd-image-tracker.js')
    || generatedPage.includes('<option value="current">')) {
    throw new Error('MindAR-only 测试页仍包含旧跟踪器或算法切换控件');
  }
  await fs.mkdir(GENERATED_ASSETS, { recursive: true });
  await fs.writeFile(path.join(GENERATED_ASSETS, 'index.html'), generatedPage, 'utf8');

  const profile = createStaticMmdResourceProfile();
  const payload = { status: 'success', resources: [{ ...profile, name: '米娅' }, ...extraCharacterProfiles] };
  await fs.writeFile(path.join(GENERATED_ASSETS, 'mmd-resources.json'), `${webAssetText(JSON.stringify(payload))}\n`, 'utf8');
}

async function stageModelAssets() {
  for (const file of STATIC_MMD_RELEASE.files) {
    const cachePath = await ensureModelFile(file);
    const stagedPath = path.join(GENERATED_ASSETS, file[0]);
    await fs.mkdir(path.dirname(stagedPath), { recursive: true });
    await fs.copyFile(cachePath, stagedPath);
  }
}

async function stageOfficialTargetAsset() {
  const source = path.join(ANDROID_PROJECT, 'assets', OFFICIAL_TARGET_FILE);
  if (!await isVerifiedFile(source, OFFICIAL_TARGET_SIZE, OFFICIAL_TARGET_SHA256)) {
    throw new Error(`MindAR 官方示例图校验失败：${source}`);
  }
  const destination = path.join(GENERATED_ASSETS, 'assets', OFFICIAL_TARGET_FILE);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function stageMindArAssets() {
  const destination = path.join(GENERATED_ASSETS, 'js/vendor', `mind-ar-${MINDAR_VERSION}`);
  const integrity = new Map();
  for (const item of MINDAR_FILES) {
    const [fileName, expectedSize, expectedHash] = item;
    const cachePath = await ensureMindArFile(item);
    const destinationPath = fileName === 'mind-ar-LICENSE'
      ? path.join(GENERATED_ASSETS, 'licenses/mind-ar-LICENSE')
      : path.join(destination, fileName);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(cachePath, destinationPath);
    integrity.set(fileName, { size: expectedSize, hash: expectedHash });
  }
  return integrity;
}

async function stageLocalArVendor() {
  // APK与网页带齐A-Frame、MindAR和官方目标文件，运行时不依赖公网CDN。
  for (const resource of LOCAL_AR_RESOURCES) {
    const source = path.join(SOURCE_PUBLIC, resource.path);
    if (!verifyLocalArBuffer(await fs.readFile(source), resource)) {
      throw new Error(`本地 AR 资源校验失败：${source}`);
    }
  }
  for (const directory of ['aframe-1.5.0', 'mind-ar-1.2.5']) {
    const relativePath = path.join('js/vendor', directory);
    await fs.cp(path.join(SOURCE_PUBLIC, relativePath), path.join(GENERATED_ASSETS, relativePath), { recursive: true });
  }
  await fs.copyFile(path.join(SOURCE_PUBLIC, 'assets/mindar-official-card.mind'),
    path.join(GENERATED_ASSETS, 'assets/mindar-official-card.mind'));
}

async function prepareNativeSlam() {
  await new Promise((resolve, reject) => {
    const child = spawn('python3', [path.join(ANDROID_PROJECT, 'prepare-native-slam.py')], { stdio: 'inherit', cwd: PROJECT_ROOT });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`原生SLAM依赖准备失败: ${code}`)));
  });
}

function runGradle() {
  return new Promise((resolve, reject) => {
    const wrapper = path.join(PROJECT_ROOT, 'src/apps/android-display/gradlew');
    const args = ['--no-daemon', '-p', ANDROID_PROJECT, ':app:assembleDebug'];
    const processHandle = spawn(wrapper, args, { stdio: 'inherit', cwd: PROJECT_ROOT });
    processHandle.once('error', reject);
    processHandle.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Gradle 构建失败，exit=${code ?? 'null'} signal=${signal || 'none'}`));
    });
  });
}

async function publishLocalArtifact(sourceApk) {
  await fs.mkdir(path.dirname(OUTPUT_APK), { recursive: true });
  const temporaryOutput = `${OUTPUT_APK}.tmp-${process.pid}`;
  await fs.copyFile(sourceApk, temporaryOutput);
  await fs.rename(temporaryOutput, OUTPUT_APK);
  const artifact = await hashFile(OUTPUT_APK);
  return { ...artifact, path: OUTPUT_APK };
}

async function main() {
  await fs.rm(GENERATED_ASSETS, { recursive: true, force: true });
  if (STATIC_MMD_RELEASE.files.length === 0) throw new Error('默认 PMX 清单为空');
  await stageTextAssets();
  await stageOfficialTargetAsset();
  await stageModelAssets();
  await stageLocalArVendor();
  if (!WEB_MODE) await stageMindArAssets();

  if (WEB_MODE) {
    log(`HTTPS 静态网页资源已生成：${GENERATED_ASSETS}`);
    return;
  }

  log('开始构建独立 Android APK');
  await prepareNativeSlam();
  await runGradle();
  const builtApk = path.join(APP_PROJECT, 'build/outputs/apk/debug/app-debug.apk');
  const metadataPath = path.join(APP_PROJECT, 'build/outputs/apk/debug/output-metadata.json');
  const buildMetadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  if (buildMetadata.applicationId !== 'com.aasc.mmdartest') {
    throw new Error(`APK applicationId 错误：${buildMetadata.applicationId || 'unknown'}`);
  }
  const inspection = await inspectApk(builtApk, { assetRoot: GENERATED_ASSETS, appProject: APP_PROJECT,
    modelFiles: STATIC_MMD_RELEASE.files, mindArFiles: MINDAR_FILES, mindArVersion: MINDAR_VERSION });
  const artifact = await publishLocalArtifact(builtApk);
  log(`APK 校验通过：applicationId=${buildMetadata.applicationId}，${inspection.modelFiles} 个模型文件，${inspection.webFiles} 个网页文件及原生SLAM资源，${artifact.size} bytes`);
  log(`SHA-256：${artifact.sha256}`);
  log(`输出：${artifact.path}`);
}

main().catch((error) => {
  process.stderr.write(`[mmd-ar-${WEB_MODE ? 'web' : 'apk'}] 构建失败：${error.stack || error.message}\n`);
  process.exitCode = 1;
});
