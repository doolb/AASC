'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const folder = path.resolve(__dirname, '../3rd/mmd-ar-test');
const load = name => import(pathToFileURL(path.join(folder, name)).href);

test('共享目录28类语义唯一，所有实际/候选符号都有对应入口且逐个可解析', async t => {
    const { ADVANCED_GESTURES, REPLY_SYMBOLS } = await load('web-reply-gestures.mjs');
    const { parseReply, ACTIONS, EMOTIONS } = await load('web-reply-parser.mjs');
    assert.equal(ADVANCED_GESTURES.length, 28); assert.equal(Object.keys(ACTIONS).length, 28); assert.equal(Object.keys(EMOTIONS).length, 7);
    assert.equal(new Set(ADVANCED_GESTURES.map(g => g.name)).size, 28);
    for (const [icon, [kind, name]] of REPLY_SYMBOLS) {
        const parsed = parseReply('甲' + icon + '乙');
        assert.equal(parsed.speech, '甲乙', icon); assert.equal(parsed.events.length, 1, icon);
        assert.deepEqual([parsed.events[0].kind, parsed.events[0].name, parsed.events[0].offset], [kind, name, 1], icon);
        assert.ok(ADVANCED_GESTURES.some(g => g.name === name));
    }
    t.diagnostic('逐一验证符号及颜文字数量=' + REPLY_SYMBOLS.size);
});

test('肤色/性别/黑猫/双展示符消费完整序列，未知ZWJ不被截出已知动作', async () => {
    const { parseReply } = await load('web-reply-parser.mjs');
    const cases = [['🙇🏽‍♀️', '鞠躬'], ['🙋🏾‍♂️', '挥手'], ['🤷🏿‍♀️', '摊手'], ['🙅🏻‍♂️', '拒绝'], ['👍🏽', '赞同'], ['🫶🏾', '比心'], ['❤️️', '比心'], ['🐈‍⬛', '猫咪撒娇'], ['🙂‍↕️', '点头'], ['🙂‍↔️', '摇头']];
    for (const [symbol, name] of cases) {
        const result = parseReply('甲' + symbol + '乙');
        assert.equal(result.speech, '甲乙'); assert.equal(result.events.length, 1); assert.equal(result.events[0].name, name);
        assert.equal(result.events[0].raw, symbol); assert.equal(result.events[0].offset, 1);
    }
    for (const symbol of ['🐱‍🚀', '❤️‍🔥', '👩‍💻', '🇨🇳', '1️⃣', '🌦️', '📱', '🎬']) {
        const result = parseReply(symbol + '你好😊');
        assert.equal(result.speech, symbol + '你好'); assert.equal(result.events.length, 1);
        assert.equal(result.events[0].offset, Array.from(symbol + '你好').length);
    }
});

test('代码/引用/普通括号和未知图标保护，显式动作及颜文字沿用受控别名', async () => {
    const { parseReply } = await load('web-reply-parser.mjs');
    const protectedText = '`❤️🐱`\n> 🤗[动作:比心]\n```js\n🐾\n```\n(会议)🌧️💻';
    const result = parseReply(protectedText + '[动作:爱心 强度=0.4 次数=2](喵)');
    assert.equal(result.speech, protectedText); assert.deepEqual(result.events.map(e => e.name), ['比心', '猫咪撒娇']);
    assert.equal(result.events[0].strength, 0.4); assert.equal(result.events[0].count, 2);
    assert.deepEqual(parseReply('😊😾🙀😽').events.map(e => [e.kind, e.name]), [
        ['emotion', '开心'], ['emotion', '生气'], ['emotion', '惊讶'], ['action', '亲亲']]);
    assert.equal(parseReply('[动作:开心]').events[0].kind, 'action');
    assert.equal(parseReply('[动作:不存在]').events.length, 0);
});

