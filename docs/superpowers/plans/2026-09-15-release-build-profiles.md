# Release 配置与 APK 构建 profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 让服务器可选用 release/ 配置运行，并让 build:apk、build:apk:offline 和新增的 build:apk:noserver 使用固定 APK profile、独立中间目录、可配置功能/模型以及 results/index.json 中的 running 实例恢复。

**Architecture:** 新增一个无副作用的运行路径解析器，服务器通过 --release 或环境变量切换配置、用户配置和任务目录。APK 构建统一由 profile 编排器驱动，profile 从已有的 release/apkbuild/{noserver,withserver,allserver}/app.json 读取，服务器运行包、模型、任务 results 和 Gradle 构建目录都写入对应 profile。Android Runtime 安装器保留已有用户数据，并在首次安装后让现有 TaskManager.restoreAutoStartServices() 按任务结果索引恢复服务实例。

**Tech Stack:** Node.js node:test、Node fs/promises、Gradle Kotlin DSL、Android Kotlin、现有 Node Runtime manifest/SHA-256 校验和 Android assets 安装器。

**Spec:** docs/design/release-build-profiles.md、docs/spec/release-build-profiles.md

## Global Constraints

- npm start 不带 --release 时保持当前路径：config/、~/.config/aasc-user/ 和 res/tasks/。
- npm start -- --release 使用并写入 release/config/、release/userconfig/ 和 release/task/；发布输入缺失时必须失败，不得静默回退。
- build:apk 固定使用 release/apkbuild/withserver，build:apk:offline 固定使用 release/apkbuild/allserver，新增 build:apk:noserver 固定使用 release/apkbuild/noserver。
- 每个 profile 的 package/、runtime/、gradle/ 和 output/ 必须互不共享；上一次成功的 output 在本次构建失败时不得被删除或覆盖。
- app.json 只包含 schemaVersion、embeddedNode、features 和 models；不读取或新增 tasks 字段。
- APK 任务包必须包含 release/task 的任务定义、results/index.json、实例目录、日志和输出；首次启动只恢复 mode=service 且 status=running 的实例。
- results/latest 和 .task-links.json 等 Android assets 不支持的路径必须使用 marker 打包，并在安装到私有目录后恢复。
- noserver 只保留显示端，不打包或启动 Node Runtime、Node 服务器、任务和模型资产。
- APK 的模型选择通过 profile 的 models 稳定 ID 解析模型 manifest/目录清单，不再使用 OFFLINE_MODEL_FILES 固定白名单。
- Gradle/AAR 原生依赖不按 feature 删除；feature 只控制运行包、任务、模型资产和运行能力元数据。
- 所有 JavaScript 使用 const/let、async/await 和 try-catch；新增注释使用中文；不引入大段 if/else if 分支。
- 修改代码前先有对应 spec 伪代码；完成后更新 design、spec、task、todo 和 changelog；不自动提交 git，除非用户明确要求。

---

### Task 1: 统一服务器 release 运行路径

**Files:**
- Create: src/core/release-runtime-context.js
- Modify: src/apps/server/modules/config/config-app-service.js
- Modify: src/apps/server/modules/task-engine/task-io.js
- Modify: src/apps/server/boot/server-launcher.js
- Test: tests/release-runtime-context.test.js
- Test: tests/server-launcher.test.js

**Interfaces:**
- Produces resolveReleaseRuntimeContext({ projectRoot, homeDir, argv, environment }) -> { releaseMode, configFile, userConfigDir, taskDir }.
- Produces hasReleaseFlag(argv) -> boolean，只识别完整参数 --release。
- config-app-service.js 和 TaskIO 使用同一解析器；显式构造 new TaskIO({ tasksDir }) 的现有测试和调用继续优先使用传入值。

- [x] Step 1: Write the failing tests

