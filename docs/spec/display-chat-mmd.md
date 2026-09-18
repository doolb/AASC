# 显示端聊天与 VRM/MMD 同位分层实现规格

> 本文只使用伪代码描述计划中的实现，当前版本尚未实现这些流程。

## 1. 状态模型

```text
结构 DisplayLayerState
  mediaVisible = true
  chatVisible = false
  mmdVisible = false
  mmdOrder = "under-chat"
  viewportWidth
  viewportHeight
  devicePixelRatio
  keyboardInset = 0

结构 ChatTarget
  targetId
  targetType = "role | assistant | private | group"
  title
  avatar
  modelResourceId 可为空
  availableSessions

结构 ChatContext
  targetId
  targetType
  roleId 可为空
  sessionId
  mode
  templateTarget
  displayId 可为空
  historyVersion
  requestIds

结构 ModelProfile
  resourceId
  version
  sha256
  localUrl
  fallbackResourceId 可为空
  license
  author

结构 MmdActionPlan
  planId
  roleId
  sessionId
  priority
  interruptPolicy
  steps
  fallbackAction
  expiresAt
```

## 2. 显示端舞台初始化

```text
过程 initializeDisplayStage()
  读取现有媒体层，不改变媒体播放状态
  创建 mediaLayer、mmdLayer、chatLayer、interactionLayer
  将 mediaLayer 放到层级 0
  将 mmdLayer 放到层级 10
  将 chatLayer 放到层级 20
  将 interactionLayer 放到层级 30
  设置舞台高度为当前 visualViewport 的动态高度
  设置安全区内边距
  绑定 visualViewport resize、orientationchange、ResizeObserver
  连接现有 display WebSocket
  请求当前聊天快照、角色列表和会话列表
  默认只显示媒体层和聊天入口
```

```text
过程 resizeDisplayStage(viewport)
  更新 CSS 舞台宽高为 viewport 的布局尺寸
  更新 state.viewportWidth、state.viewportHeight
  更新 state.keyboardInset 为 visualViewport 与 layoutViewport 的差值
  聊天输入区只使用 keyboardInset 调整底部内边距
  MMD Canvas 的 CSS 尺寸跟随舞台
  MMD Canvas 的实际像素尺寸乘以受限的 devicePixelRatio
  不因为键盘或 devicePixelRatio 改变模型的逻辑缩放
```

## 3. 对象选择和会话切换

```text
过程 openChatEntry()
  请求或读取服务端权威 ChatTarget 列表
  显示角色、助手、群聊和私聊对象
  对没有 modelResourceId 的对象显示“仅聊天”标识
  打开 chatLayer
  保持 mediaLayer 原有播放状态
```

```text
过程 selectChatTarget(targetId)
  从权威 ChatTarget 列表查找 targetId
  如果找不到
    显示对象不可用错误
    保持当前 ChatContext 不变
    返回
  计算默认会话键
    角色使用 role:<roleId>:<sessionId>
    私聊使用 private:<targetId>:<sessionId>
    群聊使用 group
  发送带 type 的 chatSession 请求
  等待服务端返回 chatSession 和 chatHistory
  只在服务端确认后替换当前 ChatContext
  渲染目标标题、顶部会话选择器和历史
  如果 target 有模型
    请求按需加载模型
  否则
    隐藏 mmdLayer
```

```text
过程 switchChatSession(sessionId)
  检查 sessionId 属于当前 ChatTarget 的权威列表
  如果不属于
    忽略选择并显示短暂错误
    返回
  发送带 type 的 chatSession 切换消息
  收到服务端确认前冻结重复切换操作
  收到 chatSession 后更新 ChatContext.sessionId
  收到 chatHistory 后清空当前消息视图并渲染新历史
  清理旧会话未完成的动作计划引用
  保留输入草稿，但不自动发送到新会话
```

## 4. 聊天同步

```text
过程 sendDisplayChatMessage(text)
  如果 text 为空
    返回
  生成全局唯一 requestId
  使用当前 ChatContext 组装 chatMessage
  将 requestId 加入待确认集合
  通过现有 WebSocket 发送
  服务端负责写入历史、调用 LLM 和向控制端/显示端广播
```

```text
过程 handleChatChunk(message)
  如果 requestId 已经完成或片段序号已处理
    忽略重复片段
  如果 message.sessionId 不是当前 ChatContext.sessionId
    写入对应后台会话缓存，不显示到当前气泡
    返回
  将正文片段追加到正文缓冲
  将 think 片段追加到 think 缓冲
  使用现有过滤规则更新显示端消息气泡
  不把动作计划字段写入正文
```

```text
过程 handleChatResponse(message)
  按 requestId 完成待确认集合
  将服务端最终正文、think、usage 和错误状态写入当前会话
  如果存在 mmd.action.plan
    丢给 MmdActionController
  TTS 只接收正文分流结果
  向聊天气泡提交正文和 think 的最终状态
```

```text
过程 handleChatHistory(snapshot)
  校验 snapshot.type、targetId、sessionId 和 historyVersion
  如果 snapshot 不是当前请求或当前上下文
    放入后台会话缓存
    返回
  用服务端历史替换本地历史
  重建 requestId 去重集合和未完成响应状态
```

## 5. 分层开关

