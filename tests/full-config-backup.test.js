'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { resolveReleaseRuntimeContext } = require('../src/core/release-runtime-context');
const { pipeline } = require('node:stream/promises');
const { ZipFile } = require('yazl');
const express = require('express');
const { createFullConfigBackupService, validateManifest, LIMITS } = require('../src/apps/server/modules/config/full-config-backup-service');
const { mountFullConfigBackupRoutes } = require('../src/apps/server/modules/config/full-config-backup-http');

function fixture(t, name, extra = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `aasc-full-backup-${name}-`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const context = { configFile: path.join(root, 'release/config/config.json'), userConfigDir: path.join(root, 'release/userconfig') };
    fs.mkdirSync(path.dirname(context.configFile), { recursive: true });
    fs.mkdirSync(context.userConfigDir, { recursive: true });
    fs.writeFileSync(context.configFile, JSON.stringify({ server: { port: 8081 }, custom: name }));
    const write = (name, value) => {
        const target = path.join(root, 'release', name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
    };
    const read = name => fs.readFileSync(path.join(root, 'release', name), 'utf8');
    const service = createFullConfigBackupService({ projectRoot: root, context, ...extra });
    return { root, context, write, read, service };
}

async function zipFixture(t, files, manifestOverride, modeOverride = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-backup-zip-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const archive = path.join(directory, 'backup.zip');
    const manifest = { format: 'aasc-full-config', version: 1, files: files.map(([name, body]) => ({ path: name,
        size: Buffer.byteLength(body), sha256: crypto.createHash('sha256').update(body).digest('hex') })) };
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify(manifestOverride || manifest)), 'manifest.json');
    for (const [name, body] of files) zip.addBuffer(Buffer.from(body), name, modeOverride[name] || {});
    const written = pipeline(zip.outputStream, fs.createWriteStream(archive));
    zip.end();
    await written;
    return archive;
}

test('全局、用户、聊天与凭证 ZIP 往返；确认后等待新启动应用，合并保留额外文件', async t => {
    let flushes = 0;
    const source = fixture(t, 'source', { prepareExport: () => { flushes += 1; } });
    source.write('config/capabilities.json', { available: ['chat'] });
    source.write('userconfig/userconfig.json', { displayStates: { example: { volume: 30 } } });
    source.write('userconfig/chat-history.json', [{ id: 'group', role: 'user', content: '群聊' }]);
    source.write('userconfig/chat-history-小爱.json', [{ id: 'private', sessionId: 'two', content: '私聊' }]);
    source.write('userconfig/ai-roles/role/history.json', [{ content: '角色' }]);
    source.write('userconfig/chat2api/accounts.json', [{ credentials: { apiKey: 'fictional-key' } }]);
    source.write('userconfig/server.pid', '123');
    source.write('userconfig/logs/server.log', 'runtime');
    source.write('userconfig/data.json.tmp-abcd', '{}');
    const archive = await source.service.exportArchive();
    t.after(archive.dispose);
    assert.equal(flushes, 1);
    assert.equal(archive.manifest.files.length, 7);
    assert.ok(!archive.manifest.files.some(file => /\.pid|logs|\.tmp-/u.test(file.path)));
    const target = fixture(t, 'target');
    target.write('userconfig/extra.json', { keep: true });
    const original = target.read('config/config.json');
    const preview = await target.service.previewArchive(archive.archivePath);
    assert.equal(preview.configFiles, 2);
    assert.equal(preview.userFiles, 5);
    target.service.commitPreview(preview.id, 'merge', true);
    assert.equal(target.read('config/config.json'), original);
    assert.equal(target.service.status().status, 'pending');
    const restarted = createFullConfigBackupService({ projectRoot: target.root, context: target.context });
    assert.equal(restarted.applyPending().status, 'applied');
    for (const file of archive.manifest.files) assert.equal(target.read(file.path), source.read(file.path));
    assert.deepEqual(JSON.parse(target.read('userconfig/extra.json')), { keep: true });
    assert.equal(restarted.applyPending(), null);
});

