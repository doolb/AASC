'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

test('服务器目录支持后续名称、同源URL及有限参数，拒绝重复和路径逃逸', async () => {
    const { validateServerActions: validate } = await import('../3rd/mmd-ar-test/web-human-server-actions.mjs');
    const base = 'https://example.com/mnt/mmd-ar/mmd-actions.json';
    const entry = { id: 'dance', name: '跳舞', type: 'vmd', url: './mmd/motions/dance.vmd' };
    const result = validate({ schema: 1, actions: [entry, { ...entry, id: 'greet', name: '新动作' }] }, base);
    assert.equal(result[1].name, '新动作'); assert.equal(result[0].duration, null); assert.equal(result[0].strength, 1);
    assert.equal(result[0].url, 'https://example.com/mnt/mmd-ar/mmd/motions/dance.vmd');
    assert.equal(validate({ schema: 1, actions: [{ ...entry, mplUrl: './mmd/motions/idle.mpl' }] }, base)[0].mplUrl,
        'https://example.com/mnt/mmd-ar/mmd/motions/idle.mpl');
    for (const mplUrl of ['https://other.com/mmd/idle.mpl', './idle.mpl', './mmd/a.vmd', './mmd/a.mpl?q=1', './mmd/a.mpl#x', './mmd/%2e%2e/a.mpl', 123]) {
        assert.throws(() => validate({ schema: 1, actions: [{ ...entry, mplUrl }] }, base));
    }
    for (const url of ['https://other.com/mmd/dance.vmd', './outside.vmd', './mmd/../dance.vmd', './mmd/a.vmd?x=1', './mmd/%2e%2e/a.vmd', './mmd/a.vmd#x']) {
        assert.throws(() => validate({ schema: 1, actions: [{ ...entry, url }] }, base));
    }
    for (const other of [{ ...entry }, { ...entry, id: 'two' }, { ...entry, name: 'two' }]) {
        assert.throws(() => validate({ schema: 1, actions: [entry, other] }, base));
    }
    for (const patch of [{ strength: Infinity }, { count: 1.5 }, { duration: 0 }, { mask: [3] }, { name: '__proto__' }]) {
        assert.throws(() => validate({ schema: 1, actions: [{ ...entry, ...patch }] }, base));
    }
});

test('动作源码同源按需读取，流式64KiB边界、空文件与错误不伪造源码', async () => {
    const { createServerActionCatalog } = await import('../3rd/mmd-ar-test/web-human-server-actions.mjs');
    let source = '@pose idle {}', requests = 0;
    const catalog = createServerActionCatalog({ url: 'https://example.com/mmd-actions.json', fetcher: async (url, options) => {
        assert.equal(options.cache, 'no-cache'); assert.ok(options.signal);
        if (url.endsWith('mmd-actions.json')) return new Response(JSON.stringify({ schema: 1, actions: [
            { id: 'idle', name: '待机', type: 'vmd', url: './mmd/a.vmd', mplUrl: './mmd/a.mpl' },
            { id: 'dance', name: '跳舞', type: 'vmd', url: './mmd/dance.vmd' }
        ] }));
        assert.equal(url, 'https://example.com/mmd/a.mpl'); requests++; return new Response(source);
    } });
    await catalog.load(); assert.equal(requests, 0);
    assert.equal(await catalog.source('待机'), source);
    await assert.rejects(catalog.source('跳舞'), /只有VMD/u);
    source = ' '.repeat(65537); await assert.rejects(catalog.source('待机'), /64KiB/u);
    source = ' '; await assert.rejects(catalog.source('待机'), /为空/u);
    source = '@pose updated {}'; assert.equal(await catalog.source('待机'), source);
});

