# 修复 Offline Pi 聊天 `partial-json` 缺失

## 任务描述

修复 Offline APK 控制端使用 `agent/pi` 聊天时的模块错误：
`openai/_vendor/partial-json-parser/parser.mjs` 无法从 APK 运行目录加载。

## Design 需求

- 保留 OpenAI 运行必需的 `_vendor` 目录树，继续过滤无运行价值的生成目录。
- 在 APK Runtime 生成时预检 `openai/_vendor/partial-json-parser/parser.mjs`。
- Pi 相关模块优先从 `AASC_NODE_MODULES_DIR` 指向的 active dependency 根加载。
- 不改变 Responses 协议、普通聊天、非 Pi profile 和模型配置。

## Spec 设计

- `isAndroidAssetExcluded` 对 `node_modules/openai/_vendor` 建立最小目录白名单。
- `validateRequiredAndroidRuntimeAssets` 在 package 声明 `openai` 时校验 parser 文件。
- `pi-runtime-manager` 和 `pi-readonly-tools.mjs` 使用 active root 的 file URL 入口。

## 受影响的功能模块和代码

- `scripts/ops/prepare-android-node-runtime.js`
- `src/apps/server/modules/chat/pi-runtime-manager.js`
- `src/apps/server/modules/chat/pi-readonly-tools.mjs`
- `tests/android-node-runtime-package.test.js`
- Pi 模块路径选择回归测试

## 自测用例

1. 下划线生成目录 `_virtual`、`__tests__` 仍不进入 APK。
2. `openai/_vendor/partial-json-parser/parser.mjs` 进入 APK manifest 和输出目录。
3. 声明 `openai` 但缺少 parser 时，Runtime 构建直接失败。
4. 设置 `AASC_NODE_MODULES_DIR` 后，Pi coding agent、Pi AI、compat 从 active root 加载。
5. 在已有 Offline v24 真机应用 code-only v15 后执行 agent/pi 聊天；确认请求进入本机 `llm-server`/MNN 链路且不再出现 `Cannot find module ... parser.mjs`。若出现模型超时，单独记录为模型运行问题。

## 兼容性测试

- Node Runtime packaging 定向测试。
- Pi runtime/readonly tools 定向测试。
- Offline/APK 静态测试。
- Android JVM 单测和真实 ADB 安装启动。

## 性能测试

- active module 路径只在 Pi session 创建时解析，不增加普通聊天启动路径。
- parser 预检只读取文件元数据，不复制模型或扫描额外大文件。

## 风险评估

- `_vendor` 白名单必须保持最小范围，避免把不兼容的生成目录重新打入 APK。
- active dependency 入口缺失时保留裸包回退，开发环境仍可运行；生产包通过构建预检阻止缺失依赖进入设备。
- 本次不要求重新安装完整 Offline APK：parser 文件属于 APK Runtime，设备已通过 code-only v15 验证 active dependency 路径和现有 Runtime；若目标设备的基础 Runtime 从未包含该文件，仍需后续发布带修复 Runtime 的 min/full APK。

## 预计工时

约 1 小时，包含代码修复、定向回归、code-only 热更新和 ADB 真机链路复测。

## 执行结果（2026-09-20）

- 代码包 v15 已生成并应用到 LAN 真机 Offline v24；依赖包继续复用 v4，未重新生成完整 APK。
- 定向测试：Android Runtime packaging、Pi active module、Pi runtime/readonly tools 共 `42/42` 通过。
- 真机日志：请求已进入 `llm-server`，模型为 `qwen3.5-0.8b-claude-opus-distilled-mnn`；未出现 `partial-json/parser.mjs` 或 `Cannot find module`。
- 真机最终回复受 MNN 本地请求超时影响，后续记录为模型执行/服务进程稳定性问题，不作为本任务失败原因。
