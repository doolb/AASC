# HTML 媒体类型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为媒体中心新增 `html` 媒体类型：媒体库识别 .html 文件、支持粘贴 HTML 代码发送，显示端以 iframe 全屏纯展示并支持三种自动滚动模式。

**Architecture:** 服务端 `detectMediaType` 识别 `.html/.htm` 为 `html`，批量播放过滤加入该类型；上传端（媒体库点击 / 裁剪框拖拽 / 工具栏粘贴）在发送前弹滚动设置对话框，mediaData 携带 `htmlScroll` 参数；显示端新增 iframe 元素渲染 html（url 同源加载 / base64 解码为 srcdoc），用 rAF 时间步进控制器实现分页式/平滑/循环滚动。

**Tech Stack:** Node.js (express, ws), 原生浏览器 JS（无框架），node:test 测试框架

**设计文档:** `docs/design/html-media.md`（已批准）

## Global Constraints

- 媒体类型映射：`.html`/`.htm`（大小写不敏感）→ `'html'`；现有 `gif`→gif、`mp4/webm/mov/avi/mkv`→video、其余→image 保持不变
- `htmlScroll` 数据模型：`{ mode: 'page'|'smooth'|'loop', pageInterval: 3|5|8, speed: 'slow'|'medium'|'fast' }`；默认 `{ mode:'page', pageInterval:5 }`
- 滚动速度映射：slow=60px/s, medium=120px/s, fast=240px/s
- iframe **不加 `sandbox` 属性**（sandbox 产生 opaque origin，无法读取 scrollHeight 控制滚动）；用 `pointer-events: none` 保证不可交互
- 批量播放（playlist）中的 html 项使用默认滚动参数，不单独配置
- 项目代码规范：`const/let` 不用 `var`；`async/await`；`try-catch`；中文注释；避免一大段 if-else-else if 链
- 项目文档规范：改代码前先更新 `docs/spec/*.md` 伪代码；完成后更新 `changelog.md`、`todo.md`；新功能需要 `docs/task/时间_需求.md` 任务文档
- 测试运行：`node --test tests/`（node:test + assert，见 `tests/playlist-app-service.test.js` 风格）
- 涉及文件（来自设计文档）：`media-library-app-service.js`、`playlist-app-service.js`、`ui/public/js/upload.js`、`ui/public/js/media-library.js`、`ui/public/js/websocket.js`、`ui/public/js/crop.js`、`ui/public/display.html`、`ui/public/upload.html`

---

### Task 1: 服务端媒体类型识别（TDD）

**Files:**
- Modify: `src/apps/web-mediacenter/modules/media/media-library-app-service.js:53-58`（`detectMediaType`）
- Modify: `src/apps/web-mediacenter/modules/media/playlist-app-service.js:3`（`MEDIA_TYPES`）
- Create: `tests/media-library-app-service.test.js`
- Modify: `tests/playlist-app-service.test.js`
- Modify: `docs/spec/media-library.md`（detectMediaType 伪代码）、`docs/spec/batch-playlist.md`（MEDIA_TYPES 伪代码）

**Interfaces:**
- Consumes: `MediaLibraryProvider`（已导出 `module.exports = { MediaLibraryProvider, ... }`，构造函数接收 config 对象）
- Produces: `detectMediaType(name)` 对 `.html/.htm` 返回 `'html'`；`PlaylistManager.buildFromLibrary` 的 `MEDIA_TYPES` 包含 `'html'`

- [ ] **Step 1: 更新 spec 伪代码（改代码前先更新文档）**

`docs/spec/media-library.md` 中 `detectMediaType` 伪代码段，在 gif/video 之后加一行：
```
if ext in ['html','htm']: return 'html'      // 新增
```
`docs/spec/batch-playlist.md` 中 `MEDIA_TYPES`（或等价描述处）加入 `'html'`。提交：`git add docs/spec/media-library.md docs/spec/batch-playlist.md && git commit -m "docs: spec 更新 html 媒体类型识别"`

- [ ] **Step 2: 写失败测试**

创建 `tests/media-library-app-service.test.js`：

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { MediaLibraryProvider } = require('../src/apps/web-mediacenter/modules/media/media-library-app-service.js');

const provider = new MediaLibraryProvider({});

test('detectMediaType 识别 html/htm 文件', () => {
    assert.strictEqual(provider.detectMediaType('page.html'), 'html');
    assert.strictEqual(provider.detectMediaType('page.HTM'), 'html');
    assert.strictEqual(provider.detectMediaType('page.htm?t=123'), 'html');
});

test('detectMediaType 保持原有类型识别', () => {
    assert.strictEqual(provider.detectMediaType('a.gif'), 'gif');
    assert.strictEqual(provider.detectMediaType('a.mp4'), 'video');
    assert.strictEqual(provider.detectMediaType('a.jpg'), 'image');
});
```

修改 `tests/playlist-app-service.test.js`：在文件顶部 tree 定义后追加一个独立小树和测试（不改动现有 tree，避免破坏现有断言）：

```js
const htmlTree = {
    '/': [
        { name: 'index.html', path: '/index.html', type: 'file', mediaType: 'html', modifiedTime: new Date('2026-01-02'), url: '/media/1/index.html' },
        { name: 'a.jpg', path: '/a.jpg', type: 'file', mediaType: 'image', modifiedTime: new Date('2026-01-01'), url: '/media/1/a.jpg' }
    ]
};

