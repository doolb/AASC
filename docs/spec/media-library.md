# 媒体库功能实现文档

```text
显示端返回键 → 媒体库下载弹窗打开时关闭弹窗；否则媒体库打开时关闭面板并消费事件；均未打开则交给下一层
```

## WebDAV、抖音和用户采集媒体（2026-11-11）

```text
已有声明：媒体库管理器、媒体播放代理、国内任务注册表、用户配置目录
新增定义：WebDAV提供器、抖音来源、用户媒体清单、油猴采集器
媒体库配置 → WebDAV连接 → 目录PROPFIND → 元数据 → 文件流Range；非只读 → PUT / MKCOL / DELETE；跨域跳转 → 不携带凭据
网页标签、资源和结构化数据 → 候选媒体与标题 → 用户预览确认 → 令牌校验 → 用户目录/站点/内容/列表.json → 合并去重
用户文件条目 → 公网 IPv4 DNS 校验并固定地址 → 流式播放或用户目录下载；重定向逐跳校验
M3U8 → 校验无加密 TS 点播分段 → 受限下载 → 本地 ffmpeg 转封装 MP4 → 用户目录 → Range 播放
抖音分享链接 → 国内任务来源 → yt-dlp 与所选来源代理 → 安全域名校验 → 流式播放或下载
```

## 媒体源统一代理（2026-11-11）

```text
已有声明：代理列表、来源选择、B站服务、夸克媒体库、国内与国外任务媒体源
新增定义：来源客户端 = 原始 HTTP 客户端 + 实时来源代理读取器
操作流程：每次外部请求 → 读取来源选择 → 生成代理连接参数或显式直连 → 保留原请求参数与流 → 发起请求 → 返回响应或错误
操作流程：B站播放、列表、搜索与弹幕 → B站来源客户端；夸克分享请求与文件流 → 夸克来源客户端
操作流程：任务来源请求与下载进程 → 既有来源代理封装；控制端选择 → 远端配置消息 → 服务端持久化并广播
```

## 代理与媒体用户配置迁移（2026-11-11）

```text
已有声明 := 主配置 network、media；用户配置 userconfig.json；媒体连接 media-libraries.json
启动迁移 → 按 network、media 字段合并旧值与用户值，用户已有字段优先
用户配置保存成功 → 删除主配置对应旧分区并保存；失败 → 保留旧分区并停止迁移
配置读取 network、media 及其子路径 → 用户配置；写入 → 用户配置，失败恢复内存旧值
迁移失败 → 停止配置初始化，保留旧分区；重启重试，不覆盖用户已有字段
媒体连接列表 → 继续读写 userconfig/media-libraries.json；远端配置消息保持不变
```

## 分享移动文件夹弹窗（2026-11-10）

```text
已有声明 := 夸克/B站分类快照、分享键、shareFolderMove 消息
点击移动 → 从对应分类快照创建 HTML 弹窗，展示未分类及各文件夹，默认选中分享当前分类
选择 → 更新目标，不发送消息；取消、遮罩、Escape → 关闭且不修改分类
确认 → 检查目标仍存在、连接可用；发送原有 shareFolderMove { category, key, folderId }
目标已被删除或连接失败 → 提示并保留弹窗；成功发送 → 关闭并等待服务端权威广播
文件夹名通过文本节点渲染；关闭时释放键盘监听并恢复原焦点
```

## 概述

媒体库功能提供统一的媒体资源管理接口，支持多种存储后端（本地存储、HTTP目录、SMB共享）。

## 核心模块实现

### 1. 媒体库提供者接口

```
类 MediaLibraryProvider:
    属性:
        config: 配置对象
        connected: 连接状态
    
    方法:
        connect() -> 连接媒体库
        disconnect() -> 断开连接
        list(path) -> 列出目录内容
        getFile(path) -> 获取文件信息
        uploadFile(path, file) -> 上传文件
        deleteFile(path) -> 删除文件
        createFolder(path) -> 创建文件夹
        deleteFolder(path) -> 删除文件夹
        getFileStream(path, range?) -> 获取文件流（range: {start, end} 可选，支持分段）
        getPublicUrl(path) -> 获取公开访问URL

    parseRange(rangeHeader, totalSize) -> {start, end} | null   // 工具函数
        // 解析 HTTP Range: bytes=start-end 或 bytes=start- 或 bytes=-suffix
        // 非法返回 null，由调用方回退为 200 整流

        detectMediaType(name):
        ext = name 的后缀
        if ext in ['gif']: return 'gif'
        if ext in ['mp4','webm','mov','avi','mkv']: return 'video'
        if ext in ['html','htm','mhtml']: return 'html'   // mhtml 为单文件网页，iframe 可直接渲染
        return 'image'
```

### Range 流返回约定

各 Provider 的 getFileStream(path, range) 统一返回 `{ stream, statusCode, headers }`：
- 无 range：statusCode=200，headers 含 Content-Length=totalSize（本地可精确）
- 有 range：statusCode=206，headers 含 Content-Range: bytes {start}-{end}/{totalSize} + Content-Length={end-start+1}
- 服务器 proxy 端点据 statusCode 决定响应状态码，实现视频 seek

### 2. 本地存储提供者 (LocalProvider)

```
类 LocalProvider 继承 MediaLibraryProvider:
    属性:
        basePath: 基础路径（绝对路径）
    
    connect():
        如果 basePath 不存在:
            创建目录（递归）
        设置 connected = true
    
    list(dirPath):
        fullPath = 解析路径(dirPath)
        items = 读取目录(fullPath)
        对每个 item:
            itemPath = fullPath + item.name
            linkStat = lstat(itemPath)
            stat = linkStat
            如果 linkStat 是符号链接:
                尝试 stat = stat(itemPath)
                如果目标不存在:
                    跳过该项
            使用 stat 判断 type、mediaType、size、modifiedTime
        返回 items 映射为:
            - name: 文件名
            - path: 相对路径
            - type: folder | file
            - mediaType: image | video | gif | folder
            - size: 文件大小
            - modifiedTime: 修改时间
            - url: 公开访问URL
    
    getFileStream(filePath, range?):
        fullPath = 解析路径(filePath)
        如果文件不存在: 抛出错误("文件不存在")
        totalSize = stat(fullPath).size
        如果 range:
            stream = createReadStream(fullPath, {start: range.start, end: range.end})
            返回 { stream, statusCode: 206, headers: {Content-Length: range.end-range.start+1, Content-Range: "bytes {start}-{end}/{totalSize}"} }
        否则:
            stream = createReadStream(fullPath)
            返回 { stream, statusCode: 200, headers: {Content-Length: totalSize} }
    
    uploadFile(dirPath, file):
        fullPath = 解析路径(dirPath)
        uniqueName = 时间戳 + 原文件名
        写入文件(fullPath + uniqueName)
        返回文件信息
    
    deleteFile(filePath):
        fullPath = 解析路径(filePath)
        如果文件存在:
            删除文件
    
    createFolder(dirPath, folderName):
        fullPath = 解析路径(dirPath + folderName)
        创建目录（递归）
    
    deleteFolder(folderPath):
        fullPath = 解析路径(folderPath)
        如果目录存在:
            递归删除目录
    
    _encodePath(filePath):
        按 / 分段，每段 encodeURIComponent，再以 / 拼接
        （不可对整段路径编码：/ 会变成 %2F，express.static 不解码导致子目录 404）

    getPublicUrl(filePath):
        encoded = _encodePath(filePath 去掉开头的 /)
        如果 basePath === uploads 目录:
            返回 "http://{本地IP}:{端口}/uploads/{encoded}"
        否则:
            返回 "http://{本地IP}:{端口}/media/{id}/{encoded}"
    
    getRoutePrefix():
        返回 "/media/{id}"
    
    getBasePath():
        返回 basePath
    
    _resolvePath(relativePath):
        resolved = path.join(basePath, relativePath)
        如果 resolved 不以 basePath 开头:
            抛出错误("路径遍历攻击")
        返回 resolved
```

### 3. HTTP 提供者 (HttpProvider)

