# 显示端聊天与 VRM/MMD 同位分层实现规格

> 本文只使用伪代码描述实现流程；当前按同一 `display.html` 拆分 JS/CSS 模块的方案实现，不使用 iframe。

## 1. 状态模型

```text
结构 DisplayLayerState
  mediaVisible = true
  chatVisible = false
  mmdVisible = true
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
  sourceUrl
  modelId
  characterId
  modelUrl
  cacheKey
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

结构 DisplayModuleBus
  publish(type, payload)
  subscribe(type, handler)
  unsubscribe(type, handler)

结构 DisplayStageRefs
  mediaLayer
  mmdLayer
  chatLayer
  interactionLayer
  mmdCanvas
  chatPanel
  voiceTextDisplay
  mmdVisibilityControls
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
  默认显示媒体层、MMD 舞台和聊天入口；聊天面板按入口单独打开
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

```text
过程 initializeDisplayModules()
  等待 DOMContentLoaded，确保所有 defer 模块已完成注册
  创建同页 DisplayModuleBus
  创建 DisplayStageRefs 并传给聊天模块和 MMD 模块
  创建 displayChatController(root=chatLayer, bus, sendWebSocket)
  创建 displayMmdController(canvas=mmdCanvas, bus, resourceResolver)
  聊天模块不创建第二条 WebSocket
  MMD 模块不直接读写聊天历史
  父页面的 WebSocket 消息按类型发布到 DisplayModuleBus
  模块销毁时取消所有订阅和 pointer 监听
```

```text
过程 renderDisplayLayerOrder()
  将媒体层设置为基础层
  将 render-display 覆盖层设置为媒体层之上
  将 MMD、聊天和交互控制层设置为 render-display 之上
  不允许 render-display 覆盖聊天输入、会话菜单或显示端开关
```

```text
过程 renderHtmlDropdown(kind, items, selectedValue)
  使用 button 作为当前值入口
  使用同页 div[role=listbox] 和 button[role=option] 渲染选项
  点击选项后更新状态并调用既有 selectTarget 或 selectSession 流程
  点击外部区域或 Escape 时关闭菜单
  不创建 select 元素，不触发系统原生选择器
  菜单颜色从根元素主题变量读取

过程 styleHtmlDropdownOption(option)
  未选中状态使用普通文本色和透明背景
  悬停或键盘聚焦状态使用浅主题强调色
  aria-selected=true 状态使用主题 accent-color 背景和 bg-primary 文字
  已选中状态再次悬停或聚焦时使用 accent-secondary 背景
  保证未选中、交互中和已选中状态具有可见颜色差异
```

```text
过程 layoutFullscreenChat()
  将聊天层和聊天窗口尺寸设置为舞台宽高的 100%
  将聊天窗口根背景设置为透明，不使用模糊和卡片阴影
  将顶部栏、状态栏和输入区设置为实色主题背景
  将消息列表背景保持透明，使媒体通过空白区域可见
  将消息气泡、输入框、按钮和下拉菜单保持实色主题控件
  使用安全区和键盘内缩，不改变媒体与 MMD 的逻辑尺寸
  将 compose 设置为两列布局：输入框占据剩余空间，操作区固定在右侧
  将发送按钮和清空按钮按纵向排列
  在窄屏下保持操作区最小可用宽度，禁止按钮覆盖输入框
```

```text
过程 layoutDisplayInteractionControls()
  将聊天和 MMD 两个显示开关固定在交互层左下角
  保留左侧和底部安全区内边距
  键盘弹出时将底部内边距增加 keyboardInset
  不改变媒体、MMD 和聊天面板的层级关系
```

```text
过程 setChatLayerVisible(visible)
  如果 visible 为 true
    chatLayer 显示
    页面设置 display-chat-open 状态类
    voiceTextDisplay 隐藏，但不停止 TTS 音频播放
    chatLayer 默认不拦截透明区域的 pointer 事件
    chatLayer 内实际面板、输入和按钮允许接收 pointer 事件
  否则
    chatLayer 隐藏并设置 aria-hidden
    页面移除 display-chat-open 状态类
    voiceTextDisplay 按当前 voice-text-visible 状态恢复
    释放输入焦点
    mmdLayer 恢复完整 pointer 事件
  不销毁聊天上下文或 MMD 模型