test('编辑来源和播放一致：本地MPL优先，VMD或叠加层不回退冒充，模板使用当前参数', async () => {
    const { getAdvancedMpl } = await import('../3rd/mmd-ar-test/web-reply-source.mjs');
    const { createHighLevelMpl } = await import('../3rd/mmd-ar-test/web-reply-actions.mjs');
    let calls = 0;
    const catalog = { load: async () => { calls++; return [{ name: '待机' }, { name: '跳舞' }]; }, source: async name => {
        if (name === '跳舞') throw new Error('暂无MPL源码'); return 'server idle';
    } };
    const local = { actionId: '待机', active: 'v1', versions: [{ id: 'v1', source: 'local idle', patches: [] }] };
    const human = { learn: { list: () => [local] } };
    assert.equal(await getAdvancedMpl({ name: '待机' }, human, catalog), 'local idle'); assert.equal(calls, 0);
    delete local.versions[0].source; await assert.rejects(getAdvancedMpl({ name: '待机' }, human, catalog), /本地版本只有VMD/u);
    local.versions[0].source = 'local idle'; local.versions[0].patches = [{}];
    await assert.rejects(getAdvancedMpl({ name: '待机' }, human, catalog), /多层修正/u); assert.equal(calls, 0);
    assert.equal(await getAdvancedMpl({ name: '待机' }, null, catalog), 'server idle');
    await assert.rejects(getAdvancedMpl({ name: '跳舞' }, null, catalog), /暂无MPL/u);
    const options = { name: '挥手', duration: 3, strength: 0.5, count: 2 };
    assert.equal(await getAdvancedMpl(options, null, catalog), createHighLevelMpl(options));
});

test('目录请求共享且有界，失败保留模板可用并报告来源错误', async () => {
    const { createServerActionCatalog } = await import('../3rd/mmd-ar-test/web-human-server-actions.mjs');
    let count = 0;
    const catalog = createServerActionCatalog({ url: 'https://example.com/mmd-actions.json', fetcher: async () => {
        count++; return new Response(JSON.stringify({ schema: 1, actions: [] }));
    } });
    assert.deepEqual(await Promise.all([catalog.load(), catalog.load()]), [[], []]); assert.equal(count, 1);
    const bad = createServerActionCatalog({ url: 'https://example.com/mmd-actions.json', fetcher: async () => new Response(' ', { status: 404 }) });
    assert.deepEqual(await bad.load(), []); assert.match(bad.getState().warning, /404/u);
    const huge = createServerActionCatalog({ url: 'https://example.com/mmd-actions.json', fetcher: async () => new Response(' '.repeat(65537)) });
    await huge.load(); assert.match(huge.getState().warning, /64KiB/u);
});

test('服务器/登记动作显式标记保留原时长，内置模板沿用2秒和15秒边界', async () => {
    const { parseReply } = await import('../3rd/mmd-ar-test/web-reply-parser.mjs');
    const parsed = parseReply('你好[动作:跳舞][动作:新动作 时长=15.2 次数=2][动作:挥手]', { actions: ['跳舞', '新动作'] });
    assert.equal(parsed.speech, '你好'); assert.equal(parsed.events[0].duration, null);
    assert.equal(parsed.events[0].strength, null); assert.equal(parsed.events[1].duration, 15.2);
    assert.equal(parsed.events[1].count, 2); assert.equal(parsed.events[2].duration, 2);
    assert.equal(parseReply('[动作:挥手 时长=16]').events.length, 0);
    assert.equal(parseReply('[动作:不存在]').events.length, 0);
    assert.equal(parseReply('`[动作:跳舞]`', { actions: ['跳舞'] }).events.length, 0);
});

test('目录等待时停止或新播放接管，迟到结果不启动旧回复', async () => {
    const folder = path.resolve(__dirname, '../3rd/mmd-ar-test');
    let source = await fs.readFile(path.join(folder, 'web-reply-player.mjs'), 'utf8');
    source = source.replace("import { createTextTimeline } from './mmd-lipsync-timeline.mjs';", 'const createTextTimeline = () => { throw new Error("本用例不请求口型时间线"); };');
    source = source.replace(/from '(\.\/[^']+)'/gu, (_match, name) => "from '" + pathToFileURL(path.join(folder, name)).href + "'");
    const { createReplyPlayer } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    const names = ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame'], old = new Map(names.map(key => [key, globalThis[key]]));
    let scheduled = 0;
    globalThis.document = { hidden: false, addEventListener() {} }; globalThis.window = { addEventListener() {} };
    globalThis.requestAnimationFrame = () => ++scheduled; globalThis.cancelAnimationFrame = () => {};
    const create = () => {
        let resolve;
        const loading = new Promise(done => { resolve = done; });
        const actionCatalog = { load: () => loading, list: () => [{ name: '跳舞' }] };
        const api = { getManualExpressions: () => ({ ready: true, token: 'pmx', items: [] }),
            getHumanInterface: () => ({ learn: { list: () => [] } }), getModelProfile: () => ({ motionUrl: 'idle.vmd' }) };
        const player = createReplyPlayer({ api: () => api, lip: () => ({}), body: () => ({ getState: () => ({}), async stop() {} }),
            busy: () => false, changed() {}, actionCatalog });
        return { player, resolve };
    };
    try {
        const first = create(), stopped = first.player.playAdvanced({ name: '跳舞' });
        await first.player.stop(); first.resolve(); assert.equal(await stopped, undefined); assert.equal(scheduled, 0);
        const second = create(), stale = second.player.playAdvanced({ name: '跳舞' });
        const latest = second.player.playAdvanced({ name: '跳舞', duration: 15.2 }); second.resolve();
        assert.equal(await stale, undefined); assert.equal((await latest).events[0].duration, 15.2);
        assert.equal(scheduled, 1); await second.player.stop();
    } finally { for (const [key, value] of old) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});