```
类 HttpProvider 继承 MediaLibraryProvider:
    属性:
        baseUrl: 远程服务器基础URL
        readonly: true（只读）
        requestTimeout: 8s（请求超时，防止不可达服务器挂死 init / 播放）
    
    connect():
        设置 connected = true
        无需实际连接
    
    list(dirPath):
        url = _buildUrl(dirPath)
        html = HTTP GET(url, {超时: requestTimeout, auth: username/password})
        items = _parseHtml(html, dirPath)
        对每个 type 为 file 且 mediaType 属于 image/video/gif/html 的项:
            并发（小并发池 6）HEAD 请求补 size / modifiedTime
            HEAD 失败或超时保持 size=0（不阻塞列表浏览）
        返回 items

    getFile(filePath):
        sizeInfo = _fetchHead(_buildUrl(filePath))    // HEAD 取 Content-Length + Last-Modified
        返回 {
            name: basename(filePath),
            path: filePath,
            type: 'file',
            mediaType: detectMediaType(filePath),
            size: sizeInfo?.size || 0,
            modifiedTime: sizeInfo?.modifiedTime || null,
            url: getPublicUrl(filePath)
        }

    _fetchHead(url):
        HTTP HEAD(url, {超时: requestTimeout})
        返回 { size: Content-Length 转数字, modifiedTime: Last-Modified }
        失败/超时返回 null（size 回落 0，不抛错）

    _buildUrl(dirPath):
        baseUrl 去掉末尾 / + "/" + dirPath 去掉开头 /
        文件路径不追加末尾 /（否则 Apache 对文件 404）
    
    _fetchHtml(url):
        HTTP GET(url, {超时: requestTimeout})
        超时或非 200 抛错（不可达 8s 内快速失败，不再无限挂起）
    
    getFileStream(filePath, range?):
        url = _buildUrl(filePath)
        reqHeaders = {auth: username/password}
        如果 range: reqHeaders.Range = "bytes={start}-{end}"
        response = HTTP GET(url, {超时: requestTimeout, headers: reqHeaders})
        如果响应状态不是 200/206: 抛错
        返回 {
            stream: response,
            statusCode: response.statusCode,        // relay 远端 206/200
            headers: {Content-Type, Content-Range, Accept-Ranges, Content-Length}（取自远端）
        }
    
    getPublicUrl(filePath):
        // 同源 HTTPS 代理 URL（与 SmbProvider 一致）：服务器 HTTPS 时媒体库 URL 必须走同源 https，
        // 否则显示端 https 页面加载 http 媒体被混合内容拦截
        返回 "{协议}://{本地IP}:{端口}/api/media-libraries/{id}/proxy/{encodeURIComponent(filePath 去掉开头 /)}"
    
    _parseHtml(html, dirPath):
        过滤 fancy-index 表头排序链接（?C=N;O=D 等）与 Parent Directory
        跳过 ../ ./ 链接
        items = []
        使用正则匹配 <a href="..."> 链接
        对于每个匹配:
            如果是 ../ 或 ./ 则跳过
            判断是否为文件夹（以 / 结尾）
            添加到 items
        返回 items
```

### 4. SMB 提供者 (SmbProvider)

```
类 SmbProvider 继承 MediaLibraryProvider:
    属性:
        client: SMB2客户端实例
        server: SMB服务器地址（如 192.168.1.100）
        sharePath: 共享路径（如 share 或 share/subfolder）
        share: 完整共享路径（自动构建为 \\server\share）
    
    _buildSharePath(server, sharePath):
        清理 sharePath 前后的斜杠
        返回 "\\\\" + server + "\\" + sharePath
    
    connect():
        验证 server 不为空
        验证 sharePath 不为空
        构建 share = _buildSharePath(server, sharePath)
        client = new SMB2({
            share: share,
            domain: config.domain,
            username: config.username,
            password: config.password
        })
        设置 connected = true
    
    disconnect():
        如果 client 存在:
            client.close()
            connected = false
    
    list(dirPath):
        使用 Promise 包装:
            client.readdir(dirPath, callback)
            返回文件列表映射为统一格式
    
    getFileStream(filePath, range?):
        使用 Promise 包装:
            client.readFile(filePath, callback)   // 整文件读入 buffer（SMB 无流式读）
            如果 range:
                从 buffer 切出 {start, end} 段
                返回 { stream: 延迟读出的 Readable(切片), statusCode: 206, headers: {Content-Length: 切片长度, Content-Range: "bytes {start}-{end}/{total}"} }
            否则:
                返回 { stream: 延迟读出的 Readable(整buffer), statusCode: 200, headers: {Content-Length: buffer.length} }
    
    uploadFile(dirPath, file):
        使用 Promise 包装:
            client.writeFile(filePath, file.data, callback)
            返回文件信息
    
    getPublicUrl(filePath):
        返回 "/api/media-libraries/{id}/proxy{filePath}"
```

### 5. 媒体库管理器 (MediaLibraryManager)

```
类 MediaLibraryManager:
    属性:
        libraries: Map<id, {config, provider}>
        defaultLibraryId: 默认媒体库ID
        configPath: 配置文件路径
    
    init():
        config = 加载配置文件()
        对于每个 libConfig:
            调用 addLibrary(libConfig)
            如果 isDefault:
                设置 defaultLibraryId
    
    addLibrary(config):
        根据 config.type 创建对应 provider:
            - "local" -> LocalProvider
            - "http" -> HttpProvider
            - "smb" -> SmbProvider
        调用 provider.connect()
        存入 libraries Map
        返回 config.id
    
    removeLibrary(id):
        获取 library
        调用 provider.disconnect()
        从 libraries 删除
    
    getLibrary(id):
        返回 libraries.get(id)
    
    listLibraries():
        返回所有媒体库的摘要信息列表
    
    list(libraryId, path):
        获取 library
        调用 provider.list(path)
    
    upload(libraryId, dirPath, file):
        获取 library
        检查 readonly
        调用 provider.uploadFile(dirPath, file)
    
    delete(libraryId, filePath):
        获取 library
        检查 readonly
        调用 provider.deleteFile(filePath)
    
    createFolder(libraryId, dirPath, name):
        获取 library
        检查 readonly
        调用 provider.createFolder(dirPath, name)
    
    deleteFolder(libraryId, folderPath):
        获取 library
        检查 readonly
        调用 provider.deleteFolder(folderPath)
    
    getFile(libraryId, filePath):
        获取 library
        调用 provider.getFile(filePath)          // 委托（proxy 端点据此拿 size 解析 Range）

    getFileStream(libraryId, filePath, range?):
        获取 library
        调用 provider.getFileStream(filePath, range)
    
    saveConfig():
        遍历 libraries 构建配置对象:
            对于每个 library:
                基础配置: id, name, type, isDefault, readonly
                如果 type === "http":
                    添加 url, username, password
                否则如果 type === "smb":
                    添加 share, domain, username, password
                否则 (local):
                    添加 path
        写入配置文件
```

## HTTP API 实现

### 媒体库管理 API

```
GET /api/media-libraries
    返回: { status: "success", libraries: 媒体库列表 }

POST /api/media-libraries
    请求: { name, type, path?, baseUrl?, share?, domain?, username?, password?, readonly? }
    处理:
        生成唯一ID
        构建配置对象
        调用 mediaLibraryManager.addLibrary(config)
        如果是本地媒体库:
            获取 provider 的路由前缀和基础路径
            动态注册静态路由: app.use(routePrefix, staticWithMhtmlMime(basePath))
                // staticWithMhtmlMime: express.static + setHeaders
                //   .mhtml → Content-Type: message/rfc822（默认 octet-stream 浏览器不渲染）
        保存配置
    返回: { status: "success", library: config }

PUT /api/media-libraries/:id
    请求: { 要更新的字段 }
    处理:
        获取媒体库
        更新配置
        保存配置
    返回: { status: "success", library: 更新后的配置 }

DELETE /api/media-libraries/:id
    处理:
        调用 mediaLibraryManager.removeLibrary(id)
        保存配置
    返回: { status: "success", message: "媒体库已删除" }
```

### 媒体操作 API

```
GET /api/media-libraries/:id/list?path=xxx
    处理:
        调用 mediaLibraryManager.list(id, path)
    返回: { status: "success", items: 文件列表 }

POST /api/media-libraries/:id/upload
    请求: multipart/form-data
        - file: 文件数据
        - path: 目标目录
    处理:
        解析 multipart
        调用 mediaLibraryManager.upload(id, path, file)
    返回: { status: "success", file: 文件信息 }

DELETE /api/media-libraries/:id/file?path=xxx
    处理:
        调用 mediaLibraryManager.delete(id, path)
    返回: { status: "success", message: "文件已删除" }

POST /api/media-libraries/:id/folder
    请求: { path: 父目录, name: 文件夹名 }
    处理:
        调用 mediaLibraryManager.createFolder(id, path, name)
    返回: { status: "success", message: "文件夹已创建" }

DELETE /api/media-libraries/:id/folder?path=xxx
    处理:
        调用 mediaLibraryManager.deleteFolder(id, path)
    返回: { status: "success", message: "文件夹已删除" }

GET /api/media-libraries/:id/proxy/*
    请求头: 可选 Range: bytes=start-end
    处理:
        filePath = decodeURIComponent(req.params[0])    // express 通配符已解码 %2F
        range = parseRange(req.headers.range, 未知size时先由 provider 计算)
        调用 mediaLibraryManager.getFileStream(id, path, range)
        result = { stream, statusCode, headers }
        设置响应状态码 statusCode
        按 headers 设置 Content-Type / Content-Length / Content-Range / Accept-Ranges
        stream.pipe(res)     // 流式返回，支持视频 seek
        req close / stream error 时清理

GET /api/media-proxy?url=<编码后的http地址>
    通用 HTTPS 媒体代理：服务器 HTTPS 且直连 HTTP 资源在浏览器/WebView 中被混合内容策略拦截时，
    作为同源备用地址 /api/media-proxy 使用；直连地址始终保留为首选
    请求头: 可选 Range: bytes=start-end
    校验:
        url 必须以 http:// 或 https:// 开头
        禁止重定向到本机 localhost/回环/私有地址等（SSRF 防护，简单校验目标 host）
    处理:
        upstream = HTTP(S) GET(url, {headers: Range 透传, 超时: 15s})
        relay 远端状态码 206/200 与响应头 Content-Type/Content-Range/Accept-Ranges/Content-Length
        stream.pipe(res)
        超时/错误时响应 502/504，客户端断开时中断上游请求

显示端媒体消息 URL 规范化（初次下发、重连恢复、播放列表恢复共用）
    normalizeDisplayMediaMessage(message, useHttps):
        payload = 复制消息以及将被规范化的媒体对象/容器 // 不修改持久化状态或调用者对象
        normalizeMedia(media):
            如果 media 不是对象，或媒体不是 URL 资源: 原样返回
            directUrl = media.url
            fallbackUrl = media.fallbackUrl
            如果服务器未启用 HTTPS: 原样返回 media
            如果 directUrl 是 http:// 且 fallbackUrl 为空:
                fallbackUrl = /api/media-proxy?url=encodeURIComponent(directUrl)
            如果 fallbackUrl 是 http://:
                fallbackUrl = /api/media-proxy?url=encodeURIComponent(fallbackUrl)
            返回 { ...media, url: directUrl, fallbackUrl }
        如果 message 是单媒体 url 消息: normalizeMedia(message)
        如果 message.type == playlistStart:
            对 message.playlist 每项调用 normalizeMedia
        如果 message.type == restoreState:
            对 message.state.currentMedia 调用 normalizeMedia
            对 message.state.currentPlaylist.startData.playlist 每项调用 normalizeMedia
        返回 payload

    sendToDisplay(displayId, message):
        outgoing = normalizeDisplayMediaMessage(message, useHttps)
        只发送 outgoing；不把 fallbackUrl 写回持久化媒体

    显示端连接恢复：
        从持久化状态生成 restoreState 和 playlistStart
        两条消息都通过 normalizeDisplayMediaMessage 后发送
        播放端先请求原始直连 url；资源加载失败后才尝试 fallbackUrl
```

