# 媒体库功能实现任务

## 任务描述

实现媒体库功能，为用户提供统一的媒体资源管理能力，支持多种存储后端（本地磁盘、HTTP远程服务器、SMB网络共享），用户可以在控制端查看、上传、删除和预览媒体文件。

## Design 需求

来源：[docs/design/media-library.md](docs/design/media-library.md)

### 功能需求

1. **媒体库管理**
   - 支持配置多个媒体库
   - 支持设置默认媒体库
   - 支持媒体库的增删改查

2. **文件操作**
   - 支持视频和图片上传
   - 支持删除已上传的媒体
   - 支持预览已上传的媒体
   - 支持批量上传文件
   - 支持上传文件夹

3. **文件夹管理**
   - 支持文件夹中的媒体管理
   - 支持创建文件夹
   - 支持删除文件夹
   - 支持文件夹树形浏览

4. **多协议支持**
   - 本地磁盘：直接操作服务器文件系统
   - HTTP协议：代理访问远程HTTP服务器资源
   - SMB协议：使用smb2库连接网络共享

### 系统架构

```
控制端 (upload.html)
    │
    ▼
Server (server.js)
    │
    ├── Media Library API
    │
    └── core/media-library.js
            │
            ├── LocalProvider (本地磁盘)
            ├── HttpProvider (HTTP远程)
            └── SmbProvider (SMB网络共享)
```

### 安全设计

1. 路径遍历防护：验证所有路径参数，禁止 `..` 跳转
2. 权限控制：readonly 标记防止误删远程资源
3. 密码加密：SMB 密码加密存储
4. 文件类型验证：限制上传文件类型
5. 访问代理：HTTP/SMB 资源通过服务器代理，避免暴露凭证

### 实现优先级

| 优先级 | 功能 | 说明 | 状态 |
|--------|------|------|------|
| P0 | 本地媒体库管理 | 基于现有 uploads/ 扩展 | ✅ 已完成 |
| P0 | 媒体库配置 API | CRUD 操作 | ✅ 已完成 |
| P1 | 文件夹管理 | 创建/删除/浏览 | ✅ 已完成 |
| P1 | 批量上传 | 支持多文件和文件夹 | ✅ 已完成 |
| P2 | HTTP 媒体库 | 代理远程资源 | ✅ 已完成 |
| P3 | SMB 媒体库 | 需要安装 smb2 依赖 | ✅ 已完成 |

## Spec 设计

来源：[docs/spec/media-library.md](docs/spec/media-library.md)

### 核心模块

| 模块 | 文件 | 说明 | 状态 |
|------|------|------|------|
| 媒体库提供者接口 | core/media-library.js | MediaLibraryProvider 基类 | ✅ 已完成 |
| 本地存储提供者 | core/media-library.js | LocalProvider 实现 | ✅ 已完成 |
| HTTP 提供者 | core/media-library.js | HttpProvider 实现 | ✅ 已完成 |
| SMB 提供者 | core/media-library.js | SmbProvider 实现 | ✅ 已完成 |
| 媒体库管理器 | core/media-library.js | MediaLibraryManager 统一管理 | ✅ 已完成 |
| 前端模块 | public/js/media-library.js | UI交互、文件操作 | ✅ 已完成 |
| 样式文件 | public/css/media-library.css | 界面样式 | ✅ 已完成 |

### HTTP API

