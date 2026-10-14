'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prepareReleaseRepairs, recoverReleaseTransaction } = require('../scripts/ops/offline-data-repair-seeds');
const { sha256Buffer } = require('../src/apps/server/modules/data-repair/data-repair-js-runner');
const { readBaseline, initializeReleaseBaseline } = require('../src/apps/server/modules/data-repair/data-repair-baseline');

async function fixture(t, script = "module.exports=async({services,assert})=>{await services.config.set('voiceprint.test',true);assert(services.config.get('voiceprint.test')===true,'未保存');};") {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-seed-repair-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    for (const directory of ['config', 'userconfig', 'task']) await fs.mkdir(path.join(root, 'release', directory), { recursive: true });
    await fs.writeFile(path.join(root, 'release/config/config.json'), '{"keep":"original"}\n');
    const file = path.join(root, 'repair.js'); await fs.writeFile(file, script);
    return { root, repair: { script: file, metadata: { repairId: 'seed-test-1', repairVersion: 1,
        requiredCodeVersion: 1, requiredDataVersion: 0, targetDataVersion: 1, capabilities: ['config'], scriptSha256: sha256Buffer(Buffer.from(script)) } } };
}

test('真实业务脚本隔离修改release，配置与数据基线共同提交，旧状态不覆盖', async t => {
    const { root, repair } = await fixture(t);
    const tx = await prepareReleaseRepairs({ projectRoot: root, repairs: [repair] }); t.after(tx.dispose);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'release/config/config.json'))).voiceprint, undefined);
    await tx.commit();
    const config = JSON.parse(await fs.readFile(path.join(root, 'release/config/config.json')));
    assert.deepEqual(config, { keep: 'original', voiceprint: { test: true } });
    const baseline = await readBaseline(path.join(root, 'release'));
    assert.equal(baseline.dataVersion, 1); assert.equal(baseline.includedRepairs[0].repairId, repair.metadata.repairId);
    assert.equal(await initializeReleaseBaseline(root, path.join(root, 'release'), true), true);
    await fs.writeFile(path.join(root, 'data-repair/state.json'), '{"dataVersion":9}');
    assert.equal(await initializeReleaseBaseline(root, path.join(root, 'release'), true), false);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'data-repair/state.json'))).dataVersion, 9);
});

test('修复脚本失败不会修改release配置或抬高版本', async t => {
    const { root, repair } = await fixture(t, "module.exports=async({services})=>{await services.config.set('keep','bad');throw Error('failed');};");
    await assert.rejects(prepareReleaseRepairs({ projectRoot: root, repairs: [repair] }), /修复未完成/u);
    assert.equal(await fs.readFile(path.join(root, 'release/config/config.json'), 'utf8'), '{"keep":"original"}\n');
    assert.equal(await readBaseline(path.join(root, 'release')), null);
});

test('提交失败回滚配置/版本/产物，期间并发修改不会被覆盖', async t => {
    const { root, repair } = await fixture(t);
    const tx = await prepareReleaseRepairs({ projectRoot: root, repairs: [repair] }); t.after(tx.dispose);
    await assert.rejects(tx.commit([], undefined, () => { throw Error('模拟写入后失败'); }));
    assert.equal(await fs.readFile(path.join(root, 'release/config/config.json'), 'utf8'), '{"keep":"original"}\n');
    assert.equal(await readBaseline(path.join(root, 'release')), null);
    await fs.writeFile(path.join(root, 'release/config/config.json'), '{"keep":"concurrent"}\n');
    await assert.rejects(tx.commit(), /发生变化/u);
    assert.equal(await fs.readFile(path.join(root, 'release/config/config.json'), 'utf8'), '{"keep":"concurrent"}\n');
});

test('现有两项修复按0到1到2写入实际种子，不伪造设备运行记录', async t => {
    const { root } = await fixture(t);
    const declarations = [
        ['voiceprint-tts-v1', 'enable-voice-input-during-tts-without-voiceprint-v1', ['config']],
        ['hide-offline-display-status-bar-v2', 'hide-offline-display-status-bar-v2', ['user-config']]
    ];
    const repairs = [];
    for (const [index, [directory, id, capabilities]] of declarations.entries()) {
        const script = path.resolve(__dirname, '../release/offline-update/repair-sources', directory, 'repair.js');
        repairs.push({ script, metadata: { repairId: id, repairVersion: index + 1, requiredCodeVersion: 1,
            requiredDataVersion: index, targetDataVersion: index + 1, capabilities, scriptSha256: sha256Buffer(await fs.readFile(script)) } });
    }
    const tx = await prepareReleaseRepairs({ projectRoot: root, repairs }); t.after(tx.dispose); await tx.commit();
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'release/config/config.json'))).voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint, true);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'release/userconfig/userconfig.json'))).displayStates['offline-display'].showStatusBar, false);
    assert.equal((await readBaseline(path.join(root, 'release'))).dataVersion, 2);
    assert.equal(await fs.stat(path.join(root, 'data-repair/state.json')).then(() => true).catch(() => false), false);
});

