# Plan: Android offline 模型资产按需加载

## Goal

让 offline APK 保留内置 MNN 模型能力，但不把 LLM 权重解包到 Node 服务目录；显示端按需从 APK assets 物化到自己的模型缓存后推理。

## Implementation steps

1. [x] 先在 Node Runtime、LLM manifest 和 APK 静态契约测试中写出新的失败断言：`modelAssets`/`display-models` 分类、offline-ready 元数据、Android manifest 解析和显示端 cache 路径。
2. [x] 修改 `prepare-android-node-runtime.js`：将 LLM 权重移到 `display-models/<modelId>`，生成 `offline-model-manifest.json`，把模型资产加入 `runtime-manifest.modelAssets` 和内容版本指纹；语音模型与服务器清单保持原有安装路径。
3. [x] 修改 `NodeRuntimeManifest.kt` 与 `NodeRuntimeInstaller.kt`：解析可选 `modelAssets`，安装/快速复用只依赖 `files` 和小型 offline 元数据，不复制模型资产，并保留旧格式兼容。
4. [x] 修改 `LlmModelManifestService` 和 `server-app.js`：offline 读取元数据中的内置 model ID，公开 manifest 报告 ready；实际下载仍要求服务器缓存文件完整。
5. [x] 修改 `MnnLlmModelManager.kt`：从 `AssetManager` 读取模型元数据，将内置模型原子复制到 `files/models/llm/bundled`，校验后复用；修正首次落盘时缺少 bundled 父目录的问题；在线 active 下载路径和 `.mmap` 预生成行为不变。
6. [x] 运行 Node 定向测试（38/38）、Android JVM 测试（143 项）、APK 构建和真机安装；确认 Node Runtime 目录不含 LLM 权重、`/v1` 聊天返回非空内容。
7. [x] 同步 design/spec/task/todo/changelog，并以 `git diff --check` 收尾；未创建 Git commit。

## Files

- `scripts/ops/prepare-android-node-runtime.js`
- `src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeManifest.kt`
- `src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt`
- `src/apps/android-display/app/src/main/java/com/aasc/display/MnnLlmModelManager.kt`
- `src/apps/server/modules/llm/llm-model-manifest-service.js`
- `src/apps/server/boot/server-app.js`
- 对应 Node/Android 测试与 `docs/design`、`docs/spec`、`docs/task`、`docs/todo.md`、`changelog.md`
