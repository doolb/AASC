'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    createDataRepairRunner,
    FORMAT,
    SCHEMA_VERSION,
    sha256Buffer,
    validatePendingRepair
} = require('./data-repair-js-runner');

const createTempRoot = () => fs.mkdtemp(path.join(os.tmpdir(), 'aasc-data-repair-'));

async function writeRepair(root, source, overrides = {}) {
    const scriptPath = path.join(root, 'updates', 'data-repair', 'data-repair-v1', 'repair.js');
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, source, 'utf8');
    const pending = {
        format: FORMAT,
        schemaVersion: SCHEMA_VERSION,
        repairId: 'test-repair-1',
        repairVersion: 1,
        requiredCodeVersion: 1,
        requiredDataVersion: 0,
        targetDataVersion: 1,
        script: path.relative(root, scriptPath).split(path.sep).join('/'),
        scriptSha256: sha256Buffer(Buffer.from(source, 'utf8')),
        capabilities: ['config'],
        ...overrides
    };
    await fs.mkdir(path.join(root, 'data-repair'), { recursive: true });
    await fs.writeFile(path.join(root, 'data-repair', 'pending-repair.json'), JSON.stringify(pending), 'utf8');
    return { scriptPath, pending };
}

test('repair.js 可以调用原有配置服务并按 repairId 只成功执行一次', async () => {
    const root = await createTempRoot();
    const configPath = path.join(root, 'config.json');
    await fs.writeFile(configPath, JSON.stringify({ value: 1 }), 'utf8');
    const config = {
        async get(key) {
            const value = JSON.parse(await fs.readFile(configPath, 'utf8'));
            return value[key];
        },
        async set(key, value) {
            const current = JSON.parse(await fs.readFile(configPath, 'utf8'));
            current[key] = value;
            await fs.writeFile(configPath, JSON.stringify(current), 'utf8');
        }
    };
    const source = `module.exports = async ({ services, assert }) => {
        assert(typeof process === 'undefined', 'process 不应注入修复脚本');
        assert(typeof services.config.set === 'function', 'config.set 未注入');
        await services.config.set('value', 2);
    };`;
    await writeRepair(root, source);
    const runner = createDataRepairRunner({
        projectRoot: root,
        codeVersion: 1,
        services: { config },
        managedFiles: [configPath]
    });

    const first = await runner.applyPendingRepair();
    assert.equal(first.status, 'applied');
    assert.deepEqual(JSON.parse(await fs.readFile(configPath, 'utf8')), { value: 2 });
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'data-repair', 'state.json'), 'utf8')).dataVersion, 1);
    assert.equal(await fs.stat(path.join(root, 'data-repair', 'pending-repair.json')).then(() => true).catch(() => false), false);
    await fs.rm(root, { recursive: true, force: true });
});

test('repair.js 失败时回滚原有业务类已经落盘的修改并允许重试', async () => {
    const root = await createTempRoot();
    const configPath = path.join(root, 'config.json');
    await fs.writeFile(configPath, JSON.stringify({ value: 1 }), 'utf8');
    const config = {
        async set(key, value) {
            const current = JSON.parse(await fs.readFile(configPath, 'utf8'));
            current[key] = value;
            await fs.writeFile(configPath, JSON.stringify(current), 'utf8');
        }
    };
    const source = `module.exports = async ({ services }) => {
        await services.config.set('value', 99);
        throw new Error('故意失败');
    };`;
    await writeRepair(root, source);
    const runner = createDataRepairRunner({
        projectRoot: root,
        codeVersion: 1,
        services: { config },
        managedFiles: [configPath]
    });

    const result = await runner.applyPendingRepair();
    assert.equal(result.status, 'rolled-back');
    assert.deepEqual(JSON.parse(await fs.readFile(configPath, 'utf8')), { value: 1 });
    assert.equal(await fs.stat(path.join(root, 'data-repair', 'pending-repair.json')).then(() => true).catch(() => false), true);
    await fs.rm(root, { recursive: true, force: true });
});

test('包含 Chat2API 账号能力时必须显式声明敏感配置', async () => {
    assert.throws(
        () => validatePendingRepair({
            format: FORMAT,
            schemaVersion: SCHEMA_VERSION,
            repairId: 'test-repair-1',
            repairVersion: 1,
            requiredCodeVersion: 1,
            requiredDataVersion: 0,
            targetDataVersion: 1,
            script: 'repair.js',
            scriptSha256: '0'.repeat(64),
            capabilities: ['chat2api.accounts']
        }),
        (error) => error instanceof Error
    );
});