test('扩展符号后仍限制64KiB、64事件和16身体段，不执行未知名称', async () => {
    const { parseReply } = await load('web-reply-parser.mjs');
    assert.throws(() => parseReply('a'.repeat(65537)), /64KiB/u);
    assert.throws(() => parseReply('😊'.repeat(65)), /64个/u);
    assert.throws(() => parseReply('🐾'.repeat(17)), /16段/u);
    assert.equal(parseReply('🐾'.repeat(16)).events.length, 16);
    assert.equal(parseReply('✅').events[0].name, '赞同');
});

test('模板依当前PMX真实名称生成表情，缺失/歧义降级且强度仅写一次', async () => {
    const { createHighLevelMpl } = await load('web-reply-actions.mjs');
    const morphs = [{ name: '笑い ', supported: true, index: 7 }, { name: 'にこり', supported: true, index: 8 }];
    const source = createHighLevelMpl({ name: '开心', strength: 0.4, count: 2, duration: 3 }, morphs);
    assert.match(source, /morph "笑い " 0.4;/u); assert.match(source, /head sway right 2;/u);
    assert.match(source, /3.0000: rest;/u); assert.equal((source.match(/: second;/gu) || []).length, 2);
    assert.doesNotMatch(createHighLevelMpl({ name: '开心' }), /morph /u);
    assert.doesNotMatch(createHighLevelMpl({ name: '开心' }, [...morphs, { ...morphs[0] }]), /morph "笑い "/u);
    assert.match(createHighLevelMpl({ name: '平静' }, morphs), /morph "笑い " 0;/u);
    for (const options of [{ duration: 16 }, { strength: -1 }, { strength: NaN }, { count: 9 }, { count: 1.5 }]) {
        assert.throws(() => createHighLevelMpl({ name: '比心', ...options }), /参数/u);
    }
});

test('源码入口使用当前Human模板能力，与播放相同参数；本地优先仍保留', async () => {
    const { getAdvancedMpl } = await load('web-reply-source.mjs');
    const { createHighLevelMpl } = await load('web-reply-actions.mjs');
    const morphs = [{ name: '照れ', supported: true, index: 3 }], options = { name: '比心', duration: 3, strength: 0.4, count: 2 };
    const human = { learn: { list: () => [] }, mpl: { advancedSource: received => {
        assert.deepEqual(received, options); return createHighLevelMpl(received, morphs);
    } } };
    assert.equal(await getAdvancedMpl(options, human, { load: async () => [] }), createHighLevelMpl(options, morphs));
});