## 前端模块实现

### media-library.js

```
对象 MediaLibrary:
    属性:
        libraries: []        // 媒体库列表
        currentLibrary: null // 当前媒体库
        currentPath: '/'     // 当前路径
    
    init():
        调用 loadLibraries()
        设置拖拽上传
        渲染界面
    
    loadLibraries():
        GET /api/media-libraries
        存储 libraries
        如果有媒体库:
            选择默认或第一个
            调用 switchLibrary(id)
    
    switchLibrary(id):
        设置 currentLibrary
        重置 currentPath = '/'
        调用 loadContent('/')
    
    loadContent(path):
        设置 currentPath
        GET /api/media-libraries/{id}/list?path={path}
        渲染文件列表
        渲染面包屑导航
    
    uploadFile(file, dirPath):
        构建 FormData
        POST /api/media-libraries/{id}/upload
        成功后刷新列表
    
    deleteItem(itemPath):
        确认对话框
        DELETE /api/media-libraries/{id}/file?path={path}
        成功后刷新列表
    
    createFolder(name):
        POST /api/media-libraries/{id}/folder
        成功后刷新列表
    
    navigateToFolder(folderPath):
        调用 loadContent(folderPath)
    
    navigateUp():
        计算父路径
        调用 loadContent(parentPath)
    
    playMedia(url, mediaType):
        如果 mediaType === 'html':
            弹「HTML 发送设置」对话框（滚动方式 + 参数）
            确认后跳过 Crop.showPreview，直接 sendMedia({type:'url', url, mediaType:'html', htmlScroll})
            返回
        调用 Crop.showPreview(url, mediaType)
        调用 WebSocketManager.sendMedia({type, url, mediaType})

    playRemoteMedia(url, mediaType, library):
        sourceNodeId = library.remote ? library.ownerNodeId : 'main-server'
        mediaData = {type, url, mediaType, sourceNodeId}
        如果存在 proxyUrl:
            mediaData.fallbackUrl = proxyUrl
        通过既有媒体播放消息发送 mediaData

主服务器节点媒体正常重播:
    收到 node.register，或 node.heartbeat 携带的新 node.url 与旧值不同时:
        遍历所有显示端的持久化 currentMedia/currentPlaylist
        只选择 sourceNodeId 或兼容 URL 识别为当前节点的媒体
        使用当前 node.url 重写节点直连 URL，保留主服务器代理 URL
        单媒体重新发送原有 url/base64 消息
        播放列表重新发送原有 playlistStart 消息，并保留 resumeIndex/resumeTime/resumeState
    显示端按已有 showMedia/handlePlaylistStart 流程处理，不认识新的重播消息

    sendHtmlFile(file):
        校验扩展名 .html/.htm
        弹「发送 HTML 文件」对话框（文件信息 + 滚动设置 + 去向 checkbox）
        如果勾选保存到媒体库:
            uploadFile(file, currentPath) → 按返回 url 发送
        否则:
            Upload.fileToBase64(file) → 临时 base64 发送（temp:true）
    
    render():
        渲染媒体库列表
        渲染面包屑导航
    
    renderLibraryList():
        遍历 libraries
        生成媒体库选择器HTML
    
    renderBreadcrumb():
        解析 currentPath
        生成面包屑导航HTML
    
    renderFileList(items):
        分离文件夹和文件
        文件夹在前，文件在后
        生成文件列表HTML
    
    setupDragDrop():
        监听 dragover 事件（显示拖拽区域）
        监听 drop 事件（上传文件）
    
    showAddLibraryDialog():
        创建模态框DOM
        显示添加媒体库表单
        支持选择类型（本地/HTTP/SMB）
        根据类型显示不同字段
    
    showEditLibraryDialog(id):
        获取媒体库配置
        创建模态框DOM
        显示编辑表单（名称、只读、默认）
        类型不可修改
    
    onTypeChange(type):
        本地类型：显示路径字段
        HTTP类型：显示URL、用户名、密码字段
        SMB类型：显示服务器地址、共享路径、域、用户名、密码字段
    
    addLibraryFromForm():
        收集表单数据
        验证必填字段
        POST /api/media-libraries
        成功后刷新媒体库列表
    
    updateLibraryFromForm(id):
        收集表单数据
        PUT /api/media-libraries/{id}
        成功后刷新媒体库列表
    
    deleteLibrary(id):
        确认对话框
        DELETE /api/media-libraries/{id}
        成功后刷新媒体库列表
```

## 配置文件结构

### config/media-libraries.json

```json
{
  "libraries": [
    {
      "id": "local_uploads",
      "name": "本地上传",
      "type": "local",
      "path": "./uploads",
      "isDefault": true,
      "readonly": false
    },
    {
      "id": "http_media",
      "name": "远程媒体库",
      "type": "http",
      "url": "http://192.168.1.100:8080/media",
      "username": "user",
      "password": "password",
      "isDefault": false,
      "readonly": false
    },
    {
      "id": "smb_share",
      "name": "NAS共享",
      "type": "smb",
      "server": "192.168.1.200",
      "share": "media",
      "domain": "WORKGROUP",
      "username": "user",
      "password": "encrypted_password",
      "isDefault": false,
      "readonly": false
    }
  ]
}
```

## 文件结构

```
web-mediacenter/
├── core/
│   ├── media-library.js     # 媒体库核心模块
│   └── media.js             # 现有媒体处理
├── public/
│   ├── js/
│   │   └── media-library.js # 媒体库前端模块
│   ├── css/
│   │   └── media-library.css
│   └── upload.html
└── config/
    └── media-libraries.json
```

## 依赖安装

SMB 支持需要安装 smb2 库：

```bash
npm install @marsaud/smb2
```

网页代理支持需要安装 https-proxy-agent 与 socks-proxy-agent（已写入 package.json）：

```bash
npm install https-proxy-agent socks-proxy-agent
```

## 状态说明

媒体库功能已全部实现（2026-03-28），包括：
- MediaLibraryProvider 提供者基类
- LocalProvider 本地文件系统实现
- HttpProvider HTTP 远程媒体库实现
- SmbProvider SMB 网络共享实现
- MediaLibraryManager 媒体库管理器
- 前端媒体库 UI 模块
- 媒体库 API 路由
- 批量上传和文件夹上传
- 代理访问 API

## 相关文件

| 文件 | 说明 |
|------|------|
| src/apps/web-mediacenter/modules/media/media-library-app-service.js | 媒体库核心模块 |
| public/js/media-library.js | 媒体库前端模块 |
| public/css/media-library.css | 媒体库样式 |
| config/media-libraries.json | 媒体库配置文件 |

### 夸克分享只读提供者

```
创建夸克提供者(分享链接, 可选提取码):
    验证链接为 pan.quark.cn/s/分享ID
    请求分享令牌并读取根目录，失败时返回上游错误
列目录(路径):
    从根目录逐级按名称查找文件夹，分页读取分享目录
    返回目录项以及经本机代理访问的媒体地址
读取文件(路径):
    刷新父目录并查找文件；图片使用分享接口返回的临时预览地址
    视频使用账号 Cookie 获取免转存地址并按 Range 代理；其他文件不支持；不转存或修改网盘
    只访问夸克 HTTPS 域名，代理流式返回上游响应头
配置持久化并通过子服务器命令传递提取码；所有只读设置不可关闭
```

### 夸克分享标签与链接识别

```text
控制端媒体库切换普通库 / 夸克分享标签:
    根据已有媒体库 type 分组；夸克配置和节点归属原样保留
夸克输入框解析(链接或分享文案):
    提取 pan.quark.cn/s/分享ID；仅保留规范 HTTPS 分享链接
    提取 URL 的 pwd/passcode/code 或文案中的提取码；手动填写优先
加入或播放:
    根据分享ID复用已存在的分享；否则在主服务器添加只读夸克库
    加入后选中并显示目录；播放时打开既有逐目录批量播放设置
媒体索引仅公开分享ID用于查重，不返回提取码
```

