'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const scriptPath = path.resolve(__dirname, '../src/apps/web-mediacenter/ui/public/js/media-library.js');

function createMediaLibraryContext() {
    const elements = {
        mediaLibraryList: { innerHTML: '' },
        mediaLibraryBreadcrumb: { innerHTML: '' },
        mediaLibraryContent: { innerHTML: '' }
    };
    const window = {};
    const document = {
        getElementById(id) {
            return elements[id] || null;
        }
    };
    const context = {
        window,
        document,
        URL,
        AbortController,
        setTimeout,
        clearTimeout,
        console,
        fetch: async () => ({ ok: true, async json() { return {}; } }),
        showToast() {},
        confirm() { return true; }
    };
    vm.runInNewContext(fs.readFileSync(scriptPath, 'utf8'), context, { filename: scriptPath });
    return { api: window.MediaLibrary, elements, context };
}

test('没有媒体库时仍显示添加媒体库按钮', () => {
    const { api, elements } = createMediaLibraryContext();
    api.libraries = [];

    api.renderLibraryList();

    assert.match(elements.mediaLibraryList.innerHTML, /暂无媒体库/);
    assert.match(elements.mediaLibraryList.innerHTML, /library-add-btn/);
    assert.match(elements.mediaLibraryList.innerHTML, /添加/);
});

test('媒体库目录项没有媒体 URL 时仍可进入子目录', () => {
    const { api, elements } = createMediaLibraryContext();

    api.renderFileList([{ name: 'storage', path: '/storage', type: 'folder' }]);

    assert.match(elements.mediaLibraryContent.innerHTML, /navigateToFolder\('\/storage'\)/);
    assert.doesNotMatch(elements.mediaLibraryContent.innerHTML, /媒体地址不可用/);
});

test('媒体库面板展平主服务器和子服务器媒体库并保留目标库读写状态', () => {
    const { api } = createMediaLibraryContext();
    const libraries = api.flattenNetworkLibraries({
        sources: [
            {
                node: { nodeId: 'main-server', name: '主服务器', url: 'https://main.test' },
                libraries: [{ id: 'main', name: '本地库', isDefault: true }]
            },
            {
                node: { nodeId: 'sub-node', name: 'Termux', url: 'https://sub.test' },
                libraries: [{ id: 'termux', name: 'Termux媒体库', items: [{ name: 'storage', type: 'folder' }] }]
            }
        ]
    });

    assert.equal(libraries.length, 2);
    assert.equal(libraries[0].id, 'main');
    assert.equal(libraries[0].isLocal, true);
    assert.equal(libraries[1].id, 'sub-node::termux');
    assert.equal(libraries[1].name, 'Termux / Termux媒体库');
    assert.equal(libraries[1].sourceLibraryId, 'termux');
    assert.equal(libraries[1].remote, true);
    assert.equal(libraries[1].readonly, false);
});

test('远程媒体库保留直连地址和主服务器代理地址', () => {
    const { api } = createMediaLibraryContext();
    const libraries = api.flattenNetworkLibraries({
        sources: [{
            node: { nodeId: 'termux-subserver', name: 'Termux', url: 'https://192.168.1.6:8081' },
            libraries: [{
                id: 'termux-media',
                name: 'Termux媒体库',
                proxyUrl: 'https://192.168.1.39:8081/api/aasc/servers/termux-subserver/media-libraries/termux-media/proxy/',
                items: [{
                    name: '演示图.png',
                    path: '/演示图.png',
                    url: 'https://192.168.1.6:8081/media/termux-media/%E6%BC%94%E7%A4%BA%E5%9B%BE.png'
                }]
            }]
        }]
    });

    assert.equal(libraries[0].items[0].directUrl, 'https://192.168.1.6:8081/media/termux-media/%E6%BC%94%E7%A4%BA%E5%9B%BE.png');
    assert.equal(libraries[0].items[0].proxyUrl, 'https://192.168.1.39:8081/api/aasc/servers/termux-subserver/media-libraries/termux-media/proxy/%E6%BC%94%E7%A4%BA%E5%9B%BE.png');
    assert.equal(api.getPlaybackUrl(libraries[0].items[0]), libraries[0].items[0].directUrl);
    assert.equal(api.getPlaybackFallbackUrl(libraries[0].items[0]), libraries[0].items[0].proxyUrl);
});

test('远程媒体库操作使用真实库 ID而不是展示用复合 ID', () => {
    const { api } = createMediaLibraryContext();
    const library = {
        id: 'termux-subserver::termux-media',
        sourceLibraryId: 'termux-media',
        ownerNodeId: 'termux-subserver',
        remote: true
    };

    const request = api.getLibraryRequest(library, 'update');
    assert.equal(request.url, '/api/aasc/servers/termux-subserver/media-libraries/termux-media');
    assert.equal(request.method, 'PUT');
});