| 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|
| GET | /api/media-libraries | 获取所有媒体库列表 | ✅ 已完成 |
| POST | /api/media-libraries | 添加新媒体库 | ✅ 已完成 |
| PUT | /api/media-libraries/:id | 更新媒体库配置 | ✅ 已完成 |
| DELETE | /api/media-libraries/:id | 删除媒体库 | ✅ 已完成 |
| GET | /api/media-libraries/:id/list | 列出媒体库内容 | ✅ 已完成 |
| POST | /api/media-libraries/:id/upload | 上传文件到媒体库 | ✅ 已完成 |
| DELETE | /api/media-libraries/:id/file | 删除文件 | ✅ 已完成 |
| POST | /api/media-libraries/:id/folder | 创建文件夹 | ✅ 已完成 |
| DELETE | /api/media-libraries/:id/folder | 删除文件夹 | ✅ 已完成 |
| GET | /api/media-libraries/:id/proxy/* | 代理访问（用于HTTP/SMB） | ✅ 已完成 |

### 配置文件

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
      "name": "远程媒体",
      "type": "http",
      "url": "http://192.168.1.100/media",
      "readonly": true
    },
    {
      "id": "smb_share",
      "name": "网络共享",
      "type": "smb",
      "share": "\\\\192.168.1.100\\media",
      "domain": "WORKGROUP",
      "username": "user",
      "password": "pass",
      "readonly": true
    }
  ]
}
```

## 执行步骤

### 阶段一：P0 本地媒体库 ✅ 已完成

- [x] 创建 core/media-library.js
  - [x] MediaLibraryProvider 基类
  - [x] LocalProvider 实现
  - [x] MediaLibraryManager 管理器
- [x] 修改 server.js
  - [x] 引入 media-library 模块
  - [x] 添加媒体库管理 API
  - [x] 添加媒体操作 API
- [x] 创建 public/js/media-library.js
  - [x] 媒体库切换功能
  - [x] 文件列表渲染
  - [x] 上传/删除操作
- [x] 创建 public/css/media-library.css
- [x] 修改 public/upload.html
  - [x] 集成媒体库 UI
- [x] 更新 config/media-libraries.json

### 阶段二：P1 文件夹管理 ✅ 已完成

- [x] 实现文件夹创建/删除
- [x] 实现文件夹浏览导航
- [x] 实现批量上传
- [x] 实现文件夹上传
- [x] 实现拖拽上传文件夹

### 阶段三：P2 HTTP 媒体库 ✅ 已完成

- [x] 实现 HttpProvider
- [x] 实现代理访问 API
- [x] 支持 HTTP Basic 认证
- [x] 实现目录列表解析

### 阶段四：P3 SMB 媒体库 ✅ 已完成

- [x] 实现 SmbProvider
- [x] 支持 SMB 认证
- [x] 实现文件流读取
- [x] 兼容 @marsaud/smb2 和 smb2 库

## 受影响的功能模块和代码

### 新增文件

| 文件 | 说明 | 代码量 |
|------|------|--------|
| core/media-library.js | 媒体库核心模块 | ~820 行 |
| public/js/media-library.js | 前端媒体库模块 | ~570 行 |
| public/css/media-library.css | 媒体库样式 | ~280 行 |

### 修改文件

| 文件 | 修改内容 | 影响范围 |
|------|------|----------|
| server.js | 添加媒体库 API 路由、代理 API | +120 行 |
| public/upload.html | 集成媒体库 UI、添加上传按钮 | +20 行 |
| public/js/main.js | 初始化媒体库模块 | +4 行 |
| config/media-libraries.json | 更新配置结构 | 重写 |

### 核心类和方法

#### MediaLibraryProvider (基类)
```
- connect() - 连接媒体库
- disconnect() - 断开连接
- list(dirPath) - 列出目录内容
- getFile(filePath) - 获取文件信息
- uploadFile(dirPath, file) - 上传文件
- deleteFile(filePath) - 删除文件
- createFolder(dirPath, name) - 创建文件夹
- deleteFolder(folderPath) - 删除文件夹
- getFileStream(filePath) - 获取文件流
- getPublicUrl(filePath) - 获取公开访问URL
```

#### LocalProvider (本地存储)
```
- 基于 fs 模块实现
- 路径遍历防护
- 自动创建目录
- 支持文件上传/删除
```

#### HttpProvider (HTTP远程)
```
- 基于 http/https 模块实现
- 支持 Basic 认证
- HTML 目录列表解析
- 结果缓存
- 只读模式
```

#### SmbProvider (SMB网络共享)
```
- 基于 @marsaud/smb2 实现
- 支持域认证
- 文件流读取
- 只读模式
```

#### MediaLibraryManager (管理器)
```
- init() - 初始化所有媒体库
- addLibrary(config) - 添加媒体库
- removeLibrary(id) - 移除媒体库
- getLibrary(id) - 获取媒体库
- listLibraries() - 列出所有媒体库
- setDefault(id) - 设置默认媒体库
- upload/delete/createFolder/deleteFolder - 代理操作
- getFileStream() - 获取文件流（用于代理）
```

#### MediaLibrary (前端模块)
```
- init() - 初始化
- loadLibraries() - 加载媒体库列表
- switchLibrary(id) - 切换媒体库
- loadContent(path) - 加载目录内容
- uploadFile/uploadFiles - 上传文件
- uploadFolder - 上传文件夹
- deleteItem - 删除文件/文件夹
- createFolder - 创建文件夹
- playMedia - 播放媒体
- setupDragDrop - 设置拖拽上传
```

## 自测用例

### 1. 本地媒体库测试

#### 1.1 媒体库列表
```
测试步骤：
1. 启动服务器
2. 访问控制端页面
3. 查看媒体库列表

预期结果：
- 显示 "本地上传" 媒体库
- 显示 "默认" 标签
- 显示本地磁盘图标
```

#### 1.2 文件上传
```
测试步骤：
1. 选择本地媒体库
2. 点击 "上传文件" 按钮
3. 选择多个图片/视频文件

预期结果：
- 显示上传进度提示
- 上传完成后刷新文件列表
- 显示上传成功数量
```

#### 1.3 文件夹上传
```
测试步骤：
1. 点击 "上传文件夹" 按钮
2. 选择包含子文件夹的目录

预期结果：
- 自动创建对应文件夹结构
- 上传所有文件到对应位置
- 显示上传完成提示
```

#### 1.4 拖拽上传
```
测试步骤：
1. 从文件管理器拖拽文件到媒体库区域
2. 从文件管理器拖拽文件夹到媒体库区域

预期结果：
- 文件直接上传到当前目录
- 文件夹自动创建并上传内容
```

#### 1.5 文件夹操作
```
测试步骤：
1. 点击 "新建文件夹" 按钮
2. 输入文件夹名称
3. 点击文件夹进入
4. 点击面包屑导航返回

预期结果：
- 文件夹创建成功
- 可以进入文件夹查看内容
- 面包屑导航正常工作
```

#### 1.6 文件删除
```
测试步骤：
1. 鼠标悬停在文件上
2. 点击 "删除" 按钮
3. 确认删除

预期结果：
- 显示确认对话框
- 删除后刷新列表
- 文件从磁盘删除
```

#### 1.7 媒体播放
```
测试步骤：
1. 点击文件的 "播放" 按钮

预期结果：
- 媒体发送到显示端播放
- 文件显示 "正在播放" 标记
- 裁剪预览显示媒体
```

### 2. HTTP 媒体库测试

#### 2.1 添加 HTTP 媒体库
```
测试步骤：
1. 通过 API 添加 HTTP 媒体库配置
2. 重启服务器或调用初始化

配置示例：
{
  "id": "http_test",
  "name": "HTTP测试",
  "type": "http",
  "url": "http://192.168.1.100/media",
  "readonly": true
}

预期结果：
- 媒体库列表显示新条目
- 显示网络图标
- 显示 "只读" 标签
```

#### 2.2 浏览 HTTP 资源
```
测试步骤：
1. 切换到 HTTP 媒体库
2. 浏览目录结构

预期结果：
- 显示远程目录列表
- 可以进入子文件夹
- 面包屑导航正常
```

#### 2.3 代理访问
```
测试步骤：
1. 点击 HTTP 媒体库中的文件播放

预期结果：
- 通过代理 API 获取文件
- 媒体正常播放
- 不暴露原始服务器地址
```

#### 2.4 只读限制
```
测试步骤：
1. 尝试上传文件到 HTTP 媒体库
2. 尝试删除文件
3. 尝试创建文件夹

预期结果：
- 所有写操作返回错误提示
- 显示 "只读媒体库" 提示
```

### 3. SMB 媒体库测试

#### 3.1 安装依赖
```bash
npm install @marsaud/smb2
```

#### 3.2 添加 SMB 媒体库
```
测试步骤：
1. 通过 API 添加 SMB 媒体库配置

配置示例：
{
  "id": "smb_test",
  "name": "SMB共享",
  "type": "smb",
  "share": "\\\\192.168.1.100\\media",
  "domain": "WORKGROUP",
  "username": "user",
  "password": "password",
  "readonly": true
}

预期结果：
- 媒体库连接成功
- 显示网络共享图标
```

#### 3.3 浏览 SMB 资源
```
测试步骤：
1. 切换到 SMB 媒体库
2. 浏览目录结构

预期结果：
- 显示网络共享目录列表
- 可以进入子文件夹
```

#### 3.4 播放 SMB 媒体
```
测试步骤：
1. 点击 SMB 媒体库中的文件播放

预期结果：
- 通过代理 API 流式传输
- 媒体正常播放
```

### 4. API 测试

#### 4.1 获取媒体库列表
```bash
curl http://localhost:8081/api/media-libraries
```

#### 4.2 列出媒体库内容
```bash
curl "http://localhost:8081/api/media-libraries/local_uploads/list?path=/"
```

#### 4.3 上传文件
```bash
curl -X POST \
  -F "file=@test.jpg" \
  -F "path=/" \
  http://localhost:8081/api/media-libraries/local_uploads/upload
```

#### 4.4 创建文件夹
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"path":"/","name":"test_folder"}' \
  http://localhost:8081/api/media-libraries/local_uploads/folder
```

#### 4.5 删除文件
```bash
curl -X DELETE \
  "http://localhost:8081/api/media-libraries/local_uploads/file?path=/test.jpg"
```

#### 4.6 代理访问
```bash
curl http://localhost:8081/api/media-libraries/http_test/proxy/image.jpg --output test.jpg
```

### 5. 错误处理测试

#### 5.1 路径遍历攻击
```
测试步骤：
1. 尝试访问包含 ../ 的路径

预期结果：
- 返回错误
- 不允许访问上级目录
```

#### 5.2 不存在的媒体库
```
测试步骤：
1. 访问不存在的媒体库 ID

预期结果：
- 返回 500 错误
- 显示 "媒体库不存在"
```

#### 5.3 连接失败
```
测试步骤：
1. 配置错误的 HTTP/SMB 地址
2. 重启服务器

预期结果：
- 显示连接失败日志
- 其他媒体库正常工作
```

## 相关文件

| 文件 | 状态 | 说明 |
|------|------|------|
| docs/design/media-library.md | ✅ 已完成 | 设计文档 |
| docs/spec/media-library.md | ✅ 已完成 | 实现文档（伪代码） |
| core/media-library.js | ✅ 已完成 | 核心模块 |
| public/js/media-library.js | ✅ 已完成 | 前端模块 |
| public/css/media-library.css | ✅ 已完成 | 样式文件 |
| config/media-libraries.json | ✅ 已完成 | 配置文件 |
| server.js | ✅ 已完成 | 添加 API 路由 |
| public/upload.html | ✅ 已完成 | 集成 UI |
| public/js/main.js | ✅ 已完成 | 初始化媒体库 |

## 依赖说明

### SMB 支持
如需使用 SMB 媒体库，需安装依赖：
```bash
npm install @marsaud/smb2
```

支持的 SMB 库：
- `@marsaud/smb2` (推荐)
- `smb2` (备选)