### B 站链接播放

```text
控制端发送 URL:
    如为 bilibili.com 的 /video/BV... 链接:
        校验 BV 号和 p 分集参数
        生成 https://player.bilibili.com/player.html?bvid=...&p=...&autoplay=1
        按网页媒体发送到显示端 iframe
    否则沿用原有 URL 媒体识别
显示端 iframe 允许 autoplay 与 fullscreen；播放器和登录由 B 站控制
```

### B 站视频标签

```text
控制端连接成功 → 发送 bilibiliListGet → 接收服务端规范化列表
加入 BV 视频:
    服务端校验域名、BV、分集；按 BV+分集去重
    请求 B 站视频元数据，获取标题和封面；失败则保留 BV 和占位图
    配置持久化，广播权威列表给所有控制端
删除 → 服务端按 BV+分集删除并广播
播放 → 复用官方外链播放器；显示端按网页媒体处理
前端封面仅使用服务端校验过的 B 站图片域名，加载失败显示占位
```

### B 站原生视频流

```text
选择 B 站 BV 视频 → 主服务查询官方视频信息与目标分集 CID
请求视频播放接口的单文件 MP4 → 仅接受 B 站视频域名，短期缓存解析结果
解析成功 → 下发主服务的稳定代理 URL，按原生 video 播放；支持 Range、进度和暂停
代理处理 GET/HEAD: 转发 Range、校验每次跳转域名、返回上游状态与媒体响应头
解析或播放器加载失败 → 回退官方外链播放器
本期不提供登录账号配置或分离音视频 DASH 合成；画质由匿名接口决定
```

### B 站匿名 480P DASH

```text
服务端请求 DASH(qn=32): 选 480P H.264 视频与 AAC 音频，校验 CDN URL 和分段范围
生成只包含服务端代理地址的 MPD；音视频资源按 Range 流式转发
控制端优先下发 DASH 媒体及 360P、官方播放器回退地址
显示端通过本地 dash.js 在同一个 video 中同步音画，原有暂停和拖动继续使用
DASH 不支持或出错 → 360P MP4；MP4 出错 → 官方播放器
切换媒体时销毁 DASH 实例；异常或重连不得复活旧媒体
```

### 夸克视频只读播放与分享文件夹

```text
当读取夸克视频：
  从 KUAKE_COOKIE（或 KUAKE_PUS/KUAKE_PUUS）取得服务端凭证；刷新并合并 __pus、__puus
  用分享令牌、文件 ID 和文件令牌请求免转存下载地址
  只允许 HTTPS 夸克可信下载域名，携带对应 Cookie、UA、Referer 请求
  将客户端 Range 请求和上游 200/206、长度及 Content-Range 安全转发
  上游失败时明确返回错误，不转存、不删除网盘文件

夸克与 B 站标签分别维护服务端文件夹和链接归属：
  用 WebSocket 请求快照、创建文件夹、移动链接、删除空文件夹
  服务器规范化名称并持久化配置，广播完整权威状态
  旧链接默认归入未分类；选中文件夹后新加链接归入该文件夹
  夸克分享展示为文件夹入口，进入后浏览原分享目录
```

```text
配置夸克 Cookie：
  控制端仅提供输入入口，通过现有 WebSocket 保存服务端配置
  服务端只广播已配置状态，不能向其他客户端回传 Cookie
  播放时优先使用服务端配置，未配置时使用进程环境变量
  Cookie 改变时丢弃旧会话并重新刷新，Cookie 不写入日志
```

### 夸克视频完整缓存后切换与链接复制

```text
请求播放夸克视频:
  按分享文件 ID、大小及更新时间确定服务器缓存条目
  同一视频合并并发下载；流式写临时文件并校验字节数
  完整写入后原子替换最终缓存，失败删除临时文件并报告错误
  单项播放先请求缓存完成，成功后才发送切换；取消或失败保持当前画面
  逐目录播放遇到视频时等待缓存完成，仍保留当前画面；播放项改变后忽略旧结果
  视频代理优先从完整缓存按 Range 读取；其他预览不触发整视频缓存
  夸克和 B 站条目提供复制规范分享链接按钮，复制失败给出可手动复制的地址
```

```text
缓存配额:
  视频大于 300 MiB 时拒绝缓存并提示，不切换当前媒体
  同时最多保留两个视频缓存，只允许一个视频下载，其他请求排队并按同文件去重
  下载新视频前清理超出两个上限的最久未使用的旧缓存和本功能遗留的临时文件
  不删除目录以外的文件；缓存失败后不留下不完整视频
```

### 夸克缓存进度与视频缩略图

```text
缓存任务按已接收字节统计进度，共享任务的每个订阅者接收排队、下载和完成事件
准备请求逐行推送进度和最终结果；断开某个订阅不取消其他订阅的缓存
单项播放在控制端顶部显示百分比和已下载/总大小；批量播放由显示端转发进度给控制端
远端媒体代理透传进度，缓存仍遵守单视频及 300 MiB 上限
夸克目录存在视频 thumbnail 时提供本地安全代理缩略图 URL
控制端直接展示缩略图，不启动视频缓存；缩略图无效或缺失时显示占位
```

### 夸克视频卡片缓存进度

```text
每个夸克视频卡片标识所属服务器、媒体库与文件路径
单视频缓存和显示端批量缓存进度携带相同的文件标识
控制端收到进度:
  只在标识匹配的可见视频缩略图底部显示进度条与状态
  排队和未知大小显示等待状态；完成或失败显示结果后自动收起
  新缓存或播放其他媒体时清除旧的单视频标记
  列表重新渲染时恢复当前仍有效的进度；旧请求回包不得覆盖新视频
```

### 夸克分享文件下载

```text
控制端显示夸克文件卡片:
  显示下载链接，指向主服务器同源代理（远程库经主服务器转发）
  文件路径和原文件名分别作为代理路径和浏览器保存名称
服务端代理收到 download=1:
  校验媒体库是夸克分享；查询分享中的原文件并取得受信任的原文件地址
  通过流式响应和 attachment 文件名向控制端下载，透传有效 Range
  不使用播放缓存，不返回 Cookie 或上游下载地址
```

### 夸克目录持久下载与本地优先播放

```text
控制端在夸克目录点击下载到服务端:
  向主服务器提交来源节点、媒体库和目录，递归获取目录并串行下载原文件
  流式写入独立持久目录的临时文件，校验大小后原子发布并记录来源与本地地址
  广播当前文件、完成数量和失败信息；重复下载时跳过来源未变且完整的文件
播放请求与预缓存请求:
  根据来源节点、媒体库与路径查询完整的持久文件
  命中时通过媒体代理直接读取本地文件并支持 Range；未命中沿用原播放缓存流程
  持久下载和原来的单文件临时播放缓存分开保存
```

```text
目录下载前，控制端选择主服务器上任一可写本地媒体库作为目标
新下载路径：目标库/夸克分享/<sanitizeCategoryName(category)>/<sha256(source).slice(0,16)>/<相对路径>
category 经统一清洗：分隔符/控制字符 -> 下划线，折叠空白，空值或点目录 -> 未分类，截断 50 字符
保留原目录结构，已有文件不得覆盖；lookup 仍按 source + filePath + targetId 命中旧记录
旧目录与记录不迁移；仍按 source + filePath + targetId 查询
记录来源和所选目标库内的本地路径；可跨重启读取映射
```

```text
夸克临时播放缓存最多保留两个完整视频，命中时更新最近使用时间
不同视频共用串行下载队列，同一视频的并发请求合并；保留单文件 300 MiB 上限
下载新视频前只淘汰最久未使用的多余缓存，下载失败不发布半成品
```

### B 站搜索与本地下载

```text
B 站标签搜索关键词：
  服务端访问 B 站视频搜索，规范化视频标题、BV、封面和分页
  控制端显示结果，支持播放、加入当前分类和下载
下载视频或收藏列表：
  选择主服务器可写本地媒体库，后台按项串行下载
  优先取得匿名 480P DASH 音视频并通过 ffmpeg 无转码合成；不可用时回退单文件 MP4
  完整文件发布到目标媒体库，记录 BV、分集和本地地址，失败不登记半成品
  新下载路径：目标库/B站视频/<sanitizeCategoryName(category)>/<标题> <bvid>[ Pn].mp4
  category 缺省使用“未分类”；旧目录与记录不迁移、不失效
  控制端 B站优先合集标题，其次当前文件夹；夸克使用当前分享文件夹
  两来源及夸克单文件对话框预览“目标：库名 / 来源名 / 分类名”，切换库同步更新并提交 category
播放 B 站视频：
  优先查询本地映射并通过代理支持 Range；未命中沿用现有 DASH/MP4 播放
```

### 用户任务扩展媒体源

