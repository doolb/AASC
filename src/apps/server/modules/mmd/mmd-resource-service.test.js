const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  STATIC_MMD_RELEASE,
  createStaticMmdResourceProfile,
  createMmdResourceProfile,
  loadMmdResourceManifest,
  loadPreferredMmdResources,
  requestStaticMmdAsset,
  resolveStaticMmdAsset,
  resolveStaticMmdAssetUrl,
  resolveMmdResource,
} = require('./mmd-resource-service');

const createUpstreamResponse = ({ status = 200, content = Buffer.alloc(0), contentLength } = {}) => {
  const body = new PassThrough();
  body.end(content);
  return {
    status,
    headers: {
      get: (name) => (name.toLowerCase() === 'content-length' && contentLength !== undefined ? String(contentLength) : null),
    },
    body,
  };
};

const lookupStaticMmdHost = async () => ({ address: '120.79.245.103', family: 4 });

test('static Miya release exposes only the fixed same-origin PMX and VMD profile', () => {
  const profile = createStaticMmdResourceProfile();
  assert.equal(STATIC_MMD_RELEASE.host, 'c.aasc.us');
  assert.equal(STATIC_MMD_RELEASE.files.length, 14);
  assert.deepEqual(profile, {
    resourceId: 'miya-default',
    modelType: 'pmx',
    modelUrl: '/api/mmd/static/mmd/miya/miya.pmx',
    motionResourceId: 'miya-default-motion',
    motionUrl: '/api/mmd/static/mmd/motions/miya-default.vmd',
    playMode: 'loop',
    version: 'ca07d84b494577f5dab90d71465bc08e01ec036fe66278a2393313b6febf56c6',
  });
});

test('static Miya release rejects non-whitelisted and unsafe asset paths before lookup', () => {
  for (const relativePath of [
    '',
    '../mmd/miya/miya.pmx',
    'mmd/%2e%2e/miya/miya.pmx',
    'mmd\\miya\\miya.pmx',
    'mmd//miya/miya.pmx',
    'mmd/miya/miya.pmx?download=1',
    'mmd/miya/toon/1.bmp',
  ]) {
    assert.throws(() => resolveStaticMmdAsset(relativePath), /static|path|asset|unsafe|unknown/i);
  }
});

test('static Miya release resolves the declared PMX through its IPv4 address', async () => {
  const sourceUrl = await resolveStaticMmdAssetUrl('mmd/miya/miya.pmx', { lookup: lookupStaticMmdHost });
  assert.equal(sourceUrl, 'http://120.79.245.103/mnt/mmd/miya-v1/mmd/miya/miya.pmx');
});

test('static Miya request rejects untrusted upstream responses without returning partial assets', async () => {
  const motionPath = 'mmd/motions/miya-default.vmd';
  const motionAsset = resolveStaticMmdAsset(motionPath);
  let requestedUrl = '';
  const request = async (url, options) => {
    requestedUrl = url;
    assert.equal(options.redirect, 'manual');
    return createUpstreamResponse({ status: 404, contentLength: 0 });
  };
  await assert.rejects(
    requestStaticMmdAsset({ relativePath: 'mmd/miya/miya.pmx', lookup: lookupStaticMmdHost, request }),
    /status|404|upstream/i,
  );
  assert.equal(requestedUrl, 'http://120.79.245.103/mnt/mmd/miya-v1/mmd/miya/miya.pmx');

  await assert.rejects(
    requestStaticMmdAsset({
      relativePath: motionPath,
      lookup: lookupStaticMmdHost,
      request: async () => createUpstreamResponse({ content: Buffer.alloc(motionAsset.size), contentLength: undefined }),
    }),
    /content-length|length/i,
  );
  await assert.rejects(
    requestStaticMmdAsset({
      relativePath: motionPath,
      lookup: lookupStaticMmdHost,
      request: async () => createUpstreamResponse({ content: Buffer.alloc(motionAsset.size), contentLength: motionAsset.size - 1 }),
    }),
    /content-length|length|size/i,
  );
  await assert.rejects(
    requestStaticMmdAsset({
      relativePath: motionPath,
      lookup: lookupStaticMmdHost,
      request: async () => createUpstreamResponse({ content: Buffer.alloc(motionAsset.size + 1), contentLength: motionAsset.size }),
    }),
    /size|length|exceed/i,
  );
  await assert.rejects(
    requestStaticMmdAsset({
      relativePath: motionPath,
      lookup: lookupStaticMmdHost,
      request: async () => createUpstreamResponse({ content: Buffer.alloc(motionAsset.size), contentLength: motionAsset.size }),
    }),
    /checksum|sha|digest/i,
  );
});

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
    playMode: 'loop',
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
    assert.equal(profile.playMode, 'loop');
    assert.equal(profile.modelUrl.startsWith('http'), false);
    assert.equal(profile.motionUrl.startsWith('http'), false);
    assert.throws(() => resolveMmdResource('https://example.com/model.pmx', { manifest }), /unknown|not found|不存在|未知/i);
  } finally {
    await fs.rm(modelRoot, { recursive: true, force: true });
  }
});

