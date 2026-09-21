# 控制端运行版本显示实现规范

## 服务端伪代码

```text
函数读取 JSON 文件(文件路径):
    如果文件不存在、无法解析或不是对象:
        返回空值
    返回对象

函数读取运行版本(项目根目录, 可选代码根目录, 可选 Node 依赖根目录, 可选 APK 版本, 可选显示端版本):
    packageVersion = 读取项目根目录/package.json.version
    activeRelease = 读取项目根目录/updates/active-release.json
    bundledBaseline = 读取项目根目录/offline-update-client.json
    release = activeRelease 或 bundledBaseline 或空对象
    codeRoot = 可选代码根目录 或项目根目录
    nodeModulesRoot = 可选 Node 依赖根目录 或环境变量 AASC_NODE_MODULES_DIR 或项目根目录/node_modules

    apkVersion = 非空 APK 版本 或 packageVersion 或 unknown
    codeVersion = release.codeVersion 格式化为 v数字
    dependencyVersion = release.dependencyVersion 格式化为 v数字
    displayVersion = 调用方传入的显示端版本，缺失时为未提供
    dependencySource = activeRelease 存在时：
        如果 activeRelease.legacyDependencies 为 true，则为 legacy-root
        否则为 active-release
      activeRelease 不存在但 bundledBaseline 存在时为 bundled-baseline
      两者都不存在时为 package-root

    返回 {
        apk: apkVersion,
        code: codeVersion,
        dependencies: dependencyVersion,
        display: displayVersion,
        codePath: codeRoot 的绝对路径,
        dependenciesPath: nodeModulesRoot 的绝对路径,
        dependencySource: dependencySource
    }

注册主 AASC 节点时:
    metadata.versions = 读取运行版本(
        projectRoot = PROJECT_ROOT,
        codeRoot = CODE_ROOT,
        nodeModulesRoot = NODE_MODULES_ROOT,
        ...
    )

处理 GET /api/status 时:
    返回原有状态字段
    返回 versions = 读取运行版本(
        projectRoot = PROJECT_ROOT,
        codeRoot = CODE_ROOT,
        nodeModulesRoot = NODE_MODULES_ROOT,
        ...
    )
```

## 控制端伪代码

```text
服务器列表加载成功:
    保存服务器数组
    找到当前 origin 对应节点；找不到时使用第一个节点
    从节点 metadata.versions 或节点 versions 读取版本
    在当前运行版本摘要区域渲染 APK、服务代码、依赖、显示端、服务代码路径、依赖路径和依赖来源
    每个服务器卡片的版本字段使用同一格式化函数

如果节点没有新版本对象:
    显示旧的 server.version 字段

版本字段作为文本转义后渲染
```

## 验证伪代码

```text
临时项目同时存在 active-release 和内置基线:
    断言使用 active-release 的 code/dependency 版本

临时项目只有内置基线:
    断言回退到内置基线

调用方传入独立代码根目录和依赖根目录:
    断言返回 codePath 和 dependenciesPath 的绝对路径
    断言依赖来源与 active-release.legacyDependencies 一致

服务器列表 fixture 提供 metadata.versions:
    断言服务器卡片显示服务代码版本
    断言服务器卡片显示服务代码路径和依赖路径
    断言控制端 HTML 存在当前运行版本摘要节点
```
