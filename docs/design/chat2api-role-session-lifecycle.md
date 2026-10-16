# QwenChat / 豆包 Chat 按角色会话复用与清理设计

更新时间：2026-10-15
状态：设计草案，未实施；供下一会话继续评审与开发。

## 1. 用户需求与本次边界

用户原始要求：

> 如果处理 qwenchat 和豆包 chat 会话数越来越多的问题，现在重启会分配新的会话 id，能不能记录下会话 id 按照聊天里的角色不同会话，同一会话复用一个 id；如果中途切换过模型，或者重启时，先尝试删除上个 id，再请求新的。

用户随后要求先阅读当前项目聊天与 Chat2API 流程，最后要求保存设计，另一个会话继续。

目标：
- 按当前聊天角色与本地会话边界管理上游会话，不在每轮消息创建新会话。
- 模型切换或重启后的首次使用，先尝试删除已记录的旧上游会话，再创建新的上游会话。
- 重启不丢失旧 ID、所属账号和清理状态，避免只生成新 ID 而无法清理旧会话。
- 不合并不同角色、不同私聊会话、不同临时会话的上下文。

本次仅保存设计和待办；没有修改运行代码、发送聊天、删除真实上游会话、重启服务器、构建或发布。删除失败后的策略等尚未获得用户确认，不能视为已定实现契约。

## 2. 已核实的现有流程

### 2.1 前端与服务器聊天入口

- `src/apps/web-mediacenter/ui/public/js/chat.js` 的 `sendMessage` 发送 `mode`、`target`、`templateTarget`、`sessionId`、`temporaryConversationId` 等字段；工作角色模式另带 `role`。
- 项目已有群聊、私聊、工作角色、临时会话，不应另造仅按角色名分组的简单映射。
- `src/apps/server/boot/server-app.js` 的 `handleChatMessage` 根据模式确定目标、模板及有效 sessionId；临时会话使用独立 ID，群聊与临时模式不直接沿用私聊模板目标。
- 群聊系统提示可包含多个角色，不能把每条消息的文本角色前缀直接当作独立上游会话。
- 工作角色的完整服务端分发、普通 `chatStream` 的完整参数及实际使用配置仍需继续追踪。

### 2.2 普通 LLM Responses 已有持久化，不是完全没有角色映射

`src/external/llm/llm-service.js`：
- `getResponsesSessionKey` 已把 mode、target、sessionId、activeProfile、templateId 交给 `sessionKey` 生成键；精确序列化规则需再读定义。
- `getResponsesFingerprint` 包含 profile、templateId、systemPrompt、model、promptFormat、protocol、apiUrl。
- `buildResponsesPayload` 在指纹匹配且无图像内容等条件下，复用 `previous_response_id`，其次复用 `conversation`；否则发送完整消息。
- `saveResponseReference` 保存 conversationId、latestResponseId、model、fingerprint、updatedAt。
- 引用原子写入 `USER_CONFIG_DIR/chat-responses-sessions.json`，文件权限 0600。
- `clearResponseReference` 只删除本地引用；目前不能等同于删除上游会话。

因此，问题不是“所有聊天都没有持久化角色会话键”，而是不同调用路径的复用、失效和远端清理没有形成一致生命周期。

### 2.3 Pi 运行时存在明确的重建点

`src/apps/server/modules/chat/pi-runtime-manager.js`：
- runtime key 包含 profile、template、权限策略、conversationKey。
- 配置指纹含 apiUrl、model、apiKey、protocol、token/温度、templateContent、permissionProfile；指纹变化会结束旧 SDK session 后重建。
- `createSdkBackedSession` 生成新的 `pi_` 加随机 UUID 作为 conversationId。
- SDK `SettingsManager` 与 `SessionManager` 使用内存实现。

`src/apps/server/modules/chat/pi-responses-continuation.js`：
- continuation tracker 使用内存 Map，保存 responseId、systemPrompt、语义消息快照。
- 只有系统提示一致、旧消息是新消息前缀等条件满足时续接；否则清除 tracker 并走完整快照。
- 服务重启会丢失该 tracker。实际 Pi provider 如何设置 metadata 仍需继续阅读，不能仅凭 tracker 推断全部业务表现。

### 2.4 Chat2API Responses 持久化及原生会话

`src/apps/server/modules/chat2api/chat2api-data-store.js`：
- 默认数据目录为 `~/.config/aasc-user/chat2api`，支持 rootDir 覆盖。
- `responsesSessions` 对应 `responses-sessions.json`，目录 0700、私有文件 0600、原子写入。

`chat2api-response-session-store.js` 保存：
- conversationId、providerId、accountId、actualModel、history、nativeState。
- latestResponseId、responseIds、createdAt、updatedAt。
- 已有按 conversationId 的锁和集合串行写入；当前未见删除接口。

