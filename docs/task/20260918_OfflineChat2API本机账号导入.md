# Offline Chat2API 本机账号导入

## 任务描述

将当前主机已有 Chat2API 账号导入 SM-N9500 Offline APK，验证 Offline 代理可读取账号、生成模型列表并发送 Chat Completions 请求。

## design 需求

- 使用现有 Chat2API 导出数据结构和同源网关导入接口。
- 仅导入账号集合，不覆盖设备已有 Provider、代理配置和模型映射。
- 导入预览和确认合并过程不输出凭据；验证结果只使用脱敏账号、模型数量和请求状态。

## spec 设计

```text
source = read host Chat2API accounts.json
payload = version 1 export object with accounts only
preview = POST Offline gateway import/preview
merge = POST Offline gateway import/merge with confirmed=true
verify accounts list, models list and minimal chat completion
```

## 受影响的功能模块和代码

- Offline Chat2API 同源网关导入接口和设备私有账号数据目录。
- `docs/design/android-chat2api-login-control.md`、`docs/spec/android-chat2api-login-control.md`、`docs/todo.md`、`changelog.md`。
- 未修改业务代码和 APK 工件。

## 自测用例

- 主机账号文件读取成功且仅导入一个账号。
- Offline 导入预览返回 `accounts=1`，确认合并返回 `accounts=1`。
- 设备账号列表显示脱敏账号且 `secretConfigured=true`。
- `/v1/models` 返回 Qwen 模型列表。
- 清空 Offline 模型映射后，使用 Provider 原生模型名发送请求仍返回成功。
- 最小 Chat Completions 请求返回 HTTP 200 和一条回复。
- 空模型映射下使用 `Qwen3.6-Flash` 别名发送请求返回 HTTP 503、`no_available_account`，确认该别名需要显式模型映射。
- 控制端手动聊天临时切换为 `llm + openai-completions + Qwen3.6`，经 Chat2API 代理发送并返回 `OK`；测试后恢复原 profile。

## 兼容性测试

- SM-N9500 Android 9/API 28、Offline min v10、Display 2。
- 不改变设备现有 Provider、代理配置和模型映射。

## 性能测试

- 导入为一次小型 JSON 数据写入；最小请求按真实 Provider 网络耗时完成。

## 风险评估

- 账号凭据属于敏感数据，只通过 HTTPS 本地网关传递，不输出到终端日志和项目文件。
- Provider 凭据可能过期；本次请求成功证明当前账号和网络链路可用。

## 执行状态

已完成：导入主机 Qwen 账号，设备模型列表返回 6 项；确认 Offline 当前模型映射已为空，空映射下 `Qwen3.6` Chat Completions 返回 HTTP 200 和 `OK`；追加测试 `Qwen3.6-Flash` 返回 HTTP 503 `no_available_account`；控制端手动聊天使用 `Qwen3.6` 经 Chat2API 返回 `OK`，发现现有 `qwen3.5` profile 的 `agent/pi` 路由报 Pi Provider manifest 缺失；测试未修改代码、APK，临时配置已恢复。
