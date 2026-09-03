# 私聊多会话设计文档

## 概述

支持在私聊模式下为同一助手创建多个独立会话，每个会话有独立的聊天上下文和历史记录。会话切换仅在控制端提供。

## 需求

1. 同一助手（如"小爱"）支持多个独立会话
2. 每个会话有独立的聊天记录和 LLM 上下文
3. 控制端通过下拉选择器切换会话
4. 会话的创建、切换、删除均在控制端完成
5. 显示端/语音命令不涉及会话管理

## 数据模型

### 消息记录（变更）

每条消息新增 `sessionId` 字段：

```javascript
{
  id: string,
  timestamp: number,
  role: string,
  name: string,
  ip: string,
  content: string,
  mode: string,         // 'group' | 'private'
  target: string,       // 私聊对象（私聊模式）
  sessionId: string,    // 会话ID（新增）
  displayId: string
}
```

### 会话状态（变更）

```javascript
{
  mode: 'group' | 'private',
  privateTarget: string | null,
  privateSessionId: string,      // 当前私聊会话ID（新增，默认 'default'）
  playOnControl: boolean,
  commandMode: boolean,
  sessions: {                     // 会话元数据（新增）
    "小爱": [
      { id: "default", name: "默认会话", createdAt: 1234 },
      { id: "abc123", name: "工作讨论", createdAt: 5678 }
    ]
  }
}
```

### 会话键（变更）

```
// 原: private:{target}
// 新: private:{target}:{sessionId}

function sessionKey(mode, target, sessionId) {
  if (mode === 'private' && target) {
    return `private:${target}:${sessionId || 'default'}`;
  }
  return 'group';
}
```

### 历史文件存储

保持现有按目标分文件的策略，每个消息记录带 `sessionId` 字段：

- `chat-history.json` → 群聊消息
- `chat-history-小爱.json` → 小爱的所有私聊消息（包含 default + 其他会话）
- `chat-history-妲己.json` → 妲己的所有私聊消息

`loadHistory()` 加载时按 `sessionKey(mode, target, sessionId)` 分组到 `chatHistories`。

## 核心模块变更

### src/external/llm/llm-service.js

```
sessionKey(mode, target, sessionId):
    私聊且有 target → 'private:{target}:{sessionId || "default"}'
    否则 → 'group'

addMessage(data):
    创建消息记录，包含 sessionId:
        sessionId: data.sessionId || chatSession.privateSessionId || 'default'
    按 sessionKey(msg.mode, msg.target, msg.sessionId) 推入 chatHistories

getSessionHistory(target, sessionId):
    返回 chatHistories['private:{target}:{sessionId}'] 或 []

listSessions(target):
    从 chatSession.sessions 返回指定助手的所有会话列表
    如果历史中存在不在元数据列表的 sessionId:
        自动补充该会话条目
        名称优先使用已有元数据，否则暂用 sessionId
    不存在则创建默认会话
    将恢复后的列表持久化

listAllSessions():
    从 chatSession.sessions 和全部私聊历史收集 target
    对每个 target 调用 recoverSessionsFromHistory(target, entries, history)
    展平为 { mode: 'private', target, id, name, createdAt }
    按 target 排序后返回，不要求调用方提供 target

一次性历史会话命名迁移:
    对 qwen-import-*、默认会话和新会话等通用名称查找同一 target/sessionId 的最早用户消息
    将消息清理为短标题并写回 chat-session.json
    已有明确人工名称和聊天消息内容保持不变

setSession(session):
    合并 incoming sessions 与服务端已有 sessions
    以 target + session.id 去重
    不允许控制端的空/不完整快照删除服务端已有会话
    保存合并后的 chatSession

createSession(target, name):
    生成 sessionId = Date.now().toString(36) + random(4)
    添加到 chatSession.sessions[target]
    初始化空历史
    调用 saveSession()
    返回新会话信息 { id, name, createdAt }

deleteSession(target, sessionId):
    不允许删除 'default' 会话
    从 chatSession.sessions[target] 移除
    删除对应的历史: delete chatHistories['private:{target}:{sessionId}']
    调用 saveHistory()
    如果当前 activaSession 被删除:
        切换回 default
    调用 saveSession()

switchSession(target, sessionId):
    设置 chatSession.privateSessionId = sessionId
    调用 saveSession()

clearHistory(options):
    如果 options.sessionId 存在:
        删除对应会话的历史
    否则（兼容旧行为）:
        现有逻辑不变

getHistory():
    现有逻辑不变（合并所有历史）
```