```text
服务型用户任务启动时通过 registerMediaProvider 注册提供者：
  提供唯一 ID、名称及创建媒体库实例的工厂，实例实现 list/getFile/getFileStream
  任务停止或启动失败时撤销其注册；已保存媒体库保留，访问时提示任务未运行
添加媒体库选择任务媒体源并填写提供者 ID 和源地址：
  保存配置，使用任务提供者浏览、播放和原有媒体代理；任务媒体库只读
服务端重启先恢复媒体库配置，任务服务恢复后按相同提供者 ID 继续服务
本地任务保存在 res/tasks/local-only/<任务名>，显示为 local-only.<任务名>
  任务文件与结果可运行与编辑；APK、任务代码包及 release 同步禁止包含本地目录
```

### 任务媒体页签与 B 站认证播放

```text
运行中的任务媒体源各自显示顶部页签，点击后直接浏览媒体内容。
B 站搜索结果提供复制原始视频链接；Cookie 通过现有 WebSocket 配置保存，只广播是否配置。
解析 B 站 DASH 时按 Cookie 身份隔离缓存，向 B 站 API 请求可用画质并优先最高 AVC 视频与 AAC 音轨；Cookie 不发送给视频 CDN。
DASH 仅在致命播放错误时回退，避免可恢复事件中断播放。
红果任务作为可发布用户任务注册媒体源，只读取网页公开可用的资源，不绕过访问限制。
```

```text
B 站 DASH 每条轨道从主地址和备用地址中选择首个受信任的 HTTPS 标准端口地址；主地址含非标准端口时仍可使用符合限制的备用地址。
```

### 运行中任务直接显示媒体页签

```text
任务服务注册媒体源 -> 按 provider ID 查找已有任务媒体库；没有时使用临时只读媒体库，配置取任务参数和媒体源默认值
向控制端广播当前媒体源及其媒体库 ID；新控制端连接时发送快照
控制端在顶部为每个运行中的媒体源生成独立页签，点击后直接浏览根目录和播放媒体
任务停止或注销 -> 广播移除页签；若当前页签被移除，返回普通媒体库
已保存的任务媒体库配置不删除；临时媒体库不写入配置文件
```

### 地区媒体中心与任务媒体源能力

```text
实现文件：src/apps/web-mediacenter/modules/media/task-media-provider-registry.js
registerMediaProvider(owner, definition):
  校验 id（^[a-z][a-z0-9._-]{1,63}$）、name、create 与可选能力 [home, search, resolveLink, related, download]
  region 只允许 domestic、overseas 或 private；缺失或非法回退 domestic
  proxyDefault 保留兼容元数据；新代理模型不以它作为默认选择
  defaultConfig 只接受普通对象并浅拷贝
  registry 保存 definition 与 owner，注销时按 owner 删除；一个任务可注册多个来源

实现文件：src/apps/web-mediacenter/modules/media/media-library-app-service.js
MediaLibraryManager.callTaskSource(providerId, action, payload):
  查找运行中的注册；未注册报“任务媒体源未运行，请先启动对应的用户服务任务”
  action 必须在 features 内，否则报“任务媒体源不支持该操作”
  实现缺少同名方法时报“任务媒体源缺少该操作接口”
  getTaskSourceProvider(providerId) 复用 task-auto:<id> 虚拟只读媒体库，并向 TaskMediaProvider 注入 getProxyUrl

GET /api/media-library-providers -> 返回 id、name、libraryId、region、features、proxyDefault、proxyEnabled
控制端按 region 分组渲染顶部页签：
  国内媒体：B 站视频（原生）、国内任务来源
  国外媒体：国外任务来源
  私密媒体：private 任务来源，无活动来源时隐藏整个分组
  组标题固定展示；组内无来源时仅显示标题
  任务来源按钮与代理选择框成对渲染；尚无显式选择时显示“不使用代理”
任务来源的首页/搜索/链接/相关推荐 UI 由后续国内/国外任务计划实现；本计划只完成注册、代理注入与页签分组
```

### 命名网络代理与来源选择

```text
实现文件：src/apps/server/modules/media/web-proxy.js
normalizeProxyUrl(value): 去空白；空串表示未配置；允许 http/https/socks/socks5/socks5h
  拒绝查询参数、片段与缺失主机；末尾单个斜杠去除
resolveSourceProxyUrl({proxies, selections, sourceId}):
  以 selections[sourceId] 查找代理；无选择、找不到或地址非法时返回空串
getProxyAgents(proxyUrl): socks* 用 SocksProxyAgent，其余用 HttpsProxyAgent；按地址缓存
axiosProxyOptions(proxyUrl): 有代理时返回 { proxy: false, httpAgent, httpsAgent }
SOCKS 地址区分 socks5（客户端解析域名）与 socks5h（代理端解析域名）；需要代理端解析时由用户在权威代理列表中选择 socks5h

network.webProxies = [{ id, name, url }]，最多 20 项；新增 id 由服务端生成
media.providerProxy = { sourceId: proxyId }；空串或缺失表示不使用代理
迁移：webProxies 不是数组时，旧 globalWebProxy 合法则创建 proxy-legacy；
  旧 providerProxy 值 true 映射至该 id（无有效代理时为空），其他值映射为空；写入新配置并清空 globalWebProxy
  webProxies 已是数组则跳过迁移；任务 proxyDefault 不参与新模型解析
  迁移和列表保存先写 network.pendingWebProxyUpdate，再写选择并提交代理表、清除待处理记录
  启动先重放日志，再判断是否已有 webProxies；后续列表/来源保存也先恢复日志
  日志保存失败则不修改业务配置；日志成功后的普通 set 失败或完整写入之间中断可重放恢复
  迁移最后提交标志；启动恢复失败终止启动迁移；这不是多个 set 的瞬时原子事务
  失败期间来源可能暂时降级为无代理，不错误绑定其他代理
  底层 DataSnapshot 直接覆盖同一 config.json；写入中途终止导致截断不在恢复保证内
控制端 WebSocket:
  getWebProxyConfig -> { type:'webProxyConfig', webProxies, providerProxy, sources }
  setWebProxyList -> 校验数组最多 20 项、名称非空且不超过 30 字符、地址经 normalizeProxyUrl 合法
  删除代理时同一次可恢复提交清空所有引用；保存后广播权威配置，校验失败回 webProxyConfigError
  控制端仅按权威快照刷新；保存拒绝或断线恢复旧选择，连接可用时请求 getWebProxyConfig
  setProviderProxy -> 校验 sourceId 格式及非空 proxyId 的存在性，保存选择并广播；失败回 webProxyConfigError
控制端设置页编辑代理列表；B 站工具栏不显示代理选择，保留已保存的来源代理；活动任务源在对应任务实例详情内选择代理或不使用代理
任务源列表附带 ownerInstanceId，任务详情仅展示由当前实例注册的来源；一个实例可为多个来源分别选择
选择继续发送 setProviderProxy，服务端广播权威配置；断线或失败时恢复权威值，重连接收当前配置
媒体库页签按本地、国内、国外和私密分组排列；夸克分享属于国内分组
private 来源与国内、国外来源共用 media.providerProxy 逐源选择；注册不自动绑定代理，缺失或空选择均直连，已有用户选择保持不变
私密来源任务保存在 local-only 中，注册清单与可用能力由任务自身维护；只公开经匿名请求验证的能力，受限时返回明确错误；下载复用 task-media-sources 通用保存路径
私密画廊每次页面、图片、封面请求读取 config.proxyUrl，按统一协议规则生成 Axios 代理选项；选中代理时请求失败直接报错，不自动直连；切换代理时清空页面缓存
国内、国外来源保持分行，行首不显示地区文字，按钮从行首排列
无活动国外任务来源时隐藏国外媒体整个分组，来源注册或停止时重新计算显隐
来源 id 为 hongguo 的页签显示“红果短剧”，不修改注册名称或其他来源信息
任务代理下拉框不再占用页签区域
代理地址不进入日志或错误消息
任务 provider 实例化时注入 getProxyUrl(sourceId, proxyDefault)，代理只作用于服务端外部请求
B 站搜索/首页/相关推荐/弹幕服务通过 axiosProxyOptions 使用来源代理
子进程 yt-dlp 的 --proxy/HTTPS_PROXY 由后续国外任务计划实现
```

### 显示端本机媒体库

```text
display.html 的 #displayGameChatActions 内、#displayGameToggle 之前加入“媒体库”入口
仅页面 hostname 为 localhost、127.0.0.1、::1 或 [::1] 时显示入口
GET /api/display-local/libraries -> { libraries }：local/smb/http/android-saf 库和 listTaskMediaSources 活动任务源
GET /api/display-local/list?libraryId=&path= -> { path, parent, entries }
服务端按 req.socket.remoteAddress 校验回环；非回环返回 403 { error: '仅限本机访问' }
entries 保留目录和 image/video/audio/text 媒体；gif 归一化为 image
本地文件使用同源静态地址；SMB、HTTP、SAF 和任务源使用同源媒体库代理地址
媒体库代理调用 provider 前统一补齐路径前导斜杠，兼容任务媒体清单的路径格式
已停止的任务媒体源返回 410 / TASK_SOURCE_STOPPED
单文件播放 -> 发送带 requestId 的 displayPlaylistCancel {libraryId,path}，等待 displayMediaStart 权威确认后 showMedia
  不信任客户端 URL；重新列举父目录按完整 path 匹配；失败保留原播放，确认只消费一次
文件夹播放 -> 回环连接发送 displayPlaylistRequest
  仅允许本地库与当前活动任务源，过滤非 image/video/audio/text 文件，GIF 转为 image
  分配显示端操作令牌；playlistManager.buildFromLibrary(recursive:false, mode:sequence, sortBy:name, direction:asc)
  扫描后检查令牌、连接和活动来源；被后续播放或停止操作取代时丢弃结果
  注册仅面向请求显示端的可信文本语音路由，终止旧路由的朗读上下文
  startData 设置 loop:false、interval:5、selectedDisplayIds:[请求显示端]
  空目录或生成失败 -> displayPlaylistError；不发送空列表
本地 provider 以相对路径边界校验目标属于库根，拒绝同前缀兄弟目录和向上穿越
```