在 tests/release-runtime-context.test.js 写入：

    test('没有 --release 时保留开发配置、用户配置和任务路径', () => {
        const context = resolveReleaseRuntimeContext({
            projectRoot: '/workspace/aasc',
            homeDir: '/home/tester',
            argv: ['node', 'server-launcher.js'],
            environment: {}
        });

        assert.deepEqual(context, {
            releaseMode: false,
            configFile: '/workspace/aasc/config/config.json',
            userConfigDir: '/home/tester/.config/aasc-user',
            taskDir: '/workspace/aasc/res/tasks'
        });
    });

    test('--release 和 AASC_RELEASE_MODE 都切换到 release 路径', () => {
        const byFlag = resolveReleaseRuntimeContext({
            projectRoot: '/workspace/aasc',
            homeDir: '/home/tester',
            argv: ['node', 'server-launcher.js', '--release'],
            environment: {}
        });
        const byEnvironment = resolveReleaseRuntimeContext({
            projectRoot: '/workspace/aasc',
            homeDir: '/home/tester',
            argv: ['node', 'server-app.js'],
            environment: { AASC_RELEASE_MODE: '1' }
        });

        assert.equal(byFlag.releaseMode, true);
        assert.equal(byFlag.configFile, '/workspace/aasc/release/config/config.json');
        assert.equal(byFlag.userConfigDir, '/workspace/aasc/release/userconfig');
        assert.equal(byFlag.taskDir, '/workspace/aasc/release/task');
        assert.deepEqual(byEnvironment, byFlag);
    });

在 tests/server-launcher.test.js 增加断言：使用 processArguments: ['--release'] 启动子进程时，spawnChild 收到的 env.AASC_RELEASE_MODE 为 '1'；不带该参数时不新增该环境变量。

- [x] Step 2: Run tests and verify the expected failure

Run:

    node --test tests/release-runtime-context.test.js tests/server-launcher.test.js

Expected: 新的 context 模块导入失败，或 release 路径断言失败；现有 launcher 测试保持通过。

- [x] Step 3: Implement the minimal resolver and wire the server

在 src/core/release-runtime-context.js 实现 hasReleaseFlag 和 resolveReleaseRuntimeContext。release 分支返回 release/config/config.json、release/userconfig、release/task；非 release 分支返回当前 config/config.json、home/.config/aasc-user、res/tasks。

config-app-service.js 在创建 Config/UserConfig 前根据 project root、process.argv 和 process.env 解析路径；release 模式调用 fs.statSync 校验三个输入，缺失时抛出带绝对路径的错误。TaskIO 默认任务目录读取 AASC_TASK_DIR，没有该变量时调用解析器，保留显式 options.tasksDir 优先级。server-launcher.js 在 fork 子进程时复制当前环境，并在参数包含 --release 时加入 AASC_RELEASE_MODE: '1'。

- [x] Step 4: Run the focused tests

    node --test tests/release-runtime-context.test.js tests/server-launcher.test.js src/apps/server/modules/task-engine/task-io.test.js

Expected: 全部通过，并且现有 TaskIO({ tasksDir }) 测试仍写入临时目录。

---

### Task 2: APK profile 和模型/任务结果资产解析

**Files:**
- Create: scripts/ops/apk-build-profile.js
- Create: tests/apk-build-profile.test.js
- Modify: scripts/ops/prepare-android-node-runtime.js
- Modify: tests/android-node-runtime-package.test.js
- Modify: docs/task/2026-09-15_Release配置与APK构建profile重构.md

**Interfaces:**
- Produces APK_PROFILES with exact mappings: withserver -> { offline: false, embeddedNode: true }, allserver -> { offline: true, embeddedNode: true }, noserver -> { offline: false, embeddedNode: false }.
- Produces loadApkProfile({ projectRoot, profile }) -> normalizedProfile，读取 release/apkbuild/<profile>/app.json。
- Produces resolveSelectedModelFiles({ modelRoot, modelIds }) -> [{ relativePath, sourcePath }]，按稳定模型 ID 返回文件集合。
- prepareAndroidNodeRuntime({ profile, modelIds, taskRoot, configFile, userConfigDir, ... }) 使用这些接口，不再直接遍历 OFFLINE_MODEL_FILES。

