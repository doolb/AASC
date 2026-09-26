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
const yauzl = require('yauzl');
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
const WEB_PANEL_GROUPS = WEB_MODE ? require('./web-panel-groups') : null;
// 网页构建产物可挂载在任意目录；资源统一相对页面目录，APK 仍使用原本地路由。
const WEB_BASE_PATH = '.';
const GENERATED_ASSETS = WEB_MODE
  ? path.join(ANDROID_PROJECT, 'web-dist')
  : path.join(APP_PROJECT, 'build/generated/assets/www');
const MODEL_CACHE = path.join(ANDROID_PROJECT, 'model-cache', STATIC_MMD_RELEASE.version);
const OUTPUT_APK = path.join(ANDROID_PROJECT, 'output/aasc-mmd-ar-test.apk');
const MINDAR_VERSION = '1.2.5';
const MINDAR_CACHE = path.join(ANDROID_PROJECT, 'model-cache', `mind-ar-${MINDAR_VERSION}`);
const MINDAR_PUBLIC_BASE_URL = `https://cdn.jsdelivr.net/npm/mind-ar@${MINDAR_VERSION}`;
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
  'display-mmd-ar-benchmark-compiler.js',
  'display-mmd-ar-benchmark-metrics.js',
  'display-mmd-ar-benchmark.js',
]);
const SOURCE_ASSET_FILES = Object.freeze([
  'display-mmd.js',
  'display-mmd-lighting.js',
  'display-mmd-image-tracker.js',
  'display-mmd-ar.js',
  'display-pmx-runtime.js',
  'display-mmd-ar-pose.js',
  'display-pmx-ao.mjs',
  'display-pmx-ao-size.mjs',
  'display-pmx-lighting-mode.mjs',
  'mmd-ammo-physics.mjs',
  'mmd-pmx-helper.mjs',
  'pmx-display-layout.mjs',
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
    .replaceAll('/api/mmd/static/mmd/', `${WEB_BASE_PATH}/mmd/`)
    .replaceAll('/models/mmd/', `${WEB_BASE_PATH}/mmd/`)
    .replaceAll('/api/mmd/resources', `${WEB_BASE_PATH}/mmd-resources.json`)
    .replaceAll('/js/', `${WEB_BASE_PATH}/js/`)
    .replaceAll('/css/', `${WEB_BASE_PATH}/css/`);
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of require('node:fs').createReadStream(filePath)) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest('hex') };
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
  const cachePath = path.join(MINDAR_CACHE, fileName);
  if (await isVerifiedFile(cachePath, expectedSize, expectedHash)) {
    log(`复用已校验 MindAR ${MINDAR_VERSION} 资源：${fileName}`);
    return cachePath;
  }

  const resourcePath = fileName === 'mind-ar-LICENSE' ? 'LICENSE' : `dist/${fileName}`;
  const url = `${MINDAR_PUBLIC_BASE_URL}/${resourcePath}`;
  await downloadToFile(url, cachePath, expectedSize, expectedHash);
  log(`MindAR ${MINDAR_VERSION} 资源 SHA-256 校验通过：${fileName}`);
  return cachePath;
}

