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
