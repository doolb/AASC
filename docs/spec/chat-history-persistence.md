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
