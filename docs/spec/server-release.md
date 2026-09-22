# 服务器发布包实现规范

## 目标

服务器发布包由 npm 命令显式生成，运行中的 HTTP 发布接口只读取已经生成的发布包，不在请求时自动打包。

## 发布产物

- 发布目录：`res/temp/aasc-server-release/`
- 代码包：`aasc-server-<version>.tar.gz`
- 清单：`manifest.json`
- 发布白名单：`src/`、`package.json`、`package-lock.json`
- 排除媒体、用户配置、证书、模型、日志、第三方工程和依赖目录。

## 伪代码

```
变量 projectRoot = 项目根目录
变量 releaseDirectory = projectRoot + "/res/temp/aasc-server-release"
变量 releaseFiles = ["src", "package.json", "package-lock.json"]

npm run build:server-package:
    读取 package.json.version
    在临时目录生成 tar.gz
    校验压缩包只包含 releaseFiles 允许的路径
    计算压缩包 size 和 sha256
    将压缩包原子移动到 releaseDirectory
    将 version、size、sha256、packageUrl、files 写入 manifest.json
    输出发布包路径和校验值

ServerReleaseService.getManifest():
    读取 releaseDirectory/manifest.json
    若清单不存在，返回“请先执行 npm run build:server-package”
    校验清单字段和发布包存在
    返回已生成发布包的清单

ServerReleaseService.streamPackage(response):
    读取 manifest.json 指向的已生成压缩包
    不执行 tar，不扫描源码，不重新计算发布包
    流式返回压缩包

主服务器更新子服务器:
    先读取已生成清单
    若清单不存在，拒绝下发并提示先生成发布包
    子服务器 Bootstrap 下载清单指定的 packageUrl
    校验 size 和 sha256
    停止服务、备份、安装白名单文件、启动服务并健康检查
    失败时恢复备份
```

## 约束

- 发布包生成是显式运维动作，不绑定 `/server` 或 `/server/package` 请求。
- 修改源码后必须重新执行 `npm run build:server-package`，再更新子服务器。
- APK 不属于该发布包。

## esbuild 后端依赖打包预研伪代码（仅记录，未实施）

```
变量 bundleEntry = "src/apps/server/boot/server-app.js"
变量 launcherEntry = "src/apps/server/boot/server-launcher.js"
变量 bundleOutput = "build/server-bundle/server-app.cjs"
变量 externalPackages = 原生模块、Puppeteer、动态运行时依赖

npm run build:server-bundle:
    读取 package-lock.json 和当前项目代码
    使用 esbuild 以 Node.js、CommonJS、生产模式构建 bundleEntry
    将 externalPackages 保留为运行时依赖，不内联原生模块或二进制资源
    保留 launcherEntry 的稳定启动协议
    复制 bundle 依赖的静态资源、任务脚本和运行时辅助文件
    生成 bundle manifest、文件大小、SHA-256 和依赖清单
    不修改现有 server 发布清单

bundle 预发布验证:
    使用 bundle 启动服务
    验证 HTTP、WebSocket、ASR、TTS、声纹、Chat2API 和任务系统
    验证动态任务 require、用户配置、模型/资源路径和数据修复包
    任一契约失败则保留源码发布方式，不切换正式入口

正式接入评估:
    更新 server 发布包的入口和文件清单
    更新 Android Offline Runtime manifest 的 entrypoint 和内容版本
    验证 code-only、dependencies-only、all 更新及失败回滚
    验证通过后才允许 bundle 进入正式发布
```