- [x] Step 1: Write the failing profile and asset tests

在 tests/apk-build-profile.test.js 覆盖：

    test('profile 映射使用已有目录且不读取 tasks 字段', async () => {
        const projectRoot = await makeFixtureProject({
            'release/apkbuild/allserver/app.json': JSON.stringify({
                schemaVersion: 1,
                embeddedNode: true,
                features: ['llm'],
                models: ['qwen-test'],
                tasks: ['must-not-be-read']
            })
        });
        const profile = await loadApkProfile({ projectRoot, profile: 'allserver' });

        assert.equal(profile.embeddedNode, true);
        assert.equal(profile.offline, true);
        assert.deepEqual(profile.models, ['qwen-test']);
        assert.equal(Object.hasOwn(profile, 'tasks'), false);
    });

    test('noserver 禁止 embeddedNode', async () => {
        const projectRoot = await makeFixtureProject({
            'release/apkbuild/noserver/app.json': JSON.stringify({
                schemaVersion: 1,
                embeddedNode: true,
                features: [],
                models: []
            })
        });

        await assert.rejects(
            () => loadApkProfile({ projectRoot, profile: 'noserver' }),
            /noserver.*embeddedNode/u
        );
    });

在 tests/android-node-runtime-package.test.js 增加 fixture：模型目录包含两个可选模型、一个 test_wavs 子目录、任务 results/index.json、实例日志和 latest 软链接；断言只根据 modelIds 收集选择模型，同时保留任务 results。

- [x] Step 2: Run the new tests to verify they fail

    node --test tests/apk-build-profile.test.js tests/android-node-runtime-package.test.js

Expected: profile 模块不存在或当前 Runtime 仍固定使用 OFFLINE_MODEL_FILES，新断言失败。

- [x] Step 3: Implement profile validation and model discovery

loadApkProfile 校验：文件存在、JSON 是对象、schemaVersion === 1、embeddedNode 是 boolean、features/models 是字符串数组且无重复；只返回规范化的 profile、offline、embeddedNode、features、models、buildRoot。

模型解析规则：

    modelId 是 LLM manifest.models[].modelId：
        包含 res/models/llm/manifest.json 和 res/models/llm/<directory>/ 下 manifest.files 声明的文件
    modelId 是 res/models 下的一级目录：
        递归包含该目录内普通文件，排除 test_wavs、.mmap、.mmap.* 和 results
    modelId 不符合上述规则：
        构建失败并指出 modelId 与 modelRoot

对 .manifest.json 使用现有 bundled-manifest.json asset 映射；不把模型文件路径从代码中固定成 43 项数组。prepareAndroidNodeRuntime 接受 modelIds，模型列表为空时不复制模型；任务复制函数改为保留所有 results 普通文件，并单独处理 latest 与 .task-links.json marker。构建时解析每个 results/index.json，必须是 { instances: [] } 结构且每个实例至少包含 instanceId、status；损坏索引立即失败。

- [x] Step 4: Verify profile and asset packaging

    node --test tests/apk-build-profile.test.js tests/android-node-runtime-package.test.js

Expected: profile 校验、模型选择、任务定义、results/index.json、日志、输出和 marker 全部通过；未选择模型和损坏索引分别触发明确错误。

---

### Task 3: Release 输入、APK 构建编排和独立中间目录

**Files:**
- Create: scripts/ops/build-apk.js
- Create: scripts/ops/prepare-android-server-package.js
- Create: tests/apk-build-orchestrator.test.js
- Modify: scripts/ops/build-offline-apk.js
- Modify: package.json

