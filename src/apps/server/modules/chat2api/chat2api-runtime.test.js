const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createChat2ApiRuntime } = require('./chat2api-runtime');

test('Chat2API runtime 共享数据层并可启动/停止代理服务', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-chat2api-runtime-'));
  const runtime = createChat2ApiRuntime({ rootDir, host: '127.0.0.1', port: 0, enableApiKey: false });
  await runtime.start();
  assert.equal(runtime.proxy.isRunning(), true);
  assert.equal(runtime.proxy.address().address, '127.0.0.1');
  await runtime.stop();
  assert.equal(runtime.proxy.isRunning(), false);
});
