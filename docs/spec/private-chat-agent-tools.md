# 私聊聊天 Agent 系统工具实现文档

## 实现状态

当前为待讨论的伪代码设计，尚未实现工具注册表、Pi/Codex 适配器或私聊路由切换。

## 私聊 Agent 工具调用伪代码

```text
activePrivate 收到 voiceText:
    privateContext = 获取当前 target、sessionId、displayId 和 Agent profile
    tools = systemToolRegistry.list({ mode: activePrivate, profile, target })
    agentResult = chatAgent.run({ text: voiceText, history: privateHistory, tools })

    如果 agentResult.type == text:
        保存普通私聊历史
        发送聊天回复和通用 TTS

    如果 agentResult.type == toolCall:
        tool = systemToolRegistry.get(agentResult.name)
        如果 tool 不存在或不属于当前权限:
            返回工具不可用错误，不执行副作用
        否则:
            校验参数、displayId、target、sessionId 和当前状态
            result = systemToolExecutor.execute(tool, validatedCall)
            如果 result.terminal == true:
                结束当前 Agent 回复和 TTS 流
            否则:
                将 result 作为 tool result 返回 Agent
                继续生成普通私聊回复
```

## 工具注册表伪代码

```text
systemToolRegistry:
    endVoiceConversation -> 无参数，终止 activePrivate 语音会话
    exitPrivateChat -> 无参数，退出私聊并进入 activeGroup
    switchPrivateAssistant -> assistantName，校验角色并切换私聊对象
    requestRepairMode -> 无参数，只启动本地密码等待流程
    mute -> 无参数，调用现有静音服务
    announceTime -> 无参数，调用现有时间播报服务

list(context):
    只返回 activePrivate 当前允许的工具描述
    不返回密码、配置文件内容或任意内部函数名
```

## 修复模式安全伪代码

```text
执行 requestRepairMode:
    创建当前 displayId 的 awaitingPassword 状态
    不把工具调用参数或后续密码文本发送给 Agent

收到密码:
    只在服务端内存中比较 repairMode.password
    正确 -> 绑定 repairMode.role，进入修复模式
    错误或超时 -> 清理等待状态并返回失败
```

## 后端适配伪代码

```text
PiAdapter 和 CodexAdapter:
    接收相同的 ToolDefinition[]
    将原生工具调用转换为统一 ToolCall
    将统一 ToolResult 转换回对应 Agent 后端格式
    不在后端自行执行 mute、切换会话或修复模式
```

## 未决项

```text
确认是否覆盖全部工具，或只覆盖修复模式
确认 mute 是否包含 unmute / restoreVolume
确认 switchPrivateAssistant 的历史和 session 回收规则
确认工具失败、重试、TTS 和控制端事件契约
```