**Interfaces:**
- Produces buildApk({ projectRoot, profileName, commandRunner }) -> { apkPath, profile, manifest }.
- Produces prepareAndroidServerPackage({ projectRoot, outputDir }) -> packageDir，将当前服务器源码和生产依赖写入 profile 的 package/。
- build:apk 调用 buildApk({ profileName: 'withserver' })；build:apk:offline 调用 allserver；build:apk:noserver 调用 noserver。

- [x] Step 1: Write failing command/profile tests

在 tests/apk-build-orchestrator.test.js 写入：

    test('npm 脚本固定映射三个 release APK profile', () => {
        const scripts = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).scripts;

        assert.match(scripts['build:apk'], /build-apk\\.js.*withserver/u);
        assert.match(scripts['build:apk:offline'], /build-apk\\.js.*allserver/u);
        assert.match(scripts['build:apk:noserver'], /build-apk\\.js.*noserver/u);
    });

    test('profile 中间目录按 profile 隔离', () => {
        const plan = createApkBuildPlan({ projectRoot: '/repo', profileName: 'allserver' });

        assert.equal(plan.buildRoot, '/repo/release/apkbuild/allserver');
        assert.equal(plan.packageDir, '/repo/release/apkbuild/allserver/package');
        assert.equal(plan.runtimeDir, '/repo/release/apkbuild/allserver/runtime');
        assert.equal(plan.gradleDir, '/repo/release/apkbuild/allserver/gradle');
        assert.equal(plan.outputDir, '/repo/release/apkbuild/allserver/output');
    });

- [x] Step 2: Run the tests and verify the expected failure

    node --test tests/apk-build-orchestrator.test.js

Expected: 新编排器和 build:apk:noserver 尚不存在。

- [x] Step 3: Implement the orchestrator and package preparation

createApkBuildPlan 根据 profile 返回独立的 packageDir/runtimeDir/gradleDir/outputDir；构建失败只删除本次生成的临时目录，不删除已存在的 output/。服务器包准备过程执行：

    创建 profile/package.tmp-<pid>-<timestamp>
    复制 src、package.json、package-lock.json，排除 src/apps/android-display 和不兼容的桌面依赖目录
    执行 npm ci --omit=dev --ignore-scripts
    校验 src/apps/server/boot/server-launcher.js、package.json、package-lock.json 和 express 入口
    原子改名为 profile/package

如果 AASC_ANDROID_NODE_PACKAGE_DIR 显式存在，则只把它作为兼容输入，不改变输出目录隔离；否则自动生成 profile/package。buildApk 在 embeddedNode=false 时跳过服务器包和 Runtime 准备；其余 profile 将 release 配置文件、release 用户配置目录和 release 任务目录传给 Runtime 准备器，并把 modelIds 传给模型收集器。

Gradle 调用统一传递 -PaascProfile=<profileName>、-PaascOffline=<true|false>、-PaascEmbeddedNode=<true|false>、-PaascBuildDirectory=<profile/gradle>、-PaascNodeRuntimeAssetsDir=<profile/runtime/assets> 和 -PaascNodeRuntimeJniLibsDir=<profile/runtime/jniLibs>。build-offline-apk.js 保留 buildOfflineApk() 导出，但内部委托 buildApk({ profileName: 'allserver' })，避免已有调用断裂。

- [x] Step 4: Run command-level tests and static checks

    node --test tests/apk-build-orchestrator.test.js tests/server-release-service.test.js
    node --check scripts/ops/build-apk.js
    node --check scripts/ops/prepare-android-server-package.js

Expected: 全部通过；不执行大体积 APK 构建。

---

### Task 4: Gradle profile 和 Android noserver/任务结果恢复

**Files:**
- Modify: src/apps/android-display/app/build.gradle.kts
- Modify: src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt
- Modify: src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt
- Modify: src/apps/android-display/app/src/test/java/com/aasc/display/NodeServerServiceTest.kt
- Modify: tests/android-offline-apk.test.js
- Create: src/apps/android-display/app/src/test/java/com/aasc/display/ApkBuildProfileTest.kt

