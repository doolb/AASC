# 本地 PMX 模型与 VMD 动作接入设计

## 状态

- 范围已确认：先支持本地 Node 服务和浏览器显示端。
- 暂不处理 Offline APK、APK 资源清单、Android Runtime 和 APK 构建。
- 后续外网发布沿用本地资源布局，但另行执行上传、清单切换和回退验证。

## 目标

将当前显示端默认的 VRM/GLB 角色替换为用户已下载的 PMX 模型，并播放配套的 VMD 动作。模型压缩包和动作压缩包只作为本地测试输入，运行时不读取 `D:\down`，而是使用项目资源目录经本地服务提供的同源 URL。

输入资源已经确认：

- 模型包包含 PMX 2.0 文件，以及 `tex/`、`toon/` 纹理目录。
- 动作包包含 VMD 0002 文件和说明文本。

## 非目标

- 不将 PMX 转换为 VRM，不修改 PMX/VMD 二进制内容。
- 不在本阶段构建或修改 Offline APK。
- 不在本阶段上传外网或切换外网默认资源。
- 不允许通过动作计划注入任意 URL、文件系统路径或脚本。

## 方案

### 资源布局

将压缩包解压为本地资源目录，保持 PMX 的相对纹理路径：

```text
res/models/mmd/miya/
  miya.pmx
  tex/...
  toon/...
res/models/mmd/motions/
  miya-default.vmd
```

文件名可使用 ASCII 别名，但不改动文件内容。现有 `/models` 静态路由提供同源资源，浏览器 URL 采用：

```text
/models/mmd/miya/miya.pmx
/models/mmd/motions/miya-default.vmd
```

### 浏览器运行时

保留现有 VRM 运行时作为兼容分支，新增 PMX/MMD 分支：

- 使用 Three.js `MMDLoader` 加载 PMX 和相对路径纹理。
- 使用 `MMDLoader.loadAnimation` 与 `MMDAnimationHelper` 播放 VMD。
- 在同一个渲染循环中更新 MMD helper 和场景。
- 模型切换或页面销毁时释放几何体、材质、纹理、动作 helper 和监听器。
- 默认动作先按启动后播放一次实现；播放结束后保持最后姿态或回到静止状态，不循环。
- WebGL、模型、纹理或动作加载失败时保留现有 Canvas 占位和聊天/媒体功能。

### 资源白名单

默认 profile 只引用固定的 `resourceId`，由本地资源注册表映射到模型和动作 URL。服务端消息只能引用已登记资源 ID，不能直接传入任意 URL 或路径。后续外网发布时将把同一资源注册表切换到版本化外网根目录，不改变浏览器动作协议。

### 外网发布预留

本地验证通过后，再将 `res/models/mmd/miya/` 和 `res/models/mmd/motions/` 上传到外网静态资源根目录；服务端增加安全的相对路径校验、大小和 MIME 校验，并在清单原子切换后进行 LAN/WAN 验证。该阶段不纳入本次实现和验证。

## 受影响模块

- `src/apps/web-mediacenter/ui/public/js/display-mmd.js`
- 新增或调整 PMX/MMD 浏览器运行时模块
- `src/apps/web-mediacenter/ui/public/display.html` 的本地模块依赖/导入映射
- Three.js MMD loader 及其浏览器端依赖资源
- MMD 资源注册或服务端 profile 校验模块
- 显示端契约测试和本地浏览器验收
- `docs/design`、`docs/spec`、`docs/task`、`docs/todo.md`、`changelog.md`

## 验收标准

1. 本地启动 `npm start` 后，浏览器显示端能加载 PMX 模型及 `tex/`、`toon/` 纹理。
2. 显示端能加载并播放指定 VMD 一次，前 7 帧空白不导致加载失败。
3. 切换/刷新页面不会持续增加 WebGL 资源或重复动作循环。
4. 当前聊天、媒体、MMD 显示开关和触摸占位逻辑不回归。
5. 非法资源 ID、任意 URL、路径穿越和未登记动作被拒绝。
6. 测试只覆盖本地服和浏览器显示端，不执行 APK 构建，不上传外网。
