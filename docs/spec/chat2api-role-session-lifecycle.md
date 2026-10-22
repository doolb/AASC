# Qwen / 豆包角色会话生命周期伪代码草案

更新时间：2026-10-17
状态：未实施；删除协议、失败策略、重启边界及清理时机待确认。此文是下一会话的设计输入，不是现有实现说明。
设计依据：`docs/design/chat2api-role-session-lifecycle.md`。

## 已有声明

- 前端聊天消息携带 mode、target、templateTarget、sessionId、temporaryConversationId；工作角色另带 role。
- llm-service.getResponsesSessionKey、getResponsesFingerprint、buildResponsesPayload、saveResponseReference。
- PiRuntimeManager.getSessionKey、createSdkBackedSession；SDK session 与 continuation tracker 当前在内存。
- ResponsesSessionStore.get、findByResponseId、save、create、withLock、acquireLock。
- ResponsesService.resolveConversation、persist；Pi snapshot 当前清空传给 adapter 的 nativeState。
- Qwen nativeState 保存 sessionId、parentReqId。
- DoubaoSessionFlow 核对 accountId、identityFingerprint、mode、ready/uncertain；普通 Node 模式支持原生续接。

## 新增定义（提案）

- LogicalScope { mode, target, roleOrTemplate, localSessionId }
- LifecycleBinding { logicalSessionKey, generation, providerId, accountId, actualModel, configurationDigest, responsesReference, nativeStateReference, runtimeEpoch, status, updatedAt }
- CleanupRecord { logicalSessionKey, generation, providerId, accountId, nativeConversationId, identityDigest, reason, status, attempts, lastErrorCode, updatedAt }
- ProviderLifecycleCapability { continuationModes, deletionSupported }
- RotationPolicy { restartBoundary, cleanupTrigger, deletionFailurePolicy }

## 操作流程（待确认后翻译）

### 豆包 uncertain 自动重建后的旧会话清理（待实施）

收到 doubao_session_uncertain 且确认请求原本在续接旧豆包会话
在清除本地续接引用前，记录旧原生 conversationId、所属账号与本地会话范围
按现有自动重建流程，用完整本地上下文建立新豆包上游会话
如果新上游会话没有成功建立，则不执行本项删除
等待任何使用旧会话的流式请求结束
核对旧 ID 只属于本次被替换会话，且与新 ID 不同
仅在删除协议及身份校验经验证后，使用旧会话所属账号删除旧 ID
根据经验证的远端结果记录删除成功、已不存在或待处理失败
保留控制端当前会话、本地历史、新 ID 和其他远端会话

当前仅记录需求；删除协议与失败处理尚未验证，运行代码不执行以上清理。

### 解析与复用

从聊天消息与现有会话规则生成 logicalScope
使用已核实的现有键规则生成 logicalSessionKey
取得 logicalSessionKey 对应生命周期锁
读取 binding、当前配置与 providerCapability
核对 binding 的账号、实际模型、配置和运行世代
将有效且支持续接的 binding 交给现有 Responses/nativeState 流程
消费响应并提交 responseReference 与 nativeState
释放生命周期锁

### 切换或重启后的轮换

从 binding 与 rotationPolicy 得到 rotationReason
将旧 binding 的原生 ID 和归属写入 cleanupRecord
核对旧账号身份并取得 provider 删除能力
在新会话创建前尝试删除旧 nativeConversationId
将删除结果写回 cleanupRecord
按尚待确认的 deletionFailurePolicy 决定继续或返回错误
使旧 Responses 引用、Pi tracker 与 binding 的旧 generation 一致失效
从当前本地历史和上下文规则得到 initialMessages
请求新远端会话并记录新 generation 与原生 ID
保存新 binding，保留未完成 cleanupRecord

### 中断与并发

将同一 logicalSessionKey 的请求、轮换与清理串行化
等待使用旧 generation 的流结束后再删除该 generation
将协议已识别但尚未完成提交的原生 ID 保留为待核对或待清理线索
按豆包既有规则保存 uncertain，禁止把中断结果升级为 ready
使用原 provider 与原账号执行清理，不使用新账号替代
只在远端确认删除或确认不存在后完成 cleanupRecord

## 实施前阻塞项

- 对 uncertain 重建清理，验证豆包网页端单会话删除协议及旧 ID 捕获时机，不得猜测删除接口或清理账号其他会话。
- 核实实际聊天链、sessionKey 精确规则、工作角色 dispatch 与 Pi metadata。
- 验证 Qwen/豆包远端删除接口；当前没有已验证的路径或参数。
- 确认删除失败策略、重启边界和清理触发时机。
- 确认豆包 think/expert 范围及模板/系统提示变化是否轮换。
- 确定 schema、存储关联、旧数据迁移和自测后，提交具体代码方案等待确认。

## 验收输入

同会话多轮复用、角色及会话隔离、模型切换、重启轮换、删除失败、并发流式、Pi snapshot、豆包 uncertain、旧数据与其他 provider 回归；详细场景见对应设计第 6 节。本轮只保存文档，未执行运行测试。