### B 站首页、相关推荐与搜索稳定性

#### 当前播放与弹幕旋转（2026-11-10）

```text
已有声明 := 显示端媒体旋转、视频时钟、B站相关推荐、服务端播放状态
新增定义 := B站当前视频标识 { bvid, page }、相关推荐请求代次、旋转后的弹幕逻辑宽高
显示端旋转或尺寸改变 → 弹幕宿主与开关同角度居中旋转，90/270交换逻辑宽高
滚动弹幕位移 := 逻辑画布宽度 + 当前弹幕文字宽度；暂停/seek/切换沿用原视频时钟
播放状态确认 B站视频 → 相关推荐首项显示当前视频与正在播放标记，再追加去重推荐
切换视频/清空或离开B站媒体 → 使旧请求失效；旧响应不得覆盖当前项
推荐请求失败或空列表 → 保留当前项；未取得标题封面时使用BV号与安全空封面
```

```text
实现文件：src/apps/server/modules/media/bilibili-search-service.js、bilibili-discovery-service.js
B 站首页 GET /api/bilibili/home?page=:
  B 站工具栏首页按钮放在链接输入框之前，窄屏下也可见；点击读取热门首页
  api.bilibili.com/x/web-interface/popular（ps=20，pn 限制 1-50）
  规范化为 bvid、page=1、url、title、cover、author；过滤非法 BV
  封面只接受 hdslb.com 的 https，http 升级为 https，协议相对地址补 https；其余封面置空
B 站播放后相关推荐 GET /api/bilibili/related?bvid=:
  api.bilibili.com/x/web-interface/archive/related；规范化同首页
  控制端把相关推荐面板渲染在视频列表下方，点击播放并刷新；失败隐藏面板
B 站搜索 GET /api/bilibili/search?keyword=&page=:
  参数：关键词 1-100 字符，页码 1-50
  主通道请求无签名 x/web-interface/search/type；412 或业务码 -352/-403/-412/-509 触发回退
  回退通道获取 nav + spi，生成 WBI key 与 buvid3/buvid4 Cookie（会话缓存 1 小时），请求同一端点并带 w_rid
  成功按“关键词:页码”缓存 60 秒；失败后同一关键词 30 秒内快速失败
  结构无效（HTML/空结果/风控）统一报“B站搜索暂不可用，请稍后重试”
  标题去 HTML 标签与实体；分页 numPages 限制 1-50
  所有请求 timeout 10 秒、maxRedirects: 0，代理按来源开关
```

### B 站弹幕开关与显示端弹幕

```text
实现文件：控制端 media-library.js/upload.html；服务端 bilibili-danmaku-service.js；显示端 bilibili-danmaku.js
B 站页签顶部“弹幕”开关:
  默认关闭；状态存入 localStorage.aasc.bilibiliDanmaku（'1' 开启）
  单播播放载荷携带 bilibiliDanmaku=true 与 bilibiliDanmakuUrl=/api/bilibili/danmaku/:bvid/:page
  批量播放请求携带 danmaku 布尔，服务端为每个条目附加相同弹幕字段
服务端 GET /api/bilibili/danmaku/:bvid/:page:
  校验 bvid 与分集 1-10000；view 接口取 cid，cid 缓存 1 小时
  请求 comment.bilibili.com/{cid}.xml，timeout 10 秒、maxRedirects: 0、maxContentLength 4MiB+1
  解压：首字节 '<' 视为明文 XML；1f 8b 走 gunzip；否则先 inflateRaw 再 inflate
  解析 <d p="time,mode,size,color,...">，仅保留 mode 1/4/5；文本实体解码、trim、截断 200 字符；最多 10000 条
  按 cid 缓存结果 10 分钟；成功响应 Cache-Control: private, max-age=600
  请求固定 api.bilibili.com 与 comment.bilibili.com 域名，不发送用户 Cookie
显示端:
  showMedia 收到 bilibiliDanmakuUrl 时创建弹幕控制器；切换媒体、文本列表项、清空、媒体能力关闭时销毁
  弹幕层位于 #bilibiliDanmakuLayerHost 内，z-index 5，媒体容器内、睡眠遮罩（z-index 10）之下；pointer-events: none
  按 video.currentTime 调度滚动/顶部/底部弹幕；暂停冻结 CSS 动画，seeked 后重新定位游标，不重放历史
  右上角临时开关只影响当前显示端会话；新视频恢复“弹幕”文案；iframe 回退不叠加
```

### 已下载状态与夸克分享下载统一

```text
GET /api/bilibili/downloaded?bvid=&page= -> { downloaded }
B 站搜索/收藏/已保存卡片命中后显示“已下载”，下载对话框标记已下载目标库
实现文件：src/apps/server/modules/media/quark-directory-downloads.js
lookupDirectory(source, dirPath, targetId): 只匹配 directory=true 的目录完成记录
countDirectory(source, dirPath, targetId): 统计目录前缀下去重后的已登记文件数
目录完成后写入 { directory:true, fileCount }；根目录 '/' 同样记录
POST /api/quark-directory-downloads { nodeId, libraryId, targetId, path } -> 启动目录下载
POST /api/quark-file-downloads { nodeId, libraryId, targetId, path, size, modifiedTime } -> 启动单文件下载
GET /api/quark-directory-downloads -> 当前任务 job
来源校验：主服务器查本地夸克库；子服务器查网络索引；目录与单文件共用同一校验
GET /api/aasc/media-index、GET /api/media-libraries、GET /api/media-libraries/:id/list 附加 downloaded
文件夹条目另带 downloadedCount（部分下载数量）
控制端:
  分享卡片“下载/已下载”；文件卡片“下载/已下载”；文件夹“下载到媒体库/已下载/已下载 N”
  下载对话框选择可写本地库；完成后刷新当前目录与分享卡状态
  单文件与目录下载共用临时 .part、大小校验、硬链接/独占复制防覆盖、指纹跳过与索引回滚
```

### 国内媒体任务（红果短剧与番茄小说）

```text
以下描述已实现的代码契约；真实站点及设备验证范围见下方限制与自测记录。
任务 domestic-media 启动:
  注册 provider hongguo 与 tomato；每个 provider 独立 home/search/resolveLink/related/download 能力
  任一注册失败时撤销本次注册并停止自有番茄进程；ID 冲突提示先停止占用来源的旧任务，不覆盖已有注册
  停止时只注销一次，取消所有红果实例的网页请求与媒体流并等待正在保存的下载清理；并发停止共享同一次清理
  各资源清理互不阻塞，失败时仍尝试其他资源，未成功清理的资源保留可重试状态
  每次 HTTP 请求读取当前命名代理；未选择代理时显式禁用环境代理，不输出代理凭据与 Cookie
红果:
  首页返回网站推荐剧集；搜索请求 /api/search/result/?query=，解析 searchList.name 与 video_data.series_id
  搜索接口未确认分页参数，仅返回第 1 页；请求后续页面返回空结果且总页数为 1
  首页、搜索和相关推荐的剧集合集标记 downloadable=false；打开合集后仅下载公开分集
  resolveLink 接受 /player/{id}、/detail?series_id={id} 和纯数字 ID，返回 /{id} 目录
  读取剧集首页中指向同一剧集的 player 分集链接，按页面顺序去重，最多 200 集；忽略其他剧集和外站链接
  以最多 4 个并发请求逐页检查 JSON-LD 中同站明确公开的 360P 地址；未公开地址或单页请求失败的分集仍显示，标记不可播放、不可下载
  没有分集链接时保留原有单页公开视频解析；播放和下载须重新确认视频属于对应公开页面，不根据分集 ID 推测媒体地址
  只读文件目录只列可播放分集；Cookie 可选，随网页请求发送，不写入日志；停止时取消分集请求
番茄小说:
  按需检测端口空闲，以独立进程组和 --server --data-dir 启动自有下载器，等待其监听日志与状态；密码仅通过 TOMATO_WEB_PASSWORD 环境变量传给子进程，密码模式调用登录接口获取 Cookie
  启动失败、端口占用或下载器不可用时给出来源内中文错误；停止时只回收自己启动的进程，先 SIGINT，等待 5 秒后 SIGKILL
  首页请求番茄公开 /rank/1 榜单，严格提取书籍 ID，最多对前十项请求同站详情并从结构化数据还原未混淆标题及作者；匿名榜不可用时回退下载器书库
  榜单及详情请求使用当前来源代理，禁止重定向、限制响应大小和并发；同代理并发首页共享请求，不同代理首页串行
  搜索调用下载器 /api/search；resolveLink 接受 book_id 或书籍链接，读取已有 JSONL 章节
  下载先验证 item.id 和 item.url 所指书籍一致；按输出目录真实路径在 Node 进程内共享串行锁及未确定作业租约，跨 controller 生效
  新作业前确认输出目录没有未知或未结束作业；响应丢失、轮询失败和超时不能解除租约；开始前计算候选 EPUB 内容哈希并约束总读取量
  调用下载器 /api/jobs 并轮询状态；核对 job.book_id、完整章节进度以及较开始前发生内容变化的 EPUB
  校验 EPUB 条目无重复，从 META-INF/container.xml 唯一 rootfile 精确定位元数据，dc:identifier 必须等于 book_id
  限制文件与 EPUB 元数据大小和整个任务读取预算，仅唯一匹配时保存已验证的字节，不能仅凭书名绑定
  其他格式、无法确认身份或匹配多个文件时安全拒绝并提示，既不写入目标也不登记下载成功
  章节 HTML 转纯文本，按 text/plain 支持 Range；拒绝符号链接和过大的章节文件
  章节下载复用纯文本流及安全 save 发布为 .txt 文件
  媒体库 list 的文件路径 := /f_ + 文件相对路径 UTF-8 的无填充 base64url；getFile/getFileStream 严格解码并再次校验相对路径与当前书库成员
  只读媒体库目录仅列可被纯文本播放器读取的 TXT，EPUB/PDF 仍可通过任务来源书库和下载功能访问，不冒充可播放纯文本
  任务来源返回 EPUB/PDF 文件标记 playable=false；控制端显示不支持播放的提示并保留下载按钮，TXT 仍可播放
  任务媒体源 HTTP 条目仍使用 file:<原相对路径>，不改变现有条目标识和下载索引
  请求序列化并读取当前命名代理；直连时清除继承的代理环境，启动进程时注入所选代理
  代理发生变化时先检查后台下载作业和打开的媒体流；存在未结束或状态不明的作业时拒绝切换并保留进程
  确认空闲后只停止本任务持有的下载器进程，再按当前代理重新启动；作业成功、失败或取消后解除租约
  下载任务创建结果不明时保留租约，不推测任务已经停止，后续成功创建作业不得清除此租约；错误不包含代理地址或凭据
  自有下载器意外退出或重新启动时清除旧会话 Cookie，重新登录后验证状态
  下载器不可用或代理失败只在番茄来源内提示，不影响红果
```