`chat2api-responses-service.js`：
- previous_response_id 可反查持久化会话；conversation 可读取已有会话。
- 普通请求不传引用时创建新的 `conv_` ID；匹配 Pi metadata 的请求存在专门处理。
- 续接会绑定已有 provider/account/model，并按 native continuation 能力选择发送增量还是拼接本地历史。
- Pi `snapshot` 模式会把传给 adapter 的 nativeState 重置为空，即使外层 conversationId 没变也可能新建上游会话。
- 豆包中断续接会保存 uncertain 状态；流式锁延续至消费和持久化结束。

`chat2api-core-adapter.js`：
- 完成模型映射、账号选择及 provider adapter 调用。
- 已有实际模型与账号绑定冲突检查，新设计不能绕过这些约束。

### 2.5 Qwen 与豆包的能力差异

Qwen：`chat2api-provider-adapters.js` 的 `createQwenRequest`：
- 原生 ID 为 nativeState.sessionId，父请求为 parentReqId。
- 有 sessionId 时 `scene_param=continue`，否则生成新 ID 并走 first_turn。
- 响应 communication.sessionid / reqid 回写 nativeState。
- `qwen` 与 `qwen-ai` 是不同实现；qwenchat 别名的精确映射还需核实。
- `chat2api-qwen-history-service.js` 现有列表、读取与历史导入，可恢复 sessionId/parentReqId；未确认删除能力。

豆包：`chat2api-doubao-chat-adapter.js`、`chat2api-doubao-session.js`：
- 新建使用空 conversation_id、随机 local_conversation_id、need_create_conversation=true。
- 续接使用已保存 conversationId，need_create_conversation=false。
- 当前已验证的版本化原生续接限定 Node 普通模式 0；think/expert 不可直接承诺同等复用。
- 状态含 version=1、transport=node-http、status、conversationId、accountId、mode、identityFingerprint。
- identityFingerprint 为账号、sessionid Cookie 及设备身份摘要；不能持久化或输出凭据原值。
- uncertain 状态必须拒绝直接续接；观察到的上游 ID 不一致属于协议错误。

### 2.6 其他入口与明确缺口

- `chat2api-runtime.js` 连接 datastore、Responses、adapter、代理和管理服务；stop 未见上游会话清理。
- `chat2api-gateway.js` 是同源转发，不负责会话持久化。
- `llm.chat` 一次性任务发送完整 Responses input，没有主动传 conversation / previous_response_id；是否属于用户当前复现路径尚未确认。
- 已检查的代理 DELETE 路由针对 provider、account、model mapping、API key，不是删除上游聊天。
- 尚未找到并验证 Qwen/豆包的远端会话删除请求路径、参数与成功判定；不可编造接口。

## 3. 标识分层与隔离原则

必须分开保存和命名：
1. 本地聊天范围：mode、target、角色/模板、私聊 sessionId 或临时 conversationId。
2. Chat2API Responses conversationId。
3. Responses responseId / previous_response_id。
4. 原生会话：Qwen sessionId/parentReqId 或豆包 conversationId/身份状态。
5. Pi runtime conversationId。

TTS conversationId 不属于此生命周期，不用于删除上游文本聊天。

建议以现有本地会话范围构造稳定 logicalSessionKey，关联远端会话 generation；profile、provider、account、actualModel 等作为绑定信息。不能只用“角色名”，也不能只用可变模型名作为唯一主键，否则切换后无法定位待清理旧绑定。最终键应在核实既有 sessionKey 与 role dispatch 后确定，尽量复用既有结构。

## 4. 建议设计（待评审）

### 4.1 职责

- 聊天入口提供稳定的业务会话范围，不直接操作 provider 删除协议。
- Chat2API 生命周期层负责持久化绑定、串行化复用/轮换、记录清理任务。
- provider adapter 提供能力声明和远端删除操作；不支持或尚未验证时明确返回能力状态，不伪造成功。
- 现有 Responses store/nativeState 应尽量扩展或关联，避免新增另一份脱节的 ID 真相源。

### 4.2 建议记录

LifecycleBinding：logicalSessionKey、generation、providerId、accountId、actualModel、配置摘要、Responses引用、nativeState引用、运行世代、状态、更新时间。

CleanupRecord：所属 logicalSessionKey/generation、providerId、accountId、原生 conversationId、必要身份摘要、原因、状态、尝试次数、最近错误码、更新时间。

- 清理记录只针对本应用记录并拥有的远端 ID；不枚举并批量删除账号全部历史。
- 不保存 Cookie、token、CSRF、设备原值；需要凭据时通过原账号读取并核对身份。
- 旧记录在确认删除成功或确认已不存在前不能因创建新会话而丢弃。
- 字段、存储位置、版本迁移规则均未定稿，不作为已实施 schema。

### 4.3 同一会话复用

