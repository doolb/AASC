'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const load = () => import('../3rd/mmd-ar-test/web-lighting-preset-library.mjs');

async function fixture() {
    const api = await load();
    const groups = Object.fromEntries(api.groupNames.map(name => [name, {
        normalize: value => ({ enabled: value?.enabled === true, amount: value?.amount ?? 1,
            nested: { color: value?.nested?.color ?? '#ffffff' }, radii: value?.radii ?? [3, 3, 3] })
    }]));
    const memory = new Map();
    const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
    let id = 0;
    const library = api.createPresetLibrary({ groups, storage, createId: () => `test-${++id}` });
    const settings = api.normalizeSettings({ lighting: { enabled: true, amount: 2 } }, groups);
    return { api, groups, storage, memory, library, settings };
}

test('完整分组深复制、选择覆盖删除与本地刷新恢复', async () => {
    const { api, groups, storage, library, settings } = await fixture();
    library.save('侧光', settings);
    const id = library.state().selectedId;
    settings.lighting.nested.color = '#000000';
    assert.equal(library.state().presets[0].settings.lighting.nested.color, '#ffffff');
    const copy = library.state(); copy.presets[0].settings.render.radii[0] = 99;
    assert.equal(library.state().presets[0].settings.render.radii[0], 3);
    const restored = api.createPresetLibrary({ groups, storage });
    assert.deepEqual(restored.load(), library.state());
    assert.throws(() => library.save('侧光', settings), /名称已存在/u);
    library.overwrite(id, '夜间', settings);
    assert.equal(library.state().presets[0].name, '夜间');
    library.select(''); assert.equal(library.state().selectedId, '');
    library.select(id); library.remove(id);
    assert.deepEqual(library.state(), { presets: [], selectedId: '' });
});

test('单项及批量JSON往返，重名/冲突ID合并且保留原记录', async () => {
    const { library, settings } = await fixture();
    library.save('灯光', settings);
    const first = library.state().presets[0];
    const single = library.exportText(first.id);
    library.save('灯光二', settings);
    const all = library.exportText();
    assert.equal(JSON.parse(single).presets.length, 1);
    assert.equal(JSON.parse(all).presets.length, 2);
    assert.equal(library.importText(all), 2);
    assert.deepEqual(library.state().presets[0], first);
    assert.deepEqual(library.state().presets.map(item => item.name), ['灯光', '灯光二', '灯光（导入1）', '灯光二（导入1）']);
    assert.equal(new Set(library.state().presets.map(item => item.id)).size, 4);
    assert.equal(library.importText(single), 1);
    assert.equal(library.state().presets.at(-1).name, '灯光（导入2）');
});

test('整文件先校验：坏JSON/版本/字段/后续记录失败均不改变原库', async () => {
    const { api, library, settings, memory } = await fixture();
    library.save('保留', settings);
    const before = library.state(), stored = memory.get(api.storageKey);
    const file = JSON.parse(library.exportText());
    const bad = [ 'bad json', JSON.stringify({ ...file, version: 99 }),
        JSON.stringify({ ...file, presets: [file.presets[0], { name: '坏记录', settings: { lighting: { amount: 'bad' } } }] }),
        JSON.stringify({ ...file, presets: [{ ...file.presets[0], settings: { render: null } }] }),
        ' '.repeat(api.maxFileBytes + 1) ];
    for (const text of bad) {
        assert.throws(() => library.importText(text));
        assert.deepEqual(library.state(), before);
        assert.equal(memory.get(api.storageKey), stored);
    }
});

test('缺省补默认、未知字段不出库、名称/数量限制和存储失败保持旧状态', async () => {
    const { api, groups, storage, library, settings } = await fixture();
    const normalized = api.normalizeSettings({ lighting: { physicsFps: 5 }, malicious: { anything: true } }, groups);
    assert.equal(normalized.lighting.physicsFps, undefined);
    assert.equal(normalized.malicious, undefined);
    assert.equal(Object.keys(normalized).length, api.groupNames.length);
    library.save('正常', settings);
    const before = library.state();
    assert.throws(() => library.save(' '.repeat(3), settings), /名称/u);
    assert.throws(() => library.save('长'.repeat(65), settings), /名称/u);
    assert.throws(() => api.parsePresetFile(JSON.stringify({ format: api.format, version: 1,
        presets: Array(101).fill({ name: '重复', settings }) }), groups), /100/u);
    storage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => library.overwrite(before.selectedId, '改名', settings), /保存失败/u);
    assert.deepEqual(library.state(), before);
});

test('局域网HTTP缺少randomUUID仍生成ID，导入保留值custom重新分配', async () => {
    const { api, library, settings } = await fixture();
    assert.match(api.createPresetId({ getRandomValues: array => array.fill(15) }), /^light-(0f){16}$/u);
    library.importText(JSON.stringify({ format: api.format, version: api.version,
        presets: [{ id: 'custom', name: '导入', settings }] }));
    assert.notEqual(library.state().presets[0].id, 'custom');
});


test('大型合法库导出仍在文件上限内并可完整重新导入', async () => {
    const { api, library, settings } = await fixture();
    const rich = structuredClone(settings);
    // 紧凑格式接近上限、美化格式超过上限，验证降为紧凑JSON的真实边界。
    for (const value of Object.values(rich)) value.nested.color = 'a'.repeat(300);
    for (let index = 0; index < 55; index += 1) library.save('灯光' + index, rich);
    const exported = library.exportText();
    assert.ok(new TextEncoder().encode(exported).byteLength <= api.maxFileBytes);
    const other = await fixture();
    assert.equal(other.library.importText(exported), 55);
    assert.deepEqual(other.library.state().presets, library.state().presets);
});