const htmlFakeManager = {
    async list(libraryId, path) {
        return htmlTree[path] || [];
    }
};

test('buildFromLibrary 收集 html 媒体文件', async () => {
    const pm = new PlaylistManager(htmlFakeManager);
    const list = await pm.buildFromLibrary('lib1', '/', { recursive: false, mode: 'sequence', sortBy: 'name', direction: 'asc' });
    assert.deepStrictEqual(list.map(i => i.fileName), ['index.html', 'a.jpg']);
    assert.strictEqual(list[0].mediaType, 'html');
});
```

- [ ] **Step 3: 运行测试验证失败**

Run: `node --test tests/`
Expected: `detectMediaType 识别 html/htm 文件` FAIL（返回 'image'）；`buildFromLibrary 收集 html 媒体文件` FAIL（index.html 被过滤）；其余 PASS

- [ ] **Step 4: 最小实现**

`media-library-app-service.js:53-58` 修改为：

```js
    detectMediaType(name) {
        const ext = name.toLowerCase().split('.').pop().split('?')[0];
        if (['gif'].includes(ext)) return 'gif';
        if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
        if (['html', 'htm'].includes(ext)) return 'html';
        return 'image';
    }
```

`playlist-app-service.js:3` 修改为：

```js
const MEDIA_TYPES = ['image', 'video', 'gif', 'html'];
```

- [ ] **Step 5: 运行测试验证通过**

Run: `node --test tests/`
Expected: 全部 PASS（含新增 3 个测试）

- [ ] **Step 6: 提交**

```bash
git add tests/media-library-app-service.test.js tests/playlist-app-service.test.js src/apps/web-mediacenter/modules/media/media-library-app-service.js src/apps/web-mediacenter/modules/media/playlist-app-service.js
git commit -m "feat: 媒体类型识别新增 html（.html/.htm）"
```

---

### Task 2: 发送链路基础（websocket.js + crop.js）

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/websocket.js:419-445`（`getMediaRatio`）
- Modify: `src/apps/web-mediacenter/ui/public/js/crop.js`（`showPreview` 开头加 html 分支 + 新增 `hideForHtml`）

**Interfaces:**
- Consumes: `WebSocketManager.getMediaRatio(mediaData)`（现有签名）；`Crop.showPreview(url, mediaType, onReady)`（现有签名）
- Produces: `getMediaRatio` 对 `mediaType==='html'` 直接返回 1；`Crop.hideForHtml()` 隐藏裁剪框/预览元素；`sendMediaWithRatio` 原样透传 mediaData 中的 `htmlScroll`（无需改动）

- [ ] **Step 1: websocket.js getMediaRatio 短路 html**

`websocket.js:419-445` 函数开头加一行：

```js
    async getMediaRatio(mediaData) {
        // HTML 无固有宽高比且铺满显示，不创建 img 探测
        if (mediaData.mediaType === 'html') {
            return 1;
        }
        if (mediaData.width && mediaData.height) {
            return mediaData.width / mediaData.height;
        }
        ...
    }
```

- [ ] **Step 2: crop.js showPreview html 分支**

`crop.js` `showPreview(url, mediaType, onReady)` 函数开头（`this.currentMedia = url;` 之前）插入：

```js
        if (mediaType === 'html') {
            // HTML 媒体铺满显示且不可裁剪，跳过图片/视频预览
            this.currentMedia = url;
            this.hideForHtml();
            return;
        }
```

在 `showPreview` 方法之后新增方法（放在 `_retryShowPreview` 之前）：

```js
    hideForHtml() {
        // 隐藏裁剪框与预览元素（HTML 媒体不支持裁剪）
        this.box.style.display = 'none';
        this.previewImg.style.display = 'none';
        this.previewImg.removeAttribute('src');
        this.previewVideo.style.display = 'none';
        this.previewVideo.removeAttribute('src');
        if (window.MediaLibrary && window.MediaLibrary.removeTempPreviewPlaceholder) {
            window.MediaLibrary.removeTempPreviewPlaceholder();
        }
    },
```

注意：`this.box`、`this.previewImg`、`this.previewVideo` 为 crop.js 已有属性（见 `showPreview` 中 `this.previewVideo.style.display`、`this.box.style.display` 用法）。若 `this.box` 实际属性名不同，按文件内实际命名调整。

- [ ] **Step 3: 验证**

Run: `node --check src/apps/web-mediacenter/ui/public/js/websocket.js && node --check src/apps/web-mediacenter/ui/public/js/crop.js`
Expected: 无语法错误输出。浏览器功能验证放在 Task 5 自测阶段。

- [ ] **Step 4: 提交**

```bash
git add src/apps/web-mediacenter/ui/public/js/websocket.js src/apps/web-mediacenter/ui/public/js/crop.js
git commit -m "feat: html 媒体发送链路（跳过比例探测与裁剪预览）"
```

---

