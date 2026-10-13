const fs = require('fs').promises;
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const sourceRoot = path.join(projectRoot, '3rd/tts-server/android-asr/web');
const outputRoot = path.join(projectRoot, '3rd/tts-server/android-asr/web-dist');
const runtimeFiles = [
  'index.html',
  'css',
  'js',
  'vendor',
];

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function build() {
  try {
    const sourceStat = await fs.stat(sourceRoot);
    if (!sourceStat.isDirectory()) throw new Error(`网页源码目录无效：${sourceRoot}`);

    const existingOutput = await fs.lstat(outputRoot).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existingOutput?.isSymbolicLink()) throw new Error(`拒绝覆盖符号链接：${outputRoot}`);
    await fs.rm(outputRoot, { recursive: true, force: true });
    await fs.mkdir(outputRoot, { recursive: true });

    for (const entry of runtimeFiles) {
      const sourcePath = path.join(sourceRoot, entry);
      const destinationPath = path.join(outputRoot, entry);
      await fs.cp(sourcePath, destinationPath, { recursive: true, force: true });
    }

    const requiredFiles = [
      'index.html',
      'js/app.js',
      'js/asr-worker.js',
      'vendor/sherpa-onnx-wasm-combined.js',
      'vendor/sherpa-onnx-wasm-combined.wasm',
      'vendor/THIRD_PARTY_NOTICES.md',
      'vendor/licenses/MIT.txt',
      'vendor/licenses/Apache-2.0.txt',
    ];
    for (const relativePath of requiredFiles) {
      const stat = await fs.stat(path.join(outputRoot, relativePath));
      if (!stat.isFile() || stat.size === 0) throw new Error(`构建资源缺失或为空：${relativePath}`);
    }

    const wasmStat = await fs.stat(path.join(outputRoot, 'vendor/sherpa-onnx-wasm-combined.wasm'));
    if (wasmStat.size < 10 * 1024 * 1024) throw new Error('组合 WASM 体积异常，拒绝输出不完整构建');

    const builtFiles = await listFiles(outputRoot);
    const totalBytes = (await Promise.all(builtFiles.map((file) => fs.stat(file)))).reduce((total, stat) => total + stat.size, 0);
    console.log(`Android ASR 网页构建完成：${outputRoot}`);
    console.log(`静态文件：${builtFiles.length} 个，${totalBytes} 字节；模型仍从 Apache /mnt/aimodel/ 加载。`);
  } catch (error) {
    console.error(`Android ASR 网页构建失败：${error.message}`);
    process.exitCode = 1;
  }
}

build();