test('完整替换只删除受管多余文件，运行日志和链接保留', async t => {
    const source = fixture(t, 'source');
    const target = fixture(t, 'target');
    target.write('config/extra.json', { old: true });
    target.write('userconfig/server.log', 'keep-runtime');
    target.write('userconfig/cache/a.json', '{}');
    fs.symlinkSync('/outside-missing-file', path.join(target.context.userConfigDir, 'link.json'));
    const archive = await source.service.exportArchive(); t.after(archive.dispose);
    const preview = await target.service.previewArchive(archive.archivePath, 'replace');
    assert.equal(preview.deleted, 1);
    assert.throws(() => target.service.commitPreview(preview.id, 'replace', false), /确认/u);
    target.service.commitPreview(preview.id, 'replace', true);
    target.service.applyPending();
    assert.equal(fs.existsSync(path.join(target.root, 'release/config/extra.json')), false);
    assert.equal(target.read('userconfig/server.log'), 'keep-runtime');
    assert.equal(fs.lstatSync(path.join(target.context.userConfigDir, 'link.json')).isSymbolicLink(), true);
    assert.equal(target.read('userconfig/cache/a.json'), '{}');
});

test('导入过程中失败回滚全局/用户数据，并移除新写入的文件', async t => {
    const source = fixture(t, 'source');
    source.write('userconfig/new.json', { new: true });
    const target = fixture(t, 'target', { afterApplyFile: name => { if (name.startsWith('userconfig/')) throw new Error('模拟写盘失败'); } });
    const original = target.read('config/config.json');
    const archive = await source.service.exportArchive(); t.after(archive.dispose);
    const preview = await target.service.previewArchive(archive.archivePath);
    target.service.commitPreview(preview.id, 'merge', true);
    const result = target.service.applyPending();
    assert.equal(result.status, 'failed');
    assert.equal(result.rolledBack, true);
    assert.equal(target.read('config/config.json'), original);
    assert.equal(fs.existsSync(path.join(target.context.userConfigDir, 'new.json')), false);
    assert.equal(target.service.applyPending(), null);
});

test('应用前再次检查暂存 SHA-256；取消及模式变更不写入数据', async t => {
    const source = fixture(t, 'source'); const target = fixture(t, 'target');
    const archive = await source.service.exportArchive(); t.after(archive.dispose);
    const first = await target.service.previewArchive(archive.archivePath);
    assert.throws(() => target.service.commitPreview(first.id, 'replace', true), /模式/u);
    target.service.cancelPreview(first.id);
    assert.throws(() => target.service.commitPreview(first.id, 'merge', true), /不存在/u);
    const next = await target.service.previewArchive(archive.archivePath);
    const original = target.read('config/config.json');
    target.service.commitPreview(next.id, 'merge', true);
    fs.writeFileSync(path.join(target.service.stateRoot, 'previews', next.id, 'payload/config/config.json'), '{}');
    assert.equal(target.service.applyPending().status, 'failed');
    assert.equal(target.read('config/config.json'), original);
});

