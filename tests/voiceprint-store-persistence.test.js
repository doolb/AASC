const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const source = fs.readFileSync('src/apps/server/modules/voiceprint/voiceprint-store.js', 'utf8');

function fixture(t) {
    const cache = path.join(os.homedir(), '.cache/aasc-voiceprint-tests');
    fs.mkdirSync(cache, { recursive: true });
    const root = fs.mkdtempSync(path.join(cache, 'store-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

function install(codeRoot) {
    const modulePath = path.join(codeRoot, 'src/apps/server/modules/voiceprint/voiceprint-store.js');
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(modulePath, source);
    return modulePath;
}

function run(modulePath, projectRoot, action = '') {
    const env = { ...process.env, AASC_OFFLINE_MODE: '1' };
    delete env.AASC_PROJECT_ROOT;
    if (projectRoot) env.AASC_PROJECT_ROOT = projectRoot;
    // 每次独立进程加载正式模块，模拟实际服务版本切换，而不是模拟存储方法。
    return JSON.parse(execFileSync(process.execPath, ['-e',
        `const store = require(${JSON.stringify(modulePath)}); ${action}; console.log(JSON.stringify(store.getSpeakers()));`
    ], { env, encoding: 'utf8' }).trim());
}

function writeDb(root, name) {
    const file = path.join(root, 'res/voiceprint/db.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, dim: 512, speakers: { [name]: Array(512).fill(0.1) } }));
    return file;
}

test('未设置数据根时保留普通非Android项目根目录', (t) => {
    const root = fixture(t);
    writeDb(root, 'desktop-test');
    assert.deepEqual(run(install(root)), ['desktop-test']);
});

test('显式数据根优先于代码根已有库', (t) => {
    const root = fixture(t);
    const code = path.join(root, 'code');
    const data = path.join(root, 'data');
    const old = writeDb(code, 'old-code-test');
    const before = fs.readFileSync(old);
    writeDb(data, 'fixed-root-test');
    assert.deepEqual(run(install(code), data), ['fixed-root-test']);
    assert.deepEqual(fs.readFileSync(old), before);
});

test('从不同code-v版本启动时注册和删除始终保存在同一数据根', (t) => {
    const root = fixture(t);
    const a = install(path.join(root, 'updates/code/code-v1'));
    const b = install(path.join(root, 'updates/code/code-v2'));
    const c = install(path.join(root, 'updates/code/code-v3'));
    assert.deepEqual(run(a, root, "store.add('persistent-test', Array(512).fill(0.1))"), ['persistent-test']);
    assert.ok(fs.existsSync(path.join(root, 'res/voiceprint/db.json')));
    assert.equal(fs.existsSync(path.join(path.dirname(a), '../../../../../res/voiceprint/db.json')), false);
    assert.deepEqual(run(b, root), ['persistent-test']);
    assert.deepEqual(run(b, root, "store.remove('persistent-test')"), []);
    assert.deepEqual(run(c, root), []);
});

test('按用户要求不扫描或恢复旧版本声纹库', (t) => {
    const root = fixture(t);
    const oldRoot = path.join(root, 'updates/code/code-v1');
    const old = writeDb(oldRoot, 'legacy-test');
    const before = fs.readFileSync(old);
    const modulePath = install(path.join(root, 'updates/code/code-v2'));
    assert.deepEqual(run(modulePath, root), []);
    assert.equal(fs.existsSync(path.join(root, 'res/voiceprint')), false);
    assert.deepEqual(fs.readFileSync(old), before);
});