```

```text
过程 updateVoiceTextVisibility(chatVisible)
  如果 chatVisible 为 true
    voiceTextDisplay 设置为隐藏状态
    voiceTextDisplay.dataset.chatSuppressed 设置为 "true"
    不清理 voiceTextDisplay 当前文本
    不停止 TTS 音频、队列或播放回调
  否则
    voiceTextDisplay.dataset.chatSuppressed 设置为 "false"
    如果 voiceTextDisplay 仍有当前播报文本
      恢复 voice-text-visible 状态
    否则
      保持 voice-text-hidden 状态
  showTtsText 在 chatVisible 为 true 时只更新缓存文本，不显示 DOM 文字
```

```text
过程 handleMmdPointerEvent(event)
  如果 chatLayer 可见且命中实际聊天控件
    由聊天控件处理
    返回
  如果 MMD 当前不可见
    返回
  计算 Canvas 内部坐标和受限 devicePixelRatio
  如果本地 three-vrm 运行时已就绪，使用 Raycaster 检测当前模型可交互网格
  否则使用受限的 Canvas 占位命中区，不读取外部资源
  如果没有命中模型
    返回
  根据网格/骨骼映射得到 hitPart
  执行 hitPart 对应的本地预置动作或表情
  发布 mmd.interaction，包含 roleId、hitPart、gesture 和时间戳
```

```text
过程 handleMmdInteraction(event)
  校验 roleId、hitPart、gesture 和时间戳
  如果当前角色或会话不匹配
    忽略聊天联动
    返回
  如果当前角色配置未开启 chatLink
    只保留本地动作结果
    返回
  按冷却时间和 requestId 去重
  将允许的交互映射为固定聊天事件
  不直接拼接任意用户可执行文本
```

```text
过程 dispatchDisplayServerMessage(message)
  如果 message.type 是 displayId
    更新 DisplayStageState.displayId
  如果 message.type 属于聊天、角色、会话或动作计划消息
    通过 DisplayModuleBus 发布给对应模块
  如果消息未被舞台模块消费
    交回现有媒体消息处理流程
  不为聊天模块创建第二条 WebSocket
```

```text
过程 setMmdLayerVisible(visible)
  更新 mmdLayer 的 aria-hidden 和可见状态
  如果 visible 且 chatVisible 为 false
    开启 MMD Canvas pointer 事件
  否则
    关闭 MMD Canvas pointer 事件
  保留模型、动作和聊天上下文，不因隐藏释放资源
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
过程 sendSelectedDisplayMmdVisibility(visible)
  如果当前没有选中的 displayId
    显示“请先选择显示端”
    返回
  发送 { type: "control", displayId, action: "mmdVisibility", value: visible }
  控制端更新对应按钮的 active 状态
```

```text
过程 handleDisplayControl(message)
  如果 message.type 不是 control 或 message.action 不是 mmdVisibility
    交回已有控制消息处理流程
    返回
  调用 DisplayStage.setMmdVisible(message.value === true)
  更新显示端角色按钮文字、aria-expanded 和 MMD pointer 状态
  返回 control ack，不改变媒体播放状态
```

实现约束：`body.display-chat-open` 和 `#voiceTextDisplay[data-chat-suppressed="true"]` 都使用 `display: none !important`。这样即使现有 TTS/语音识别流程重新设置 `voiceTextDisplay.className` 或行内布局，也不会在聊天打开期间显示播报文字。

