# Offline Pi SDK 与 Chat2API Responses 修复设计

## 需求背景

SM-N9500 Offline APK 的控制端 `agent/pi` 请求在真机启动时失败。设备日志显示 `openai/lib/ChatCompletionStream.mjs` 从基础 `node_modules` 加载时找不到 `openai/_vendor/partial-json-parser/parser.mjs`。原因有两个：Android asset 打包器排除了 `_vendor` 目录；Pi 的裸模块导入又会优先命中服务目录祖先中的基础 `node_modules`，没有使用 active dependency 更新目录。

同一轮验证中，Chat2API 的 `Qwen3.6` Responses 首轮、`previous_response_id` 续聊和控制端临时 profile 请求均能返回成功；`Qwen3.6-Flash` 在空模型映射下稳定返回 `no_available_account`。因此本次修复需要先把 Responses 契约锁定为回归测试，避免将模型映射问题误改成协议转换问题。

## 目标

1. Offline 服务器运行包安全携带 Pi SDK 所需的隐藏 Provider manifest。
2. 保留 OpenAI 运行必需的 `_vendor/partial-json-parser/parser.mjs`，在 APK 生成阶段缺失时直接失败。
3. Android Runtime 安装完成后，将安全文件名恢复成 Node/Pi SDK 约定的 `.manifest.json`，并在完整 Runtime 快速复用时检查关键 Pi manifest，避免旧包继续复用为“健康”运行时。
4. Pi SDK 和只读工具显式从 `AASC_NODE_MODULES_DIR` 的 active dependency 根加载，避免基础 `node_modules` 覆盖热更新依赖。
5. 覆盖 Chat2API Responses 的首轮、续聊、流式事件和上游错误透传，验证 Qwen3.6 真实路径的行为契约。
6. 保持 `Qwen3.6-Flash` 模型映射、控制端遮挡层级和其他 Offline UI 行为不变。

## 方案

### Pi SDK 资源打包

构建器继续拒绝普通隐藏路径和生成目录，但对 `node_modules` 中 basename 为 `.manifest.json` 的普通文件建立明确例外；同时仅对 `node_modules/openai/_vendor` 目录树建立下划线目录例外。OpenAI 的 parser 文件在进入 APK 前执行必需资产预检，避免构建出设备必然失败的包。

复制到 Android assets 时，把 Provider manifest 文件名改成 `aasc-bundled-manifest.json`，manifest 记录改名后的可打包路径和原文件内容 hash。该名称不使用点号，也不与模型已有的 `bundled-manifest.json` 冲突。

安装器复制并校验 staging 后，在 Runtime 切换前递归扫描 `node_modules`，把每个同目录的 `aasc-bundled-manifest.json` 原子复制为 `.manifest.json` 并删除 marker。这样 Node 的 import 路径保持原样，APK 内部不会依赖 AssetManager 对隐藏文件的行为。安装失败仍通过现有 Runtime 回滚流程恢复旧目录。

完整 Runtime 快速复用增加 Pi SDK manifest 健康检查：只有检测到 Pi SDK 目录时才要求其 `dist/providers/data/.manifest.json` 存在且非空，旧的无 Pi 包不受影响。

### Pi active dependency 选择

Android Service 通过 `AASC_NODE_MODULES_DIR` 指向当前 active dependency 目录。Pi coding agent、Pi AI、Responses compat 和只读工具不再依赖 Node 从服务源码祖先目录进行裸包解析，而是优先把 active root 下的入口转换为 file URL 后动态导入；本地开发或旧目录缺少入口时保留裸包名回退。这样 code-only/dependencies 更新后，Pi 与 OpenAI 始终来自同一版本树。

### Responses 契约

继续使用现有 `chat2api-responses-service`、proxy 和 `llm-responses-client`，不新增平行 HTTP 配置接口。回归测试验证：

- 非流式响应包含稳定的 `id/object/status/output/output_text`。
- `previous_response_id` 能续接第二轮并保存最新会话。
- 流式事件顺序包含 `response.created`、文本 delta、`response.completed`，客户端能消费 SSE。
- Provider/账号不可用时，HTTP 状态、错误 code 和 message 不被代理吞掉或伪装成成功响应。

如果这些测试通过，不改变现有 Responses 转换逻辑；只有测试暴露出实际缺陷时才修改对应最小代码路径。

## 实现状态（2026-09-20）

- 已完成 Pi marker 打包和 Android 安装恢复；真实 release package 生成结果包含 Pi SDK marker，未直接携带隐藏路径。
- 已完成 Runtime 快速复用的 Pi manifest 健康检查；不含 Pi SDK 的旧包仍按原规则复用，含 Pi SDK 但缺 manifest 的安装会重新完整安装。
- 已修复 Android `_vendor` 目录过滤导致 OpenAI parser 缺失的问题，并增加 `openai/_vendor/partial-json-parser/parser.mjs` 构建预检。
- 已修复 Pi 裸模块导入覆盖 active dependency 的问题；Pi runtime 与只读工具显式使用 `AASC_NODE_MODULES_DIR`。
- 已修复 Responses 客户端流式 HTTP 错误竞争：先读取非 2xx JSON 错误，再返回上游 `statusCode`、`code` 和 `message`。
- Node Runtime packaging、Chat2API Responses/proxy/client 和 Android JVM 回归均通过；code-only v15 已通过 LAN 热更新安装到已有 Offline v24 真机。
- 真机日志确认 Pi Agent 已进入本机 `llm-server` 和 MNN 模型链路，未再出现 `partial-json/parser.mjs` 缺失；本次单条聊天最终受离线模型执行超时影响，后续需单独处理模型端超时/进程稳定性，不归因于依赖包缺失。

## 兼容性与风险

- 新 marker 只影响 Android Offline Runtime 资源；在线 APK、普通服务器包和已有模型 marker 不变。
- 安装器对旧 Runtime 采用兼容判断；缺失 Pi manifest 的旧安装会重新完整安装，而不是覆盖用户 `config`、任务、日志或模型缓存。
- marker 恢复是一次小文件操作，不复制模型权重，首包耗时影响可忽略。
- Responses 测试使用 fake core adapter 和真实 Chat2API 设备验收；不把 `Qwen3.6-Flash` 映射缺失当作代码失败。