### Task 3: 上传端 UI（upload.js + media-library.js + upload.html）

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/js/upload.js`（`detectMediaType`、`sendTempFile`、`uploadFile` 临时模式分支）
- Modify: `src/apps/web-mediacenter/ui/public/js/media-library.js`（`playMedia`、新增 `showHtmlScrollSettingsDialog`、`showSendHtmlDialog`、`_sendHtmlCode`）
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`（「发送 HTML」按钮、accept 扩展）
- Modify: `docs/spec/media-library.md`（前端模块伪代码）

**Interfaces:**
- Consumes: `MediaLibrary.uploadFile(file, dirPath)`（已存在，返回 `{success, data}`，`data.file.url` 为上传后 URL）；`Upload.fileToBase64(file)`（已存在，返回 base64 字符串，支持中文内容）；`WebSocketManager.sendMedia(mediaData)`（已存在，mediaData 可含任意附加字段，Task 2 已确保 html 短路）
- Produces: `MediaLibrary.showHtmlScrollSettingsDialog()` → `Promise<htmlScroll|null>`（null=取消）；`MediaLibrary.showSendHtmlDialog()`（工具栏入口）；`Upload.detectMediaType` 识别 html；`sendTempFile`/`uploadFile` html 分支发送带 `htmlScroll` 的 base64 消息

- [ ] **Step 1: 更新 spec 伪代码**

`docs/spec/media-library.md` 前端模块 `playMedia` 伪代码段，在调用 `Crop.showPreview` 前加：
```
if mediaType === 'html':
    弹「HTML 发送设置」对话框（滚动方式 + 参数）
    确认后跳过 Crop.showPreview，直接 sendMedia({type:'url', url, mediaType:'html', htmlScroll})
```
提交：`git add docs/spec/media-library.md && git commit -m "docs: spec 更新 html 发送流程"`

- [ ] **Step 2: upload.js detectMediaType**

`upload.js:2-7` 修改为：

```js
    detectMediaType(name) {
        const ext = name.toLowerCase().split('.').pop().split('?')[0];
        if (['gif'].includes(ext)) return 'gif';
        if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
        if (['html', 'htm'].includes(ext)) return 'html';
        return 'image';
    },
```

- [ ] **Step 3: upload.js sendTempFile html 分支**

`sendTempFile(file)`（约 122-161 行）在 `const mediaType = this.detectMediaType(file.name);` 之后插入 html 分支：

```js
            const mediaType = this.detectMediaType(file.name);
            if (mediaType === 'html') {
                // HTML 媒体：跳过尺寸探测与裁剪预览，弹滚动设置后临时发送
                const htmlScroll = await window.MediaLibrary.showHtmlScrollSettingsDialog();
                if (!htmlScroll) {
                    showToast('已取消发送', 'warning');
                    return;
                }
                if (window.WebSocketManager) {
                    window.WebSocketManager.sendMedia({
                        type: 'base64',
                        data: base64,
                        fileName: file.name,
                        mediaType: 'html',
                        mimeType: file.type || 'text/html',
                        temp: true,
                        htmlScroll
                    });
                }
                if (window.MediaLibrary) {
                    window.MediaLibrary.lastTempFileSent = { name: file.name };
                }
                showToast('已发送到显示端', 'success');
                return;
            }
```

- [ ] **Step 4: upload.js uploadFile 临时模式分支 html 处理**

`uploadFile(file)` 临时模式分支（约 53-89 行），在 `const mediaType = this.detectMediaType(file.name);` 之后插入：

```js
                const mediaType = this.detectMediaType(file.name);
                if (mediaType === 'html') {
                    // HTML 媒体：跳过尺寸探测与裁剪预览，弹滚动设置后临时发送
                    const htmlScroll = await window.MediaLibrary.showHtmlScrollSettingsDialog();
                    if (!htmlScroll) {
                        showToast('已取消发送', 'warning');
                        return;
                    }
                    if (window.WebSocketManager) {
                        window.WebSocketManager.sendMedia({
                            type: 'base64',
                            data: base64,
                            fileName: file.name,
                            mediaType: 'html',
                            mimeType: file.type || 'text/html',
                            temp: true,
                            htmlScroll
                        });
                    }
                    showToast('已发送到显示端', 'success');
                    return;
                }
```

- [ ] **Step 5: media-library.js 新增共享滚动设置对话框**

在 `MediaLibrary` 对象中新增方法（放在 `showPlaylistSettingsDialog` 附近，复用其对话框样式类 `modal-mask`/`playlist-settings-dialog`/`settings-row`/`btn-cancel`/`btn-confirm`）：

