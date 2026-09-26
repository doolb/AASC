# Release 配置与 APK 构建 profile 实现规范

## 输入目录约定

```text
release/
├── config/config.json
├── userconfig/userconfig.json
├── task/<taskName>/
│   ├── task.js 或 service.js
│   ├── config.json
│   └── results/
│       ├── index.json
│       ├── <instanceId>/
│       └── latest
└── apkbuild/
    ├── noserver/app.json
    ├── withserver/app.json
    └── allserver/app.json
```

## 发布上下文解析

```text
resolveServerRuntimeContext(arguments, environment):
    如果 arguments 包含 --release 或 environment.AASC_RELEASE_MODE == "1":
        返回 {
            releaseMode: true,
            configFile: projectRoot + "/release/config/config.json",
            userConfigDir: projectRoot + "/release/userconfig",
            taskDir: projectRoot + "/release/task"
        }
    否则:
        返回当前 config/config.json、~/.config/aasc-user 和 res/tasks 路径

validateReleaseContext(context):
    如果 releaseMode == true:
        要求 configFile 是普通文件
        要求 userConfigDir 是目录
        要求 taskDir 是目录
        任一输入缺失 → 抛出带具体路径的错误
```

## npm 服务器启动

```text
npm start:
    server-launcher 读取 process.argv
    如果包含 --release:
        为 server-app 子进程设置 AASC_RELEASE_MODE=1
    保持现有 launcher 参数、重启和停止行为

server-app 加载 config-app-service 和 TaskManager:
    根据统一上下文选择配置文件、用户配置目录和任务目录
    无 --release → 使用原有路径
    有 --release → 读写 release 路径
```

## APK profile 选择

```text
build:apk:
    profile = "withserver"
    offline = false
    release = true

build:apk:offline:
    profile = "allserver"
    offline = true
    release = true

build:apk:noserver:
    profile = "noserver"
    embeddedNode = false
    release = true

buildApk(profile):
    source = readGitSourceMetadata(projectRoot)
    执行 profile 原有 APK 构建流程
    build-manifest.source = {
        gitCommit: source.gitCommit,
        gitDirty: source.gitDirty
    }

upload:apk:
    先执行 build:apk
    从 release/apkbuild/withserver/output/aasc-display.apk 上传和安装
    不读取旧的 app/build/outputs/apk/debug/app-debug.apk
```

```text
loadApkProfile(profile):
    读取 release/apkbuild/<profile>/app.json
    校验 schemaVersion、embeddedNode、features 和 models
    不读取 tasks 字段，也不使用 tasks 字段决定实例
    返回规范化 profile
```

## APK app.json

```text
app.json:
    schemaVersion = 1
    embeddedNode = true 或 false
    features = 功能 ID 数组
    models = 模型 ID 数组
    verifyRuntime = true 或 false（解析缺省为 true；offline allserver 正式配置为 false）

校验规则:
    noserver 的 embeddedNode 必须为 false
    noserver 的 models 必须为空数组
    models 中每个 ID 必须能在模型 manifest 或受支持模型目录清单中解析
    目录型模型扫描跳过 .gitkeep 占位文件；模型 manifest 声明的 .manifest.json 仍需保留并映射为可打包名称
    features 和 models 不允许重复项
    verifyRuntime 缺省为 true；allserver 的正式 app.json 默认关闭校验；非布尔值 → 构建失败
    不存在或格式错误 → 构建失败
```

## 任务和 results 打包

```text
prepareTaskAssets(release/task, output):
    遍历 release/task 下的所有任务目录
    复制任务定义、config.json、results/index.json、实例目录、日志和输出文件
    不用 tasks 配置筛选任务
    results/latest 如果是软链接:
        读取软链接目标并写入可打包的 latest marker，记录目标 instanceId
    results/latest 如果是普通文件:
        读取去除首尾空白后的实例 ID
        写入可打包的 latest marker，记录目标 instanceId
    results/latest 不作为普通 APK asset 复制，避免安装后遮挡恢复出的软链接
    .task-links.json 如果存在:
        写入可打包的 task-links marker
    拒绝路径穿越和不支持的文件类型
```

```text
installRuntime(staging, root):
    完整校验 runtime manifest 后原子切换 staging 为 root
    manifest.verifyRuntime == true:
        校验每个 Runtime 文件的存在、大小和 SHA-256
    manifest.verifyRuntime == false:
        仅校验每个 Runtime 文件存在且为普通文件，跳过 SHA-256 内容校验
    保留已安装 root 的用户可变目录
    新设备首次安装时写入 release 配置、用户配置和任务结果
    将 latest marker 恢复为 results/latest 软链接
    latest marker 指向的实例目录不存在时创建空实例目录；若目标是普通文件则失败
    将 task-links marker 恢复为 .task-links.json

server-app 启动:
    TaskManager.listTasks 读取每个 results/index.json
    对 mode == "service" 且 status == "running" 的实例调用 restoreAutoStartServices
    stopped/completed/failed 实例只保留记录，不启动
```

## release 配置传入 APK

```text
prepareReleaseSeeds:
    release/config/config.json → release-config.json，并兼容生成 offline-config.json
    release/userconfig/* → 初始用户配置资产
    已安装 root/config/config.json 存在 → 不覆盖
    已安装 root/home/.config/aasc-user/* 存在 → 不覆盖
    release/task/* → root/res/tasks/*
```

配置中的主服务器地址、LLM profile、ASR/TTS 路由和其他可序列化运行参数随 release 配置进入首次安装种子；NodeServerConfig 只覆盖 APK 必须的本地端口、节点角色、节点 ID 和 native ASR/TTS 禁用规则。

## APK 中间目录

```text
release/apkbuild/<profile>/:
    app.json          # 用户维护的 profile 配置
    package/          # 服务器运行包输入
    runtime/          # Node Runtime 和 assets staging
    gradle/           # 该 profile 独立的 Gradle build directory
    output/           # APK、manifest、hash 和构建日志
```

构建过程使用临时目录完成原子替换；不同 profile 不共享 package、assets、Gradle cache 或最终 APK 文件。

## noserver 行为

```text
如果 embeddedNode == false:
    Gradle 不添加 Node Runtime assets 和 jniLibs
    MainActivity 不启动 NodeServerService
    不创建本地控制端和本地 Node 启动遮罩
    构建器不校验或打包 release/config、release/userconfig、release/task
    WebView 仍按用户输入连接主服务器 /display
```

## 错误处理

```text
release 输入缺失、app.json 无效、模型不存在、results/index.json 无法解析:
    构建命令返回非零状态
    输出 profile、字段和具体路径
    不覆盖上一次成功的 profile output
```

## 验收用例

| 场景 | 预期 |
|---|---|
| `npm start` | 原路径和原行为不变 |
| `npm start -- --release` | 配置、用户数据和任务结果读写 `release/` |
| `build:apk` | 使用 `withserver` 独立目录并包含 Node 子服务器 |
| `build:apk:offline` | 使用 `allserver` 独立目录，内置选择模型并恢复 running 服务实例 |
| `build:apk:noserver` | 使用 `noserver` 独立目录，不含 Node 服务，仅显示端 |
| release task 含 stopped/completed 实例 | 保留 results，但首次启动不运行 |
| release task 含 running service 实例 | 首次启动恢复该实例 |
| 不同 profile 连续构建 | 中间文件和输出互不覆盖 |
