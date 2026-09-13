const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

let AndroidSafProvider;
let MediaLibraryManager;
try {
  ({ AndroidSafProvider, MediaLibraryManager } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service'));
} catch (error) {
  console.error(error.stack);
  throw error;
}

test('Android SAF provider通过本地网关连接、列目录并支持Range流', async () => {
  const provider = new AndroidSafProvider({
    id: 'android-saf',
    url: 'http://127.0.0.1:8081',
    token: 'test-token',
  });
  provider._request = async (method, endpoint, options = {}) => {
    if (endpoint === '/v1/status') {
      return { statusCode: 200, headers: {}, body: Buffer.from('{"ok":true,"ready":true}') };
    }
    if (endpoint === '/v1/list') {
      assert.equal(options.query?.path, '/');
      return { statusCode: 200, headers: {}, body: Buffer.from(JSON.stringify({ items: [{
        name: 'demo.mp4', path: '/demo.mp4', type: 'file', size: 10, modifiedTime: 0,
      }] })) };
    }
    assert.equal(options.query?.path, '/demo.mp4');
    if (method === 'HEAD') {
      return {
        statusCode: 200,
        headers: {
          'content-length': '10',
          'last-modified': 'Thu, 01 Jan 1970 00:00:00 GMT',
        },
        body: Buffer.alloc(0),
      };
    }
    return {
      statusCode: 206,
      headers: {
        'content-length': '4',
        'content-range': 'bytes 2-5/10',
        'accept-ranges': 'bytes',
      },
      stream: Readable.from([Buffer.from('2345')]),
    };
  };

  await provider.connect();
  const items = await provider.list('/');
  assert.equal(items[0].path, '/demo.mp4');
  assert.equal(items[0].url, '/api/media-libraries/android-saf/proxy/demo.mp4');

  const file = await provider.getFile('/demo.mp4');
  assert.equal(file.size, 10);
  const result = await provider.getFileStream('/demo.mp4', { start: 2, end: 5 });
  assert.equal(result.statusCode, 206);
  assert.equal(result.headers['Content-Range'], 'bytes 2-5/10');
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), '2345');
  await provider.disconnect();
});

test('Android SAF provider拒绝虚拟根之外的路径', () => {
  const provider = new AndroidSafProvider({
    id: 'android-saf',
    url: 'http://127.0.0.1:8081',
    token: 'test-token',
  });

  for (const value of ['/../secret', '/media//file', '/media/./file', 'media\\file']) {
    assert.throws(() => provider._normalizePath(value), /Android SAF 路径/);
  }
});

test('Android SAF 媒体库由运行时环境自动注册且不写入媒体库配置', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-android-saf-'));
  const configPath = path.join(tempRoot, 'media-libraries.json');
  const originalConnect = AndroidSafProvider.prototype.connect;
  AndroidSafProvider.prototype.connect = async function connectForTest() {
    this.connected = true;
    return true;
  };
  try {
    const manager = new MediaLibraryManager({
      configPath,
      androidSafConfig: {
        url: 'http://127.0.0.1:8081',
        token: 'runtime-only-token',
      },
    });
    await manager.init();
    assert.deepEqual(manager.listLibraries(), [{
      id: 'android-saf',
      name: 'Android SAF 媒体目录',
      type: 'android-saf',
      isDefault: true,
      readonly: false,
      managed: true,
    }]);
    manager.saveConfig();
    assert.deepEqual(JSON.parse(await fs.readFile(configPath, 'utf8')), { libraries: [] });
    await assert.rejects(
      manager.addLibraryFromConfig({ type: 'android-saf', token: 'should-not-be-accepted' }),
      /只能由 APK 自动注册/
    );
  } finally {
    AndroidSafProvider.prototype.connect = originalConnect;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