test('真实固定WASM生成待机只含双臂轨道，挥手腕高于肩且原舞蹈仍15.2秒', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aasc-human-actions-'));
    try {
        await require('../3rd/mmd-ar-test/web-human-actions-build').stage(dir);
        const { prepare } = require('../scripts/ops/mmd-mpl-assets'); const cache = await prepare();
        const source = await fs.readFile(path.join(cache, 'mmd_mpl.js'));
        const module = await import('data:text/javascript;base64,' + source.toString('base64'));
        await module.default({ module_or_path: await fs.readFile(path.join(cache, 'mmd_mpl_bg.wasm')) });
        const parserModule = await import('../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/mmdparser.module.js');
        const parser = new parserModule.Parser(), buffer = value => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        const idle = parser.parseVmd(buffer(await fs.readFile(path.join(dir, 'mmd/motions/miya-idle.vmd'))), true);
        const editableSource = await fs.readFile(path.join(dir, 'mmd/motions/miya-idle.mpl'), 'utf8');
        assert.equal(editableSource, await fs.readFile(path.resolve(__dirname, '../3rd/mmd-ar-test/idle.mpl'), 'utf8'));
        const editableCompiler = new module.WasmMPLCompiler();
        try {
            const raw = parser.parseVmd(buffer(editableCompiler.compile(editableSource)), true);
            for (const motion of idle.motions) assert.deepEqual(motion.rotation,
                raw.motions.find(m => m.boneName === motion.boneName && m.frameNum === motion.frameNum).rotation);
        } finally { editableCompiler.free(); }
        assert.deepEqual([...new Set(idle.motions.map(m => m.boneName))].sort(), ['左ひじ', '左手首', '左腕', '右ひじ', '右手首', '右腕'].sort());
        assert.equal(Math.max(...idle.motions.map(m => m.frameNum)), 240);
        const leftIdle = idle.motions.find(m => m.boneName === '左腕'), rightIdle = idle.motions.find(m => m.boneName === '右腕');
        assert.ok(leftIdle.rotation[2] < 0 && rightIdle.rotation[2] > 0);
        assert.ok(Math.abs(leftIdle.rotation[2] + rightIdle.rotation[2]) < 1e-6);
        const { createHighLevelMpl } = await import('../3rd/mmd-ar-test/web-reply-actions.mjs');
        const compiler = new module.WasmMPLCompiler();
        let wave;
        try { wave = parser.parseVmd(buffer(compiler.compile(createHighLevelMpl({ name: '挥手', duration: 2, strength: 1 }))), true); }
        finally { compiler.free(); }
        const THREE = await import('three');
        // 使用经过构建校验的资源缓存，其他会话重建web-dist不会删除自测输入。
        const { STATIC_MMD_RELEASE } = require('../src/apps/server/modules/mmd/mmd-resource-service');
        const resources = path.resolve(__dirname, '../3rd/mmd-ar-test/model-cache', STATIC_MMD_RELEASE.version);
        const pmx = parser.parsePmx(buffer(await fs.readFile(path.join(resources, 'mmd/miya/miya.pmx'))), true);
        const root = new THREE.Group(), bones = pmx.bones.map(b => { const bone = new THREE.Bone(); bone.name = b.name; bone.position.fromArray(b.position); return bone; });
        pmx.bones.forEach((b, i) => { if (b.parentIndex >= 0) { bones[i].position.sub(new THREE.Vector3(...pmx.bones[b.parentIndex].position)); bones[b.parentIndex].add(bones[i]); } else root.add(bones[i]); });
        root.updateMatrixWorld(true);
        const inverse = bones.map(b => b.matrixWorld.clone().invert());
        for (const motion of wave.motions.filter(m => m.frameNum === 15)) bones.find(b => b.name === motion.boneName)?.quaternion.fromArray(motion.rotation);
        root.updateMatrixWorld(true);
        const shoulder = bones.find(b => b.name === '右肩').getWorldPosition(new THREE.Vector3());
        const wrist = bones.find(b => b.name === '右手首').getWorldPosition(new THREE.Vector3());
        assert.ok(wrist.y > shoulder.y + 0.5, `${wrist.y} <= ${shoulder.y}`);
        // 使用实际蒙皮手指点与裙子三角形距离验证待机，不能仅以骨骼点或包围盒代替。
        for (const motion of idle.motions.filter(m => m.frameNum === 0)) bones.find(b => b.name === motion.boneName).quaternion.fromArray(motion.rotation);
        root.updateMatrixWorld(true);
        const matrices = bones.map((bone, index) => bone.matrixWorld.clone().multiply(inverse[index]));
        const handIndices = new Set();
        for (const name of ['左手首', '右手首']) bones.find(b => b.name === name).traverse(b => handIndices.add(bones.indexOf(b)));
        const skirt = []; let faceOffset = 0;
        for (const material of pmx.materials) {
            if (/裙/u.test(material.name)) for (const face of pmx.faces.slice(faceOffset, faceOffset + material.faceCount)) {
                const triangle = new THREE.Triangle(...face.indices.map(index => new THREE.Vector3(...pmx.vertices[index].position)));
                skirt.push({ triangle, box: new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]) });
            }
            faceOffset += material.faceCount;
        }
        const temporary = new THREE.Vector3(), position = new THREE.Vector3(), closest = new THREE.Vector3();
        let minimum = Infinity, handCount = 0;
        for (const vertex of pmx.vertices) {
            if (!vertex.skinIndices.some((index, slot) => handIndices.has(index) && vertex.skinWeights[slot] > 0.2)) continue;
            handCount++; position.set(0, 0, 0);
            vertex.skinIndices.forEach((bone, slot) => position.addScaledVector(temporary.fromArray(vertex.position).applyMatrix4(matrices[bone]), vertex.skinWeights[slot]));
            for (const { triangle, box } of skirt) {
                if (box.distanceToPoint(position) >= minimum) continue;
                minimum = Math.min(minimum, triangle.closestPointToPoint(position, closest).distanceTo(position));
            }
        }
        // 按参考红线：上臂接近竖直、肘部内收，前臂仍斜向外；分别验证双侧，保留裙面间距。
        for (const side of ['左', '右']) {
            const upper = bones.find(b => b.name === side + '腕').getWorldPosition(new THREE.Vector3());
            const elbow = bones.find(b => b.name === side + 'ひじ').getWorldPosition(new THREE.Vector3());
            const wrist = bones.find(b => b.name === side + '手首').getWorldPosition(new THREE.Vector3());
            assert.ok(Math.abs(elbow.x) < 2.05);
            assert.ok(Math.abs(elbow.x - upper.x) / (upper.y - elbow.y) < 0.32);
            assert.ok(Math.abs(wrist.x - elbow.x) / (elbow.y - wrist.y) > 0.8);
            assert.ok(Math.abs(wrist.x) > Math.abs(elbow.x) + 1.5);
            const handAngles = new THREE.Euler().setFromQuaternion(bones.find(b => b.name === side + '手首').getWorldQuaternion(new THREE.Quaternion()));
            assert.ok(Math.abs(handAngles.x) < 1e-6 && Math.abs(handAngles.y) < 1e-6, '手掌保持默认Tpose掌面，不展开朝镜头');
            const axis = new THREE.Vector3(side === '左' ? 0.8 : -0.8, -0.6, 0);
            const forearm = axis.clone().applyQuaternion(bones.find(b => b.name === side + 'ひじ').getWorldQuaternion(new THREE.Quaternion()));
            const hand = axis.clone().applyQuaternion(bones.find(b => b.name === side + '手首').getWorldQuaternion(new THREE.Quaternion()));
            const delta = Math.atan2(hand.y, hand.x) - Math.atan2(forearm.y, forearm.x);
            assert.ok(Math.abs(delta - (side === '左' ? -1 : 1) * Math.PI / 18) < 1e-6, '双手镜像下压10度');
        }
        assert.ok(handCount > 100); assert.ok(minimum > 0.5, '待机真实手部与裙面最小间距=' + minimum);
        const dance = parser.parseVmd(buffer(await fs.readFile(path.join(resources, 'mmd/motions/miya-default.vmd'))), true);
        assert.equal(Math.max(...dance.motions.map(m => m.frameNum)) / 30, 15.2);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
