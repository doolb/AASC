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


test('默认源要求格式版本唯一记录及十组完整，错误输入拒绝', async () => {
    const { api, settings } = await fixture();
    const { parseDefaultPresetFile } = await import('../3rd/mmd-ar-test/web-lighting-defaults.mjs');
    const record = { name: '日光', settings };
    const file = { format: api.format, version: api.version, presets: [record] };
    assert.deepEqual(parseDefaultPresetFile(JSON.stringify(file)), record);
    for (const bad of [{ ...file, version: 2 }, { ...file, presets: [] }, { ...file, presets: [record, record] },
        { ...file, presets: [{ ...record, settings: { lighting: {} } }] },
        { ...file, presets: [{ ...record, settings: { ...settings, render: [] } }] }]) {
        assert.throws(() => parseDefaultPresetFile(JSON.stringify(bad)));
    }
    assert.throws(() => parseDefaultPresetFile('bad JSON'));
});

test('默认只应用无有效保存分组，空/坏结构回默认，历史标量正确保留', async () => {
    const { groups, settings, memory, storage } = await fixture();
    const { applyLightingDefaults, settingStorageKeys } = await import('../3rd/mmd-ar-test/web-lighting-defaults.mjs');
    const applied = [];
    for (const [key, adapter] of Object.entries(groups)) adapter.apply = value => applied.push([key, value]);
    memory.set(settingStorageKeys.lighting, JSON.stringify({ amount: 9 }));
    memory.set(settingStorageKeys.specular, JSON.stringify({ amount: '坏数值' }));
    memory.set(settingStorageKeys.shadowMap, '{}');
    memory.set(settingStorageKeys.render, '[]');
    memory.set(settingStorageKeys.aoConcavity, '15');
    memory.set(settingStorageKeys.aoEdgeCorrection, 'false');
    const keys = applyLightingDefaults({ settings }, groups, { onlyUnsaved: true, storage: () => storage });
    assert.equal(keys.includes('lighting'), false);
    assert.equal(keys.includes('aoConcavity'), false);
    assert.equal(keys.includes('aoEdgeCorrection'), false);
    assert.equal(keys.includes('specular'), true);
    assert.equal(keys.includes('shadowMap'), true);
    assert.equal(keys.includes('render'), true);
    assert.equal(applied.length, keys.length);
    assert.equal(memory.get(settingStorageKeys.lighting), JSON.stringify({ amount: 9 }));
});

test('完整恢复默认覆盖所有十组，缺省校验失败时无局部应用', async () => {
    const { api, groups, settings } = await fixture();
    const { applyLightingDefaults } = await import('../3rd/mmd-ar-test/web-lighting-defaults.mjs');
    const applied = [];
    for (const [key, adapter] of Object.entries(groups)) adapter.apply = value => applied.push([key, value]);
    assert.deepEqual(applyLightingDefaults({ settings }, groups), api.groupNames);
    assert.deepEqual(Object.fromEntries(applied), settings);
    applied.length = 0;
    assert.throws(() => applyLightingDefaults({ settings: { ...settings, render: { amount: {} } } }, groups));
    assert.equal(applied.length, 0);
});

test('存储访问受限按日光默认处理，兼容旧keyPosition灯光', async () => {
    const { groups, settings, storage, memory } = await fixture();
    const { applyLightingDefaults, hasSavedSettings, settingStorageKeys } = await import('../3rd/mmd-ar-test/web-lighting-defaults.mjs');
    const applied = [];
    for (const [key, adapter] of Object.entries(groups)) adapter.apply = () => applied.push(key);
    const keys = applyLightingDefaults({ settings }, groups, { onlyUnsaved: true,
        storage: () => { throw new Error('blocked'); } });
    assert.equal(keys.length, 10);
    memory.set(settingStorageKeys.lighting, JSON.stringify({ keyPosition: { x: 1, y: 2, z: 3 } }));
    assert.equal(hasSavedSettings('lighting', groups, () => storage), true);
    memory.set(settingStorageKeys.aoConcavity, 'null');
    assert.equal(hasSavedSettings('aoConcavity', groups, () => storage), false);
});


