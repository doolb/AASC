const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const TASKS_DIR = path.join(os.tmpdir(), 'task-io-test-' + Date.now());
const TaskIO = require('./task-io');
const taskIO = new TaskIO({ tasksDir: TASKS_DIR });

let testCount = 0;
let passCount = 0;
async function test(name, fn) { testCount++; try { await fn(); passCount++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name + ': ' + e.message); } }

async function run() {
  console.log('=== TaskIO 测试 ===\n');

  await test('saveTaskFiles: 保存文件到任务目录', async () => {
    const files = [
      { name: 'task.js', data: Buffer.from('console.log("hi")').toString('base64') },
      { name: 'data.json', data: Buffer.from('{"x":1}').toString('base64') }
    ];
    await taskIO.saveTaskFiles('test-task', files);
    const taskPath = path.join(TASKS_DIR, 'test-task');
    assert.ok(fs.existsSync(path.join(taskPath, 'task.js')));
    assert.ok(fs.existsSync(path.join(taskPath, 'data.json')));
    assert.strictEqual(fs.readFileSync(path.join(taskPath, 'task.js'), 'utf8'), 'console.log("hi")');
  });

  await test('resolveRefs: 解析跨任务引用路径', async () => {
    const refs = { 'img.png': 'other-task/results/latest/output.png' };
    const resolved = taskIO.resolveRefs('test-task', refs);
    const expected = path.resolve(TASKS_DIR, 'other-task/results/latest/output.png');
    assert.strictEqual(resolved['img.png'], expected);
  });

  await test('createInstanceDir: 创建实例结果目录', async () => {
    const dir = await taskIO.createInstanceDir('test-task', 'inst-1');
    assert.ok(fs.existsSync(dir));
    assert.strictEqual(path.basename(dir), 'inst-1');
  });

  await test('writeInstanceLog: 写入并追加日志文件', async () => {
    await taskIO.writeInstanceLog('test-task', 'inst-1', 'stdout', 'info', 'hello');
    await taskIO.writeInstanceLog('test-task', 'inst-1', 'stderr', 'error', 'fail');
    const logPath = path.join(TASKS_DIR, 'test-task/results/inst-1/run.log');
    const content = fs.readFileSync(logPath, 'utf8');
    assert.ok(content.includes('[stdout][info] hello'));
    assert.ok(content.includes('[stderr][error] fail'));
  });

  await test('updateLatestLink: 创建最新实例符号链接', async () => {
    const dir = await taskIO.createInstanceDir('test-task', 'link-test');
    await taskIO.updateLatestLink('test-task', 'link-test');
    const linkPath = path.join(TASKS_DIR, 'test-task/results/latest');
    assert.ok(fs.existsSync(linkPath));
    const target = fs.readlinkSync(linkPath);
    assert.ok(target.includes('link-test'));
  });

  await test('updateIndex: 添加实例到索引', async () => {
    await taskIO.updateIndex('test-task', { instanceId: 'inst-1', status: 'running' });
    const idx = await taskIO.getIndex('test-task');
    assert.ok(idx.find(e => e.instanceId === 'inst-1'));
  });

  await test('saveTaskFiles: 支持文件路径引用', async () => {
    // 先保存一个文件
    await taskIO.saveTaskFiles('ref-source', [
      { name: 'ref.txt', data: Buffer.from('reference data').toString('base64') }
    ]);
    // 再用 path 引用已有文件
    await taskIO.saveTaskFiles('ref-target', [
      { name: 'copied.txt', path: '/res/tasks/ref-source/ref.txt' }
    ]);
    const targetPath = path.join(TASKS_DIR, 'ref-target/copied.txt');
    assert.ok(fs.existsSync(targetPath));
    assert.strictEqual(fs.readFileSync(targetPath, 'utf8'), 'reference data');
  });

  await test('cleanupOldInstances: 保留最近 N 个实例', async () => {
    for (let i = 0; i < 5; i++) {
      await taskIO.createInstanceDir('cleanup-test', 'inst-' + i);
      await taskIO.updateIndex('cleanup-test', { instanceId: 'inst-' + i, timestamp: Date.now() + i });
    }
    await taskIO.cleanupOldInstances('cleanup-test', 3);
    const idx = await taskIO.getIndex('cleanup-test');
    assert.strictEqual(idx.length, 3);
    assert.ok(!fs.existsSync(path.join(TASKS_DIR, 'cleanup-test/results/inst-0')));
  });

  await test('_validateSafePath: 拒绝路径遍历攻击', async () => {
    assert.throws(() => taskIO._validateSafePath('/base', '../../../etc/passwd'));
    assert.throws(() => taskIO._validateSafePath('/base', 'subdir/../../../etc/passwd'));
    assert.doesNotThrow(() => taskIO._validateSafePath('/base', 'safe/file.js'));
    assert.doesNotThrow(() => taskIO._validateSafePath('/base', 'subdir/deep/file.js'));
    const resolved = taskIO._validateSafePath('/base', 'file.js');
    assert.strictEqual(resolved, path.resolve('/base', 'file.js'));
  });

  await test('saveTaskFiles: 路径遍历文件名抛出错误', async () => {
    try {
      await taskIO.saveTaskFiles('traversal-test', [
        { name: '../../../etc/passwd', data: Buffer.from('evil').toString('base64') }
      ]);
      assert.fail('应抛出错误但未抛出');
    } catch (e) {
      assert.ok(e.message.includes('路径越界') || e.message.includes('outside'));
    }
  });

  await test('saveTaskFiles: 不存在的源文件路径抛出错误', async () => {
    try {
      await taskIO.saveTaskFiles('missing-source', [
        { name: 'nope.txt', path: '/res/tasks/nonexistent/file.txt' }
      ]);
      assert.fail('应抛出错误但未抛出');
    } catch (e) {
      assert.ok(e.message.includes('源文件不存在'));
    }
  });
}

run().then(() => {
  console.log(`\n结果: ${passCount}/${testCount} 通过`);
  process.exit(passCount === testCount ? 0 : 1);
});

process.on('exit', () => { try { fs.rmSync(TASKS_DIR, { recursive: true, force: true }); } catch(e) {} });
