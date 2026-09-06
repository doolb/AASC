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