1. 解析当前业务范围，读取绑定并取得该 logicalSessionKey 的生命周期锁。
2. 核对当前运行世代、配置及 provider/account/model 绑定。
3. 绑定可用且 provider 支持该模式续接时，沿用现有原生 ID 和父请求状态。
4. 完整消费响应并按现有协议提交状态；中断时遵守各 provider 的安全状态，不盲目再次使用 uncertain 会话。
5. 避免 Pi snapshot 无意丢弃仍需清理的 nativeState；是否可直接续接必须按语义前缀和上下文契约判定。

### 4.4 模型切换与重启轮换

按用户原始目标，重启后不默认永久复用上次远端会话：
1. 通过持久化记录识别旧绑定；重启判定需要明确“主服务重启 / Chat2API任务重启 / Pi session重建”的范围。
2. 在创建新会话前，先持久化旧 generation 的清理意图及原生 ID。
3. 使用旧 provider/account 身份尝试删除旧远端会话；不能用新账号删除旧账号会话。
4. 删除成功或已不存在后记录完成，再创建新的远端会话并保存新 generation。
5. 原有 previous_response_id、外层 conversation 映射和 Pi tracker 必须与轮换一起失效，避免仍指向已删除远端会话。
6. 保留本地历史；新的远端会话按当前调用路径允许的上下文重建规则初始化。

建议采用启动时标记旧世代、该业务会话首次请求时执行清理与轮换，避免启动瞬间对所有账号集中发请求。该惰性清理时机属于建议，尚未得到用户确认；它不会立即清理长期不再使用的角色会话，需在评审时明确是否接受。

### 4.5 删除失败与异常（待确认）

建议候选策略：先尝试删除，失败记录待清理并允许新建；后续有限重试。优点是聊天不中断，缺点是不能保证旧远端会话数量严格有界。

另一候选策略：删除失败阻止新建，返回可操作错误。优点是不继续累积，缺点是上游清理故障会阻断聊天。

两者尚未选择，不应擅自实施。无论选哪种：
- 网络超时不等于删除成功，401/403 不等于远端已不存在。
- 身份不匹配或账号已移除时不改用其他账号；保留可诊断状态。
- 响应中已发现原生 ID 后若流中断，应尽量留存待核对/待清理 ID；必须与豆包现有 ACK 临时态和 uncertain 规则兼容，不能误标 ready。
- 删除、创建、发送、模型切换按逻辑会话串行化；不能删除仍被流式请求使用的旧 generation。
- 清理任务重试必须幂等、有上限或退避；具体预算待确认。

## 5. 下一会话继续点

1. 定位用户当前实际聊天模式、profile、protocol 和 provider，追踪真实复现链，不预设所有增长都来自 Pi。
2. 阅读 `llm-service.js` 的 sessionKey 定义及 `server-app.js` 的 chatStream 参数、工作角色分发。
3. 阅读 Pi 自定义 provider 的 metadata 构建与调用链，核实 snapshot/delta 何时产生及原生状态如何失效。
4. 在获授权测试条件下核实 Qwen/豆包删除协议、身份要求、幂等语义与支持模式；未验证前不执行真实删除。
5. 确认删除失败是否允许新建、重启边界、清理触发时机、模型切回行为，以及是否把系统提示/模板变更也视为轮换。
6. 明确豆包 think/expert 的处理：单独验证、明确暂不覆盖或其他方案，不宣称普通模式规则可直接扩展。
7. 向用户提交具体文件改动方案，等待确认；再先更新 spec 伪代码、生成执行 task、自测代码和实现。当前未授权开发。

## 6. 预期验收场景（未执行）

- 同角色同一私聊连续多轮：Qwen sessionId 不变，parentReqId 正确推进；豆包普通模式 conversationId 不变。
- 不同角色、不同私聊 sessionId、临时会话：上下文与远端 ID 隔离。
- 群聊多角色提示保持群聊会话边界，不因文本前缀产生额外远端会话。
- 模型切换：先尝试清理旧绑定，再生成新 ID；切回不复用已删除会话或旧 response 引用。
- 重启：可从磁盘找到旧 ID；按确认的重启边界和时机尝试清理，再新建。
- Pi snapshot、指纹变化与请求重试：旧 ID 不丢失且不重复删除正在使用的会话。
- 删除成功、已不存在、超时、鉴权过期、账号移除：符合最终确认的失败策略。
- 两个并发请求与流式请求期间切换：无重复新建、跨角色串线、误删活跃 generation。
- 豆包 uncertain/ACK 后中断：不误标 ready，保留足够的清理线索且不泄漏身份原值。
- 旧数据迁移和不支持删除的 provider：不误删用户手工创建的历史，不损坏既有 Responses、TTS、历史导入。

## 7. 关联文档

- 草案伪代码：`docs/spec/chat2api-role-session-lifecycle.md`。
- 现有设计：`docs/design/chat-system.md`、`docs/design/chat2api-global-responses.md`、`docs/design/chat2api-doubao-web.md`。
- 本文中的新增结构和删除流程均为提案，不表示当前系统已具备这些能力。