test('远程媒体没有直连地址时播放主服务器代理地址而不是空地址', () => {
    const { api } = createMediaLibraryContext();
    const item = {
        directUrl: null,
        url: null,
        proxyUrl: '/api/aasc/servers/node-a/media-libraries/media-a/proxy/a.jpg'
    };

    assert.equal(api.getPlaybackUrl(item), item.proxyUrl);
    assert.equal(api.getPlaybackFallbackUrl(item), '');
});


test('夸克标签归集已有分享，普通媒体库标签不显示分享', () => {
    const { api, elements } = createMediaLibraryContext();
    api.libraries = [{ id: 'local', name: '普通库', type: 'local' }, { id: 'old', name: '已有分享', type: 'quark' }];
    api.activeTab = 'libraries';
    api.renderLibraryList();
    assert.match(elements.mediaLibraryList.innerHTML, /普通库/);
    assert.doesNotMatch(elements.mediaLibraryList.innerHTML, /已有分享/);
    api.activeTab = 'quark';
    api.renderLibraryList();
    assert.match(elements.mediaLibraryList.innerHTML, /已有分享/);
    assert.doesNotMatch(elements.mediaLibraryList.innerHTML, /普通库/);
});

test('识别分享 URL 查询参数和分享文案中的提取码', () => {
    const { api } = createMediaLibraryContext();
    const fromQuery = api.parseQuarkShare('https://pan.quark.cn/s/abc123?pwd=4xyz');
    assert.equal(fromQuery.url, 'https://pan.quark.cn/s/abc123');
    assert.equal(fromQuery.passcode, '4xyz');
    const fromText = api.parseQuarkShare('分享链接：https://pan.quark.cn/s/xyz987 提取码：abcd');
    assert.equal(fromText.passcode, 'abcd');
    assert.throws(() => api.parseQuarkShare('https://pan.quark.cn.evil/s/abc'), /有效/);
});

test('已存在的夸克分享点击播放复用原媒体库', async () => {
    const { api, elements } = createMediaLibraryContext();
    elements.quarkShareInput = { value: 'https://pan.quark.cn/s/abc123?pwd=abcd' };
    elements.quarkSharePasscode = { value: '' };
    api.libraries = [{ id: 'old', sourceLibraryId: 'old', isLocal: true, type: 'quark', shareId: 'abc123' }];
    let selected, played;
    api.switchLibrary = async id => { selected = id; };
    api.showBatchPlayDialog = path => { played = path; };
    await api.addQuarkShare(true);
    assert.equal(selected, 'old');
    assert.equal(played, '/');
});


test('加入新分享时提交识别出的提取码并选中新库', async () => {
    const { api, elements, context } = createMediaLibraryContext();
    elements.quarkShareInput = { value: '分享 https://pan.quark.cn/s/new123?pwd=a123' };
    elements.quarkSharePasscode = { value: '' };
    let submitted, selected;
    context.fetch = async (url, options) => {
        submitted = JSON.parse(options.body);
        return { ok: true, json: async () => ({ status: 'success', library: { id: 'new-id' } }) };
    };
    api.loadLibraries = async () => { api.libraries = [{ id: 'new-id', sourceLibraryId: 'new-id', type: 'quark', isLocal: true }]; };
    api.switchLibrary = async id => { selected = id; };
    await api.addQuarkShare();
    assert.equal(submitted.url, 'https://pan.quark.cn/s/new123');
    assert.equal(submitted.passcode, 'a123');
    assert.equal(submitted.readonly, true);
    assert.equal(selected, 'new-id');
});


test('B站解析成功发送原生视频，失败时发送官方播放器', async () => {
    const { api, context } = createMediaLibraryContext();
    const sent = [];
    context.window.location = { origin: 'http://server.test' };
    context.window.Upload = { getBilibiliPlayerUrl: () => 'https://player.bilibili.com/player.html?bvid=BV1B7411m7LV' };
    context.window.WebSocketManager = { sendMedia: media => sent.push(media) };
    context.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', url: '/api/bilibili/video/BV1B7411m7LV?p=1', width: 640, height: 360 }) });
    await api.playBilibiliUrl('https://www.bilibili.com/video/BV1B7411m7LV');
    assert.equal(sent[0].mediaType, 'video');
    assert.equal(sent[0].url, 'http://server.test/api/bilibili/video/BV1B7411m7LV?p=1');
    assert.match(sent[0].bilibiliFallback, /player.bilibili.com/);
    context.fetch = async () => { throw new Error('网络错误'); };
    await api.playBilibiliUrl('https://www.bilibili.com/video/BV1B7411m7LV');
    assert.equal(sent[1].mediaType, 'html');
});

