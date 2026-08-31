const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const task = require('./tts-server');
const registry = require('./registry');

function createFakeChild() {
  const child = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => child.emit('exit', 0, 'SIGTERM'));
    return true;
  };
  return child;
}

test('tts.server 注册为唯一的 server service 内置任务', () => {
  const registered = registry.getTask('tts.server');

  assert.equal(registered, task);
  assert.equal(registered.id, 'tts.server');
  assert.equal(registered.target, 'server');
  assert.equal(registered.mode, 'service');
  assert.deepEqual(
    registered.params.map((item) => item.name),
    ['engine', 'port']
  );
});

test('Wine 实例启动本机 HTTP 服务并更新通用 TTS URL，停止时恢复 URL', async () => {
  const child = createFakeChild();
  const spawnCalls = [];
  const urls = [];
  const readyUrls = [];
  const runtime = await task.run({
    params: { engine: 'wine', port: 3211 },
    projectRoot: '/project',
    ttsServerSpawn: (file, args, options) => {
      spawnCalls.push({ file, args, options });
      return child;
    },
    ttsServerCheckReady: async (url) => {
      readyUrls.push(url);
      return true;
    },
    getTtsServiceUrl: () => 'http://old.example/api/tts',
    setTtsServiceUrl: (url) => urls.push(url)
  });

  assert.equal(runtime.type, 'service');
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].file, process.execPath);
  assert.deepEqual(spawnCalls[0].args, ['/project/3rd/tts-server/tts-wine.js']);
  assert.equal(spawnCalls[0].options.cwd, '/project/3rd/tts-server');
  assert.equal(spawnCalls[0].options.env.PORT, '3211');
  assert.equal(spawnCalls[0].options.env.WINEPREFIX, '/project/3rd/tts-server/wine/runtime/prefix');
  assert.equal(readyUrls[0], 'http://127.0.0.1:3211/api/tts/status');
  assert.equal(urls[0], 'http://127.0.0.1:3211/api/tts');

  await runtime.stop();
  assert.equal(child.killed, true);
  assert.equal(urls.at(-1), 'http://old.example/api/tts');
});

test('Linux 实例使用共享模型目录，服务启动失败时终止子进程', async () => {
  const child = createFakeChild();
  const spawnCalls = [];

  await assert.rejects(
    task.run({
      params: { engine: 'linux', port: 3212 },
      projectRoot: '/project',
      ttsServerSpawn: (file, args, options) => {
        spawnCalls.push({ file, args, options });
        return child;
      },
      ttsServerCheckReady: async () => false,
      ttsServerStartTimeoutMs: 10,
      ttsServerPollIntervalMs: 1
    }),
    /TTS 服务启动超时/
  );

  assert.equal(spawnCalls[0].args[0], '/project/3rd/tts-server/tts-linux.js');
  assert.equal(spawnCalls[0].options.env.PORT, '3212');
  assert.equal(spawnCalls[0].options.env.TTS_LINUX_BIN, '/project/3rd/tts-server/linux/bin/tts_linux');
  assert.equal(spawnCalls[0].options.env.TTS_LINUX_MODEL_DIR, '/project/3rd/tts-server/models/extracted');
  assert.equal(spawnCalls[0].options.env.TTS_LINUX_SDK_DIR, '/project/3rd/tts-server/linux/lib');
  assert.equal(child.killed, true);
});

test('拒绝不支持的引擎和实例端口', async () => {
  await assert.rejects(
    task.run({ params: { engine: 'balcon', port: 3213 } }),
    /engine 必须是 wine 或 linux/
  );
  await assert.rejects(
    task.run({ params: { engine: 'wine', port: 80 } }),
    /port 必须是 1024 到 65535 的整数/
  );
});