```js
    // HTML 滚动设置对话框（媒体库文件/裁剪框拖拽共用），返回 Promise<htmlScroll|null>
    showHtmlScrollSettingsDialog() {
        return new Promise((resolve) => {
            const mask = document.createElement('div');
            mask.className = 'modal-mask';
            mask.innerHTML = `
                <div class="playlist-settings-dialog">
                    <div class="dialog-title">HTML 发送设置</div>
                    <div class="dialog-body">
                        <div class="settings-row">
                            <span class="settings-label">滚动方式</span>
                            <label><input type="radio" name="htmlScrollMode" value="page" checked> 分页式</label>
                            <label><input type="radio" name="htmlScrollMode" value="smooth"> 平滑</label>
                            <label><input type="radio" name="htmlScrollMode" value="loop"> 循环</label>
                        </div>
                        <div class="settings-row" id="htmlPageIntervalRow">
                            <span class="settings-label">每屏停留</span>
                            <label><input type="radio" name="htmlPageInterval" value="3"> 3秒</label>
                            <label><input type="radio" name="htmlPageInterval" value="5" checked> 5秒</label>
                            <label><input type="radio" name="htmlPageInterval" value="8"> 8秒</label>
                        </div>
                        <div class="settings-row" id="htmlSpeedRow" style="display:none">
                            <span class="settings-label">滚动速度</span>
                            <label><input type="radio" name="htmlSpeed" value="slow"> 慢</label>
                            <label><input type="radio" name="htmlSpeed" value="medium" checked> 中</label>
                            <label><input type="radio" name="htmlSpeed" value="fast"> 快</label>
                        </div>
                    </div>
                    <div class="dialog-footer">
                        <button class="btn-cancel" id="htmlScrollCancelBtn">取消</button>
                        <button class="btn-confirm" id="htmlScrollConfirmBtn">确认发送</button>
                    </div>
                </div>`;
            // 滚动方式切换时显隐对应参数行
            const modeRow = (mode) => {
                mask.querySelector('#htmlPageIntervalRow').style.display = mode === 'page' ? '' : 'none';
                mask.querySelector('#htmlSpeedRow').style.display = mode === 'page' ? 'none' : '';
            };
            mask.querySelectorAll('input[name="htmlScrollMode"]').forEach(r =>
                r.addEventListener('change', (e) => modeRow(e.target.value)));
            mask.querySelector('#htmlScrollCancelBtn').addEventListener('click', () => {
                mask.remove();
                resolve(null);
            });
            mask.querySelector('#htmlScrollConfirmBtn').addEventListener('click', () => {
                const mode = mask.querySelector('input[name="htmlScrollMode"]:checked').value;
                const htmlScroll = { mode };
                if (mode === 'page') {
                    htmlScroll.pageInterval = parseInt(mask.querySelector('input[name="htmlPageInterval"]:checked').value) || 5;
                } else {
                    htmlScroll.speed = mask.querySelector('input[name="htmlSpeed"]:checked').value;
                }
                mask.remove();
                resolve(htmlScroll);
            });
            document.body.appendChild(mask);
        });
    },
```

- [ ] **Step 6: media-library.js playMedia html 分支**

`playMedia(url, mediaType)`（约 293-307 行）改为：

```js
    playMedia(url, mediaType) {
        if (mediaType === 'html') {
            this.sendHtmlMedia(url);
            return;
        }
        if (window.Crop) {
            window.Crop.showPreview(url, mediaType);
        }
        if (window.WebSocketManager && window.WebSocketManager.sendMedia) {
            window.WebSocketManager.sendMedia({
                type: 'url',
                url: url,
                mediaType: mediaType
            });
        }
        this.setCurrentMedia(url);
    },

    // HTML 媒体：弹滚动设置后直接发送（跳过裁剪预览）
    async sendHtmlMedia(url) {
        const htmlScroll = await this.showHtmlScrollSettingsDialog();
        if (!htmlScroll) {
            showToast('已取消发送', 'warning');
            return;
        }
        if (window.Crop) {
            window.Crop.hideForHtml();
        }
        if (window.WebSocketManager && window.WebSocketManager.sendMedia) {
            window.WebSocketManager.sendMedia({
                type: 'url',
                url: url,
                mediaType: 'html',
                htmlScroll
            });
        }
        this.setCurrentMedia(url);
    },
```

- [ ] **Step 7: media-library.js 新增工具栏「发送 HTML」对话框**

在 `MediaLibrary` 对象中新增两个方法：