2026-09-20 实现映射：`display-chat.css` 负责输入区两列及按钮纵排；`display-stage.js` 维护聊天可见性和字幕抑制状态；`controls.js`/`websocket.js` 负责控制端按钮和 ACK；`display.html` 处理 `mmdVisibility` 并回传状态。

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
  读取 target.modelProfile.sourceUrl
  校验 sourceUrl 的协议为 https 且主机为 hub.vroid.com
  解析 /characters/{characterId}/models/{modelId}
  请求同源 /api/vrm/model?url={sourceUrl}
  服务端校验模型 ID 并返回 modelId、characterId、modelUrl 和 cacheKey
  浏览器优先从 Cache API 读取 modelUrl
  缓存未命中时请求同源 /api/vrm/model/file?modelId={modelId}
  服务端向 VRoid optimized_preview 请求 X-Api-Version=11
  服务端只跟随 hub.vroid.com 到受控 CloudFront 资源的有限重定向
  校验响应状态、MIME 和下载大小上限
  使用 AES-256-CBC 解包响应头中的 IV/Key，再用 zstd 解压并校验 GLB 头
  如果 GLB 包含 PIXIV_vroid_hub_preview_mesh 5.0 扩展
    根据最终 optimized_preview 资源路径和扩展时间戳生成确定性种子
    恢复 POSITION accessor 的三个坐标分量
  使用 GLTFLoader + KTX2Loader + VRMLoaderPlugin 创建 VRM
  清理不必要顶点和关节
  应用 VRM0 朝向修正、角色缩放和默认表情
  将 VRM 绑定到当前 roleId 和 modelId
  释放旧角色的动作、表情、场景和事件监听
  启动待机动作
```

```text
过程 handleVrmLoadFailure(error)
  记录 sourceUrl、modelId、错误分类和 requestId
  如果 Cache API 中存在已下载的 modelUrl 响应
    回退缓存并标记为 stale
  否则
    显示角色占位状态
    保持聊天和媒体可用
```

```text
过程 proxyVroidModel(request, response)
  解析并校验 modelId 为数字字符串
  构造 https://hub.vroid.com/api/character_models/{modelId}/optimized_preview
  带 X-Api-Version=11、Referer 和固定 User-Agent 发起请求
  最多跟随 3 次重定向
  只允许 hub.vroid.com 或 cloudfront.net 目标
  校验下载大小不超过上限
  读取 AES-CBC + zstd 载荷并校验解压结果为 GLB
  以 model/gltf-binary 返回恢复后的模型，并设置短期公共缓存
  非 2xx、超时或超出大小限制时返回可观察的错误
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

## 11. 静态模型资源代理

```text
声明 MmdModelProfile { resourceId, fileName, version, sha256, modelUrl }
声明 MmdAssetSource { baseUrl = "http://c.aasc.us/mnt/mmd/", fileName }

过程 createStaticMmdModelProfile(fileName, metadata)
  校验 fileName 只包含安全的单层文件名和允许的 vrm/glb/vrm.zst/glb.zst 扩展名
  生成 resourceId、version、sha256 和同源 modelUrl
  不把任意外部 URL 写入模型配置
  返回 MmdModelProfile
```

```text
过程 resolveMmdAssetUrl(baseUrl, fileName, dnsLookup)
  解析 baseUrl 并确认协议为 http、主机为 c.aasc.us、路径为 /mnt/mmd/
  解析 c.aasc.us 的 IPv4 地址
  用解析后的 IP 替换 URL 主机
  不设置 Host 请求头
  拼接经过校验的 fileName 并返回资源 URL
```

```text
过程 proxyStaticMmdModel(request, response)
  读取并校验 fileName 或 resourceId
  通过 resolveMmdAssetUrl 得到 IP 资源地址
  请求静态资源并限制重定向、响应大小和响应类型
  校验 GLB/VRM 文件头和可选 sha256
  以 model/gltf-binary 通过本地 HTTPS 同源接口返回
  失败时返回可观察错误并保留聊天、媒体和占位角色
```

```text
过程 loadDefaultMmdModel()
  使用 default-vroid.vrm.zst 创建 MmdModelProfile
  通过 /api/vrm/model/static?file=default-vroid.vrm.zst 获取模型
  将模型 URL 交给 three-vrm 运行时
  后续收到 mmd.model.profile 或 vrm.model.profile 时按 fileName 切换模型
```

## 2026-09-21 聊天层隐藏恢复与语音聊天同步

```text
过程 setDisplayChatVisible(visible)
  只切换 displayChatLayer 的可见状态和 aria-hidden
  不重建聊天 DOM，不清空 state.session、state.history 或 state.streaming
  如果 visible 为 true
    用当前 state.session 渲染对象、角色和会话选择器
  如果 visible 为 false
    释放输入焦点，但保留当前对象、角色和会话选择
```

