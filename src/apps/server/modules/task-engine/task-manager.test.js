const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const TaskManager = require('./task-manager');

const TMPDIR = path.join(os.tmpdir(), 'task-manager-test-' + Date.now());
fs.mkdirSync(TMPDIR, { recursive: true });
fs.mkdirSync(path.join(TMPDIR, 'test-task'), { recursive: true });
fs.writeFileSync(path.join(TMPDIR, 'test-task', 'task.js'), `
  module.exports = {
    run: async (ctx) => {
      console.log('hello from managed task');
      return { processed: true };
    }
  };
`);

const manager = new TaskManager({ tasksDir: TMPDIR, maxInstances: 10 });

async function run() {
  let testCount = 0, passCount = 0;
  async function test(name, fn) {
    testCount++;
    try { await fn(); passCount++; console.log('  ✓ ' + name); }
    catch (e) { console.log('  ✗ ' + name + ': ' + e.message); }
  }

  console.log('\n=== TaskManager 测试 ===\n');

  await test('submit: 创建实例并返回 instanceId', async () => {
    const result = await manager.submit({
      taskName: 'test-task',
      taskType: 'user',
      entryFile: 'task.js',
      env: 'cpu',
      target: 'server',
      mode: 'one-shot',
      files: [{ name: 'task.js', data: fs.readFileSync(path.join(TMPDIR, 'test-task', 'task.js')).toString('base64') }]
    });
    assert.ok(result.instanceId);
    assert.ok(result.instanceId.length > 0);
  });

  await test('getInstanceStatus: 查询实例状态', async () => {
    const result = await manager.submit({
      taskName: 'test-task',
      entryFile: 'task.js',
      files: [{ name: 'task.js', data: fs.readFileSync(path.join(TMPDIR, 'test-task', 'task.js')).toString('base64') }]
    });
    const status = await manager.getInstanceStatus('test-task', result.instanceId);
    assert.ok(status);
    assert.ok(status.instanceId);
  });

  await test('stopInstance: 停止不存在的实例返回失败', async () => {
    const result = await manager.stopInstance('test-task', 'non-existent');
    assert.ok(!result.success);
  });

  await test('task:progress 事件触发', async () => {
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('未收到 progress 事件')), 3000);
      manager.once('progress', (instanceId, stage) => {
        clearTimeout(timeout);
        assert.ok(instanceId);
        resolve();
      });
      await manager.submit({
        taskName: 'test-task',
        entryFile: 'task.js',
        files: [{ name: 'task.js', data: fs.readFileSync(path.join(TMPDIR, 'test-task', 'task.js')).toString('base64') }]
      });
    });
  });

  console.log('\n结果: ' + passCount + '/' + testCount + ' 通过');
  process.exit(passCount === testCount ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
process.on('exit', () => { try { fs.rmSync(TMPDIR, { recursive: true, force: true }); } catch(e) {} });