test('旧库补入内置一次，保持选择，刷新覆盖/删除不复活且导出不含安装标记', async () => {
    const { api, groups, storage, memory, library, settings } = await fixture();
    library.save('已有灯光', settings);
    const selected = library.state().selectedId;
    const old = JSON.parse(memory.get(api.storageKey)); delete old.installedBundles;
    memory.set(api.storageKey, JSON.stringify(old)); library.load();
    const text = JSON.stringify({ format: api.format, version: api.version,
        presets: [{ id: 'evening', name: '傍晚', settings }] });
    assert.equal(library.installBundle('evening-v1', text), 1);
    assert.equal(library.state().selectedId, selected);
    assert.equal(library.installBundle('evening-v1', text), 0);
    const edited = { ...settings, lighting: { ...settings.lighting, amount: 7 } };
    library.overwrite('evening', '傍晚修改', edited);
    const refreshed = api.createPresetLibrary({ groups, storage }); refreshed.load();
    assert.equal(refreshed.installBundle('evening-v1', text), 0);
    assert.equal(refreshed.state().presets[1].settings.lighting.amount, 7);
    assert.equal(JSON.parse(refreshed.exportText()).installedBundles, undefined);
    refreshed.remove('evening');
    const deleted = api.createPresetLibrary({ groups, storage }); deleted.load();
    assert.equal(deleted.installBundle('evening-v1', text), 0);
    assert.equal(deleted.state().presets.length, 1);
});

test('内置相同来源ID保留用户版本，同名不同ID沿用合并重命名', async () => {
    const { api, library, settings } = await fixture();
    library.save('傍晚', settings);
    const before = library.state();
    const file = { format: api.format, version: api.version,
        presets: [{ id: before.selectedId, name: '傍晚', settings: { ...settings, lighting: { amount: 8 } } }] };
    assert.equal(library.installBundle('same-id', JSON.stringify(file)), 0);
    assert.deepEqual(library.state(), before);
    file.presets[0].id = 'another-id';
    assert.equal(library.installBundle('new-id', JSON.stringify(file)), 1);
    assert.equal(library.state().presets[1].name, '傍晚（导入1）');
    assert.deepEqual(library.state().presets[0], before.presets[0]);
});

test('内置补入记录与标记一起保存，失败/坏文件不改变库且可重试', async () => {
    const { api, storage, memory, library, settings } = await fixture();
    library.save('保留', settings);
    const before = library.state(), stored = memory.get(api.storageKey);
    const file = { format: api.format, version: api.version, presets: [{ id: 'evening', name: '傍晚', settings }] };
    const setter = storage.setItem;
    storage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => library.installBundle('evening-v1', JSON.stringify(file)), /保存失败/u);
    assert.deepEqual(library.state(), before); assert.equal(memory.get(api.storageKey), stored);
    storage.setItem = setter;
    const bad = { ...file, presets: [...file.presets, { name: '坏', settings: { render: { amount: [] } } }] };
    assert.throws(() => library.installBundle('evening-v1', JSON.stringify(bad)));
    assert.deepEqual(library.state(), before); assert.equal(memory.get(api.storageKey), stored);
    assert.equal(library.installBundle('evening-v1', JSON.stringify(file)), 1);
    assert.deepEqual(JSON.parse(memory.get(api.storageKey)).installedBundles, ['evening-v1']);
});

test('满库不补入也不写安装标记，释放容量后成功补入', async () => {
    const { api, memory, library, settings } = await fixture();
    for (let index = 0; index < 100; index += 1) library.save('已有' + index, settings);
    const before = library.state(), stored = memory.get(api.storageKey);
    const text = JSON.stringify({ format: api.format, version: api.version, presets: [{ id: 'evening', name: '傍晚', settings }] });
    assert.throws(() => library.installBundle('evening-v1', text), /100/u);
    assert.deepEqual(library.state(), before); assert.equal(memory.get(api.storageKey), stored);
    library.remove(before.presets[0].id);
    assert.equal(library.installBundle('evening-v1', text), 1);
    assert.equal(library.state().presets.length, 100);
});