```text
过程 handleDisplayChatInput(message)
  校验 requestId、displayId 和 content
  如果 displayId 属于当前显示端
    追加用户气泡
    创建 requestId 对应的“正在思考”流式气泡
    将 requestId 保存到 streaming
```

```text
过程 sendVoiceChatUpdate(displayId, message)
  向控制端广播 message
  同时向 displayId 对应的显示端发送 message
  仅用于语音输入触发的聊天消息，不改变普通语音命令的目标
```

```text
过程 setVoiceTextVisible(text, visible)
  更新 voiceTextDisplay 的文本和语音状态 class
  如果 displayChatLayer 可见
    写入 chatSuppressed=true
    使用最高优先级隐藏 voiceTextDisplay
  否则
    清除 chatSuppressed
    按当前播放/识别状态恢复文字显示
```

## 2026-09-21 聊天层联动语音监听会话

```text
声明 DisplayChatVoiceContext { visible, mode, target }
声明 VoiceConversationState { state, target, expiresAt, timerPaused, remainingMs }

函数 getDisplayChatVoiceContext()
  如果 session.mode == "private"
    返回 { mode: "private", target: session.privateTarget }
  如果 session.mode == "role"
    返回 { mode: "private", target: session.roleTarget }
  返回 { mode: "group", target: null }
```

```text
过程 syncDisplayChatVoiceContext(visible)
  context = getDisplayChatVoiceContext()
  通过当前显示端 WebSocket 发送
    { type: "displayChatVisibility", visible, mode: context.mode, target: context.target }

过程 onDisplayChatTargetChanged()
  如果聊天层可见
    syncDisplayChatVoiceContext(true)
```

```text
过程 handleDisplayChatVisibility(displayId, message)
  校验 visible 为布尔值
  校验 mode 只能是 group/private；private 必须有非空 target
  记录当前显示端 chatLayerVisible
  如果显示端未启用语音监听
    不修改 disabled 会话状态
    返回
  如果 visible == true
    取得当前 active 会话剩余时间；没有 active 会话时使用当前会话窗口时长
    清除服务器计时器
    设置 activeGroup 或 activePrivate、target、timerPaused=true、remainingMs
    广播权威 voiceConversationState
  如果 visible == false 且当前会话 timerPaused == true
    使用 remainingMs 创建新的服务端到期时间
    设置 timerPaused=false
    广播权威 voiceConversationState
```

```text
过程 resumeDisplayConversationTimer(displayId, preserveRemaining)
  如果 preserveRemaining 且 remainingMs 有效
    expiresAt = 当前时间 + remainingMs
  否则
    expiresAt = 当前时间 + 当前会话窗口时长
  由服务端 setTimeout 负责到期迁移到 waitingWake
  显示端只按 expiresAt/remainingMs 更新倒计时 UI
```

## 13. Android 入口与聊天下方语音 UI 层级

```text
常量 DISPLAY_STAGE_Z_INDEX = 3000
常量 DISPLAY_VOICE_STATUS_Z_INDEX = 2000
常量 DISPLAY_VOICE_TEXT_Z_INDEX = 1000

过程 layoutControlEntry()
  controlToggleButton.gravity = TOP | START
  controlToggleButton.marginLeft = 12dp
  controlToggleButton.marginTop = 12dp
  折叠状态仍使用左侧窄把手；展开状态仍使用完整「控制端」按钮

过程 renderDisplayVoiceLayers()
  displayStageLayers.zIndex = DISPLAY_STAGE_Z_INDEX
  voiceStatusRow.zIndex = DISPLAY_VOICE_STATUS_Z_INDEX
  voiceTextDisplay.zIndex = DISPLAY_VOICE_TEXT_Z_INDEX
  voiceConversationCountdown 与 voiceConversationConfirmationCountdown 继续沿用原有位置、旋转和计时刷新
  因 displayStageLayers 的整体层级高于语音状态/文字，聊天层、MMD 和交互控件始终覆盖 TTS 文字与聊天倒计时
  聊天打开或异步 TTS 文本更新时，不改变倒计时状态，不允许语音文字越过聊天层
```
