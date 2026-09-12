# 聊天历史安全持久化、备份与导入导出实现伪代码

## 路径与文件

```text
historyDir = 用户配置目录
historyBackupDir = dirname(historyDir) + "/aasc-user-backups"
groupFile = historyDir + "/chat-history.json"
privateFile(target) = historyDir + "/chat-history-" + target + ".json"
previousDayBackup(date) = historyBackupDir + "/aasc-user-previous-day-" + date
```

## 加载历史

```text
loadHistory():
    files = historyDir 中以 chat-history 开头且以 .json 结尾的文件
    不扫描 aasc-user-backups 或其他备份目录
    对每个文件:
        读取 JSON
        如果不是数组:
            保留原文件并报告错误
            跳过该文件
        对每条消息补全 sessionId/profileName/templateId 默认值
        按 mode/target/sessionId/profileName/templateId 放入 chatHistories
    返回加载数量和会话数量
```

## 普通保存

```text
requestHistorySave(reason, changedFiles):
    将 changedFiles 加入 pendingChangedFiles
    取消旧的 2 秒定时器
    设置新的 2 秒定时器

flushHistorySave():
    allMessages = chatHistories 中的全部消息
    grouped = 按目标文件名分组(allMessages)
    filesToWrite = grouped 中有消息的文件 + pendingChangedFiles

    对 filesToWrite:
        如果文件属于当前快照:
            原子写入当前消息数组
        否则如果文件是 pendingChangedFiles:
            原子写入空数组
        否则:
            不修改文件

    pendingChangedFiles 清空
    ensurePreviousDayBackup()
```

## 会话状态保存策略

```text
shouldPersistSession(metadata):
    如果 metadata.persist === false:
        返回 false
    返回 true

setSession(session, metadata):
    保存 previousSession
    合并 mode、privateTarget、privateSessionId、播放设置和 sessions
    记录实际模式变化及 metadata.source
    如果 shouldPersistSession(metadata):
        saveSession()
    返回当前会话副本

setMode(mode, target, metadata):
    保存 previousSession
    如果模式、目标或私聊 session 发生变化:
        重置 previousSession 对应的 Pi 会话
    更新 mode、privateTarget、privateSessionId='default'
    记录实际模式变化及 metadata.source
    如果 shouldPersistSession(metadata):
        saveSession()
    返回当前会话副本

switchSession(target, sessionId, metadata):
    校验 target 和 sessionId 对应的会话存在
    必要时重置旧私聊 Pi 会话
    更新 privateTarget 和 privateSessionId
    如果 shouldPersistSession(metadata):
        saveSession()
    返回 true
```

测试会话隔离：

```text
测试开始:
    originalSession = getSession()

测试执行模式/会话切换:
    setSession(..., { source: 'test', persist: false })
    setMode(..., { source: 'test', persist: false })
    switchSession(..., { source: 'test', persist: false })

每个测试结束:
    setSession(originalSession, { source: 'testRestore', persist: false })

约束:
    测试不得创建、覆盖或删除真实用户目录中的 chat-session.json
    生产调用未传 persist=false 时保持原有持久化行为
```

## 上一天完整配置快照

```text
ensurePreviousDayBackup():
    today = Asia/Shanghai 当前日期
    yesterday = today - 1 天
    如果 backupDir 中已经存在 yesterday 对应备份:
        返回

    创建 backupDir 下的临时目录
    递归复制 historyDir 下所有持久化配置和数据文件
    排除日志、锁、PID、socket、临时文件和备份目录
    写入备份清单
    原子重命名临时目录为 previousDayBackup(yesterday)
    删除 backupDir 下旧的 aasc-user-previous-day-* 目录
```

## 范围清空

```text
clearHistory(options):
    scope = validateScope(options)
    如果 scope 无效:
        抛出“必须指定群聊或具体私聊会话”

    backupCurrentHistory()
    affectedFiles = 找到 scope 命中的消息所属文件
    从 chatHistories 删除 scope 命中的消息
    requestHistorySave("clear", affectedFiles)
    重置对应 Pi/Responses 会话
    返回当前可见历史
```

```text
validateScope(options):
    如果 mode == "group":
        返回 group/default
    如果 mode == "private" 且 target 非空 且 sessionId 非空:
        返回 private/target/sessionId
    否则:
        拒绝，不执行全量清空
```

## 导出

```text
exportHistory():
    返回 {
        format: "aasc-chat-history",
        version: 1,
        exportedAt: 当前时间,
        messages: 所有已加载消息的副本
    }

chatHistoryDownload():
    文件名 = "chat-history.json"
    编码 = UTF-8
    内容 = JSON.stringify(exportHistory(), null, 2)

    每条 messages 记录至少包含：
        id, timestamp, role, name, content,
        mode, target, sessionId, profileName, templateId
    如果存在来源地址，则保留 ip 等扩展字段
    messages 是扁平消息数组，不按 user/assistant 成对包装一轮对话
```

## 导入

```text
importHistory(payload, mode="merge"):
    messages = 解析 payload.messages 或兼容的数组格式
    校验每条消息的 role/content/mode/target/sessionId
    标准化旧字段并补默认值

    如果 mode == "replace":
        备份当前历史
        chatHistories = 从 messages 重建
    否则:
        对每条消息:
            如果 id 已存在，跳过
            如果稳定指纹已存在，跳过
            否则追加到对应历史分区

    requestHistorySave("import", 受影响文件)
    重置受影响 Agent 会话
    返回导入数量、跳过数量和当前历史
```

## aasc-user 目录导入导出

```text
exportUserConfig():
    files = 递归扫描 historyDir 下的持久化普通文件
    对每个文件记录相对路径、权限和 Base64 内容
    返回 { format: "aasc-user-config", version: 1, root: "aasc-user", files }
```

```text
importUserConfig(payload, mode="merge"):
    校验 format/version/root、相对路径和 Base64 内容
    拒绝日志、锁、PID、socket、临时文件和路径穿越
    先触发上一天完整配置快照
    merge: 原子写入导入文件，保留未包含的持久化文件
    replace: 删除未包含的持久化文件，再原子写入导入文件
    返回写入、删除数量以及 restartRequired=true
```