test('中断提交恢复已改变的配置并删除本事务新增文件，不跟随符号链接', async t => {
    const { root } = await fixture(t);
    const file = path.join(root, 'release/config/config.json');
    const baseline = path.join(root, 'release/config/data-repair-state.json');
    const journal = path.join(root, 'release/.data-repair-seed-transaction.json');
    const original = await fs.readFile(file);
    await fs.writeFile(file, '{"partial":true}'); await fs.writeFile(baseline, '{"dataVersion":99}');
    await fs.writeFile(journal, JSON.stringify({ schemaVersion: 1, pid: 2147483647, snapshots: [
        { filePath: file, exists: true, content: original.toString('base64') }, { filePath: baseline, exists: false, content: '' }
    ] }));
    assert.equal(await recoverReleaseTransaction(root), true);
    assert.deepEqual(await fs.readFile(file), original);
    assert.equal(await fs.stat(baseline).then(() => true).catch(() => false), false);
    await fs.symlink(file, journal);
    await assert.rejects(recoverReleaseTransaction(root), /日志无效/u);
});

test('累计脚本在旧0/1环境补修，在版本2保留用户后续状态栏偏好', async t => {
    for (const version of [0, 1, 2]) {
        const { root } = await fixture(t);
        const releaseRoot = path.join(root, 'release');
        const configuration = { keep: 'original', voiceprint: { acceptVoiceInputDuringTtsWithoutVoiceprint: version > 0 } };
        await fs.writeFile(path.join(releaseRoot, 'config/config.json'), JSON.stringify(configuration));
        await fs.writeFile(path.join(releaseRoot, 'userconfig/userconfig.json'), JSON.stringify({ displayStates: { 'offline-display': { displayId: 'offline-display', showStatusBar: true } } }));
        const files = [];
        for (const name of ['config/config.json', 'userconfig/userconfig.json']) {
            const bytes = await fs.readFile(path.join(releaseRoot, name)); files.push({ path: name, size: bytes.length, sha256: sha256Buffer(bytes) });
        }
        await fs.writeFile(path.join(releaseRoot, 'config/data-repair-state.json'), JSON.stringify({ format: 'aasc-offline-data-baseline', schemaVersion: 1,
            dataVersion: version, latestRepairVersion: version, includedRepairs: [], files }));
        const script = path.resolve(__dirname, '../release/offline-update/repair-sources/offline-config-baseline-v3/repair.js');
        const tx = await prepareReleaseRepairs({ projectRoot: root, repairs: [{ script, metadata: { repairId: 'cumulative-3', repairVersion: 3,
            requiredCodeVersion: 1, requiredApkVersionCode: 46, requiredDataVersion: 0, targetDataVersion: 3,
            compatibleDataVersions: [0, 1, 2], capabilities: ['config', 'user-config'], scriptSha256: sha256Buffer(await fs.readFile(script)) } }] });
        t.after(tx.dispose); await tx.commit();
        const user = JSON.parse(await fs.readFile(path.join(releaseRoot, 'userconfig/userconfig.json')));
        assert.equal(user.displayStates['offline-display'].showStatusBar, version === 2);
        assert.equal(JSON.parse(await fs.readFile(path.join(releaseRoot, 'config/config.json'))).voiceprint.acceptVoiceInputDuringTtsWithoutVoiceprint, true);
        assert.equal((await readBaseline(releaseRoot)).dataVersion, 3);
    }
});

test('数据基线自测只读原生状态，不执行修复或发送配置', async () => {
    const vm = require('node:vm');
    const source = await fs.readFile(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/self-test.js'), 'utf8');
    let reads = 0;
    const run = source + '\nSelfTest.tests.find(item=>item.id==="offline_data_repair_baseline").run();';
    const result = await vm.runInNewContext(run, { window: { NativeOfflineModels: { dataRepairStatus() {
        reads++; return JSON.stringify({ dataVersion: 2, latestRepairVersion: 2, pending: false, satisfied: true });
    }, apply() { throw Error('禁止执行修复'); } } } });
    assert.equal(result.success, true); assert.equal(reads, 1);
    const failed = await vm.runInNewContext(run, { window: { NativeOfflineModels: { dataRepairStatus() {
        return JSON.stringify({ dataVersion: 0, latestRepairVersion: 0, pending: true, satisfied: false });
    } } } });
    assert.equal(failed.success, false);
});
