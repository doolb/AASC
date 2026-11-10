# 媒体库多代理地址、显示端媒体库浏览与下载目录子分类设计文档

日期：2026-11-10

## 功能概述

本设计包含三个相互独立、可分别实施的功能：

1. **多代理地址**：将当前“单个全局代理 + 每个媒体源布尔开关”改为“命名代理列表 + 每个媒体源从下拉框选择一个代理（或不使用代理）”，并兼容旧配置自动迁移。
2. **显示端媒体库浏览与播放**：在显示端左下角“游戏”按钮上方新增“媒体库”入口，仅对通过 `localhost` / `127.0.0.1` / `::1` 打开页面的本机开放；面板只读，展示本地媒体库与当前活动任务媒体源，支持单文件播放和文件夹批量播放。
3. **下载目录子分类**：夸克分享与 B 站下载在目标库内按“来源名 / 子分类”建目录，子分类取当前正在浏览的夸克分享文件夹名或 B 站收藏夹 / 合集名；路径风格为 `目标库/来源名/子分类/...`。

三个功能都沿现有服务端权威、控制端配置、显示端消费的架构实现，不引入新的存储系统或前端构建步骤。

---

## 一、多代理地址

### 1.1 需求

- 设置中维护一张代理表，每项包含名称与代理地址，数量上限 20。
- 当前实际使用代理的媒体源（B 站与各任务媒体源）各自从下拉框选择使用列表中的某个代理，或选择“不使用代理”；夸克分享当前不读取代理，界面不提供其代理选择。
- 服务端按媒体源解析出唯一生效的代理地址；解析不到时不走代理。
- 现有 `network.globalWebProxy` 与布尔型 `media.providerProxy` 自动迁移，不要求用户重新配置。
- 代理仅由服务端使用，浏览器端不建立代理连接；代理地址（可能含凭据）不写入日志，不进入错误消息。

### 1.2 数据模型

配置文件 `config.json`：

```json
{
  "network": {
    "webProxies": [
      { "id": "proxy-a1b2c3d4", "name": "公司代理", "url": "http://127.0.0.1:7890" },
      { "id": "proxy-e5f6g7h8", "name": "备用代理", "url": "socks5://127.0.0.1:1080" }
    ]
  },
  "media": {
    "providerProxy": {
      "bilibili": "proxy-a1b2c3d4",
      "quark": "",
      "hongguo": "proxy-e5f6g7h8"
    }
  }
}
```

规则：

- `network.webProxies`：数组，元素 `{id, name, url}`；`id` 由服务端生成（`proxy-` + 8 位十六进制随机串），客户端保存整表时不信任客户端提供的 id，新增项一律重新生成，已有项按 id 匹配。
- `media.providerProxy`：`{sourceId: proxyId}`；`proxyId` 为空字符串表示明确不使用代理；键不存在时同样视为不使用代理。
- `sourceId` 沿用现有校验正则 `^(bilibili|[a-z][a-z0-9._-]{1,63})$`；任务媒体源直接使用注册 ID（如 `hongguo`、`youtube`），不带 `task-auto:` 前缀。
- 删除代理时，服务端在同一保存操作内把所有引用该 `proxyId` 的来源置为 `""`，不留下悬空引用。
- 任务媒体源注册表中的 `proxyDefault` 在新模型下不再参与解析：没有显式选择的来源一律不使用代理；旧行为通过迁移阶段写入 `proxy-legacy` 来保留。

### 1.3 旧配置迁移

在加载配置后、首次提供代理解析之前执行一次迁移：

```text
若 network.webProxies 不是数组：
    proxies = []
    legacyId = ''
    若 normalizeProxyUrl(network.globalWebProxy) 非空：
        proxies = [{ id: LEGACY_PROXY_ID, name: '默认代理', url: 规范化后的地址 }]
        legacyId = LEGACY_PROXY_ID
    把 media.providerProxy 中所有值为 true 的键改为 legacyId，其余改为 ''
    写入 network.webProxies 与迁移后的 media.providerProxy
    把 network.globalWebProxy 置为空字符串（配置服务没有删除接口，置空避免残留可被误读的旧值）
    （以上仅修改内存配置并标记为待持久化，由现有配置保存路径落盘）

其中 LEGACY_PROXY_ID = 'proxy-legacy'。
```

