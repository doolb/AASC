# 聊天历史与用户配置安全持久化、备份与导入导出

## 需求背景

聊天历史同时服务于控制端展示、群聊/私聊筛选和 Agent 上下文。旧实现把内存中的历史当成磁盘完整快照：保存时只写入当前内存中存在的文件，并删除其他 `chat-history-*.json`。当自动测试、清空操作或异常进程只保留群聊记录时，延迟保存会误删私聊历史文件。

当前服务器仍连接真实配置目录，暂不实现请求级自动测试隔离。本次先保证测试或普通聊天保存不能因为内存快照不完整而删除其他历史；同时为直接调用聊天会话服务的单元测试增加非持久化会话变更入口，避免测试把临时群聊/私聊状态写入真实用户配置。

## 需求目标

1. 普通保存只更新当前明确发生变化的历史文件，不删除内存中暂时不存在的私聊文件。
2. 清空和删除必须指定明确范围，并记录来源、模式、角色和会话 ID。
3. 每天按 `Asia/Shanghai` 自动生成上一天的一份 `/home/as/.config/aasc-user` 完整配置快照，备份目录中始终只保留一份。
4. 控制端可以导出/导入完整聊天历史，也可以导出/导入整个 `aasc-user` 配置目录；目录导入默认合并，覆盖或替换需要显式操作。
5. 写文件使用临时文件和原子替换，异常或空快照不能覆盖已有非空文件。
6. 保留现有群聊/私聊文件格式、会话筛选和 Chat2API/Pi 独立会话存储。

## 非目标

- 本次不改变 Pi/Chat2API 的会话历史协议。
- 本次不将自动测试切换到独立目录；该项保留为后续可选任务。
- 不自动把 Chat2API 内部 System、工具调用和提示词恢复为界面聊天消息。

## 数据与文件

- `chat-history.json`：群聊及旧格式消息。
- `chat-history-{target}.json`：指定助手的全部私聊会话，消息通过 `sessionId` 区分。
- `../aasc-user-backups/aasc-user-previous-day-{yyyy-mm-dd}/`：上一天完整配置快照；包含 `aasc-user` 下的持久化配置、聊天历史、角色配置和 Chat2API 持久化文件，写入新日期前删除备份目录中的旧快照。
- 运行时日志、PID、锁、socket 和临时文件不属于配置快照，不复制、不导入。
- 聊天导出使用 `format`、`version`、`exportedAt`、`messages` 包装；目录导出使用 `format`、`version`、`exportedAt`、`root`、`files` 包装，文件内容采用 Base64 保存二进制兼容性。

### 聊天历史导出格式

`GET /api/chat/history/export` 下载 UTF-8、格式化缩进的 JSON 文件 `chat-history.json`，结构如下：

```json
{
  "format": "aasc-chat-history",
  "version": 1,
  "exportedAt": "2026-09-01T00:00:00.000Z",
  "messages": [
    {
      "id": "消息 ID",
      "timestamp": 1788273030000,
      "role": "control",
      "name": "控制端",
      "content": "用户消息文本",
      "mode": "group",
      "target": null,
      "sessionId": "default",
      "profileName": "qwen3.5",
      "templateId": "default"
    }
  ]
}
```

`messages` 是按时间保存的扁平消息数组，每个元素代表一条控制端或助手消息，不是把一轮对话包装成 `user`/`assistant` 成对对象。消息可能额外包含来源 `ip` 等字段；`role`、`mode`、`target`、`sessionId`、`profileName` 和 `templateId` 用于恢复显示、群聊/私聊筛选及 Agent 会话上下文。导入时支持同版本包装格式，也兼容旧的顶层消息数组。

## 保存安全策略

普通 `saveHistory()`：

- 写入所有当前仍有消息的历史文件；
- 写入本次明确修改过的空文件，以表示显式清空已经生效；
- 对既有但未出现在当前内存快照中的文件保持不动；
- 不执行“清理不存在文件”操作。

显式清空/删除：

- 先确定目标文件和 `mode/target/sessionId` 范围；
- 清空前触发上一天完整配置快照；
- 只修改目标会话，其他助手、会话和群聊保持不变；
- 未提供有效范围时拒绝操作，不执行全量清空。

## 自动化测试会话状态隔离

聊天会话服务的 `setSession()`、`setMode()` 和 `switchSession()` 默认继续持久化真实运行状态，保证服务器和控制端现有行为不变。测试在验证模式切换、私聊会话切换等内存逻辑时，显式传入 `persist: false`，只更新当前测试进程内存；每个测试结束后恢复测试开始时的会话快照。

该隔离覆盖“测试结束后恢复原有群聊/私聊模式”和“测试期间不创建或覆盖 `chat-session.json`”两个约束，但不扩展为请求级测试命名空间；真实服务器收到的会话同步、手动切换和语音切换仍使用默认持久化路径。

## 导入导出

- `GET /api/chat/history/export` 导出当前服务内所有已加载聊天消息，响应为下载文件。
- `POST /api/chat/history/import` 接收版本化 JSON；默认 `merge`，按消息 ID 和稳定消息指纹去重。
- `replace` 仅允许显式传入，执行前自动备份，再用导入消息替换 AASC 聊天历史。
- 导入完成后重新加载控制端历史；受影响的 Agent 会话需要重置，避免旧 Pi 上下文与新历史不一致。
- `GET /api/aasc-user/export` 导出整个配置目录的持久化文件，默认文件名为 `aasc-user-config.json`。
- `POST /api/aasc-user/import` 接收目录快照；默认合并并按相对路径覆盖，`replace` 会删除快照中未包含的其他持久化配置文件，运行时文件始终保留。
- 目录导入完成后返回 `restartRequired=true`，由用户决定何时重启服务端使所有内存配置重新加载。

## 后续可选：自动测试隔离

未来自动测试连接现有服务器时，可增加 `testOnly/testRunId` 请求命名空间，让测试只使用内存临时会话并禁止持久化。当前阶段不启用该协议。
