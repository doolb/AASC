'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const yauzl = require('yauzl');

// 两端资源摘要和APK全量校验独立维护，构建入口仅负责资源生成与调用。
async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of require('node:fs').createReadStream(filePath)) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest('hex') };
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

async function inspectApk(apkPath, { assetRoot: GENERATED_ASSETS, appProject: APP_PROJECT,
  modelFiles: STATIC_MODEL_FILES, mindArFiles: MINDAR_FILES, mindArVersion: MINDAR_VERSION }) {
  const vocabulary = await hashFile(path.join(APP_PROJECT, 'build/generated/slam-assets/orb-slam3/ORBvoc.txt'));
  // 校验全部生成网页文件，确保共享功能的ESM、控件和物理补丁真实进入APK，而非只停留在构建目录。
  const expectedWebAssets = new Map();
  const collect = async (directory, prefix = '') => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(filePath, `${relative}/`);
      else if (entry.isFile()) {
        const digest = await hashFile(filePath);
        expectedWebAssets.set(`assets/www/${relative}`, { size: digest.size, hash: digest.sha256 });
      } else throw new Error(`测试网页资源不得包含符号链接：${relative}`);
    }
  };
  await collect(GENERATED_ASSETS);
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
      const expectedModels = new Map(STATIC_MODEL_FILES.map(([assetPath, size, hash]) => [
        `assets/www/${assetPath}`,
        { size, hash },
      ]));
      const expectedAssets = new Map([
        ...expectedWebAssets,
        ...MINDAR_FILES.map(([fileName, size, hash]) => [
          fileName === 'mind-ar-LICENSE'
            ? 'assets/www/licenses/mind-ar-LICENSE'
            : `assets/www/js/vendor/mind-ar-${MINDAR_VERSION}/${fileName}`,
          { size, hash },
        ]),
        ['assets/orb-slam3/ORBvoc.txt', { size: vocabulary.size, hash: vocabulary.sha256 }],
        ['assets/orb-slam3/VERSIONS.txt', null],
        ['assets/orb-slam3/ORB-SLAM3-LICENSE.txt', null],
        ['assets/www/js/display-mmd-ar-native.js', null],
        ['assets/www/js/display-mmd-ar-aframe.js', null],
        ['assets/www/js/vendor/aframe-1.5.0/aframe.min.js', null],
        ['assets/www/js/vendor/mind-ar-1.2.5/mindar-image-aframe.prod.js', null],
        ['assets/www/js/display-mmd-ar-benchmark-compiler.js', null],
        ['assets/www/js/display-mmd-ar-benchmark.js', null],
        ['assets/www/js/display-mmd-ar-benchmark-metrics.js', null],
      ]);
      const requiredLibraries = new Set(['lib/arm64-v8a/libaasc_mmd_slam.so', 'lib/arm64-v8a/libc++_shared.so']);
      const foundLibraries = new Set();
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
        if (name === 'assets/www/js/display-mmd-image-tracker.js') {
          fail(new Error('MindAR-only 测试 APK 不得包含旧 JS 图片跟踪器'));
          return;
        }
        if (requiredLibraries.has(name) && entry.uncompressedSize > 1024) foundLibraries.add(name);
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
            fail(new Error(`APK 中定位资源 hash/size 不匹配：${name}`));
          } else {
            if (expectedModel) foundModels.add(name);
            if (expectedAssets.has(name)) foundAssets.add(name);
            zip.readEntry();
          }
        }).catch(fail);
      });
      zip.on('end', () => {
        if (failed) return;
        if (foundLibraries.size !== requiredLibraries.size) {
          finish(reject, new Error('APK 原生SLAM或C++运行库不完整'));
          return;
        }
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
          finish(reject, new Error(`APK 内定位资源不完整：${foundAssets.size}/${expectedAssets.size}`));
          return;
        }
        finish(resolve, { modelFiles: foundModels.size, webFiles: expectedWebAssets.size });
      });
      zip.readEntry();
    });
  });
}

module.exports = { hashFile, inspectApk };