### WebSocket 消息处理 (server-app.js)

新增消息类型：

```
listPrivateSessions:
    请求: { type: 'listPrivateSessions', target }
    响应: { type: 'privateSessions', target, sessions: [...] }

createPrivateSession:
    请求: { type: 'createPrivateSession', target, name }
    响应: { type: 'privateSessionCreated', target, session }

deletePrivateSession:
    请求: { type: 'deletePrivateSession', target, sessionId }
    响应: { type: 'privateSessionDeleted', target, sessionId }
    广播到所有控制端

switchPrivateSession:
    请求: { type: 'switchPrivateSession', target, sessionId }
    响应: { type: 'privateSessionSwitched', target, sessionId }
    广播到所有控制端
```

HTTP API（新增）：

```
GET /api/chat/sessions?target={target}
    target 存在时返回 { status: 'success', sessions: [...] }

GET /api/chat/sessions
    target 省略时返回 { status: 'success', sessions: [{ mode, target, id, name, createdAt }, ...] }

POST /api/chat/sessions/create
    body: { target, name }
    返回 { status: 'success', session: { id, name, createdAt } }

POST /api/chat/sessions/delete
    body: { target, sessionId }
    返回 { status: 'success' }

POST /api/chat/sessions/switch
    body: { target, sessionId }
    返回 { status: 'success', sessionId }
```

### 控制端 UI (public/js/chat.js)

render() 变更：
    私聊模式头部添加会话选择器区域

renderSessionSelector():
    如果 mode === 'private' 且有 privateTarget:
        获取 target = privateTarget
        请求列表或从 session 数据渲染
        生成下拉选择器 HTML:
            <div class="session-selector">
              <label>会话:</label>
              <select onchange="Chat.onSessionChange(this.value)">
                {sessions.map(s => <option value={s.id} selected={s.id === currentSessionId}>{s.name}</option>)}
              </select>
              <button onclick="Chat.createSession()">+新建</button>
              <button onclick="Chat.deleteSession()">×删除</button>
            </div>

onSessionChange(sessionId):
    调用 switchPrivateSession(target, sessionId)
    重新加载历史
    重新渲染

createSession():
    弹出输入框输入会话名
    调用 createPrivateSession API
    刷新会话列表

deleteSession():
    确认弹窗
    不允许删除默认会话
    调用 deletePrivateSession API
    刷新会话列表

handleSessionList(data):
    更新本地会话列表
    调用 renderSessionSelector()

handleSessionSwitched(data):
    更新 session.privateSessionId
    重新加载历史
    调用 renderHistory()
    调用 renderSessionSelector()

renderHistory() 变更:
    私聊模式过滤改为按当前 sessionId:
        item.mode === 'private'
        && item.target === session.privateTarget
        && item.sessionId === session.privateSessionId

clearHistory() 变更:
    传递当前 sessionId

### 控制端 WebSocket (public/js/websocket.js)

新增消息处理:

```
privateSessions:
    调用 Chat.handleSessionList(data)

privateSessionCreated:
    调用 Chat.handleSessionList(data)
    window.showToast('会话已创建')

privateSessionDeleted:
    调用 Chat.handleSessionList(data) 或重载
    window.showToast('会话已删除')

privateSessionSwitched:
    调用 Chat.handleSessionSwitched(data)
```

## 向后兼容

1. 旧消息无 `sessionId` 字段 → 加载时默认视为 `'default'` 会话
2. 旧版本 `chat-session.json` 无 `sessions` 字段 → 初始化时自动创建默认会话
3. `setMode('private', target)` 时自动设置 `privateSessionId = 'default'`
4. 会话元数据丢失但历史仍在时，按历史中的 `target/sessionId` 自动恢复条目；原会话名称不可从消息记录推断时使用 sessionId

## 文件列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| src/external/llm/llm-service.js | 修改 | sessionKey 加入 sessionId，新增 session 管理函数 |
| src/apps/server/boot/server-app.js | 修改 | 新增 session 管理 WebSocket/HTTP handler |
| public/js/chat.js | 修改 | 新增会话选择器 UI 和相关函数 |
| public/js/websocket.js | 修改 | 新增 session 相关消息处理 |
| public/css/chat.css | 修改 | 新增会话选择器样式 |
| ~/.config/aasc-user/chat-session.json | 变更 | 新增 privateSessionId 和 sessions 字段 |
| docs/spec/chat-system.md | 修改 | 更新实现文档 |