```text
过程 setChatVisible(visible)
  state.chatVisible = visible
  更新 chatLayer 的可见性和 pointer-events
  如果 visible
    interactionLayer 保持可操作
  否则
    清除输入焦点和键盘 inset
  不停止 mediaLayer 或 mmdLayer
```

```text
过程 setMmdVisible(visible)
  state.mmdVisible = visible
  更新 mmdLayer 的可见性
  如果 visible
    恢复模型渲染循环和动作时钟
  否则
    暂停渲染循环、动作采样和非必要骨骼计算
  不清理已缓存的模型资源
```

```text
过程 setMmdOrder(order)
  如果 order 不是 under-chat 或 over-chat
    使用 under-chat
  state.mmdOrder = order
  如果 order 是 under-chat
    mmdLayer 的视觉层级低于 chatLayer
  如果 order 是 over-chat
    mmdLayer 的视觉层级高于 chatLayer
    interactionLayer 仍保持最高层级
  保存为显示端本地偏好或通过既有远端配置流程保存
```

## 6. VRM 资源加载

```text
过程 loadVrmForTarget(target)
  根据 target.modelResourceId 查询本地资源清单
  优先选择本地离线资源或服务端缓存
  如果没有本地资源
    不直接加载未登记的外部 URL
    返回模型缺失状态，聊天继续可用
  校验 version、sha256、MIME 和大小限制
  从资源缓存读取或下载到受控缓存
  使用 GLTFLoader + VRMLoaderPlugin 创建 VRM
  清理不必要顶点和关节
  应用 VRM0 朝向修正、角色缩放和默认表情
  将 VRM 绑定到当前 roleId
  释放旧角色的动作、表情、场景和事件监听
  启动待机动作
```

```text
过程 handleVrmLoadFailure(error)
  记录 resourceId、version、错误分类和 requestId
  如果存在已校验的旧缓存
    回退旧缓存并标记为 stale
  否则
    显示角色占位状态
    保持聊天和媒体可用
```

## 7. 动作计划和低级命令

```text
过程 executeMmdActionPlan(plan)
  校验 plan.roleId 和 plan.sessionId 等于当前上下文
  校验 priority、expiresAt、step 数量和资源引用白名单
  按 interruptPolicy 处理正在播放的动作
  对每个 step
    将语义动作映射到预置 motionResourceId
    校验时长、强度、表情和骨骼范围
    加入对应动作轨道
  同步执行可并行的表情和口型轨道
  失败时执行 fallbackAction
  只向动作状态面板报告错误，不修改聊天正文
```

```text
过程 executeMmdAgentCommand(command)
  校验 command.type 和 command.args
  如果 command.type 是 MOTION_ADD
    将资源 ID 映射为 VMD/VRMA/FBX
    交给动作播放器
  如果 command.type 是 MOTION_DELETE
    停止指定动作轨道
  如果 command.type 是 MODEL_BINDFACE
    将 morph 名称映射为 VRM expression
    限制权重在允许范围
  如果 command.type 是 MODEL_BINDBONE
    将骨骼名称映射为 normalized bone
    限制旋转和位移范围
  如果 command.type 未知
    返回可观察的 unsupported_command 错误
  不执行 command 中的脚本、URL 或文件系统路径
```

## 8. VMD、表情和口型

```text
过程 loadVmdMotion(resourceId, model)
  读取已校验的 VMD 二进制资源
  用 mmd-parser 解析骨骼、表情和相机数据
  只保留允许的骨骼和表情轨道
  将 MMD 骨骼映射到 VRM normalized bones
  将 MMD morph 映射到 VRM expressions
  生成浏览器 AnimationClip
  交给动作播放器，禁止直接修改全局场景
```

```text
过程 applyTtsLipSync(audioTimeline)
  从现有 TTS 音频时间线取得基础口型事件
  将事件映射为 VRM vowel expression
  与当前动作表情按优先级叠加
  音频结束后平滑回到默认表情
```

## 9. 异步复杂动作生成

```text
过程 submitComplexMotionRequest(description, context)
  将自然语言转换为结构化动作描述
  生成带 context、roleId、sessionId 的 mmd.motion.generate 请求
  通过现有任务执行链路异步提交
  聊天正文立即继续显示，不等待动作文件
  服务端生成、重定向、校验并缓存 VMD 或等价资源
  完成后广播 motionResourceReady
```

```text
过程 handleMotionResourceReady(message)
  校验资源哈希、角色兼容性和会话上下文
  如果资源属于当前会话
    将资源加入动作计划缓存
    按用户可见的计划状态决定是否播放
  否则
    只缓存资源元数据，不自动播放
```

## 10. 断线、错误和性能

```text
过程 handleDisplayReconnect()
  重新连接现有 WebSocket
  请求服务端权威聊天、角色和会话快照
  先恢复 ChatContext，再恢复消息列表
  丢弃无法确认的旧流式片段
  对待发送草稿提示用户确认后重发
```

```text
过程 onStageVisibilityChanged(visible)
  如果页面不可见或 mmdVisible 为 false
    暂停 MMD 渲染循环和动作采样
  否则
    按当前时间戳恢复动作时钟
  媒体层按原有可见性策略运行
```

```text
过程 releaseRoleRuntime(roleId)
  停止角色动作轨道和音频口型绑定
  移除 VRM scene、Canvas 引用和 ResizeObserver
  清理当前运行时缓存，但保留已校验磁盘资源
  确认旧角色不再接收新的 action plan
```
