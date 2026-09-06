# 媒体库功能设计文档

## 功能概述

媒体库功能为用户提供统一的媒体资源管理能力，支持多种存储后端（本地磁盘、HTTP远程服务器、SMB网络共享），用户可以在控制端查看、上传、删除和预览媒体文件。

## 功能需求

### 1. 媒体库管理
- 支持配置多个媒体库
- 支持设置默认媒体库
- 支持媒体库的增删改查

### 2. 文件操作
- 支持视频和图片上传
- 支持删除已上传的媒体
- 支持预览已上传的媒体
- 支持批量上传文件
- 支持上传文件夹

### 3. 文件夹管理
- 支持文件夹中的媒体管理
- 支持创建文件夹
- 支持删除文件夹
- 支持文件夹树形浏览

### 4. 多协议支持
- 本地磁盘：直接操作服务器文件系统
- HTTP协议：代理访问远程HTTP服务器资源
- SMB协议：使用smb2库连接网络共享（参考 smb2.js）

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           控制端 (upload.html)                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    MediaLibrary UI                               │   │
│  │  - 媒体库列表/切换                                                 │   │
│  │  - 文件夹树形结构                                                  │   │
│  │  - 媒体网格/列表视图                                               │   │
│  │  - 上传/删除/预览操作                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Server (server.js)                               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Media Library API                              │  │
│  │  GET/POST/DELETE /api/media-libraries/*                          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  src/apps/web-mediacenter/modules/media/media-library-app-service.js │  │
│  │  - MediaLibraryManager: 统一管理接口                               │  │
│  │  - LocalProvider: 本地文件系统                                     │  │
│  │  - HttpProvider: HTTP 远程媒体库                                   │  │
│  │  - SmbProvider: SMB 网络共享                                       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ┌───────────┐   ┌───────────┐   ┌───────────┐
            │  本地磁盘  │   │  HTTP(S)  │   │ SMB/CIFS  │
            │  uploads/ │   │  远程服务器 │   │ 网络共享  │
            └───────────┘   └───────────┘   └───────────┘
```

## 模块划分

| 模块 | 文件 | 说明 |
|------|------|------|
| 媒体库核心 | src/apps/web-mediacenter/modules/media/media-library-app-service.js | 提供者接口、管理器、三种实现 |
| 媒体库前端 | public/js/media-library.js | UI交互、文件操作 |
| 媒体库样式 | public/css/media-library.css | 界面样式 |
| 媒体库配置 | ~/.config/aasc-user/media-libraries.json | 媒体库配置存储 |

## 用户界面设计

### 媒体库选择器
- 下拉列表显示所有媒体库
- 显示媒体库类型图标（本地/HTTP/SMB）
- 当前选中高亮

### 文件浏览区
- 面包屑导航显示当前路径
- 文件夹树形侧边栏（可选）
- 文件网格/列表视图切换
- 支持拖拽上传

### 文件操作栏
- 上传文件按钮
- 上传文件夹按钮
- 新建文件夹按钮
- 刷新按钮

### 文件项
- 缩略图预览
- 文件名
- 文件大小
- 操作按钮（播放/删除/预览）

## 安全设计

1. **路径遍历防护**：验证所有路径参数，禁止 `..` 跳转
2. **权限控制**：readonly 标记防止误删远程资源
3. **密码加密**：SMB 密码加密存储
4. **文件类型验证**：限制上传文件类型
5. **访问代理**：HTTP/SMB 资源通过服务器代理，避免暴露凭证
6. **混合内容规避**：服务器 HTTPS 时，http:// 媒体 URL 统一重写为同源 /api/media-proxy，绕开浏览器/WebView 混合内容拦截；代理做 SSRF 基础防护（禁本机/回环/云元数据，内网媒体放行）

## 实现优先级

| 优先级 | 功能 | 说明 | 状态 |
|--------|------|------|------|
| P0 | 本地媒体库管理 | 基于现有 uploads/ 扩展 | ✅ 已完成 |
| P0 | 媒体库配置 API | CRUD 操作 | ✅ 已完成 |
| P1 | 文件夹管理 | 创建/删除/浏览 | ✅ 已完成 |
| P1 | 批量上传 | 支持多文件和文件夹 | ✅ 已完成 |
| P2 | HTTP 媒体库 | 代理远程资源 | ✅ 已完成 |
| P3 | SMB 媒体库 | 需要安装 smb2 依赖 | ✅ 已完成 |

## 实现记录

### 2026-03-28 本地媒体库基础功能

**已完成功能：**
- MediaLibraryProvider 提供者基类
- LocalProvider 本地文件系统实现
- MediaLibraryManager 媒体库管理器
- 媒体库 CRUD API
- 文件上传/删除 API
- 文件夹创建/删除 API
- 前端媒体库 UI 模块
- 拖拽上传支持

**改动文件：**
- src/apps/web-mediacenter/modules/media/media-library-app-service.js (新增)
- public/js/media-library.js (新增)
- public/css/media-library.css (新增)
- server.js (修改：添加 API 路由)
- public/upload.html (修改：集成媒体库 UI)
- public/js/main.js (修改：初始化媒体库)
- ~/.config/aasc-user/media-libraries.json (更新配置结构)

### 2026-03-28 批量上传和文件夹上传

**已完成功能：**
- 多文件批量上传
- 文件夹上传（保留目录结构）
- 拖拽上传文件夹
- 上传进度提示

**改动文件：**
- public/js/media-library.js: uploadFiles, uploadFolder, uploadDirectoryEntry
- public/upload.html: 添加上传文件/文件夹按钮
- public/css/media-library.css: 上传按钮样式

### 2026-03-28 HTTP 媒体库支持

**已完成功能：**
- HttpProvider 实现
- HTTP Basic 认证支持
- HTML 目录列表解析
- 结果缓存
- 代理访问 API

**改动文件：**
- src/apps/web-mediacenter/modules/media/media-library-app-service.js: HttpProvider 类
- server.js: 代理访问 API 路由

### 2026-03-28 SMB 媒体库支持

**已完成功能：**
- SmbProvider 实现
- SMB 域认证支持
- 文件流读取
- 兼容 @marsaud/smb2 和 smb2 库

**改动文件：**
- src/apps/web-mediacenter/modules/media/media-library-app-service.js: SmbProvider 类

### 2026-03-29 优化 SMB 媒体库配置界面

**改进内容：**
- 将 SMB 共享路径拆分为"服务器地址"和"共享路径"两个独立字段
- 用户只需输入服务器 IP 和共享名称，无需手动拼接完整路径

**改动文件：**
- public/js/media-library.js: 添加服务器地址输入框
- src/apps/web-mediacenter/modules/media/media-library-app-service.js: SmbProvider 添加 `_buildSharePath` 方法

### 2026-03-28 移除旧的 media-list.js 组件

**已完成功能：**
- 删除旧的 MediaList 组件
- 统一使用 MediaLibrary 组件管理媒体

**改动文件：**
- public/js/media-list.js (删除)
- public/upload.html (移除脚本引用)
- public/js/main.js (移除 MediaList.load() 调用)
- public/js/websocket.js (MediaList → MediaLibrary)
- public/js/upload.js (MediaList.load → MediaLibrary.loadContent)

### 2026-08-17 HTTP 媒体混合内容修复 + Range 流

**背景：** 服务器启用 HTTPS（res/certs）后，显示端页面为 https://...:8081/display，加载 http:// 媒体子资源被浏览器/WebView 混合内容策略拦截——手动输入 http:// 媒体地址无法播放，HttpProvider 媒体库（mnt/mnt2）同理。

**方案：**
1. **sendToDisplay 统一出口重写**：服务器 HTTPS 时，把下发媒体的 http:// URL 重写为同源 `/api/media-proxy?url=<编码>`，覆盖手动 URL 输入 / restore 恢复 / 单文件播放全部路径，显示端零改动
2. **通用代理端点 `GET /api/media-proxy?url=`**：流式转发上游 + Range 透传（relay 206/200 + Content-Range）+ 15s 超时 + SSRF 基础防护（禁本机/回环/云元数据，内网媒体放行，因媒体库本身即内网资源）
3. **HttpProvider.getPublicUrl** 改同源 HTTPS 库代理 URL（`/api/media-libraries/{id}/proxy/{path}`，与 SmbProvider 一致），媒体库控制端预览/播放不再被拦
4. **库代理端点支持 Range**：本地/SMB 有精确 size → 解析 Range 走 206；http 库 size 未知回落全量（不回归）
5. **超时**：HttpProvider._fetchHtml/getFileStream 加 8s 超时，修 192.168.1.101 不可达时 init 挂死（此前卡 SYN-SENT 2-3 分钟、8081 不监听）
6. **_parseHtml 垃圾过滤**：剔除 fancy-index 表头排序链接（Name/Last modified/Description/Parent Directory）误当媒体项

**范围约定：** 各 Provider getFileStream(path, range) 统一返回 `{ stream, statusCode, headers }`（无 range 200 整流 / 有 range 206 切片），供 proxy 端点 setHeader。

**改动文件：**
- src/apps/web-mediacenter/modules/media/media-library-app-service.js
- src/apps/server/boot/server-app.js
- tests/media-library-app-service.test.js
- docs/spec/media-library.md

### 2026-08-17 http 媒体库获取文件大小 + 批量播放视频 seek

**背景：** HttpProvider 的 list/getFile 不返回 size（fancy-index 目录列表只有人类可读大小如 `531M`，无法精确还原字节），控制端媒体库不显示真实文件大小；库代理端点 Range 解析依赖 `getFile().size`，size 未知时恒回落 200 全量，批量播放视频拖动进度条会重新全量下载。

**方案：**
1. **HttpProvider._fetchHead(url)**：HEAD 请求取 `Content-Length` + `Last-Modified`，8s 超时，失败/非 200 返回 null（回落 0，不阻塞）
2. **HttpProvider.getFile**：调 _fetchHead 填 size + modifiedTime
3. **HttpProvider._fetchList**：收集媒体文件（image/video/gif/html）后小并发池（6）发 HEAD 补 size，文件夹不 HEAD；单文件失败回落 0
4. **MediaLibraryManager.getFile(libraryId, filePath)** 委托：修复 proxy 端点此前调 `mediaLibraryManager.getFile` 抛错被 `catch(e){}` 静默吞掉、Range 恒 null 的隐藏 bug

**效果：** 控制端显示真实大小；库代理端点 Range 可解析 → 批量播放视频 seek 返回 206 分段，不再全量重下。

**改动文件：**
- src/apps/web-mediacenter/modules/media/media-library-app-service.js
- tests/media-library-app-service.test.js（+3 测试）
- docs/spec/media-library.md

### 2026-09-05 Termux storage 符号链接目录列举修复

**问题：** Termux 执行 `termux-setup-storage` 后，`~/storage` 及其下级目录通常是符号链接。LocalProvider 使用 `lstat` 读取链接自身属性，导致目录链接被识别为文件，控制端无法继续进入并列出目录。

**方案：**
- `LocalProvider.list` 先使用 `lstat` 保留符号链接和断链识别，再对符号链接使用 `stat` 获取目标的真实属性。
- 目标不存在的断链继续跳过；有效目标按真实目录或文件返回，保持现有路径校验和隐藏文件过滤。

**验收：**
- 符号链接目录在根目录列表中返回 `type=folder`、`mediaType=folder`。
- 通过符号链接继续列举目标目录时，可以返回其下级目录。
- 回归测试覆盖 Linux 目录符号链接，并在 Windows 使用 junction 兼容执行。

**改动文件：**
- src/apps/web-mediacenter/modules/media/media-library-app-service.js
- tests/media-library-app-service.test.js
- docs/spec/media-library.md
- docs/task/20260905_修复Termux存储符号链接目录列举.md
