# 媒体库功能实现文档

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
    通用 HTTPS 媒体代理：服务器 HTTPS 时，控制端手动输入的 http:// 媒体 URL
    由 sendToDisplay 统一重写为同源 /api/media-proxy，绕开浏览器混合内容拦截
    请求头: 可选 Range: bytes=start-end
    校验:
        url 必须以 http:// 或 https:// 开头
        禁止重定向到本机 localhost/回环/私有地址等（SSRF 防护，简单校验目标 host）
    处理:
        upstream = HTTP(S) GET(url, {headers: Range 透传, 超时: 15s})
        relay 远端状态码 206/200 与响应头 Content-Type/Content-Range/Accept-Ranges/Content-Length
        stream.pipe(res)
        超时/错误时响应 502/504，客户端断开时中断上游请求
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