迁移的原则是“旧布尔开关为 true 且旧全局代理有效”的来源继续走同一个代理，其余来源不走代理，行为与迁移前一致。

### 1.4 服务端代理解析

`web-proxy.js` 调整：

```text
function resolveSourceProxyUrl({ proxies = [], selections = {}, sourceId, legacyProxyDefault = false }):
    若 sourceId 为空：返回 ''
    proxyId = selections[sourceId]（按自有属性判断；undefined 视为 legacyProxyDefault ? LEGACY_PROXY_ID : ''）
    若 proxyId 为空：返回 ''
    找到 proxies 中 id 等于 proxyId 的项
    返回该项 url 经 normalizeProxyUrl 后的结果；找不到或非法则返回 ''
```

- `legacyProxyDefault` 仅为迁移期间过渡；迁移完成后所有来源选择都以 `selections` 为准，注册表里的 `proxyDefault` 被忽略。
- `normalizeProxyUrl`、`getProxyAgents`、`axiosProxyOptions` 保持现有行为（协议白名单、拒绝 search/hash、去尾部斜杠、代理缓存）。
- 每个媒体源调用代理的地方继续使用 `getProxyUrl(sourceId, proxyDefault)`，其内部改为查 `network.webProxies` + `media.providerProxy`。

### 1.5 配置协议

控制端与服务端之间：

| 方向 | 消息 | 载荷 |
|------|------|------|
| 控制端 → 服务端 | `getWebProxyConfig` | 无 |
| 服务端 → 所有控制端 | `webProxyConfig` | `{ webProxies: [{id,name,url}], providerProxy: {sourceId: proxyId}, sources: [{id,name,region,proxyId}] }` |
| 控制端 → 服务端 | `setWebProxyList` | `{ webProxies: [{id?, name, url}] }` |
| 控制端 → 服务端 | `setProviderProxy` | `{ sourceId, proxyId }` |
| 服务端 → 请求方 | `webProxyConfigError` | `{ message }` |

`setWebProxyList` 校验规则：

- 非数组或超过 20 项 → 错误“代理数量超出限制（最多 20 个）”。
- 名称为空或超过 30 字符 → 错误“代理名称不能为空且不能超过 30 个字符”。
- 地址 `normalizeProxyUrl` 失败 → 错误“代理地址格式不正确，仅支持 http/https/socks/socks5/socks5h”。
- 校验失败时不写入配置、不广播，只回 `webProxyConfigError`，原有配置保持不变。
- 保存成功后整表持久化，广播 `webProxyConfig`。

`setProviderProxy` 校验规则：

- `sourceId` 不匹配现有正则 → 错误“媒体源标识不合法”。
- `proxyId` 非空且不在当前代理表中 → 错误“所选代理不存在，请先保存代理列表”。
- 保存后广播 `webProxyConfig`。

`sources` 中每项的 `proxyId` 是服务端解析后的当前选择，控制端据此渲染下拉框选中项；`region` 用于沿用现有页签分组。

### 1.6 控制端界面

`upload.html` 服务设置中的“全局网络代理”区域替换为：

- 代理列表编辑器，每行：名称输入框、地址输入框、删除按钮；底部“添加代理”“保存代理列表”两个按钮。
- 保存按钮把当前整表发送 `setWebProxyList`；成功前不更新本地权威状态，失败只提示 `webProxyConfigError.message`。
- 已保存列表在收到 `webProxyConfig` 后重新渲染，输入框中的未保存编辑不跨广播保留。

B 站页签与每个任务媒体源页签旁的下拉框（`<select data-provider-proxy="<sourceId>">`）：

