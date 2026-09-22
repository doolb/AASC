const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const yauzl = require('yauzl');

const DEFAULT_MODEL_ZIP = 'D:\\down\\a6fc97ed31db587c30d49d49d53939c7.zip';
const DEFAULT_MOTION_ZIP = 'D:\\down\\半成品_by_爱打游戏的柠檬茶_7979ff2612c650d9094502210c9781bf.zip';
const DEFAULT_RESOURCE_ID = 'miya-default';
const DEFAULT_MOTION_RESOURCE_ID = 'miya-default-motion';
const MODEL_OUTPUT_PATH = 'mmd/miya/miya.pmx';
const MOTION_OUTPUT_PATH = 'mmd/motions/miya-default.vmd';

const toPosixPath = (fileName) => String(fileName).replaceAll('\\', '/');

const validateZipEntryPath = (fileName) => {
  const normalized = toPosixPath(fileName);
  const segments = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || segments.includes('..') || segments.includes('.')) {
    throw new Error(`ZIP entry path is not safe: ${fileName}`);
  }
  return normalized;
};

const readZipEntries = async (zipPath) => new Promise((resolve, reject) => {
  yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openError, zipFile) => {
    if (openError) {
      reject(openError);
      return;
    }

    const entries = [];
    let settled = false;
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on('entry', (entry) => {
      try {
        const normalizedPath = validateZipEntryPath(entry.fileName);
        const isDirectory = normalizedPath.endsWith('/') || (entry.externalFileAttributes & 0x10) !== 0;
        if (isDirectory) {
          // 普通目录条目只是压缩包索引元数据；只跳过模型允许的目录，其他目录条目仍然拒绝，避免把未知结构当作资源。
          if (normalizedPath === 'spa/' || normalizedPath === 'tex/' || normalizedPath === 'toon/') {
            zipFile.readEntry();
            return;
          }
          throw new Error(`ZIP entry must be a regular file: ${entry.fileName}`);
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            fail(streamError);
            return;
          }
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', fail);
          stream.on('end', () => {
            entries.push({ path: normalizedPath, data: Buffer.concat(chunks) });
            zipFile.readEntry();
          });
        });
      } catch (error) {
        fail(error);
      }
    });
    zipFile.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(entries);
      }
    });
    zipFile.on('error', fail);
    zipFile.readEntry();
  });
});

const findSingleEntry = (entries, extension, label) => {
  const matches = entries.filter((entry) => entry.path.toLowerCase().endsWith(extension));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${label} entry, found ${matches.length}`);
  }
  return matches[0];
};

const validatePmx = (data) => {
  if (data.length < 8 || data.subarray(0, 4).toString('ascii') !== 'PMX ' || Math.abs(data.readFloatLE(4) - 2.0) > 0.0001) {
    throw new Error('PMX header must declare version 2.0');
  }
};

const validateVmd = (data) => {
  if (data.length < 30 || data.subarray(0, 30).toString('ascii').startsWith('Vocaloid Motion Data 0002') === false) {
    throw new Error('VMD header is invalid');
  }
};

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const writeFileEntry = async (root, outputPath, data) => {
  const absolutePath = path.join(root, ...outputPath.split('/'));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, data);
  return {
    path: outputPath,
    size: data.length,
    sha256: sha256(data),
  };
};

const replaceTaskDirectory = async (stagedPath, targetPath) => {
  const backupPath = `${targetPath}.previous-${process.pid}-${Date.now()}`;
  let movedExisting = false;
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    try {
      await fs.rename(targetPath, backupPath);
      movedExisting = true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    await fs.rename(stagedPath, targetPath);
    if (movedExisting) {
      await fs.rm(backupPath, { recursive: true, force: true });
    }
  } catch (error) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      if (movedExisting) {
        await fs.rename(backupPath, targetPath);
      }
    } catch {
      // 保留原始错误；恢复失败只会影响下次人工清理，不掩盖安装失败原因。
    }
    throw error;
  }
};

const installMmdAssets = async ({
  modelZip = DEFAULT_MODEL_ZIP,
  motionZip = DEFAULT_MOTION_ZIP,
  outputRoot = path.resolve(__dirname, '../../res/models'),
  resourceId = DEFAULT_RESOURCE_ID,
  motionResourceId = DEFAULT_MOTION_RESOURCE_ID,
} = {}) => {
  const modelEntries = await readZipEntries(modelZip);
  const motionEntries = await readZipEntries(motionZip);
  const modelEntry = findSingleEntry(modelEntries, '.pmx', 'PMX');
  const motionEntry = findSingleEntry(motionEntries, '.vmd', 'VMD');
  validatePmx(modelEntry.data);
  validateVmd(motionEntry.data);

  const textureEntries = modelEntries
    .filter((entry) => entry.path.startsWith('tex/') || entry.path.startsWith('toon/'))
    .sort((left, right) => left.path.localeCompare(right.path));
  const stagingRoot = await fs.mkdtemp(path.join(await fs.mkdir(outputRoot, { recursive: true }).then(() => outputRoot), '.mmd-stage-'));
  const stagedMmdRoot = path.join(stagingRoot, 'mmd');
  const stagedModelRoot = path.join(stagedMmdRoot, 'miya');
  const stagedMotionRoot = path.join(stagedMmdRoot, 'motions');
  const modelFiles = [];

  try {
    modelFiles.push(await writeFileEntry(stagingRoot, MODEL_OUTPUT_PATH, modelEntry.data));
    for (const textureEntry of textureEntries) {
      modelFiles.push(await writeFileEntry(stagingRoot, `mmd/miya/${textureEntry.path}`, textureEntry.data));
    }
    const motionFile = await writeFileEntry(stagingRoot, MOTION_OUTPUT_PATH, motionEntry.data);
    const version = sha256(Buffer.from(modelFiles.concat(motionFile).map((file) => `${file.path}:${file.sha256}`).join('\n')));
    const manifest = {
      schemaVersion: 1,
      resources: [{
        resourceId,
        modelType: 'pmx',
        modelPath: MODEL_OUTPUT_PATH,
        motionResourceId,
        motionPath: MOTION_OUTPUT_PATH,
        playMode: 'loop',
        version,
        files: modelFiles.concat(motionFile),
      }],
    };
    await fs.mkdir(stagedMmdRoot, { recursive: true });
    await fs.writeFile(path.join(stagedMmdRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    await replaceTaskDirectory(stagedModelRoot, path.join(outputRoot, 'mmd/miya'));
    await replaceTaskDirectory(stagedMotionRoot, path.join(outputRoot, 'mmd/motions'));
    const manifestTarget = path.join(outputRoot, 'mmd/manifest.json');
    const manifestTemp = path.join(outputRoot, 'mmd/.manifest.next.json');
    await fs.rename(path.join(stagedMmdRoot, 'manifest.json'), manifestTemp);
    await replaceTaskDirectory(manifestTemp, manifestTarget);
    return manifest;
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
};

const parseCliArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--model-zip') {
      options.modelZip = argv[++index];
    } else if (argument === '--motion-zip') {
      options.motionZip = argv[++index];
    } else if (argument === '--output-root') {
      options.outputRoot = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
};

if (require.main === module) {
  installMmdAssets(parseCliArgs(process.argv.slice(2)))
    .then((manifest) => {
      console.log(`Installed ${manifest.resources[0].modelPath} and ${manifest.resources[0].motionPath}`);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_MODEL_ZIP,
  DEFAULT_MOTION_ZIP,
  installMmdAssets,
  validatePmx,
  validateVmd,
  validateZipEntryPath,
};
