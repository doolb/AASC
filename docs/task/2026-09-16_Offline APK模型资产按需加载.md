# Offline APK 模型资产按需加载

## 任务描述

当前 offline APK 将 LLM 权重随 Node Runtime 一起解包到 `files/aasc-server/res/models/llm`。这会让服务端目录持有一份大模型文件，且 Node Runtime 安装流程需要处理不属于服务端的推理资源。本任务保留 APK 内置模型能力，将 LLM 作为显示端资产按需物化；当前不处理 `.mmap` 预生成或 MNN AssetManager 直读。

## Design 需求

- 使用独立 `display-models/<modelId>/` APK asset 命名空间。
- Node Runtime manifest 区分可安装 `files` 和仅随 APK 分发的 `modelAssets`。
- server 只保留 LLM 清单和 offline-ready 元数据，不释放 LLM 权重。
- display 首次加载时复制到 `files/models/llm/bundled/<modelId>`，校验后原子切换。
- offline `/v1` 路由仍将请求转发给 display，不因为 Node 本地无权重拒绝 ready。

## Spec 设计

伪代码和字段契约见 `docs/spec/android-offline-model-assets.md`：打包生成 `offline-model-manifest.json`，Android 安装器只处理 `manifest.files`，MNN 管理器通过 `AssetManager` 懒加载 bundled 模型。

## 受影响功能模块和代码

- APK 构建：`scripts/ops/prepare-android-node-runtime.js`、profile 模型资源选择。
- Android Runtime：`NodeRuntimeManifest.kt`、`NodeRuntimeInstaller.kt`、`MnnLlmModelManager.kt`。
- Node LLM：`llm-model-manifest-service.js`、`server-app.js`。
- 测试：Node Runtime/APK 集成、LLM manifest、Android JVM 单元测试。

## 自测用例

1. offline 打包后模型权重出现在 `display-models`，不出现在 `manifest.files` 和 `server/res/models`。
2. offline 模型元数据和 `modelAssets` 的路径、大小、hash 完整且无重复。
3. Runtime 安装器快速复用不要求 `res/models/llm/<model>` 文件存在。
4. 显示端首次加载物化模型，第二次加载复用缓存；损坏缓存会重建。
5. offline `/v1/models` 对内置模型返回 ready，下载 API 不伪装成 Node 本地文件服务。
6. 真实 APK 安装、启动、聊天回复和 Node Runtime 目录检查。

## 兼容性测试

- 旧格式无 `modelAssets` 的 online manifest 仍可解析。
- offline 旧格式 `offline-model-manifest.files` 仍可被安装器识别，便于升级失败回退。
- Android API 28、arm64-v8a、现有 MNN native ABI。
- online APK 的 `active` 下载模型流程不变。

## 性能测试

- 对比首次启动：Node Runtime 解包不再复制 LLM 权重。
- 记录首个 LLM 请求的 asset 物化耗时和后续缓存命中耗时。
- 确认 `.mmap` 仍只在首次 MNN 加载/推理阶段按当前策略产生。

## 风险评估

- MNN 当前 API 需要普通文件路径，因此首次推理仍有一次显示端模型物化成本；这是本阶段接受的兼容折中。
- offline ready 是“显示端资产可用”语义，不能让 Node 下载接口直接读取不存在的服务器文件。
- 构建产物 APK 总大小基本不变；收益主要是服务端私有目录不重复持有模型和首包 Runtime 解包路径变短。
- 模型资产损坏时必须阻止 MNN 加载并保留可重试状态。

## 预计工时

约 4-6 小时，包括 Node/Android 测试、Gradle 构建和真机短聊天回归。

## 实施结果

- 将 9 个 Qwen 运行文件打入 APK `assets/display-models/<modelId>/`；Node Runtime 仅保留 `res/models/llm/manifest.json` 和 `offline-model-manifest.json` 元数据，不复制 Qwen 权重。
- 显示端从 AssetManager 读取模型并校验 size/SHA-256，物化到 `files/models/llm/bundled/<modelId>`；首次实现遗漏最终目录父级创建，真机复现后增加创建步骤及静态回归断言。
- 真机安装包：`release/apkbuild/allserver/output/aasc-display-offline.apk`，大小 `958958767` bytes，SHA-256 `dae3137a20539750b8f84c6604ea336413a3a4de3cde0efbf94c7aa5e8b8910f`；设备 APK hash 相同。
- 真机 `192.168.1.6:5555` / SM-N9500 / Android 9 / display 2：Node HTTPS 8081 正常；`/v1/models` 对默认 Qwen 报告 `display-kxou6him` ready；`/v1/chat/completions` 可到达本机推理并返回 HTTP 200，128 token 探测得到非空正文。16/256 token 探测得到空正文，符合关闭思考时过滤器丢弃未闭合 think 输出的既有边界；本任务不扩展修改聊天输出逻辑。
- 文件检查确认 `files/aasc-server/res/models/llm` 只有 `manifest.json`，权重位于 `files/models/llm/bundled/<modelId>`。MNN 在正常加载/推理时生成了该显示端目录内的 `.mmap`；本任务未预生成、调整或删除 `.mmap`。
- 验证：Node 定向测试 38/38、Android JVM 单测 143 项通过；offline APK 构建及真机安装通过。