- 第一项固定为“不使用代理”，值为 `""`。
- 后续每项为一个已保存代理，显示名称为代理名称，值为代理 id。
- 变更即发送 `setProviderProxy`；广播回来后按服务端结果更新。
- 任务媒体源页签（`renderTaskMediaTabs`）中的“使用代理”复选框替换为同样的下拉框，包在 `.media-task-source-wrap` 内，与页签按钮并列；`data-task-media-proxy` 不再表示开关状态，仅作为设置面板批量同步下拉框时的排除标记。
- 任务源尚未出现在配置里时，下拉框显示“不使用代理”，待首次选择后才写入 `providerProxy`。
- `webProxyConfig.sources` 由服务端返回固定项 B 站（`bilibili`）加上 `listTaskMediaSources()` 的活动任务源，控制端按此渲染；夸克分享不在列表中。

### 1.7 测试

- `tests/web-proxy.test.js`：多代理解析、空选择、非法 proxyId、名称/数量/地址校验、旧配置迁移（有全局代理 + true/false 混合、全局代理为空、已有新结构不重复迁移）。
- 控制端单元/浏览器测试：保存代理列表后每个来源下拉框选项更新；删除被引用代理后来源回到“不使用代理”；任务源页签下拉框渲染与切换。

---

## 二、显示端媒体库浏览与播放

### 2.1 入口与开放范围

- 在 `display.html` 的 `#displayGameChatActions` 中、`#displayGameToggle`（游戏）之前插入 `#displayMediaLibraryToggle` 按钮，文案“媒体库”，复用同一容器内按钮的 `display-stage-button` 样式，纵向排列后位于“游戏”上方。
- 可见性由页面主机名决定：

```text
isLocalDisplay = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname)
若 !isLocalDisplay：按钮不渲染（display:none 也可，但不注册点击事件）
```

- 服务端提供第二道边界：新增 `/api/display-local/*` 路由组，路由中间件用 `req.socket.remoteAddress` 判断回环地址（`127.0.0.1`、`::1`、`::ffff:127.0.0.1`、`::ffff:7f00:1`），非回环请求一律 403 `{ error: '仅限本机访问' }`。显示端来源的批量播放 WS 消息同样只在回环连接上受理。
- 不新增 online/offline 判定：从本机访问即满足“暂时只对 offline 本机开放”。

### 2.2 数据来源

`GET /api/display-local/libraries` 返回：

```json
{
  "libraries": [
    { "id": "local_uploads", "name": "上传", "type": "local", "readonly": false },
    { "id": "task-auto:hongguo-1", "name": "红果短剧", "type": "task", "taskId": "..." }
  ]
}
```

- 本地库来自 `listLibraries()` 中 `type` 为 `local` / `smb` / `http` / `android-saf` 的库，排除 `quark` 与 `task`。
- 任务媒体源来自 `listTaskMediaSources()`，使用其 `libraryId`（`task-auto:<providerId>`）访问；任务停止后不再出现。
- 顺序：本地库按现有顺序在前，任务源按任务创建顺序在后。

`GET /api/display-local/list?libraryId=<id>&path=<相对路径>` 返回目录内容：

```json
{
  "path": "/电影",
  "parent": "/",
  "entries": [
    { "name": "合集A", "path": "/电影/合集A", "type": "directory" },
    { "name": "a.mp4", "path": "/电影/a.mp4", "type": "file", "mediaType": "video", "directUrl": "/uploads/...", "proxyUrl": "/api/media-proxy?url=..." },
    { "name": "b.jpg", "path": "/电影/b.jpg", "type": "file", "mediaType": "image", "directUrl": "...", "proxyUrl": "..." }
  ]
}
```

- 本地库复用 `/api/aasc/media-index` 的目录扫描结果，转换为上述结构。
- 任务源复用 `/api/media-libraries/:id/list?path=` 的结果。
- `directUrl` / `proxyUrl` 由服务端统一生成；任务源返回的绝对 LAN URL 在 HTTPS 页面会产生混合内容，显示端优先使用同源 `proxyUrl`（`/api/media-proxy?url=`），本地库直接使用同源相对 `directUrl`。
- 只返回目录与可播放文件（`mediaType` 为 `image`/`video`/`audio`/`text`）；其他文件不展示。

### 2.3 显示端面板

