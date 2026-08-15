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
        getFileStream(path) -> 获取文件流
        getPublicUrl(path) -> 获取公开访问URL
        detectMediaType(name):
        ext = name 的后缀
        if ext in ['gif']: return 'gif'
        if ext in ['mp4','webm','mov','avi','mkv']: return 'video'
        if ext in ['html','htm']: return 'html'      // 新增
        return 'image'
```

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
    
    getPublicUrl(filePath):
        如果 basePath === uploads 目录:
            返回 "http://{本地IP}:{端口}/uploads/{filePath}"
        否则:
            返回 "http://{本地IP}:{端口}/media/{id}/{filePath}"
    
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
    
    connect():
        设置 connected = true
        无需实际连接
    
    list(dirPath):
        url = baseUrl + dirPath
        response = HTTP GET(url)
        html = response.text
        返回 解析HTML目录列表(html, dirPath)
    
    getFileStream(filePath):
        url = baseUrl + filePath
        response = HTTP GET(url)
        返回 response.body（流）
    
    getPublicUrl(filePath):
        返回 baseUrl + filePath（直接使用原始HTTP路径）
    
    _parseHtmlListing(html, basePath):
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
    
    getFileStream(filePath):
        使用 Promise 包装:
            client.readFile(filePath, callback)
            创建延迟读取的 Readable stream:
                read() 时 push buffer 并立即释放引用
            返回 stream
    
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
    
    getFileStream(libraryId, filePath):
        获取 library
        调用 provider.getFileStream(filePath)
    
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
            动态注册静态路由: app.use(routePrefix, express.static(basePath))
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
    处理:
        提取文件路径
        调用 mediaLibraryManager.getFileStream(id, path)
        流式返回文件内容
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
