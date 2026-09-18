# Offline Pi SDK 接入与 Chat2API Responses 协议验证

## 任务描述

修复 Offline APK 服务器运行包遗漏 Pi SDK Provider 隐藏 manifest 导致 `agent/pi` 无法启动的问题，并补充 Chat2API Responses 首轮、续聊、流式和错误透传回归测试。Qwen3.6-Flash 模型映射和控制端遮挡暂不处理。

## Design 需求

- 设计文档：`docs/design/android-offline-pi-sdk-and-chat2api-responses.md`
- Android assets 使用 `aasc-bundled-manifest.json` 代替隐藏 `.manifest.json`，安装后恢复原路径。
- Runtime 快速复用必须验证 Pi SDK manifest；Responses 仅在测试发现缺陷时最小修改。

## Spec 设计

- 实现文档：`docs/spec/android-offline-pi-sdk-and-chat2api-responses.md`
- 伪代码覆盖构建器路径映射、安装恢复、健康检查和 Responses proxy 契约。

## 受影响功能模块和代码

- `scripts/ops/prepare-android-node-runtime.js`：允许并改名 node_modules 下的 `.manifest.json`。
- `src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt`：安装恢复和快速复用检查。
- `tests/android-node-runtime-package.test.js`：资产 marker 和 manifest 回归。
- `src/apps/android-display/app/src/test/java/com/aasc/display/NodeRuntimeManifestTest.kt`：Kotlin 恢复和快速复用回归。
- `src/apps/server/modules/chat2api/chat2api-proxy-service.test.js`、`src/apps/server/modules/chat2api/chat2api-responses-service.test.js`：Responses 代理契约回归。

## 自测用例

1. 临时 package 目录包含 `node_modules/pkg/data/.manifest.json` 时，生成资产包含 `server/node_modules/pkg/data/aasc-bundled-manifest.json`，不包含隐藏路径。
2. Kotlin 安装器将 marker 恢复为 `.manifest.json` 并删除 marker；内容和大小保持一致。
3. 含 Pi 目录但缺 manifest 的 Runtime 不允许快速复用；不含 Pi 目录的旧包仍允许复用。
4. Responses 非流式首轮和 `previous_response_id` 续聊返回完成 response。
5. Responses 流式事件可由客户端按 SSE 解析并得到文本。
6. `503/no_available_account` 错误保留状态和错误字段。

## 兼容性测试

- Node 定向 Android Runtime packaging tests。
- Chat2API Responses service/proxy/client tests。
- Android `:app:testDebugUnitTest`。
- 真实 SM-N9500 Offline Qwen3.6 Responses smoke test；不输出凭据。

## 性能测试

- 比较 marker 恢复前后 Runtime 安装阶段耗时；目标只增加小型 JSON 复制耗时，不重复复制模型权重。
- Responses 测试确认流式事件不会等待完整响应后才发送。

## 风险评估

- Android asset 规则变化可能再次影响隐藏文件，因此构建测试必须检查 marker 路径。
- 旧安装如果缺 Pi manifest 会触发完整 Runtime 安装，用户数据通过现有可变目录迁移保留。
- 上游账号映射缺失仍返回 `no_available_account`，不在本任务中自动创建映射。

## 预计工时

约 3 小时（文档与计划 30 分钟，TDD 与实现 90 分钟，Node/Android/真机验证 60 分钟）。

## 执行结果

- 已完成 `scripts/ops/prepare-android-node-runtime.js` 的 Pi manifest marker 映射；真实 release package 生成结果包含 `aasc-bundled-manifest.json`，不包含直接的隐藏 asset 路径。
- 已完成 `NodeRuntimeInstaller` 的 marker 恢复和 Pi manifest 快速复用检查；恢复测试确认内容保持一致且 marker 被删除。
- 已修复 `src/external/llm/llm-responses-client.js` 的非 2xx 流式错误竞争，Chat2API 的 `503/no_available_account` 状态、code、message 均能保留。
- 验证：Node Runtime packaging `23/23`、Offline/APK 回归 `49/49`、Chat2API Responses/proxy/client `19/19`、external/llm `24/24`、Android `:app:testDebugUnitTest` BUILD SUCCESSFUL。
- 项目全量 `npm test` `845/845` 通过。
- 尚未发布新 APK，也尚未在安装新 marker 的真实设备上宣称 Pi Agent 已通过；现有真实设备 Qwen3.6 Responses 结果保持原结论，Qwen3.6-Flash 空映射仍为 `503/no_available_account`。

## 状态

已完成代码与自动化验证；等待用户要求后再构建/发布新 APK，并执行真实 Offline `agent/pi` 热链路验收。