- 全屏覆盖层 `#displayMediaLibraryPanel`，默认隐藏；点击“媒体库”按钮打开，点击右上角“关闭”或按 Esc 关闭。
- 布局：左侧来源列表（本地库 / 任务源分组标题），右侧当前目录的条目列表，顶部面包屑显示当前路径与“返回上级”。
- 只读：不提供上传、删除、移动、下载、加入播放列表等控制端操作；条目点击行为：
  - 目录 → 进入目录。
  - 文件 → 立即单文件播放。
  - 目录行尾部“批量播放”按钮 → 以该目录发起文件夹批量播放。
- 状态文案：加载失败“媒体库加载失败，请稍后重试”；空目录“此目录没有可播放的媒体”；任务源消失时返回根目录并提示“任务媒体源已停止”。
- 面板不拦截全局快捷键以外的显示端交互；关闭后回到原播放画面。

### 2.4 单文件播放

```text
playDisplayLibraryFile(entry):
    url = entry.proxyUrl || entry.directUrl
    media = { type: 'media', url, fileName: entry.name, mediaType: entry.mediaType }
    若 mediaType == 'text'：media.url 保持不变，由 TextMediaPlayer 以 url 方式 fetch 解码
    调用现有 showMedia(media)（与原生媒体代理接收到的数据结构一致）
```

复用现有 `showMedia` 对图片/视频/音频/文本的分支与全屏展示逻辑，不新增播放器。

### 2.5 文件夹批量播放

- 显示端通过自身 WebSocket 发送 `displayPlaylistRequest`：

```json
{ "type": "displayPlaylistRequest", "libraryId": "local_uploads", "path": "/电影/合集A" }
```

- 服务端仅在连接为回环地址时受理；否则回错误消息 `displayPlaylistError`（“仅限本机使用”）且不生成列表。
- 服务端复用 `playlistManager.buildFromLibrary(libraryId, path, options)`：

```json
{ "recursive": false, "interval": 5, "mode": "sequence",
  "sortBy": "name", "direction": "asc", "loop": false, "announceName": false }
```

- 生成的 `playlistStart` 只发给发起请求的显示端（`displayIds: [该显示端 id]`），沿用现有列表协议、本地自循环与进度上报；播完即停，不循环、不递归。
- 批量播放可被单文件播放、游戏/聊天等其他显示端操作打断，沿用既有打断语义。
- 列表为空时服务端回 `displayPlaylistError`（“该目录没有可播放的媒体”），不发送空列表。

### 2.6 安全与兼容

- 三道边界：页面主机名控制按钮可见性；`/api/display-local/*` 回环校验；`displayPlaylistRequest` 回环校验。仅改前端无法绕过服务端两道检查。
- `/api/media-libraries`、`/api/aasc/media-index` 等现有接口的访问范围不变，避免影响控制端局域网使用。
- 显示端新增消息需加入服务端显示端 WS 允许消息集合；控制端发送的同名消息不受影响。
- 面板与按钮在非本机页面完全不出现，不影响现有显示端布局与截图比对。

### 2.7 测试

- 服务端单元测试：回环地址判定（IPv4、IPv6、IPv4-mapped、非回环）；非回环访问 `/api/display-local/*` 返回 403；`displayPlaylistRequest` 非回环被拒绝、回环生成 `loop:false/recursive:false` 列表且只发给请求方；空目录返回错误。
- 浏览器测试：以 `http://127.0.0.1:<port>/display.html` 打开，验证“媒体库”按钮在“游戏”上方、面板列出本地库与活动任务源、进入目录、单文件播放、文件夹批量播放请求；以非回环主机名打开验证按钮不存在。

---

## 三、下载目录子分类

### 3.1 需求

- 夸克分享下载、B 站下载在目标库中按来源名与子分类分层存放，便于浏览与显示端按文件夹批量播放。
- 子分类取“当前正在浏览的媒体源下的分类”：
  - 夸克分享：当前选中的分享文件夹名称；未选中 → `未分类`。
  - B 站：当前合集/收藏夹标题；无合集上下文时取当前选中的 B 站文件夹名称；都没有 → `未分类`。
- 已有的旧目录（`夸克下载`、`B站下载`）保持原样，不迁移、不删除；已下载状态查询继续有效。

### 3.2 路径规则

