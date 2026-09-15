# offline llm-server 自动启动与原生语音模型复用

## 任务描述

修复 offline APK 中 `target=server` 被 Android 能力策略整体拒绝的问题，使不创建外部子进程的 `llm-server` 服务任务可以在当前 Node 进程内运行；将 `/v1` 路由所有权收敛到 `llm-server`；offline 启动时自动创建并运行该服务实例；首次安装时同步当前聊天配置；原生 ASR/TTS 优先复用 `files/aasc-server/res/models`，避免在 `files/models` 再产生一份相同资源。

## Design 需求

- Android 只禁止需要 Node/Puppeteer 等任务 Runner 或其他外部子进程的服务端任务。
- `llm-server` 使用任务上下文注册四个 OpenAI 兼容 `/v1` 路由；服务未运行时固定路由返回结构化 `503`。
- offline `server-app` 在恢复历史服务后确保存在一个 running 的 `llm-server` 服务实例。
- 构建时从当前 `config/config.json` 只提取 `llm`、`chat` 作为首次安装配置种子；已有设备配置不可覆盖。
- offline 原生 ASR/TTS 直接加载 `files/aasc-server/res/models/sensevoice`、`files/aasc-server/res/models/tts`；online 下载路径保持不变。

## Spec 设计

```text
TaskManager.runInstance:
  Android + server target + service mode -> 当前进程 _runServiceTask
  Android + 需要 Runner 的 server task -> 返回不支持子进程错误

offline 启动:
  restoreAutoStartServices()
  ensureBuiltinServiceInstance("llm-server", target="server", mode="service")

HTTP:
  taskManager.handleHttpRoute 优先
  llm-server 注册 /v1/models、/v1/chat/completions、/v1/responses、/v1/chat/responses
  未注册 -> 503

模型:
  offline ASR/TTS -> files/aasc-server/res/models/<name>
  online ASR/TTS -> files/models/<name>
```

## 受影响功能模块和代码

- `src/apps/server/modules/task-engine/task-manager.js`：Android 服务任务执行边界、内置服务自动确保。
- `src/apps/server/boot/server-app.js`：offline 自动启动、`/v1` 503 兜底、Android 错误描述。
- `src/apps/android-display/app/src/main/java/com/aasc/display/AsrModelManager.kt`：支持注入 offline 模型目录并保护内置资源。
- `src/apps/android-display/app/src/main/java/com/aasc/display/TtsModelManager.kt`：支持内置 manifest/hash 校验和直接加载。
- `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`：offline ASR/TTS 目录注入。
- `scripts/ops/prepare-android-node-runtime.js`：生成 `offline-config.json` 配置种子。
- `src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt`：首次安装配置种子写入且不覆盖用户配置。
- `tests/task-route-llm-contract.test.js`、任务引擎测试、`tests/android-node-runtime-package.test.js`、`tests/android-offline-apk.test.js`：契约和打包回归。
- 对应 `docs/design`、`docs/spec`、`docs/todo.md`、`changelog.md`。

## 自测用例

1. Android 禁止 Runner 时，`llm-server` 服务实例可创建、运行、注册和停止四个路由。
2. Android 禁止 Runner 时，普通需要子进程的 server task 返回明确错误。
3. offline server-app 启动会自动确保唯一 running 的 `llm-server` 实例，重复调用不创建重复实例。
4. `llm-server` 未运行时四个 `/v1` 路径返回结构化 503，运行后由任务路由处理。
5. offline 配置种子只包含 `llm`、`chat`，已有 config 不覆盖。
6. offline ASR/TTS 使用 `aasc-server/res/models`，online 仍使用 `files/models`。
7. offline APK 构建、Android JVM 单元测试、Node 定向测试和 `git diff --check` 通过。

## 兼容性测试

- Android 9/API 28、arm64-v8a、Display 2。
- 普通 online APK 不自动创建 `llm-server`，ASR/TTS 下载缓存行为不变。
- 已有 offline 用户配置、模型和任务结果升级时保留。
- 旧控制端继续看到任务状态和结构化 HTTP 错误。

## 性能测试

- 首次解包增加一个小型配置种子，不复制模型权重。
- offline ASR/TTS 首次加载不经过网络；只在模型校验/引擎加载阶段读取已解包文件。
- `llm-server` 自动启动只创建服务实例，不新增监听端口或子进程。

## 风险评估

- 如果内置模型文件损坏，ASR/TTS 会进入 error 并保留资源，不自动下载；可通过重新安装或后续修复包恢复。
- 如果历史配置存在，APK 中的新聊天配置不会覆盖用户选择，这是有意的升级保护。
- 非服务端 Android 任务仍不支持需要外部 Runner 的执行；需在错误中明确提示。

## 预计工时

约 4 小时，包含代码、契约测试、APK 构建和 Display 2 冒烟验证。

## 执行记录

- 设计和伪代码：已更新。
- 代码与测试：已完成。
  - `node --test tests/task-route-llm-contract.test.js tests/task-engine-android-service.test.js tests/android-node-runtime-package.test.js tests/android-offline-apk.test.js`：35/35 通过。
  - `./gradlew --console=plain :app:testDebugUnitTest`：136/136 通过。
  - `npm run build:apk:offline`：构建成功；APK 内含完整生产依赖、`parseurl`、offline 配置种子、LLM/ASR/TTS 资源和新版服务端路由。
  - SM-N9500 Android 9/API 28、arm64-v8a、Display 2：清理数据后安装启动成功；运行时解包完成，Node 进程稳定，日志确认自动创建并运行 `llm-server`，显示端连接成功。
  - 真机接口：`/api/asr/status`、`/v1/models`、`/v1/chat/completions`、`/v1/responses`、`/api/asr/recognize`、`/api/tts/generate` 均成功；默认模型为 `qwen3.5-0.8b-claude-opus-distilled-mnn`。
  - 真机文件核验：ASR/TTS 位于 `files/aasc-server/res/models/{sensevoice,tts}`；`files/models/sensevoice`、`files/models/tts` 均不存在；已有 `llm`/`chat` 配置种子已合并写入配置文件。
