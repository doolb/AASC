const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createMmdResourceProfile,
  loadMmdResourceManifest,
  resolveMmdResource,
} = require('./mmd-resource-service');

const createFixture = async (resourceOverrides = {}) => {
  const modelRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-mmd-service-'));
  const files = [
    { path: 'mmd/miya/miya.pmx', content: Buffer.from('pmx') },
    { path: 'mmd/miya/tex/1.png', content: Buffer.from('texture') },
    { path: 'mmd/miya/toon/1.bmp', content: Buffer.from('toon') },
    { path: 'mmd/motions/miya-default.vmd', content: Buffer.from('vmd') },
  ];
  await Promise.all(files.map(async ({ path: filePath, content }) => {
    const absolutePath = path.join(modelRoot, filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }));
  const resource = {
    resourceId: 'miya-default',
    modelType: 'pmx',
    modelPath: 'mmd/miya/miya.pmx',
    motionResourceId: 'miya-default-motion',
    motionPath: 'mmd/motions/miya-default.vmd',
    playMode: 'once',
    version: 'test-version',
    files: files.map(({ path: filePath, content }) => ({
      path: filePath,
      size: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    })),
    ...resourceOverrides,
  };
  await fs.mkdir(path.join(modelRoot, 'mmd'), { recursive: true });
  await fs.writeFile(path.join(modelRoot, 'mmd/manifest.json'), JSON.stringify({ schemaVersion: 1, resources: [resource] }));
  return { modelRoot, resource };
};

test('loadMmdResourceManifest validates the generated PMX manifest and files', async () => {
  const { modelRoot, resource } = await createFixture();
  try {
    const manifest = await loadMmdResourceManifest({ modelRoot });
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(manifest.resources[0], resource);
  } finally {
    await fs.rm(modelRoot, { recursive: true, force: true });
  }
});

test('resolveMmdResource and createMmdResourceProfile only produce same-origin paths', async () => {
  const { modelRoot } = await createFixture();
  try {
    const manifest = await loadMmdResourceManifest({ modelRoot });
    const resource = resolveMmdResource('miya-default', { manifest });
    const profile = createMmdResourceProfile(resource);
    assert.equal(profile.resourceId, 'miya-default');
    assert.equal(profile.modelType, 'pmx');
    assert.equal(profile.modelUrl, '/models/mmd/miya/miya.pmx');
    assert.equal(profile.motionResourceId, 'miya-default-motion');
    assert.equal(profile.motionUrl, '/models/mmd/motions/miya-default.vmd');
    assert.equal(profile.playMode, 'once');
    assert.equal(profile.modelUrl.startsWith('http'), false);
    assert.equal(profile.motionUrl.startsWith('http'), false);
    assert.throws(() => resolveMmdResource('https://example.com/model.pmx', { manifest }), /unknown|not found|不存在|未知/i);
  } finally {
    await fs.rm(modelRoot, { recursive: true, force: true });
  }
});

test('manifest loader rejects invalid model type, paths and missing declared files', async () => {
  const cases = [
    { modelType: 'vrm', message: /modelType|pmx/i },
    { playMode: 'loop', message: /playMode|once/i },
    { modelPath: 'https://example.com/model.pmx', message: /path|路径|relative/i },
    { modelPath: '../outside.pmx', message: /path|路径|relative/i },
    { files: [{ path: 'mmd/not-found.pmx', size: 1, sha256: 'a'.repeat(64) }], message: /regular|file|文件/i },
  ];
  for (const entry of cases) {
    const { modelRoot } = await createFixture(entry);
    try {
      await assert.rejects(loadMmdResourceManifest({ modelRoot }), entry.message);
    } finally {
      await fs.rm(modelRoot, { recursive: true, force: true });
    }
  }
});

test('unknown MMD resource carries a structured 404 status', async () => {
  const { modelRoot } = await createFixture();
  try {
    const manifest = await loadMmdResourceManifest({ modelRoot });
    assert.throws(
      () => resolveMmdResource('unknown-resource', { manifest }),
      (error) => error.statusCode === 404 && /unknown|不存在|未知/i.test(error.message),
    );
  } finally {
    await fs.rm(modelRoot, { recursive: true, force: true });
  }
});

test('server registers MMD resource route without replacing the existing VRM static route', async () => {
  const serverSource = await fs.readFile(path.resolve(__dirname, '../../boot/server-app.js'), 'utf8');
  assert.match(serverSource, /app\.get\('\/api\/mmd\/resources'/u);
  assert.match(serverSource, /app\.get\('\/api\/vrm\/model\/static'/u);
  assert.match(serverSource, /loadMmdResourceManifest/u);
});