**Interfaces:**
- Gradle exposes resources aasc_offline_mode and aasc_embedded_node plus configurable build directory and assets/jniLibs source directories.
- MainActivity only starts NodeServerService when aasc_embedded_node is true；noserver 保持远程 /display 连接。
- NodeRuntimeInstaller restores config/userconfig/task result seeds and latest/task-link markers without replacing existing user files.

- [x] Step 1: Write failing Android/static tests

在 tests/android-offline-apk.test.js 增加：

    test('Gradle 支持 embeddedNode 和 profile 独立 build directory', () => {
        const gradle = read('src/apps/android-display/app/build.gradle.kts');
        const activity = read('src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt');

        assert.match(gradle, /aasc_embedded_node/u);
        assert.match(gradle, /aascBuildDirectory|aascBuildDir/u);
        assert.match(activity, /aasc_embedded_node|embeddedNode/u);
        assert.match(activity, /startForegroundService[\\s\\S]*embeddedNode/u);
    });

    test('Runtime 安装器恢复 task results marker', () => {
        const installer = read('src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt');

        assert.match(installer, /results\\/latest/u);
        assert.match(installer, /task-links/u);
        assert.match(installer, /status.*running|restoreAutoStartServices/u);
    });

在 Android JVM 测试中覆盖 embeddedNode=false 时 Node 启动命令不被调用的配置决策，以及 results/index.json 中 running service 的恢复输入保持原 instanceId、params 和 entryFile。

- [x] Step 2: Run tests to verify the expected failure

    node --test tests/android-offline-apk.test.js
    cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --no-daemon

Expected: 新的 Gradle/profile 和 marker 断言失败；现有 Android tests 不因测试环境错误失败。

- [x] Step 3: Implement Gradle and Android behavior

在 build.gradle.kts 从 Gradle 属性读取 aascEmbeddedNode、aascProfile、aascBuildDirectory、aascNodeRuntimeAssetsDir 和 aascNodeRuntimeJniLibsDir；将 layout.buildDirectory 指向 profile 的 gradle/，将 Node assets/jniLibs source set 仅在 embeddedNode=true 时加入，并写入 resValue("bool", "aasc_embedded_node", ...)。

在 MainActivity 读取 aasc_embedded_node：

    embeddedNode=false:
        不启动 NodeServerService
        不注册 Node 状态广播
        隐藏本地控制端按钮和 offline 启动遮罩
        仍使用用户输入或已保存地址加载主服务器 /display

    embeddedNode=true:
        保持普通/Offline 现有连接、控制端和 Runtime 安装流程

在 NodeRuntimeInstaller 中增加：

    config/config.json 不存在时，从 release-config asset 写入
    home/.config/aasc-user/<relative> 不存在时，从 release-userconfig asset 写入
    res/tasks 下不存在对应任务文件时写入任务定义、results/index.json、实例目录和日志
    latest marker 内容是安全的 instanceId 时重建 results/latest
    task-links marker 是 JSON 对象时重建 .task-links.json

已有目标文件不覆盖；marker 只有在目标目录内、目标 instanceId 已存在且路径校验通过时才创建软链接。安装完成后不额外实现一套恢复循环，继续由现有 server-app -> taskManager.restoreAutoStartServices() 读取 results/index.json。

- [ ] Step 4: Run Android unit and static tests（静态测试通过；Gradle 受 `AASC_MNN_ROOT` 缺失阻断）

    node --test tests/android-offline-apk.test.js tests/android-node-runtime-package.test.js
    cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --no-daemon

Expected: 静态契约和 Android JVM 测试全部通过；noserver 不再引用生成的 Node assets 目录。

---

### Task 5: Profile 配置样例、文档、完整验证和收尾记录