async function stageTextAssets() {
  const $ = cheerio.load(await fs.readFile(DISPLAY_HTML_SOURCE, 'utf8'));
  const arTrackingVideo = $('#displayArTrackingVideo').first();
  const mmdLayer = $('#displayMmdLayer').first().addClass('is-visible').attr('aria-hidden', 'false');
  const controls = $('.display-stage-lighting-control').first();
  const calibration = $('#displayArCalibration').first();
  const arPanel = $('#displayArTargetPanel').first();
  const arHeader = arPanel.find('.display-mmd-ar-header').first();
  if (!arTrackingVideo.length || !mmdLayer.length || !controls.length || !calibration.length || !arPanel.length || !arHeader.length) {
    throw new Error('显示端 AR/MMD 页面缺少测试 harness 所需的控件节点');
  }

  if ($('#mmdArTrackerEngine').length || $('#mmdArBenchmarkResults').length) {
    throw new Error('显示端页面已包含 A/B 测试控件，测试 harness 不得重复注入');
  }
  arHeader.after(`
    <div class="mmd-ar-benchmark">
      ${WEB_MODE ? '' : `
      <label class="display-mmd-ar-field" for="mmdArTrackerEngine">
        <span>图像匹配算法</span>
        <select id="mmdArTrackerEngine">
          <option value="current">当前 JS</option>
          <option value="mindar">MindAR ${MINDAR_VERSION}</option>
        </select>
      </label>`}
      ${WEB_MODE ? '<p class="mmd-ar-benchmark-live">定位采用 MindAR Basic 的 A-Frame 目标锚点；真实相机使用原始分辨率，模拟画面宽 960 像素、高度按所选原图比例计算。</p>' : ''}
      <p id="mmdArBenchmarkLive" class="mmd-ar-benchmark-live" role="status" aria-live="polite">
        ${WEB_MODE ? 'A-Frame 定位尚未启动。' : '两种算法复用同一张定位图、选区和摄像头；耗时从识别引擎启动计时，不含相机授权。MindAR 每轮重新编译，首次首锁也计入本地模块加载。请保持目标静止后比较锚点抖动。'}
      </p>
      ${WEB_MODE ? '' : '<div id="mmdArBenchmarkResults" class="mmd-ar-benchmark-results" aria-live="polite"></div><button id="mmdArBenchmarkReset" class="display-mmd-ar-action" type="button">重置对比结果</button>'}
    </div>
  `);
  if (WEB_MODE) {
    $('#displayMmdKeyColor').closest('label').before(`
      <label class="display-mmd-lighting-shadow">
        <input id="displayMmdKeyShadowEnabled" type="checkbox" checked>
        <span>主光阴影（默认开启）</span>
      </label>
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
    `);
    WEB_PANEL_GROUPS.groupWebPanels($);
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
  const webResizeSupport = WEB_MODE ? `
      const stage = document.getElementById('displayStageLayers');
      let previousWidth = 0;
      let previousHeight = 0;
      let previousPixelRatio = 0;
      let resizeFrame = 0;
      const applyStageSize = () => {
        resizeFrame = 0;
        const bounds = stage.getBoundingClientRect();
        const width = Math.max(1, Math.round(bounds.width));
        const height = Math.max(1, Math.round(bounds.height));
        const pixelRatio = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
        if (width !== previousWidth || height !== previousHeight || pixelRatio !== previousPixelRatio) {
          previousWidth = width;
          previousHeight = height;
          previousPixelRatio = pixelRatio;
          window.DisplayMmd.resize(width, height);
        }
      };
      const scheduleStageSize = () => {
        if (!resizeFrame) resizeFrame = window.requestAnimationFrame(applyStageSize);
      };
      window.addEventListener('resize', scheduleStageSize, { passive: true });
      window.visualViewport?.addEventListener('resize', scheduleStageSize, { passive: true });
      if (window.ResizeObserver) new ResizeObserver(scheduleStageSize).observe(stage);
      scheduleStageSize();
  ` : '';

  const assets = [
    ...SOURCE_ASSET_FILES.filter((fileName) => !WEB_MODE || fileName !== 'display-mmd-image-tracker.js').map((fileName) => [
      path.join(SOURCE_PUBLIC, 'js', fileName),
      path.join(GENERATED_ASSETS, 'js', fileName),
    ]),
    [path.join(SOURCE_PUBLIC, 'css/display-mmd.css'), path.join(GENERATED_ASSETS, 'css/display-mmd.css')],
    ...MINDAR_TEST_SOURCE_FILES.map((fileName) => [
      path.join(ANDROID_PROJECT, fileName),
      path.join(GENERATED_ASSETS, 'js', fileName),
    ]),
    ...(WEB_MODE ? ['display-mmd-ar-sim-camera.js', 'display-mmd-ar-aframe.js'].map((fileName) => [
      path.join(ANDROID_PROJECT, fileName), path.join(GENERATED_ASSETS, 'js', fileName),
    ]) : []),
  ];
  for (const [sourcePath, destinationPath] of assets) {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    if (WEB_MODE && /\.(?:js|mjs|css)$/u.test(sourcePath)) {
      await fs.writeFile(destinationPath, webAssetText(await fs.readFile(sourcePath, 'utf8')), 'utf8');
    } else {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
  if (WEB_MODE) {
    // 静态站点可能长时间缓存同路径 ESM；先给阴影模块加内容指纹，再计算 runtime 指纹。
    const pmxRuntimePath = path.join(GENERATED_ASSETS, 'js/display-pmx-runtime.js');
    const lightingModeVersion = (await hashFile(path.join(GENERATED_ASSETS, 'js/display-pmx-lighting-mode.mjs'))).sha256.slice(0, 12);
    const runtimeSource = await fs.readFile(pmxRuntimePath, 'utf8');
    const lightingModeImport = "'./display-pmx-lighting-mode.mjs'";
    if (!runtimeSource.includes(lightingModeImport)) throw new Error('测试网页未找到 PMX 灯光模块入口');
    await fs.writeFile(pmxRuntimePath, runtimeSource.replace(lightingModeImport,
      `'./display-pmx-lighting-mode.mjs?v=${lightingModeVersion}'`));
    // 显示模块动态导入 PMX runtime；给该 URL 加内容指纹，避免旧缓存继续使用原阴影逻辑。
    const mmdScriptPath = path.join(GENERATED_ASSETS, 'js/display-mmd.js');
    const runtimeVersion = (await hashFile(path.join(GENERATED_ASSETS, 'js/display-pmx-runtime.js'))).sha256.slice(0, 12);
    const current = await fs.readFile(mmdScriptPath, 'utf8');
    const runtimeImport = "'./display-pmx-runtime.js'";
    if (!current.includes(runtimeImport)) throw new Error('测试网页未找到 PMX runtime 动态导入入口');
    await fs.writeFile(mmdScriptPath, current.replace(runtimeImport, `'./display-pmx-runtime.js?v=${runtimeVersion}'`));
  }
  await fs.cp(VENDOR_THREE_SOURCE, path.join(GENERATED_ASSETS, 'js/vendor/three'), { recursive: true });

  const scriptVersion = new Map();
  if (WEB_MODE) {
    for (const fileName of ['display-mmd.js', 'display-mmd-lighting.js', 'display-mmd-ar-benchmark.js', 'display-mmd-ar-sim-camera.js', 'display-mmd-ar-aframe.js', 'display-mmd-ar.js']) {
      scriptVersion.set(fileName, (await hashFile(path.join(GENERATED_ASSETS, 'js', fileName))).sha256.slice(0, 12));
    }
  }
  const scriptUrl = (fileName) => `/js/${fileName}${WEB_MODE && scriptVersion.has(fileName) ? `?v=${scriptVersion.get(fileName)}` : ''}`;

  const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#111318">
  <title>MMD AR 独立测试</title>
  <link rel="stylesheet" href="/css/display-mmd.css">
  ${WEB_MODE ? '<script src="https://aframe.io/releases/1.5.0/aframe.min.js"></script><script src="https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js"></script>' : ''}
  <script type="importmap">{"imports":{"three":"/js/vendor/three/three.module.js","three/addons/":"/js/vendor/three/"}}</script>
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
    .display-stage-layers { --display-stage-panel-max-height: min(620px, calc(100dvh - var(--display-stage-panel-top-gap) - var(--mmd-ar-safe-inset-top) - var(--mmd-ar-safe-inset-bottom) - 28px)); }
    /* 校准弹窗只占真实可视区；短屏时收缩预览并允许弹窗内部滚动。 */
    #displayArCalibration { position: fixed; inset: 0; width: 100vw; height: 100dvh; min-height: 0; overflow: hidden; }
    #displayArCalibration .display-mmd-ar-dialog { width: min(920px, 100%); max-height: calc(100dvh - max(12px, var(--display-safe-inset-top)) - max(12px, var(--display-safe-inset-bottom))); min-height: 0; overscroll-behavior: contain; }
    #displayArCalibration .display-mmd-ar-preview { min-height: 0; max-height: min(50dvh, 480px); }
    #displayArCalibration .display-mmd-ar-camera, #displayArCalibration .display-mmd-ar-canvas { max-height: min(50dvh, 480px); }
    .display-mmd-lighting-panel, .display-mmd-ar-panel { touch-action: pan-y; }
    .display-stage-layers { z-index: 10; }
    .display-mmd-layer { background: transparent; }
    .display-mmd-status { --bg-secondary: #20242e; --border-color: #475066; --text-secondary: #c2c8d4; }
    .display-stage-lighting-control { top: calc(var(--mmd-ar-safe-inset-top) + 14px); right: calc(var(--mmd-ar-safe-inset-right) + 14px); }
    .mmd-ar-test-label { position: fixed; left: calc(var(--mmd-ar-safe-inset-left) + 14px); top: calc(var(--mmd-ar-safe-inset-top) + 14px); z-index: 20; padding: 8px 12px; border: 1px solid #ffffff2b; border-radius: 12px; background: #171a22c9; color: #e8ebf4; font-size: 12px; pointer-events: none; }
    @media (orientation: portrait) {
      .mmd-ar-test-label { right: calc(var(--mmd-ar-safe-inset-right) + 82px); }
    }
    .display-mmd-ar-background { z-index: 2; }
    .mmd-ar-benchmark { display: grid; gap: 8px; margin: 4px 0 12px; padding: 10px; border: 1px solid #758bff66; border-radius: 10px; background: #171a22; }
    .mmd-ar-benchmark-live { margin: 0; color: #d3d9e8; font-size: 12px; line-height: 1.45; }
    .mmd-ar-benchmark-results { display: grid; gap: 6px; }
    .mmd-ar-benchmark-result { display: grid; gap: 3px; color: #d3d9e8; font-size: 11px; }
    .mmd-ar-benchmark-result strong { color: #ffffff; font-size: 12px; }
    .mmd-ar-loading-progress { position: fixed; z-index: 25; left: max(10vw, 14px); right: max(10vw, 14px); bottom: calc(var(--mmd-ar-safe-inset-bottom) + 48px); max-width: 440px; margin: 0 auto; padding: 10px 14px; border: 1px solid #ffffff40; border-radius: 12px; background: #171a22eb; color: #f4f6fb; font-size: 13px; pointer-events: none; }
    .mmd-ar-loading-progress[hidden] { display: none; }
    .mmd-ar-loading-track { height: 6px; margin-top: 8px; overflow: hidden; border-radius: 999px; background: #ffffff35; }
    .mmd-ar-loading-fill { width: 0; height: 100%; border-radius: inherit; background: #758bff; transition: width 160ms ease-out; }
    .mmd-ar-official-target-link { display: block; width: fit-content; max-width: 100%; padding: 6px 0; color: #bfcaff; text-decoration: underline; overflow-wrap: anywhere; }
    ${WEB_MODE ? `
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
    ` : ''}
    ${WEB_MODE ? WEB_PANEL_GROUPS.WEB_PANEL_GROUP_CSS : ''}
  </style>
</head>
<body>
  <div class="mmd-ar-test-label">MMD AR 测试 · 点“定位”拍照校准 · 拖动模型旋转</div>
  <div id="mmdArLoadingProgress" class="mmd-ar-loading-progress" role="progressbar" aria-label="模型加载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden>
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
    ${WEB_MODE ? `<div id="mmdArAframeHost" hidden aria-label="MindAR 定位图蓝色标记">
      <a-scene id="mmdArAframeScene" embedded mindar-image="imageTargetSrc: ; autoStart: false; uiLoading: no; uiScanning: no; uiError: no;"
        renderer="colorManagement: true; alpha: true" vr-mode-ui="enabled: false" device-orientation-permission-ui="enabled: false">
        <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
        <a-entity id="mmdArAframeAnchor" mindar-image-target="targetIndex: 0">
          <a-plane id="mmdArAframeTargetRect" width="1" height="1" material="color: #229cff; opacity: 0.35; transparent: true; side: double" position="0 0 0"></a-plane>
          <a-plane id="mmdArAframeCrossH" width="0.22" height="0.009" material="color: #d8f2ff; side: double" position="0 0 0.01"></a-plane>
          <a-plane id="mmdArAframeCrossV" width="0.009" height="0.22" material="color: #d8f2ff; side: double" position="0 0 0.01"></a-plane>
        </a-entity>
      </a-scene>
    </div>` : ''}
  </div>
  ${WEB_MODE ? '<script>window.MmdArTestWebFillShadow = true;</script>' : ''}
  <script src="${scriptUrl('display-mmd.js')}"></script>
  <script src="${scriptUrl('display-mmd-lighting.js')}"></script>
  ${WEB_MODE ? `<script>
    window.MmdArTestMindArOnly = true;
    window.MmdArLocationMarkerTest = true;
    window.MmdArTestAframeMode = true;
  </script>` : '<script src="/js/display-mmd-image-tracker.js"></script>'}
  <script src="/js/display-mmd-ar-benchmark-compiler.js"></script>
  <script src="/js/display-mmd-ar-benchmark-metrics.js"></script>
  <script src="${scriptUrl('display-mmd-ar-benchmark.js')}"></script>
  ${WEB_MODE ? `<script src="${scriptUrl('display-mmd-ar-sim-camera.js')}"></script>` : ''}
  ${WEB_MODE ? `<script src="${scriptUrl('display-mmd-ar-aframe.js')}"></script>` : ''}
  ${WEB_MODE ? `<script>
    // 只为 HTTPS 测试页提供内置目标；共享 AR 模块在正式显示端和 APK 中不接收此配置。
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
  </script>` : ''}
  <script src="${scriptUrl('display-mmd-ar.js')}"></script>
  <script>
    ${WEB_MODE ? WEB_PANEL_GROUPS.WEB_PANEL_GROUP_JS : ''}
    (() => {
      const controls = new Map([
        ['displayMmdLightingToggle', 'displayMmdLightingPanel'],
        ['displayArTargetToggle', 'displayArTargetPanel']
      ]);
      const findControl = (target) => {
        if (!(target instanceof Element)) return null;
        const button = target.closest('#displayMmdLightingToggle, #displayArTargetToggle');
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
      const progress = document.getElementById('mmdArLoadingProgress');
      const progressText = document.getElementById('mmdArLoadingText');
      const progressFill = document.getElementById('mmdArLoadingFill');
      let hideTimer = null;
      window.DisplayMmd.init({ canvas, status, onLoadProgress: ({ phase, percent, error }) => {
        if (hideTimer) window.clearTimeout(hideTimer);
        if (error) {
          progress.hidden = true;
          return;
        }
        const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        progress.hidden = false;
        progress.setAttribute('aria-valuenow', String(value));
        progressText.textContent = phase + ' ' + value + '%';
        progressFill.style.width = value + '%';
        if (value === 100) hideTimer = window.setTimeout(() => { progress.hidden = true; }, 1500);
      } });
      window.DisplayMmd.setVisible(true);
      window.DisplayMmd.setPointerEnabled(true);
      ${webResizeSupport}
    }, { once: true });
  </script>
</body>
</html>`;
  await fs.mkdir(GENERATED_ASSETS, { recursive: true });
  await fs.writeFile(path.join(GENERATED_ASSETS, 'index.html'), webAssetText(page), 'utf8');

  const profile = createStaticMmdResourceProfile();
  const payload = { status: 'success', resources: [profile] };
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
  if (!WEB_MODE) return;
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

function hashZipEntry(apkPath, entryName) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', apkPath, entryName], { stdio: ['ignore', 'pipe', 'pipe'] });
    const hash = crypto.createHash('sha256');
    let size = 0;
    let errorOutput = '';
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      hash.update(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (errorOutput.length < 4096) errorOutput += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`unzip 读取 APK 条目失败 ${entryName}: ${errorOutput.trim() || code}`));
        return;
      }
      resolve({ size, sha256: hash.digest('hex') });
    });
  });
}

function inspectApk(apkPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(apkPath, { lazyEntries: true, autoClose: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError || new Error('APK ZIP 无法打开'));
        return;
      }
      // yauzl 的 APK 读取流可能不保持 Node event loop 引用；此定时器只在检查期间保活。
      const keepAlive = setInterval(() => {}, 1000);
      const finish = (callback, value) => {
        clearInterval(keepAlive);
        callback(value);
      };
      const expectedModels = new Map(STATIC_MMD_RELEASE.files.map(([assetPath, size, hash]) => [
        `assets/www/${assetPath}`,
        { size, hash },
      ]));
      const expectedAssets = new Map([
        ...MINDAR_FILES.map(([fileName, size, hash]) => [
          fileName === 'mind-ar-LICENSE'
            ? 'assets/www/licenses/mind-ar-LICENSE'
            : `assets/www/js/vendor/mind-ar-${MINDAR_VERSION}/${fileName}`,
          { size, hash },
        ]),
        ['assets/www/js/display-mmd-ar-benchmark-compiler.js', null],
        ['assets/www/js/display-mmd-ar-benchmark.js', null],
        ['assets/www/js/display-mmd-ar-benchmark-metrics.js', null],
      ]);
      const foundModels = new Set();
      const foundAssets = new Set();
      const extraModels = [];
      let hasIndex = false;
      let hasProfile = false;
      let hasDex = false;
      let hasServerAssets = false;
      let failed = false;

      const fail = (error) => {
        if (failed) return;
        failed = true;
        zip.close();
        finish(reject, error);
      };

      zip.on('error', fail);
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        if (name === 'assets/www/index.html') hasIndex = true;
        if (name === 'assets/www/mmd-resources.json') hasProfile = true;
        if (/^classes\d*\.dex$/u.test(name)) hasDex = true;
        if (name.startsWith('assets/server/') || name.startsWith('assets/node_modules/')) hasServerAssets = true;
        if (/\.(?:pmx|vrm|vmd)$/iu.test(name) && !expectedModels.has(name)) extraModels.push(name);

        const expectedModel = expectedModels.get(name);
        const expectedAsset = expectedAssets.get(name);
        if (!expectedModel && !expectedAssets.has(name)) {
          zip.readEntry();
          return;
        }
        hashZipEntry(apkPath, name).then((actual) => {
          if (expectedModel && (actual.size !== expectedModel.size || actual.sha256 !== expectedModel.hash)) {
            fail(new Error(`APK 中模型资源 hash/size 不匹配：${name}`));
          } else if (expectedAsset && (actual.size !== expectedAsset.size || actual.sha256 !== expectedAsset.hash)) {
            fail(new Error(`APK 中 MindAR 资源 hash/size 不匹配：${name}`));
          } else {
            if (expectedModel) foundModels.add(name);
            if (expectedAssets.has(name)) foundAssets.add(name);
            zip.readEntry();
          }
        }).catch(fail);
      });
      zip.on('end', () => {
        if (failed) return;
        if (!hasIndex || !hasProfile || !hasDex) {
          finish(reject, new Error('APK 缺少网页入口、本地 profile 或 DEX'));
          return;
        }
        if (hasServerAssets) {
          finish(reject, new Error('独立 AR APK 不得包含 AASC server/Node 依赖'));
          return;
        }
        if (extraModels.length) {
          finish(reject, new Error(`APK 存在非默认模型资源：${extraModels.join(', ')}`));
          return;
        }
        if (foundModels.size !== expectedModels.size) {
          finish(reject, new Error(`APK 内置模型文件不完整：${foundModels.size}/${expectedModels.size}`));
          return;
        }
        if (foundAssets.size !== expectedAssets.size) {
          finish(reject, new Error(`APK 内 MindAR/对比工具不完整：${foundAssets.size}/${expectedAssets.size}`));
          return;
        }
        finish(resolve, { modelFiles: foundModels.size, mindArFiles: foundAssets.size });
      });
      zip.readEntry();
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
  await stageMindArAssets();

  if (WEB_MODE) {
    log(`HTTPS 静态网页资源已生成：${GENERATED_ASSETS}`);
    return;
  }

  log('开始构建独立 Android APK');
  await runGradle();
  const builtApk = path.join(APP_PROJECT, 'build/outputs/apk/debug/app-debug.apk');
  const metadataPath = path.join(APP_PROJECT, 'build/outputs/apk/debug/output-metadata.json');
  const buildMetadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  if (buildMetadata.applicationId !== 'com.aasc.mmdartest') {
    throw new Error(`APK applicationId 错误：${buildMetadata.applicationId || 'unknown'}`);
  }
  const inspection = await inspectApk(builtApk);
  const artifact = await publishLocalArtifact(builtApk);
  log(`APK 校验通过：applicationId=${buildMetadata.applicationId}，${inspection.modelFiles} 个模型文件，${inspection.mindArFiles} 个 A/B 资源，${artifact.size} bytes`);
  log(`SHA-256：${artifact.sha256}`);
  log(`输出：${artifact.path}`);
}

main().catch((error) => {
  process.stderr.write(`[mmd-ar-${WEB_MODE ? 'web' : 'apk'}] 构建失败：${error.stack || error.message}\n`);
  process.exitCode = 1;
});
