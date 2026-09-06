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
        console,
        fetch: async () => ({ ok: true, async json() { return {}; } }),
        showToast() {},
        confirm() { return true; }
    };
    vm.runInNewContext(fs.readFileSync(scriptPath, 'utf8'), context, { filename: scriptPath });
    return { api: window.MediaLibrary, elements };
}

test('没有媒体库时仍显示添加媒体库按钮', () => {
    const { api, elements } = createMediaLibraryContext();
    api.libraries = [];

    api.renderLibraryList();

    assert.match(elements.mediaLibraryList.innerHTML, /暂无媒体库/);
    assert.match(elements.mediaLibraryList.innerHTML, /library-add-btn/);
    assert.match(elements.mediaLibraryList.innerHTML, /添加/);
});