test('拒绝错误哈希、非法范围、重复条目、链接条目与非法 JSON', async t => {
    const target = fixture(t, 'target');
    const config = ['config/config.json', '{"server":{"port":8081}}'];
    const badHash = { format: 'aasc-full-config', version: 1, files: [{ path: config[0], size: Buffer.byteLength(config[1]), sha256: '0'.repeat(64) }] };
    await assert.rejects(target.service.previewArchive(await zipFixture(t, [config], badHash)), /SHA-256/u);
    await assert.rejects(target.service.previewArchive(await zipFixture(t, [config, ['other/file.json', '{}']])), /路径/u);
    await assert.rejects(target.service.previewArchive(await zipFixture(t, [config, config])), /重复/u);
    await assert.rejects(target.service.previewArchive(await zipFixture(t, [config], null, { [config[0]]: { mode: 0o120777 } })), /链接/u);
    await assert.rejects(target.service.previewArchive(await zipFixture(t, [['config/config.json', '{bad']])), /JSON/u);
    const manifest = { format: 'aasc-full-config', version: 1, files: [{ path: 'config/../outside.json', size: 2, sha256: '0'.repeat(64) }] };
    assert.throws(() => validateManifest(manifest), /路径/u);
    assert.throws(() => validateManifest({ ...manifest, files: [{ ...manifest.files[0], path: 'config/config.json', size: LIMITS.fileBytes + 1 }] }), /大小/u);
});

test('配置目标中的父目录链接不能用于越界写入', async t => {
    const source = fixture(t, 'source'); const target = fixture(t, 'target');
    source.write('userconfig/ai-roles/role.json', { name: 'example' });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aasc-backup-outside-')); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
    fs.symlinkSync(outside, path.join(target.context.userConfigDir, 'ai-roles'));
    const archive = await source.service.exportArchive(); t.after(archive.dispose);
    await assert.rejects(target.service.previewArchive(archive.archivePath), /链接/u);
    assert.equal(fs.readdirSync(outside).length, 0);
});