```js
    // 工具栏「发送 HTML」：粘贴代码 + 滚动设置 + 去向（临时/保存到媒体库）
    showSendHtmlDialog() {
        const mask = document.createElement('div');
        mask.className = 'modal-mask';
        mask.innerHTML = `
            <div class="playlist-settings-dialog">
                <div class="dialog-title">发送 HTML</div>
                <div class="dialog-body">
                    <div class="settings-row">
                        <span class="settings-label">HTML 代码</span>
                        <textarea id="sendHtmlCodeInput" rows="10" placeholder="粘贴 HTML 代码（建议内联所有资源，如 data: 图片）"
                            style="width:100%;font-family:monospace;background:rgba(255,255,255,0.1);color:#fff;border:none;border-radius:6px;padding:8px;box-sizing:border-box;"></textarea>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">滚动方式</span>
                        <label><input type="radio" name="sendHtmlMode" value="page" checked> 分页式</label>
                        <label><input type="radio" name="sendHtmlMode" value="smooth"> 平滑</label>
                        <label><input type="radio" name="sendHtmlMode" value="loop"> 循环</label>
                    </div>
                    <div class="settings-row" id="sendHtmlPageIntervalRow">
                        <span class="settings-label">每屏停留</span>
                        <label><input type="radio" name="sendHtmlPageInterval" value="3"> 3秒</label>
                        <label><input type="radio" name="sendHtmlPageInterval" value="5" checked> 5秒</label>
                        <label><input type="radio" name="sendHtmlPageInterval" value="8"> 8秒</label>
                    </div>
                    <div class="settings-row" id="sendHtmlSpeedRow" style="display:none">
                        <span class="settings-label">滚动速度</span>
                        <label><input type="radio" name="sendHtmlSpeed" value="slow"> 慢</label>
                        <label><input type="radio" name="sendHtmlSpeed" value="medium" checked> 中</label>
                        <label><input type="radio" name="sendHtmlSpeed" value="fast"> 快</label>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">去向</span>
                        <label><input type="checkbox" id="sendHtmlSaveToLibrary"> 同时保存到媒体库（当前目录）</label>
                    </div>
                </div>
                <div class="dialog-footer">
                    <button class="btn-cancel" id="sendHtmlCancelBtn">取消</button>
                    <button class="btn-confirm" id="sendHtmlConfirmBtn">发送</button>
                </div>
            </div>`;
        const modeRow = (mode) => {
            mask.querySelector('#sendHtmlPageIntervalRow').style.display = mode === 'page' ? '' : 'none';
            mask.querySelector('#sendHtmlSpeedRow').style.display = mode === 'page' ? 'none' : '';
        };
        mask.querySelectorAll('input[name="sendHtmlMode"]').forEach(r =>
            r.addEventListener('change', (e) => modeRow(e.target.value)));
        mask.querySelector('#sendHtmlCancelBtn').addEventListener('click', () => mask.remove());
        mask.querySelector('#sendHtmlConfirmBtn').addEventListener('click', () => {
            const code = mask.querySelector('#sendHtmlCodeInput').value.trim();
            if (!code) {
                showToast('请输入 HTML 代码', 'error');
                return;
            }
            const mode = mask.querySelector('input[name="sendHtmlMode"]:checked').value;
            const htmlScroll = { mode };
            if (mode === 'page') {
                htmlScroll.pageInterval = parseInt(mask.querySelector('input[name="sendHtmlPageInterval"]:checked').value) || 5;
            } else {
                htmlScroll.speed = mask.querySelector('input[name="sendHtmlSpeed"]:checked').value;
            }
            const saveToLibrary = mask.querySelector('#sendHtmlSaveToLibrary').checked;
            mask.remove();
            this._sendHtmlCode(code, htmlScroll, saveToLibrary);
        });
        document.body.appendChild(mask);
        mask.querySelector('#sendHtmlCodeInput').focus();
    },

    // 发送粘贴的 HTML 代码：临时发送或保存到媒体库后按 url 发送
    async _sendHtmlCode(code, htmlScroll, saveToLibrary) {
        if (saveToLibrary) {
            if (!this.currentLibrary) {
                showToast('请先选择媒体库', 'error');
                return;
            }
            if (this.currentLibrary.readonly) {
                showToast('只读媒体库，无法保存', 'error');
                return;
            }
            const file = new File([code], `粘贴代码_${Date.now()}.html`, { type: 'text/html' });
            const result = await this.uploadFile(file, this.currentPath);
            if (!result.success) {
                showToast('保存到媒体库失败: ' + result.error, 'error');
                return;
            }
            const url = result.data.file.url;
            if (window.Crop) {
                window.Crop.hideForHtml();
            }
            if (window.WebSocketManager && window.WebSocketManager.sendMedia) {
                window.WebSocketManager.sendMedia({
                    type: 'url',
                    url: url,
                    mediaType: 'html',
                    htmlScroll
                });
            }
            this.setCurrentMedia(url);
            showToast('已保存到媒体库并发送', 'success');
            return;
        }
        // 临时发送：base64 直传
        const blob = new Blob([code], { type: 'text/html' });
        const base64 = await window.Upload.fileToBase64(blob);
        if (window.WebSocketManager && window.WebSocketManager.sendMedia) {
            window.WebSocketManager.sendMedia({
                type: 'base64',
                data: base64,
                fileName: '粘贴代码.html',
                mediaType: 'html',
                mimeType: 'text/html',
                temp: true,
                htmlScroll
            });
        }
        showToast('已发送到显示端', 'success');
    },
```

注意：`_sendHtmlCode` 中 `result.data.file.url` 来自上传 API 响应（`server-app.js:1533` `{ status:'success', file: result }`，`LocalProvider.uploadFile` 返回对象含 `url` 字段）。若字段名有出入，按 `media-library.js` 中现有上传调用（`uploadFile` 方法）的实际返回结构调整。

- [ ] **Step 8: upload.html 增加按钮与 accept 扩展**

`upload.html` 文件上传 section（第 81-84 行 file-input-wrapper 之后）加：

```html
                <div style="margin-top:8px;">
                    <button class="btn-batch" onclick="MediaLibrary.showSendHtmlDialog()">发送 HTML</button>
                </div>
```

`upload.html:85` `imageInput` 的 accept 改为 `accept="image/*,.html,.htm"`；`upload.html:123` `batchFileInput` 的 accept 改为 `accept="image/*,video/*,.html,.htm"`