test('preferred MMD resources use a valid local manifest and only fall back when that manifest is absent', async () => {
  const { modelRoot } = await createFixture();
  try {
    const localResources = await loadPreferredMmdResources({ modelRoot });
    assert.equal(localResources[0].modelUrl, '/models/mmd/miya/miya.pmx');
    assert.equal(localResources[0].motionUrl, '/models/mmd/motions/miya-default.vmd');

    await fs.unlink(path.join(modelRoot, 'mmd/manifest.json'));
    assert.deepEqual(await loadPreferredMmdResources({ modelRoot }), [createStaticMmdResourceProfile()]);
  } finally {
    await fs.rm(modelRoot, { recursive: true, force: true });
  }
});

test('preferred MMD resources do not fall back when an existing manifest is malformed or has a bad hash', async () => {
  const malformed = await createFixture();
  const mismatchedHash = await createFixture();
  try {
    await fs.writeFile(path.join(malformed.modelRoot, 'mmd/manifest.json'), '{not-json');
    await assert.rejects(
      loadPreferredMmdResources({ modelRoot: malformed.modelRoot }),
      (error) => error.statusCode === 503 && error.code !== 'MMD_MANIFEST_MISSING',
    );

    const manifestPath = path.join(mismatchedHash.modelRoot, 'mmd/manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.resources[0].files[0].sha256 = '0'.repeat(64);
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      loadPreferredMmdResources({ modelRoot: mismatchedHash.modelRoot }),
      (error) => error.statusCode === 503 && error.code !== 'MMD_MANIFEST_MISSING',
    );
  } finally {
    await Promise.all([
      fs.rm(malformed.modelRoot, { recursive: true, force: true }),
      fs.rm(mismatchedHash.modelRoot, { recursive: true, force: true }),
    ]);
  }
});

test('manifest loader rejects invalid model type, paths and missing declared files', async () => {
  const cases = [
    { modelType: 'vrm', message: /modelType|pmx/i },
    { playMode: 'unsupported', message: /playMode|loop|once/i },
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

test('server registers the fixed MMD static proxy without replacing the existing VRM static route', async () => {
  const serverSource = await fs.readFile(path.resolve(__dirname, '../../boot/server-app.js'), 'utf8');
  assert.match(serverSource, /app\.get\('\/api\/mmd\/resources'/u);
  assert.match(serverSource, /app\.get\('\/api\/vrm\/model\/static'/u);
  assert.match(serverSource, /loadPreferredMmdResources/u);
  assert.match(serverSource, /requestStaticMmdAsset/u);
  assert.ok(serverSource.includes('app.get(/^\\/api\\/mmd\\/static\\/'));
  assert.match(serverSource, /MMD 静态资源不接受查询参数/u);
});