test('工作目录父链接被拒绝，预览超时不能确认且只清理过期未确认事务', async t => {
    const source = fixture(t, 'source'); const target = fixture(t, 'target');
    const archive = await source.service.exportArchive(); t.after(archive.dispose);
    const preview = await target.service.previewArchive(archive.archivePath);
    const requestPath = path.join(target.service.stateRoot, 'previews', preview.id, 'request.json');
    const request = JSON.parse(fs.readFileSync(requestPath));
    fs.writeFileSync(requestPath, JSON.stringify({ ...request, createdAt: Date.now() - 31 * 60 * 1000 }));
    assert.throws(() => target.service.commitPreview(preview.id, 'merge', true), /过期/u);
    target.service.prepareUpload();
    assert.equal(fs.existsSync(requestPath), false);
    const outside = path.join(target.root, 'outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(target.service.stateRoot, 'exports'));
    await assert.rejects(target.service.exportArchive(), /链接/u);
    assert.deepEqual(fs.readdirSync(outside), []);
});

test('进程在恢复写入时退出；下次启动从 journal 回滚，不加载半份配置', async t => {
    const source = fixture(t, 'source'); const target = fixture(t, 'target');
    source.write('userconfig/new.json', { new: true });
    const original = target.read('config/config.json');
    const archive = await source.service.exportArchive(); t.after(archive.dispose);
    const preview = await target.service.previewArchive(archive.archivePath);
    target.service.commitPreview(preview.id, 'merge', true);
    const modulePath = require.resolve('../src/apps/server/modules/config/full-config-backup-service');
    const script = `require(${JSON.stringify(modulePath)}).createFullConfigBackupService({afterApplyFile:()=>process.exit(73)}).applyPending()`;
    assert.throws(() => execFileSync(process.execPath, ['-e', script], {
        env: { ...process.env, AASC_PROJECT_ROOT: target.root, AASC_RELEASE_MODE: '1' }, stdio: 'pipe'
    }), error => error.status === 73);
    assert.equal(target.read('config/config.json'), source.read('config/config.json'));
    const restarted = createFullConfigBackupService({ projectRoot: target.root, context: target.context });
    const result = restarted.applyPending();
    assert.equal(result.status, 'failed'); assert.equal(result.rolledBack, true);
    assert.match(result.message, /中断/u);
    assert.equal(target.read('config/config.json'), original);
    assert.equal(fs.existsSync(path.join(target.context.userConfigDir, 'new.json')), false);
});

test('普通与 release 目录映射一致；独立新进程先恢复再加载真实配置模块', async t => {
    const source = fixture(t, 'source'); const target = fixture(t, 'target');
    const normal = resolveReleaseRuntimeContext({ projectRoot: target.root, homeDir: path.join(target.root, 'home'), argv: [], environment: {} });
    const ordinary = createFullConfigBackupService({ projectRoot: target.root, context: normal });
    assert.equal(ordinary.roots.config, path.join(target.root, 'config'));
    assert.equal(ordinary.roots.userconfig, path.join(target.root, 'home/.config/aasc-user'));
    fs.mkdirSync(path.join(target.root, 'release/task'), { recursive: true });
    const archive = await source.service.exportArchive(); t.after(archive.dispose);
    const preview = await target.service.previewArchive(archive.archivePath);
    target.service.commitPreview(preview.id, 'merge', true);
    const modulePath = require.resolve('../src/apps/server/modules/config/full-config-backup-service');
    const configPath = require.resolve('../src/apps/server/modules/config/config-app-service');
    const script = `require(${JSON.stringify(modulePath)}).applyPendingConfigImport(); const config=require(${JSON.stringify(configPath)}); console.log('RESTORED='+config.get('custom'));`;
    const output = execFileSync(process.execPath, ['-e', script], {
        env: { ...process.env, AASC_PROJECT_ROOT: target.root, AASC_RELEASE_MODE: '1' }, encoding: 'utf8', timeout: 15000
    });
    assert.match(output, /RESTORED=source/u);
    assert.equal(target.service.status().status, 'applied');
});

test('24 MiB 聊天文件通过流式 ZIP 往返，正式数据只在启动应用时写入', async t => {
    const source = fixture(t, 'source'); const target = fixture(t, 'target');
    const content = JSON.stringify([{ role: 'user', content: '聊天'.repeat(4 * 1024 * 1024) }]);
    source.write('userconfig/chat-history.json', content);
    const started = performance.now();
    const archive = await source.service.exportArchive(); t.after(archive.dispose);
    const preview = await target.service.previewArchive(archive.archivePath);
    target.service.commitPreview(preview.id, 'merge', true);
    assert.equal(target.service.applyPending().status, 'applied');
    assert.equal(target.read('userconfig/chat-history.json'), content);
    t.diagnostic(`24 MiB 聊天往返 ${Math.round(performance.now() - started)} ms；进程峰值 RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MiB（包含测试夹具）`);
});

test('真实 HTTP ZIP 上传、预览与确认后幂等自动重启；未托管/取消不重启', async t => {
    const source = fixture(t, 'source'); const target = fixture(t, 'target');
    const archive = await source.service.exportArchive(); t.after(archive.dispose);
    const app = express(); app.use(express.json());
    let restartCount = 0; let managed = true;
    mountFullConfigBackupRoutes(app, { service: target.service, canRestart: () => managed, requestRestart: () => { restartCount += 1; } });
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    const form = new FormData(); form.append('mode', 'merge'); form.append('backup', new Blob([fs.readFileSync(archive.archivePath)]), 'backup.zip');
    const response = await fetch(`${base}/api/config-backup/preview`, { method: 'POST', body: form });
    assert.equal(response.status, 200);
    const { preview } = await response.json();
    assert.equal(restartCount, 0);
    const confirm = () => fetch(`${base}/api/config-backup/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: preview.id, mode: 'merge', confirmed: true }) });
    managed = false;
    assert.equal((await confirm()).status, 409);
    assert.equal(target.service.status().status, 'idle');
    managed = true;
    const accepted = await confirm(); assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).restarting, true);
    assert.equal(restartCount, 1);
    assert.equal((await confirm()).status, 409);
    assert.equal(restartCount, 1);
    const exported = await fetch(`${base}/api/config-backup/export`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition'), /\.zip/u);
    assert.equal(exported.headers.get('cache-control'), 'no-store');
    await exported.arrayBuffer();
});