- [ ] **Step 9: 语法检查与提交**

Run: `node --check src/apps/web-mediacenter/ui/public/js/upload.js && node --check src/apps/web-mediacenter/ui/public/js/media-library.js`
Expected: 无语法错误输出。

```bash
git add src/apps/web-mediacenter/ui/public/js/upload.js src/apps/web-mediacenter/ui/public/js/media-library.js src/apps/web-mediacenter/ui/public/upload.html
git commit -m "feat: 上传端 html 媒体发送（滚动设置对话框、粘贴发送、裁剪框拖拽）"
```

---

### Task 4: 显示端渲染与滚动（display.html + display.css）

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/css/display.css`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`

**Interfaces:**
- Consumes: media 消息结构 `{ type:'url'|'base64', url, data, mediaType:'html', mimeType, fileName, temp, htmlScroll }`（Task 3 发送端产生）；playlist 项 `{ url|data, fileName, mediaType, mimeType }`（服务端 buildFromLibrary 已含 html）
- Produces: 全局函数 `startHtmlScroll(iframe, htmlScroll)`、`stopHtmlScroll()`；`showMedia` html 分支；playlist html 处理

- [ ] **Step 1: display.css 新增 iframe 样式**

在 `#mediaVideo.crop` 规则之后追加：

```css
#mediaHtml {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: none;
    display: none;
    pointer-events: none;
}
```

- [ ] **Step 2: display.html 新增 iframe 元素**

在 `display.html:32` `<video id="mediaVideo">` 之后加：

```html
        <iframe id="mediaHtml" style="display:none;"></iframe>
```

- [ ] **Step 3: display.html 新增滚动控制器**

在 `showMedia` 函数定义之前（`function showMedia(data)` 上方）插入：

```js
        // HTML 媒体滚动控制器：分页式 / 平滑 / 循环
        let htmlScrollState = null;

        function stopHtmlScroll() {
            if (htmlScrollState) {
                if (htmlScrollState.timer) clearInterval(htmlScrollState.timer);
                if (htmlScrollState.rafId) cancelAnimationFrame(htmlScrollState.rafId);
                htmlScrollState = null;
            }
        }

        function startHtmlScroll(iframe, htmlScroll) {
            stopHtmlScroll();
            const win = iframe.contentWindow;
            if (!win) return;
            const opts = htmlScroll || {};
            const mode = opts.mode || 'page';
            const pageInterval = opts.pageInterval || 5;
            const speedPx = { slow: 60, medium: 120, fast: 240 }[opts.speed || 'medium'];

            const scrollHeight = Math.max(
                (win.document.documentElement && win.document.documentElement.scrollHeight) || 0,
                (win.document.body && win.document.body.scrollHeight) || 0
            );
            const clientHeight = win.innerHeight || iframe.clientHeight;
            // 内容不溢出时无需滚动
            if (scrollHeight <= clientHeight + 1) return;

            if (mode === 'page') {
                // 分页式：每 pageInterval 秒滚一屏，到底停止
                htmlScrollState = {
                    timer: setInterval(() => {
                        if (!htmlScrollState) return;
                        if (win.scrollY + clientHeight >= scrollHeight - 2) {
                            stopHtmlScroll();
                            return;
                        }
                        win.scrollBy(0, clientHeight);
                    }, pageInterval * 1000)
                };
            } else {
                // 平滑：匀速滚动；loop 模式滚到底回顶循环
                let last = performance.now();
                const step = (now) => {
                    if (!htmlScrollState) return;
                    const dt = (now - last) / 1000;
                    last = now;
                    if (win.scrollY + clientHeight >= scrollHeight - 2) {
                        if (mode === 'loop') {
                            win.scrollTo(0, 0);
                        } else {
                            stopHtmlScroll();
                            return;
                        }
                    }
                    win.scrollBy(0, speedPx * dt);
                    htmlScrollState.rafId = requestAnimationFrame(step);
                };
                htmlScrollState = { rafId: requestAnimationFrame(step) };
            }
        }
```

- [ ] **Step 4: showMedia 提取 TTS/temp 公共逻辑并加 html 分支**

将 `showMedia` 中 1434-1469 行的 TTS 播报 + 临时媒体上报代码块整体提取为函数（放在 `showMedia` 定义之后）：