**Files:**
- Create: release/apkbuild/noserver/app.json
- Create: release/apkbuild/withserver/app.json
- Create: release/apkbuild/allserver/app.json
- Create: docs/task/2026-09-15_Release配置与APK构建profile重构.md
- Modify: docs/design/release-build-profiles.md
- Modify: docs/spec/release-build-profiles.md
- Modify: docs/todo.md
- Modify: changelog.md
- Test: tests/release-build-profiles.integration.test.js

**Interfaces:**
- 样例配置是用户可以直接编辑的 release 输入；默认任务选择不写入 app.json。
- 集成测试只使用临时 fixture，不读取或覆盖当前用户的 release/ 和 res/ 数据。

- [x] Step 1: Add the three profile configuration files

写入以下明确内容：

    release/apkbuild/noserver/app.json
    {
      "schemaVersion": 1,
      "embeddedNode": false,
      "features": ["display"],
      "models": []
    }

    release/apkbuild/withserver/app.json
    {
      "schemaVersion": 1,
      "embeddedNode": true,
      "features": ["display", "asr", "tts", "llm"],
      "models": []
    }

    release/apkbuild/allserver/app.json
    {
      "schemaVersion": 1,
      "embeddedNode": true,
      "features": ["display", "asr", "tts", "llm", "render-display"],
      "models": ["qwen3.5-0.8b-claude-opus-distilled-mnn", "sensevoice", "tts"]
    }

这些文件不声明 tasks；需要启动的任务由 release/task/**/results/index.json 中的 status=running 实例决定。

- [x] Step 2: Write the failing integration test

在 tests/release-build-profiles.integration.test.js 使用临时目录组装：

    release/config/config.json
    release/userconfig/userconfig.json
    release/task/demo-service/task.js
    release/task/demo-service/results/index.json
    release/task/demo-service/results/demo-1/run.log
    release/task/demo-service/results/latest -> demo-1
    release/apkbuild/allserver/app.json

断言 release context 指向这些路径，profile 解析不包含 tasks，资产 manifest 包含 demo-service/results/index.json 和 demo-1/run.log，并包含选定模型、不包含未选模型。先运行测试确认当前实现不能满足这些断言。

- [x] Step 3: Update task/design/spec/changelog records

在 task 文档记录任务描述、design 需求、spec 伪代码、受影响文件、自测用例、兼容性/性能/Risk、预计工时和执行结果。同步更新 design/spec 中的实际路径、marker、profile 配置与 running 恢复规则；从 docs/todo.md 删除本任务的进行中条目；在 changelog.md 记录三种 APK 命令、release 启动参数、任务 results 恢复和模型裁剪行为。

- [ ] Step 4: Run the focused and full verification（定向 Node 54/54；全量 772/773，Android Gradle 受环境阻断）

    node --test \
      tests/release-runtime-context.test.js \
      tests/server-launcher.test.js \
      tests/apk-build-profile.test.js \
      tests/apk-build-orchestrator.test.js \
      tests/release-build-profiles.integration.test.js \
      tests/android-node-runtime-package.test.js \
      tests/android-offline-apk.test.js
    cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --no-daemon
    cd /mnt/AASC && npm test
    git diff --check

Expected: 本次新增和修改相关测试全部通过；若全量测试中出现之前已知的无关 Windows 输入声纹策略失败，记录具体测试名和断言，不得声称全量通过。

- [ ] Step 5: Verify actual build inputs without changing user data（缺少 release 输入和 `AASC_MNN_ROOT`，未执行实际 APK 构建）

在 release/config/config.json、release/userconfig 和 release/task 已由用户准备后依次执行：

    npm run build:apk:noserver
    npm run build:apk
    npm run build:apk:offline

检查三个 profile 的 output/、Gradle 目录和 Runtime manifest 不互相引用；使用 zipinfo -t 校验 APK；Offline APK 检查 results/index.json、running service 的 instanceId、模型文件和首次启动恢复日志。构建只使用当前 release 输入，不删除 release/ 或已有 APK 用户数据。