| 来源 | 新路径 |
|------|--------|
| 夸克分享 | `目标库/夸克分享/<分类>/<分享标识>/<分享内相对路径>` |
| B 站 | `目标库/B站视频/<分类>/<标题> <bvid>[ Pn].mp4` |

- 夸克的 `<分享标识>` 继续使用 `sha256(source).slice(0,16)`，避免同一分享内不同相对路径冲突，同时保证不同分享同名文件隔离。
- B 站单视频与合集分集使用同一目录，分集文件名保留 `P<页码>` 后缀。
- 目标库仍由用户在下载对话框中选择；未指定目标库时沿用现有默认库行为。

### 3.3 分类名清洗

新增共享函数 `sanitizeCategoryName(value)`（放在下载相关模块的公共位置，夸克与 B 站共用）：

```text
text = String(value ?? '').trim()
text = text 替换所有 '/'、'\\' 与控制字符为 '_'
text = 连续空白折叠为单个空格
若 text 为空、'.' 或 '..'：返回 '未分类'
若长度超过 50：截断到 50
返回 text
```

- 服务端一律以清洗后的结果建目录，客户端传来的 `category` 只作为文本，不作为路径片段直接拼接。
- 相同清洗结果的不同分类会合并到同一目录，这是可接受行为。

### 3.4 协议与界面

- 夸克目录/单文件下载请求增加 `category` 字段（当前选中分享文件夹名，可为空）。
- B 站下载请求增加 `category` 字段（合集标题或当前文件夹名，可为空）。
- 下载对话框增加目标路径预览：`目标：<库名> / <来源名> / <分类名>`，分类名展示清洗后的结果（空显示 `未分类`）。
- 已下载判断不变：夸克按 `source + filePath + targetId` 查询下载记录，B 站按 `source + 文件相对路径 + targetId` 查询；改路径不破坏既有记录命中。
- 旧记录中的 `relative` 路径保持不变，仅影响新下载的落盘位置。

### 3.5 测试

- `tests/quark-directory-downloads.test.js`：分类路径拼接、缺省分类、分类路径穿越尝试被清洗、目录下载去重计数、旧记录查询仍命中。
- B 站下载测试：合集标题分类、单视频无分类 → `未分类`、文件名与分集后缀不变、旧路径记录兼容。
- 浏览器测试：下载对话框显示路径预览；切换夸克分享文件夹后分类文本随之变化。

---

## 非目标

- 不提供代理连通性测试按钮，不校验代理可用性，只校验地址格式。
- 代理不支持按协议或按来源排序、权重、故障切换；一个来源只选一个代理。
- 显示端不展示夸克分享、B 站页签，不支持上传、删除、移动、下载。
- 显示端批量播放不支持递归、循环、乱序、间隔设置界面。
- 不迁移已下载的旧目录文件，不改动既有下载记录。
- 不改动控制端现有的下载目标库选择与“已下载”状态的视觉结构，只增加分类与预览。

## 风险与约束

- 多代理改动会触及 `web-proxy.js`、`server-app.js`、`upload.html`、`media-library.js` 与现有代理测试；实施应在当前媒体库计划（Plan 1）全部评审完成后再开始，避免同一批未提交改动交叉。
- 旧代理配置迁移必须幂等：已有 `network.webProxies` 时不得重复创建 `proxy-legacy`。
- 新模型不再使用 `proxyDefault`：迁移只改写旧布尔开关已显式为 `true` 的来源；此前依赖 `proxyDefault` 隐式启用全局代理的新任务源将改为不使用代理，需要用户在界面上重新选择。
- 显示端任务源 URL 为绝对 LAN 地址，在 HTTPS 页面必须走同源 `/api/media-proxy`，否则会被浏览器拦截。
- 回环判定需覆盖 IPv4 映射地址，否则 Node 在某些平台会把 `127.0.0.1` 表示为 `::ffff:127.0.0.1`。
- 下载子分类改变落盘路径，不改变下载记录主键语义；若未来需要移动旧文件，应作为独立任务处理。
- 本设计遵循当前“Plan 1 未完成前不产生 git 提交”的约束，文档先落盘、不提交，待用户确认后再进入实现计划。