```js
        // TTS 播报 + 临时媒体信息上报（各媒体类型共用）
        function announceAndReport(mediaName, data) {
            if (autoTtsEnabled && mediaName) {
                const displayName = extractFileName(mediaName);
                if (displayName) {
                    playTTS(displayName);
                }
            }

            if (!data.temp) return;
            const sendTempInfo = () => {
                if (!displayWs || displayWs.readyState !== WebSocket.OPEN) return;
                let w, h;
                if (data.mediaType === 'video') {
                    w = mediaVideo.videoWidth;
                    h = mediaVideo.videoHeight;
                } else if (data.mediaType !== 'html') {
                    w = mediaImage.naturalWidth;
                    h = mediaImage.naturalHeight;
                }
                displayWs.send(JSON.stringify({
                    type: 'tempMediaInfo',
                    fileName: data.fileName || mediaName || '',
                    mediaType: data.mediaType,
                    width: w || undefined,
                    height: h || undefined
                }));
            };
            const readyTarget = data.mediaType === 'video' ? mediaVideo : (data.mediaType === 'html' ? mediaHtml : mediaImage);
            const readyEvent = data.mediaType === 'video' ? 'loadedmetadata' : 'load';
            if (data.mediaType === 'html') {
                // html 无固有尺寸，加载完成即上报（不含宽高）
                readyTarget.addEventListener(readyEvent, sendTempInfo, { once: true });
            } else if (readyTarget.readyState >= 1 || (readyTarget.complete && readyTarget.naturalWidth > 0)) {
                sendTempInfo();
            } else {
                readyTarget.addEventListener(readyEvent, sendTempInfo, { once: true });
            }
        }
```

注意：`extractFileName`、`playTTS`、`displayWs`、`mediaHtml`、`autoTtsEnabled` 均为 display.html 已有定义。原 1468 行无条件调用的 `sendTempInfo();`（疑似遗留）在提取后不再保留。

`showMedia` 开头（`waitingMessage.style.display = 'none';` 之后）插入 html 分支：

```js
            if (data.mediaType === 'html') {
                // HTML 媒体：iframe 铺满纯展示，跳过 img/video 与裁剪
                stopHtmlScroll();
                mediaImage.style.display = 'none';
                mediaImage.removeAttribute('src');
                mediaVideo.pause();
                mediaVideo.src = '';
                mediaVideo.load();
                mediaVideo.style.display = 'none';
                mediaHtml.style.display = 'block';
                mediaHtml.onload = () => startHtmlScroll(mediaHtml, data.htmlScroll);
                let mediaName = data.fileName || 'HTML内容';
                if (data.type === 'url') {
                    mediaHtml.srcdoc = '';
                    mediaHtml.src = data.url;
                    const urlParts = data.url.split('/');
                    mediaName = decodeURIComponent(urlParts[urlParts.length - 1].split('?')[0]) || mediaName;
                } else {
                    const bytes = Uint8Array.from(atob(data.data), c => c.charCodeAt(0));
                    const html = new TextDecoder().decode(bytes);
                    mediaHtml.src = '';
                    mediaHtml.srcdoc = html;
                }
                fileNameDisplay.textContent = mediaName;
                announceAndReport(mediaName, data);
                return;
            }
```

将原 1434-1469 行（TTS + temp 代码块）替换为一行调用：

```js
            announceAndReport(mediaName, data);
```

注意：原 TTS 代码块位于 url/base64 分支之后、`if (data.temp) {...}` 整块结束处。替换后 `showMedia` 的 url/base64 分支末尾调用 `announceAndReport(mediaName, data)`。`mediaHtml` 变量需在 display.html 顶部元素引用区（约 40-52 行）添加：`const mediaHtml = document.getElementById('mediaHtml');`

- [ ] **Step 5: playlist 处理 html**

`playCurrentItem`（约 1203-1214 行）的尺寸上报分支改为：

```js
            if (item.mediaType === 'video') {
                mediaVideo.addEventListener('loadedmetadata', reportSizeOnce, { once: true });
            } else if (item.mediaType === 'html') {
                mediaHtml.addEventListener('load', reportSizeOnce, { once: true });
            } else {
                mediaImage.addEventListener('load', reportSizeOnce, { once: true });
            }
```

`playlistPause`（约 1281-1282 行）在 `ps.paused = true;` 后加一行：

```js
            stopHtmlScroll();
```

`playlistResume`（约 1300-1311 行）在现有逻辑后追加 html 恢复滚动：

```js
            if (item && item.mediaType === 'html' && !ps.timer) {
                startHtmlScroll(mediaHtml, item.htmlScroll || null);
            }
```

在 `playlistResume` 函数开头补充 `const item = ps.playlist[ps.index];`（若该函数内已有 item 定义则跳过）。`finishPlaylist`/`stopPlaylist` 函数内（约 1310-1360 行）在清理 videoEndedHandler 处加一行：

```js
            stopHtmlScroll();
```

- [ ] **Step 6: 语法检查与提交**

Run: `node --check src/apps/web-mediacenter/ui/public/display.html`（若失败，用 `node -e "require('fs').readFileSync('src/apps/web-mediacenter/ui/public/display.html','utf8')"` 确认文件可读；html 内联 JS 无独立检查器，用浏览器自测兜底）
Expected: 无语法错误。

```bash
git add src/apps/web-mediacenter/ui/public/css/display.css src/apps/web-mediacenter/ui/public/display.html
git commit -m "feat: 显示端 html 媒体渲染与滚动控制器（分页/平滑/循环）"
```

---

### Task 5: 项目文档收尾

**Files:**
- Create: `docs/task/2026-08-15_HTML媒体类型.md`（任务执行文档）
- Modify: `docs/todo.md`、`changelog.md`、`docs/design/html-media.md`（状态说明）
- Modify: `docs/self-test.md`（自测模块，按项目惯例补充 html 媒体自测用例）