test('全部28类模板经固定WASM真实编译，Morph时间线有效且真实PMX可用', async t => {
    const { prepare } = require('../scripts/ops/mmd-mpl-assets'); const cache = await prepare();
    const runtime = await fs.readFile(path.join(cache, 'mmd_mpl.js'));
    const module = await import('data:text/javascript;base64,' + runtime.toString('base64'));
    await module.default({ module_or_path: await fs.readFile(path.join(cache, 'mmd_mpl_bg.wasm')) });
    const parserUrl = pathToFileURL(path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/vendor/three/libs/mmdparser.module.js')).href;
    const parserModule = await import(parserUrl), parser = new parserModule.Parser();
    const { STATIC_MMD_RELEASE } = require('../src/apps/server/modules/mmd/mmd-resource-service');
    const pmxBytes = await fs.readFile(path.join(folder, 'model-cache', STATIC_MMD_RELEASE.version, 'mmd/miya/miya.pmx'));
    const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const pmx = parser.parsePmx(buffer(pmxBytes), true);
    const morphs = pmx.morphs.map((item, index) => ({ ...item, index, supported: true }));
    const preprocessing = (await fs.readFile(path.join(folder, 'web-mpl-morphs.mjs'), 'utf8'))
        .replace('./vendor/three/libs/mmdparser.module.js', parserUrl);
    const { prepareMpl } = await import('data:text/javascript;base64,' + Buffer.from(preprocessing).toString('base64'));
    const { ADVANCED_GESTURES } = await load('web-reply-gestures.mjs'), { createHighLevelMpl } = await load('web-reply-actions.mjs');
    const compiler = new module.WasmMPLCompiler(); let faces = 0;
    try {
        for (const gesture of ADVANCED_GESTURES) for (const strength of [0, 0.4, 0.7, 1]) {
            const source = createHighLevelMpl({ name: gesture.name, duration: 3, count: 2, strength }, morphs);
            const prepared = prepareMpl(source, morphs), vmd = parser.parseVmd(buffer(compiler.compile(prepared.boneSource)), true);
            assert.ok(vmd.motions.length > 0, gesture.name); assert.equal(Math.max(...vmd.motions.map(m => m.frameNum)), 90);
            for (const motion of vmd.motions) assert.ok(motion.rotation.every(Number.isFinite), gesture.name);
            for (const frame of prepared.frames) {
                assert.ok(morphs.some(m => m.name === frame.name)); assert.ok(frame.weight >= 0 && frame.weight <= strength);
                if (frame.frame === 0 || frame.frame === 90) assert.equal(frame.weight, 0, gesture.name);
            }
            if (prepared.frames.length && strength === 0.7) faces++;
            if (gesture.name === '比心' && strength === 0.7) {
                // 使用PMX真实父子骨骼检查双手确实靠近胸前，不能仅凭模板名称声称比心。
                const THREE = await import('three'), root = new THREE.Group();
                const bones = pmx.bones.map(b => { const bone = new THREE.Bone(); bone.name = b.name; bone.position.fromArray(b.position); return bone; });
                pmx.bones.forEach((b, i) => {
                    if (b.parentIndex >= 0) { bones[i].position.sub(new THREE.Vector3(...pmx.bones[b.parentIndex].position)); bones[b.parentIndex].add(bones[i]); }
                    else root.add(bones[i]);
                });
                for (const motion of vmd.motions.filter(m => m.frameNum === 11)) bones.find(b => b.name === motion.boneName)?.quaternion.fromArray(motion.rotation);
                root.updateMatrixWorld(true);
                const wrists = ['左手首', '右手首'].map(name => bones.find(b => b.name === name).getWorldPosition(new THREE.Vector3()));
                assert.ok(wrists.every(p => Math.abs(p.x) < 1 && p.y > 12 && p.z > 1));
                assert.ok(Math.abs(wrists[0].x + wrists[1].x) < 1e-5);
                t.diagnostic('比心默认强度双腕=' + JSON.stringify(wrists.map(p => p.toArray())));
            }
        }
    } finally { compiler.free(); }
    assert.ok(faces >= 7); t.diagnostic('真实米娅含Morph模板=' + faces + '/28');
});

test('已缩放模板保留低强度头部跟随占用，普通层及零强度规则不改变', async () => {
    const THREE = await import('three');
    const { createHumanMixer } = await load('web-human-mixer.mjs');
    const mesh = new THREE.Group(), head = new THREE.Bone(); mesh.add(head); mesh.morphTargetInfluences = [];
    mesh.morphTargetInfluences = [0];
    const model = { mesh, bones: [{ bone: head }], morphs: [{ index: 0, panel: 2 }], allowed: () => true };
    const sampler = { duration: 2, tracks: [{ kind: 'bone', index: 0, property: 'quaternion',
        evaluate: () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.2).toArray() }] };
    sampler.tracks.push({ kind: 'morph', index: 0, evaluate: () => [0.2] });
    for (const [strength, gazeStrength, expected] of [[1, 0.4, 0.4], [0.4, undefined, 0.4], [0, 0, 0], [0, 0.4, 0]]) {
        const mixer = createHumanMixer();
        mixer.start({ owner: 'test', duration: 2, fade: 0, layers: [{ sampler, duration: 2, start: 0, strength, gazeStrength }] });
        assert.equal(mixer.occupiedEyes(model), strength > 0, '零强度表情不能阻断自然眨眼');
        mixer.advance(0.2); let occupied;
        mixer.mix(model, [], [], (_save, value, rotations) => {
            occupied = value.get(0); assert.equal(rotations.has(0), strength > 0);
        });
        assert.equal(occupied, expected);
        if (!strength) assert.ok(head.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
        mixer.clear(); mixer.restore();
    }
});