### 国外媒体任务（YouTube/Pinterest/Pixiv）

```text
以下描述已实现的代码契约；真实站点及设备验证范围见下方限制与自测记录。
发布约束：overseas-media 在 res/tasks 用户任务目录维护；不加入 release/task-code-files.json 或 release/task 发布种子，不随 release 产物发布。
任务 overseas-media 启动:
  注册 provider youtube、pinterest、pixiv；三者按各自选择使用命名代理
  每次外部请求及 yt-dlp 调用读取当前来源的代理选择；选择为空时直连，proxyDefault 仅为旧元数据
YouTube:
  首页页面解析结果为空时明确提示用户搜索或检查登录状态，不将空白结果冒充可用首页；保留搜索、链接及其余来源能力
  任务媒体路由仅放行该首页固定提示，其他未知异常仍返回通用脱敏错误
  首页首次使用前检查或安装 yt-dlp；安装失败只影响 YouTube 并明确提示；取得趋势/推荐；搜索解析 youtube 搜索结果页的 ytInitialData；resolveLink 支持 watch、youtu.be、shorts
  停止任务时取消该来源进行中的页面请求、媒体流和下载保存，并等待自身资源及临时文件清理；其他来源不受影响
  related 读取观看页相关推荐；播放/下载调用 yt-dlp：
    首次使用仅在支持的 Linux glibc x64/arm64 下载固定版本官方单文件；校验内置 SHA-256 后以独立临时文件原子发布
    解析播放地址时读取所选格式的实际扩展名与标题，不能将降级格式固定标为 mp4
    自动安装文件每次使用前校验散列；不支持的平台提示手动配置可执行文件，自定义路径不可用时不自动覆盖
    验证 YouTube HTTPS 地址白名单；子进程禁用配置并清除继承的环境代理，使用环境变量设置当前代理或以空代理参数直连，凭据不进入命令参数
    可选 Cookie 校验后转换为权限受限的临时 Netscape 文件，子进程只接收文件路径；执行结束、失败或停止时清理文件
    限制下载大小、请求与进程运行时间及输出大小；停止任务取消下载并终止本次启动的进程组及后代，异步安装检查后再次确认停止状态；错误和日志不暴露代理凭据
    搜索和相关推荐只返回上游实际视频；链接解析须取得真实标题，失败明确报错
    页面仅访问固定 YouTube HTTPS 地址；直链只允许 HTTPS googlevideo.com 域名，不跟随重定向，不向媒体主机发送 Cookie
    流代理转发合法 Range 与状态；错误不暴露上游地址和代理凭据
    下载在独立临时目录执行，检查实际输出是目录内普通文件并采用真实扩展名，通过 save 写入后清理临时目录
    实现 list/getFile/getFileStream 以兼容任务媒体库；直链不可用时返回错误
Pinterest:
  汇总所有受支持的页面 JSON 数据脚本后解析；页面包含多个脚本时不能因第一个脚本有条目而漏掉后续条目
  页面 HTTP 401/403 返回访问受限及检查 Cookie 的安全提示，已配置 Cookie 时提示检查 Cookie 是否有效；其他网络错误保持脱敏
  任务媒体路由只放行两种固定受限提示，不转发上游错误文本和凭据
  页面只访问固定 Pinterest HTTPS 域名，解析页面 JSON 中真实 Pin；Pin 详情无 canonical 且出现匿名登录墙时提示配置 Cookie；否则先校验 Open Graph canonical 数字 ID 与请求一致，仅接受 JSON 中同 ID 的 Pin 数据，不能返回推荐条目；JSON 无条目时仅在图片地址通过 CDN 校验时解析真实图片；含视频标记时不以封面冒充视频；首页、搜索及相关推荐失败时明确提示，不伪造内容；首页和搜索仅支持第一页，其他页明确报错
  登录墙提示配置 Cookie；Cookie 仅发给 Pinterest 页面，不发送到媒体 CDN；每次请求读取当前命名代理
  媒体 ID 编码 CDN 地址，解码时只允许 HTTPS pinimg.com 子域且无凭据或端口；页面与媒体请求禁止重定向
  支持图片、直接视频与 HLS 视频；HLS 播放流明确提示使用下载，下载时仅抓取通过 HTTPS pinimg 域名校验的列表和分段，不跟随重定向；限制递归深度、数量、字节和时长，拒绝密钥及不支持的格式；独立临时目录离线交给 ffmpeg 转封装，限制同时一个 HLS 下载并在输出流写入时限制字节，停止时终止进程组并清理；HLS 卡片明确提示先下载并禁用播放；无真实相关推荐时返回空列表
  实现 list/getFile/getFileStream 与合法 Range，下载使用受控 save 并限制大小；停止时取消在途请求和销毁流，等待清理
  页面、媒体、下载失败均返回脱敏错误；不向用户暴露 Cookie 或代理凭据
Pixiv:
  作品详情和分页只缓存成功响应 60 秒、最多 32 项；同代理同地址的并发请求共享，代理变化后独立请求；停止时清空缓存并取消请求
  排行榜和搜索中验证后的封面按作品 ID 和代理短暂缓存；封面请求仅通过 ID 查找，过期时重新获取作品详情，不接受客户端 URL
  首页读取排行榜 JSON（最多 100 页）；搜索读取 ajax/search/artworks/{keyword}（最多 1000 页），返回总页数不超过可请求上限；resolveLink 支持 artworks/{id}
  相关推荐读取作品相关接口或作者作品；图片请求必须带 https://www.pixiv.net/ Referer
  多图按页列出；动图下载仅接受受限 ZIP 和帧元数据，经安全解压后由 ffmpeg 离线合成 mp4；受限内容需要可选 Cookie
  页面及 API 仅访问固定 Pixiv HTTPS 域名，Cookie 不发送 CDN；CDN 仅允许 i.pximg.net HTTPS，禁止跳转并携带 Referer
  缩略图返回同源相对路径，通过封面路由按作品 ID 重新解析并代理 CDN，携带 Referer、当前代理且不发送 Cookie；禁止接受任意 URL，限制类型与字节
  动图帧在 ffmpeg 解码前读取文件头校验 JPEG/PNG 尺寸与总像素；拒绝超出限制、无效或不支持的帧
  实现 list/getFile/getFileStream；根目录作品以 folder 类型和合法路径返回，作品目录仅返回可直接播放的文件；动图仅在来源页面提示先下载，不进入显示端目录及批量播放，兼容媒体管理器和显示端本地路由
  支持合法 Range 与受控 save；限制下载大小、临时文件和转码时长，停止时取消请求、流及进程并等待清理；失败脱敏
所有国外来源:
  外部请求带超时与响应大小限制；代理/站点失败隔离在该来源；不把上游地址或 Cookie 返回给其他客户端
```

### 任务来源选择与加入反馈

```text
媒体来源按钮按当前活动来源切换明确的选中与未选中样式，同步无障碍选中状态
加入链接发送带唯一 requestId 的 WebSocket 请求 → 只在服务端成功持久化后返回对应确认 → 当前来源切换到目标文件夹并提示成功
服务端拒绝、连接断开或确认超时 → 提示失败或状态待确认，不能冒充保存成功；其他控制端广播不触发本次成功提示
打开来源链接和其他导航请求时显示加载状态；旧请求结束不能覆盖当前来源
```