test('B站 DASH 解析结果附带 360P 和官方播放器回退', async () => {
    const { api, context } = createMediaLibraryContext();
    const sent = [];
    context.window.location = { origin: 'http://server.test' };
    context.window.Upload = { getBilibiliPlayerUrl: () => 'https://player.bilibili.com/player.html?bvid=BV1B7411m7LV' };
    context.window.WebSocketManager = { sendMedia: media => sent.push(media) };
    context.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', dash: true, url: '/api/bilibili/dash/BV1B7411m7LV?p=1', fallbackUrl: '/api/bilibili/video/BV1B7411m7LV?p=1', width: 852, height: 480 }) });
    await api.playBilibiliUrl('https://www.bilibili.com/video/BV1B7411m7LV');
    assert.equal(sent[0].bilibiliDash, true);
    assert.equal(sent[0].bilibiliMp4, 'http://server.test/api/bilibili/video/BV1B7411m7LV?p=1');
    assert.equal(sent[0].height, 480);
});

test('夸克视频完整缓存后才发送播放，失败或播放其他媒体时不切换', async () => {
    const { api, context } = createMediaLibraryContext();
    const sent = [];
    context.window.WebSocketManager = { sendMedia: value => sent.push(value) };
    api.currentLibrary = { type: 'quark' };
    api.setCurrentMedia = () => {};
    let finish;
    api.prepareQuarkVideo = () => new Promise(resolve => { finish = resolve; });
    const pending = api.playMedia('https://server.test/video.mp4', 'video', '视频');
    assert.equal(sent.length, 0);
    finish(); await pending;
    assert.equal(sent.length, 1);
    api.prepareQuarkVideo = () => Promise.reject(new Error('视频超过 300 MB 缓存上限'));
    await api.playMedia('https://server.test/large.mp4', 'video', '大视频');
    assert.equal(sent.length, 1);
    api.prepareQuarkVideo = () => new Promise(resolve => { finish = resolve; });
    const stale = api.playMedia('https://server.test/old.mp4', 'video', '旧视频');
    await api.playMedia('https://server.test/image.jpg', 'image', '新图片');
    finish(); await stale;
    assert.equal(sent.length, 2);
    assert.equal(sent[1].mediaType, 'image');
});

test('控制端顶部显示缓存排队、百分比、完成和错误', () => {
    const { api, elements } = createMediaLibraryContext();
    elements.quarkCacheStatus = { style: {} };
    elements.quarkCacheStatusText = { textContent: '' };
    elements.quarkCacheProgress = { style: {}, value: 0 };
    api.handleQuarkCacheProgress({ phase: 'queued', total: 100, received: 0, fileName: '视频.mp4' });
    assert.match(elements.quarkCacheStatusText.textContent, /等待缓存/);
    api.handleQuarkCacheProgress({ phase: 'downloading', total: 100, received: 51, fileName: '视频.mp4' });
    assert.match(elements.quarkCacheStatusText.textContent, /51%/);
    assert.equal(elements.quarkCacheProgress.value, 51);
    api.handleQuarkCacheProgress({ status: 'error', message: '空间不足' });
    assert.match(elements.quarkCacheStatusText.textContent, /空间不足/);
    assert.equal(elements.quarkCacheProgress.style.display, 'none');
});

test('夸克视频缩略图使用单独接口，不请求完整视频', () => {
    const { api, elements, context } = createMediaLibraryContext();
    context.window.location = { href: 'https://server.test/upload' };
    api.currentLibrary = { type: 'quark', readonly: true };
    api.renderFileList([{ path: '/v.mp4', name: 'v.mp4', type: 'file', mediaType: 'video', size: 100, url: 'https://server.test/api/media-libraries/q/proxy/v.mp4', hasThumbnail: true }]);
    assert.match(elements.mediaLibraryContent.innerHTML, /thumbnail=1/);
    assert.doesNotMatch(elements.mediaLibraryContent.innerHTML, /<video/);
});

test('B站解析到本地副本时发送本地视频地址', async () => {
    const { api, context } = createMediaLibraryContext();
    const sent = [];
    context.window.location = { origin: 'https://server.test' };
    context.window.Upload = { getBilibiliPlayerUrl: () => 'https://player.bilibili.com/player.html?bvid=BV1B7411m7LV' };
    context.window.WebSocketManager = { sendMedia: item => sent.push(item) };
    context.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', url: '/api/bilibili/local/BV1B7411m7LV?p=2', local: true }) });
    await api.playBilibiliUrl('https://www.bilibili.com/video/BV1B7411m7LV?p=2');
    assert.equal(sent[0].url, 'https://server.test/api/bilibili/local/BV1B7411m7LV?p=2');
    assert.equal(sent[0].mediaType, 'video');
});
