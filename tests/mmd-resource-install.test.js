const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { installMmdAssets } = require('../scripts/models/install-local-mmd-assets.js');

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createZip = async (directory, name, entries) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    const isDirectory = entry.directory === true || entry.name.endsWith('/');
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);
    localParts.push(localHeader, data);

    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(isDirectory ? 0x10 : 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuffer.copy(centralHeader, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  const zipPath = path.join(directory, name);
  await fs.writeFile(zipPath, Buffer.concat([...localParts, centralDirectory, end]));
  return zipPath;
};

const makePmx = (version = 2.0) => {
  const buffer = Buffer.alloc(16);
  buffer.write('PMX ', 0, 'ascii');
  buffer.writeFloatLE(version, 4);
  return buffer;
};

const makeVmd = (header = 'Vocaloid Motion Data 0002') => {
  const buffer = Buffer.alloc(30);
  buffer.write(header, 0, 'ascii');
  return buffer;
};

const withFixture = async (modelEntries, motionEntries, callback) => {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-mmd-test-'));
  try {
    const modelZip = await createZip(fixtureRoot, 'model.zip', modelEntries);
    const motionZip = await createZip(fixtureRoot, 'motion.zip', motionEntries);
    const outputRoot = path.join(fixtureRoot, 'output');
    return await callback({ modelZip, motionZip, outputRoot });
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
};

test('installMmdAssets extracts PMX/VMD resources and writes a fixed manifest', async () => {
  await withFixture(
    [
      { name: 'model/Miya.pmx', data: makePmx() },
      { name: 'tex/body.png', data: 'texture' },
      { name: 'toon/body.bmp', data: 'toon' },
      { name: 'readme.txt', data: 'ignore me' },
    ],
    [
      { name: '半成品.vmd', data: makeVmd() },
      { name: '1.txt', data: 'motion note' },
    ],
    async ({ modelZip, motionZip, outputRoot }) => {
      const manifest = await installMmdAssets({ modelZip, motionZip, outputRoot });
      const resource = manifest.resources[0];

      assert.equal(manifest.schemaVersion, 1);
      assert.equal(resource.modelType, 'pmx');
      assert.equal(resource.modelPath, 'mmd/miya/miya.pmx');
      assert.equal(resource.motionResourceId, 'miya-default-motion');
      assert.equal(resource.motionPath, 'mmd/motions/miya-default.vmd');
      assert.equal(resource.playMode, 'once');
      assert.equal(resource.version.length, 64);
      assert.deepEqual(
        resource.files.map((file) => file.path),
        ['mmd/miya/miya.pmx', 'mmd/miya/tex/body.png', 'mmd/miya/toon/body.bmp', 'mmd/motions/miya-default.vmd'],
      );

      for (const file of resource.files) {
        const digest = crypto.createHash('sha256').update(await fs.readFile(path.join(outputRoot, file.path))).digest('hex');
        assert.equal(file.sha256, digest);
      }
      assert.equal(JSON.parse(await fs.readFile(path.join(outputRoot, 'mmd/manifest.json'), 'utf8')).schemaVersion, 1);
    },
  );
});

test('installMmdAssets rejects missing PMX and missing VMD entries', async () => {
  await assert.rejects(
    withFixture([{ name: 'tex/body.png', data: 'texture' }], [{ name: 'motion.vmd', data: makeVmd() }], (options) => installMmdAssets(options)),
    /PMX/i,
  );
  await assert.rejects(
    withFixture([{ name: 'model.pmx', data: makePmx() }], [{ name: 'note.txt', data: 'no motion' }], (options) => installMmdAssets(options)),
    /VMD/i,
  );
});

test('installMmdAssets rejects unsafe and non-regular ZIP entries', async () => {
  await assert.rejects(
    withFixture([{ name: '../escape.pmx', data: makePmx() }], [{ name: 'motion.vmd', data: makeVmd() }], (options) => installMmdAssets(options)),
    /path|路径|安全/i,
  );
  await assert.rejects(
    withFixture([{ name: 'bad/', directory: true }, { name: 'model.pmx', data: makePmx() }], [{ name: 'motion.vmd', data: makeVmd() }], (options) => installMmdAssets(options)),
    /directory|目录|regular|普通文件/i,
  );
});

test('installMmdAssets validates PMX 2.0 and VMD headers', async () => {
  await assert.rejects(
    withFixture([{ name: 'model.pmx', data: makePmx(1.0) }], [{ name: 'motion.vmd', data: makeVmd() }], (options) => installMmdAssets(options)),
    /PMX.*2\.0|2\.0.*PMX/i,
  );
  await assert.rejects(
    withFixture([{ name: 'model.pmx', data: makePmx() }], [{ name: 'motion.vmd', data: makeVmd('invalid') }], (options) => installMmdAssets(options)),
    /VMD|header/i,
  );
});
