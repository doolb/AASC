# 服务器发布包设计

## 目标

将服务器代码发布从“HTTP 请求时自动生成压缩包”调整为“npm 命令显式生成压缩包”。主服务器只提供已经生成并校验过的发布产物，避免源码修改后因为缓存或进程状态继续下发旧包。

## 功能边界

### 包含

- 新增 `npm run build:server-package`。
- 生成服务器 tar.gz、大小、SHA-256 和发布清单。
- `/server`、`/server/manifest` 只读取已生成清单。
- `/server/package` 只读取已生成压缩包。
- 批量更新子服务器前检查发布包是否存在。
- 保留现有白名单、校验、备份、回滚和健康检查。

### 不包含

- 不改变 Termux Bootstrap 的安装和回滚协议。
- 不把媒体、用户配置、日志、模型、证书或 APK 放入服务器发布包。
- 不实现 npm registry 发布，也不使用 `npm pack` 代替服务器 tar.gz。

## 运行流程

1. 开发者修改主服务器代码。
2. 在主服务器项目根目录执行 `npm run build:server-package`。
3. 发布脚本生成并写入 manifest 与 tar.gz。
4. 控制端请求批量更新。
5. 主服务器读取已生成清单并下发更新。
6. 子服务器下载、校验、安装并重启。

## 异常行为

- 未生成发布包：发布清单接口和批量更新接口返回明确错误。
- 清单与压缩包不一致：拒绝提供发布包。
- 子服务器安装或健康检查失败：保持现有回滚行为。

## 后端 esbuild 依赖打包预研（2026-09-22，仅记录）

后续可使用 esbuild 处理后端纯 JavaScript 依赖，目标是减少重复依赖解析和运行包中的纯 JS 文件数量；本方案当前不实施，不改变现有源码发布和 Offline APK 发布流程。

### 预研边界

- 保留 `server-launcher.js` 作为稳定启动入口。
- 纯 JavaScript 依赖允许进入服务 bundle。
- ASR/TTS/声纹原生模块、Puppeteer 浏览器资源、模型、动态任务和动态 `require()` 目标继续外置。
- 保留源码发布包作为回退路径，bundle 首次只作为验证产物。
- 验证通过后，才评估接入服务器代码包、生产依赖包和 Offline APK 运行包。

### 主要风险

- 后端通过 `__dirname`、`CODE_ROOT` 和 `PROJECT_ROOT` 定位静态资源、模型、配置及脚本，bundle 输出目录不能破坏这些路径契约。
- TaskManager、NodeJsRunner 和用户任务支持运行时动态加载，不能只根据静态 import 图判断依赖完整性。
- 原生依赖和 Puppeteer 不能被错误内联，否则可能导致服务启动、模型加载或浏览器启动失败。
- Offline APK manifest 当前固定记录 `server/src/apps/server/boot/server-launcher.js`，接入 bundle 时必须同时调整入口、文件清单、内容版本和回滚策略。
- 数据修复包仍应调用受限服务能力，不应依赖 bundle 内部模块路径，也不应借 bundle 变更绕过 `requiredCodeVersion` 校验。

### 预期实施顺序

1. 增加独立的 esbuild 预构建命令和输出目录，不替换现有启动入口。
2. 对服务启动、静态资源、ASR/TTS/声纹、Chat2API、任务动态加载和数据修复执行回归测试。
3. 校验服务器代码包、依赖包和 Offline APK 的清单、SHA-256、升级与回滚。
4. 只有全部通过后，才决定是否将 bundle 纳入正式发布产物。