### 地区媒体页签与首页/搜索/链接 UI

```text
任务来源收藏按 sourceId 隔离，服务端持久化每个来源的文件夹和已加入链接，WebSocket 权威广播并在连接时补发
支持 resolveLink 的任务来源页展示未分类与自建文件夹；加入链接或来源卡片到所选分类，可移动、移出和删除空文件夹
保存操作规范化 sourceId、链接及标题，校验数量、目标文件夹和输入长度；不保存 URL 用户名、密码或控制字符
保存的链接再次打开时通过该来源 resolveLink，不能把用户提交的地址直接作为服务端请求地址
控制端加载 providers:
  按 region 分组追加到媒体库顶部：B 站与国内任务源进入 #domesticMediaTabs，国外任务源进入 #overseasMediaTabs
  国内媒体包含夸克分享和 B 站；国外组仅在存在活动国外任务来源时展示
  任务来源按钮与独立代理选择框成对渲染；没有显式选择时不使用代理
既有实现：地区元数据、代理注入、统一 callTaskSource 接口、地区页签分组
已实现：任务来源页签按能力提供首页、搜索、链接、刷新、相关推荐工具栏与卡片交互；来源数据可用性取决于上游
```

### 地区媒体任务通用路由与下载

```text
已有声明：任务源注册表、MediaLibraryManager.callTaskSource、命名代理选择、可写本地媒体库、媒体播放和下载能力
新增定义：媒体条目 { id, title, cover, mediaType, description?, duration?, meta?, playUrl?, downloadable?, downloaded }
操作流程：
  GET /api/task-media-sources/:id/home?page= → 校验运行中来源及 home 能力 → 返回首页条目和分页
  GET /api/task-media-sources/:id/search?keyword=&page= → 校验 search 能力 → 返回搜索条目和分页
  POST /api/task-media-sources/:id/resolve-link { url } → 校验 resolveLink 能力和链接 → 返回解析条目
  GET /api/task-media-sources/:id/related?itemId=&url= → 校验 related 能力 → 返回相关推荐
  结果按来源 ID 和条目 ID 查询下载索引并标记 downloaded；需要流式播放的条目使用服务端同源流地址
  GET /api/task-media-sources/:id/stream/:itemId → 校验运行中来源及流能力 → 传递 Range → 返回流、状态与安全响应头
  POST /api/task-media-sources/:id/download { item, targetId, dirPath } → 校验来源、条目和主服务器可写本地库
  来源异常仅对番茄代理租约及书籍身份验证的固定安全文案按完整相等白名单返回，其余错误统一脱敏；控制端提示该固定文案
    清洗目录和文件名并限制在目标库内；来源写入独占临时文件 → 完成后防覆盖发布 → 记录来源、条目、目标和相对路径
    已下载索引需确认目标文件仍存在；失败清理临时文件且不记录成功；多个文件按来源结果分别保存
  控制端进入活动来源 → 根据能力显示首页、搜索、链接解析、刷新、播放、下载和相关推荐
    条目 downloadable=false 时隐藏下载按钮；未声明时按来源 download 能力显示，保留其他来源合集下载
    首页和搜索返回有效分页且多页时显示上一页/下一页，保留当前搜索关键词；进入链接或切换来源隐藏分页，忽略过期响应
    点击条目按媒体类型播放或进入目录；离开来源或来源停止时清理旧视图，忽略过期请求
  每个来源通过当前选择的命名代理发起外部请求；无选择即直连，凭据和代理地址不写日志
  国内发布清单保留 domestic-media 并将旧 hongguo 标记退役，不再发布旧任务代码
  本地旧任务目录保留 results 等用户数据，使用退役标记阻止任务列表和自动恢复；不递归删除目录
  已运行的旧实例需先停止才能释放 hongguo 来源，新的 domestic-media 方可注册；不能仅靠修改磁盘解除运行中冲突
  overseas-media 不加入任何 release 任务清单或发布种子
  当前 domestic-media 最低服务版本 169 尚不能证明包含本次服务代码；发布前确定包含本次服务的版本并更新兼容声明
```

真实环境限制：Pinterest 真实匿名 Pin 图片链接解析及 Range 已做只读验证；匿名搜索请求 403，首页未取得可用内容；真实首页、搜索、分页、相关推荐尚未实现，登录态与真实视频待验收。番茄仅在 EPUB 身份及完整性检查通过时保存，锁只覆盖同一 Node 进程，真实完整下载与代理待验收。Pixiv 真实 CDN、登录和动图待验收，ffmpeg 无系统级内存硬限制。

### 显示端本地播放操作与权威确认

```text
点击单文件:
  取消旧批量 requestId，创建单文件 requestId
  发送 {type:'displayPlaylistCancel', libraryId, path, requestId}，确认前不调用 playMedia
服务端处理带来源/路径的 displayPlaylistCancel:
  仅回环且当前已登记连接可处理；立即使在途扫描 token 失效
  从活动白名单来源重新列举父目录，按完整 path 匹配 image/video/audio/text 文件
  忽略客户端 URL；服务端生成同源 URL，文本 format 规范为 markdown/plain
  异步后再次校验 token、连接、来源；后续单文件、目录或控制端播放使旧结果失效
  解析成功 -> 更新并持久化 currentMedia、currentPlaylist=null、currentMediaProgress=null
  注册当前显示端可信文本路由，发送 displayMediaStart(requestId, media)
  解析失败 -> displayPlaylistError(requestId)，保留原媒体与原列表
兼容不带来源/路径的 displayPlaylistCancel:
  仅取消扫描并清除/持久化 currentPlaylist；不执行单文件解析
浏览器处理 displayMediaStart:
  仅消费当前单文件 requestId 一次；清除 pending，再 stopPlaylist/showMedia
  重复、过期或断线后的确认丢弃；断线清除 pending 并提示，重连使用已保存权威状态
目录请求:
  附带 requestId，playlistStart 原样返回；调用 handlePlaylistStart 前过滤已取消 requestId
  getLibraries 默认拒绝全部，生产注入本地库与活动任务源白名单
  扫描前后检查 token、连接和原媒体/列表引用；播放、停止、清空使扫描失效
  仅投影播放必需字段，不转发 provider 凭据；GIF -> image，文本保留 format
  buildTextVoiceRoute(displayId,[displayId]) 生成可信路由
  textMediaTtsService.setDisplayRoute 终止旧朗读，startData 保存相同 route/voiceRouteByDisplayId
  持久化初始进度后下发；announceName=false，单层名称升序，不循环
目录浏览返回 410 / TASK_SOURCE_STOPPED:
  回当前来源根路径，清空旧条目并提示任务媒体源已停止
  浏览版本标识防止旧异步结果覆盖新来源/目录
LocalProvider._resolvePath:
  用 path.relative 校验完整路径段；拒绝向上穿越与同前缀兄弟目录
  符号链接目录行为保持原有兼容，不声称新增 realpath 隔离
```

### Task 6 单文件失败时恢复已提交批量列表
```text
单文件解析失败时，错误携带 requestId 与服务端 authoritativePlaylist 当前快照
浏览器仅对当前单文件请求处理此快照：
    若快照 startData.requestId 曾被本地取消，撤销该标识取消并调用 restorePlaylist
    使用服务端 index/currentTime/state 恢复，避免重播已在客户端播放的其他列表
    其余失败保留当前画面，不重启正在播放的媒体
单文件成功仍维持过期批量 requestId 取消，禁止旧列表覆盖
当前连接断开后清空旧连接取消标识；旧连接消息不能进入新连接分发
重连权威 playlistStart 可正常恢复服务端实际保存的列表
```
## 显示端媒体库层级（2026-11-11）

```text
打开显示端媒体库 → 页面及提示显示在 MMD 舞台与设置面板之上
关闭媒体库 → 恢复底层显示与交互
```
## 显示端夸克与 B 站来源（2026-11-11）

## 显示端 B 站热门首页与相关推荐（2026-11-11）

```text
显示端进入 B 站 → 复用控制端热门首页服务 → 显示视频卡片及原保存目录入口
显示端当前 B 站视频变化 → 复用相关推荐服务 → 首项当前视频、过滤重复；异步结果需匹配当前视频
卡片操作 → 播放、加入、下载、复制链接；播放经服务端可信视频标识解析并沿用已有显示端权威播放流程
外部服务失败 → 呈现错误或保留当前项；其他媒体来源不受影响
```

## 显示端媒体库背景透明度（2026-11-11）

```text
媒体库顶端滑块 0–100 → 透明度百分比 → 背景 alpha = 1 - 百分比 / 100
滑块输入 → 即时更新背景与百分比 → 本机持久化；无有效值时沿用原背景透明度
文字、控件和图片不使用整体 opacity → 保持清晰；重开媒体库恢复本机值
```

```text
本机显示端媒体库 → 展示本地、已配置夸克分享、B 站已保存项目和已启动国内任务来源
浏览夸克 → 按可信库标识与路径复用服务端提供器；B 站 → 使用服务端已保存视频及收藏列表
单项及批量播放 → 复用服务端权威路径校验和同源媒体代理，失败不改变当前播放
```