**Interfaces:**
- Consumes: Task 1-4 全部实现

- [ ] **Step 1: 创建任务文档**

`docs/task/2026-08-15_HTML媒体类型.md`，内容包含：任务描述、设计需求（引用 `docs/design/html-media.md`）、spec 设计（引用更新后的 `docs/spec/media-library.md`/`batch-playlist.md`）、受影响模块和文件、自测用例（下文的浏览器自测清单）、兼容性测试（现有 image/video/gif 发送与批量播放不回归）、性能测试（长页面滚动 rAF 无泄漏，切换/停止清理定时器）、风险评估（iframe 同源信任、srcdoc 相对资源失效）、预计工时。

- [ ] **Step 2: 浏览器自测（验证 Task 2/3/4 功能）**

按 `docs/self-test.md` 项目流程逐项验证：

1. 服务端启动 `npm start`，上传端打开 `/upload`，显示端打开 `/display`
2. 媒体库上传一个 `test.html`（内容为超过一屏的长页面，含 JS 动画），点击发送 → 弹出滚动设置框 → 选「分页式 3秒」→ 确认：显示端 iframe 铺满显示，每 3 秒滚一屏，滚到底停止
3. 重复发送，选「平滑 快」：匀速滚动到底停止；选「循环」：滚到底回顶循环
4. 内容不足一屏的 html（短页面）：发送后静态显示不滚动
5. 裁剪框拖入 `test.html`：弹滚动设置框，确认后临时模式发送成功，裁剪预览区不显示图片/视频
6. 工具栏「发送 HTML」：粘贴含中文和 `data:` 图片的代码 → 临时发送 → 显示端渲染正确；勾选「同时保存到媒体库」→ 媒体库出现 `粘贴代码_*.html` 且显示端按 url 渲染
7. 批量播放含 html 的文件夹：html 项按间隔切换，滚动用默认分页 5 秒；暂停时滚动停止，恢复时继续
8. 回归：发送图片/视频/gif 行为不变，裁剪功能正常
9. 显示端刷新后临时 html 的占位提示不异常（复用现有 temp 逻辑）

- [ ] **Step 3: 更新项目文档**

`changelog.md` 追加：`2026-08-15 新增 HTML 媒体类型（媒体库识别 .html、粘贴代码发送、显示端 iframe 纯展示、分页/平滑/循环滚动）`
`todo.md`：若该功能曾在待办中则移除
`docs/design/html-media.md` 末尾状态段标注：功能已实现（2026-08-15）
`docs/self-test.md` 按项目格式补充 html 媒体自测用例

- [ ] **Step 4: 提交**

```bash
git add docs/task/2026-08-15_HTML媒体类型.md docs/todo.md changelog.md docs/design/html-media.md docs/self-test.md
git commit -m "docs: HTML 媒体类型任务文档与自测记录"
```

---

## Self-Review

**Spec 覆盖检查（对照 docs/design/html-media.md）：**
- 媒体类型识别（服务端 detectMediaType + MEDIA_TYPES）→ Task 1 ✅
- 上传端 detectMediaType（upload.js）→ Task 3 Step 2 ✅
- 媒体库文件发送弹滚动设置 → Task 3 Step 6 ✅
- 工具栏「发送 HTML」粘贴（临时/媒体库两去向）→ Task 3 Step 7 ✅
- 裁剪框拖拽 html 临时发送 → Task 3 Step 3/4 ✅
- 批量临时拖入 html 用默认参数 → Task 3（prepareTempFiles 的 detectMediaType 已识别，playlist 项带 mediaType，显示端默认参数）✅
- getMediaRatio 短路 → Task 2 Step 1 ✅
- crop.js html 分支 → Task 2 Step 2 ✅
- 显示端 iframe + showMedia html 分支 → Task 4 ✅
- 滚动控制器三种模式 + 溢出判断 → Task 4 Step 3 ✅
- playlist html（图片式切换 + 默认滚动参数 + 暂停/恢复/停止清理）→ Task 4 Step 5 ✅
- temp 上报（html 无宽高）→ Task 4 Step 4 ✅
- accept 扩展 → Task 3 Step 8 ✅
- 文档流程（spec 先行、changelog、todo、task 文档、self-test）→ Task 1 Step 1、Task 3 Step 1、Task 5 ✅

**占位符扫描：** 无 TBD/TODO；所有代码步骤给出完整代码。⚠️ 两处"按实际命名调整"提示（crop.js `this.box` 属性名、上传响应 `result.data.file.url`）属于对现有代码的谨慎标注，已给出依据（`showPreview` 中 `this.box.style.display`、`server-app.js:1533`），实现者按提示核对即可。

**类型一致性：** `htmlScroll` 结构 `{mode, pageInterval, speed}` 在 Task 3（对话框产出）、Task 4（startHtmlScroll 消费）一致；`showHtmlScrollSettingsDialog` 返回 `Promise<htmlScroll|null>` 在 Task 3 Step 3/4/6 三处消费一致；`stopHtmlScroll`/`startHtmlScroll` 签名在 Task 4 内部一致；`announceAndReport(mediaName, data)` 在 showMedia html 分支与 url/base64 分支一致。
