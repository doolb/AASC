const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const NodeJsRunner = require('./nodejs-runner');

const TMPDIR = path.join(os.tmpdir(), 'nodejs-runner-test-' + Date.now());
fs.mkdirSync(TMPDIR, { recursive: true });

const runner = new NodeJsRunner();

async function run() {
  let testCount = 0;
  let passCount = 0;
  async function test(name, fn) {
    testCount++;
    try { await fn(); passCount++; console.log('  ✓ ' + name); }
    catch (e) { console.log('  ✗ ' + name + ': ' + e.message); }
  }

  console.log('\n=== NodeJsRunner 测试 ===\n');

  await test('run: 执行简单脚本并捕获日志', async () => {
    const workDir = path.join(TMPDIR, 'simple');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'task.js'), `
      module.exports = {
        run: async (ctx) => {
          console.log('hello from task');
          return { result: 42 };
        }
      };
    `);

    const result = await runner.run({
      entryFile: 'task.js',
      workDir,
      context: { params: {} }
    });

    assert.ok(result.success);
    assert.ok(result.logs.some(l => l.message.includes('hello from task')));
  });

  await test('run: 超时自动终止', async () => {
    const workDir = path.join(TMPDIR, 'timeout');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'task.js'), `
      module.exports = {
        run: async (ctx) => {
          await new Promise(r => setTimeout(r, 10000));
          return {};
        }
      };
    `);

    const result = await runner.run({
      entryFile: 'task.js',
      workDir,
      context: { params: {} },
      timeout: 500
    });

    assert.ok(!result.success);
    assert.strictEqual(result.error, 'timeout');
  });

  await test('run: 执行异常捕获', async () => {
    const workDir = path.join(TMPDIR, 'error');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'task.js'), `
      module.exports = {
        run: async (ctx) => {
          throw new Error('oops');
        }
      };
    `);

    const result = await runner.run({
      entryFile: 'task.js',
      workDir,
      context: { params: {} }
    });

    assert.ok(!result.success);
    assert.ok(result.error);
  });

  await test('run: console.warn 捕获到 stderr', async () => {
    const workDir = path.join(TMPDIR, 'warn');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'task.js'), `
      module.exports = {
        run: async (ctx) => {
          console.warn('warning message');
          return {};
        }
      };
    `);

    const result = await runner.run({
      entryFile: 'task.js',
      workDir,
      context: { params: {} }
    });

    assert.ok(result.success);
    assert.ok(result.logs.some(l => l.stream === 'stderr' && l.message.includes('warning message')));
  });

  console.log('\n结果: ' + passCount + '/' + testCount + ' 通过');
  process.exit(passCount === testCount ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
