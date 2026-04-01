# Web MediaCenter - 变更日志

## [Unreleased]

### Bug 修复
- ✅ 画面裁剪模式添加调试打印语句
  - 控制端添加打印语句：public/js/crop.js
    - sendData: 直接发送视觉裁剪数据，不再转换原始数据
    - updateBox: 打印媒体尺寸、媒体偏移、裁剪框像素位置、裁剪框百分比
    - recalculateSize: 打印显示画布比例、媒体比例、计算后裁剪框
    - 修复旋转时拖动方向不正确的问题（90/180/270度）
    - 修复旋转时调整大小方向不正确的问题（90/180/270度）
  - 显示端通过确认消息发送尺寸信息给控制端：public/display.html
    - applyCrop 返回裁剪信息对象（包含状态、容器尺寸、媒体尺寸等）
    - sendCommandAck 支持 extraData 参数
    - crop 命令发送包含尺寸信息的确认消息
    - 修复 applyCrop 在非裁剪模式下不返回值的问题
    - 修复 90/270 度旋转时裁剪坐标计算错误的问题
  - 控制端接收并打印显示端尺寸信息：public/js/websocket.js
    - 收到 crop 确认消息时打印显示端尺寸信息
  - 服务端转发确认消息：server.js
    - 修复转发 commandAck 时未包含 extraData 字段的问题
  - 改动文件：public/js/crop.js, public/display.html, public/js/websocket.js, server.js

### 新增
- ✅ 显示端全选和自适应功能
  - 新增三种选择模式：单选、全选、自适应
  - 单选模式：选择单个显示端进行媒体下发（默认模式）
  - 全选模式：媒体下发到所有已连接的显示端
  - 自适应模式：根据媒体比例自动匹配显示端方向
    - 横向媒体（宽 > 高）下发到横向显示端
    - 纵向媒体（高 > 宽）下发到纵向显示端
    - 显示端方向判断考虑旋转角度（90°/270° 时方向互换）
  - 显示端列表新增方向指示器（↔ 横向 / ↕ 纵向）
  - 改动文件：public/js/display-list.js, public/js/websocket.js, server.js, public/css/upload.css
  - 设计文档：docs/design/display.md
  - 实现文档：docs/spec/display-selection.md
  - 任务文档：docs/task/2026-03-31_显示端全选和自适应功能.md
- ✅ 时间监听能力实现
  - 创建时间监听模块：core/timeListener.js
    - 支持分钟、小时、天级别的时间变化事件
    - 提供 on/off/once 事件订阅方法
    - 单例模式，全局统一管理
  - 重构报时模块使用时间监听
    - 移除独立定时器，改用时间监听事件
    - 改动文件：core/timeAnnounce.js
  - 重构提醒模块使用时间监听
    - 移除独立定时器，改用时间监听事件
    - 改动文件：core/reminder.js
  - 更新 server.js 启动时间监听
  - 设计文档：docs/task/2026-03-31_提醒增强与静音功能.md
- ✅ 静音/取消静音功能实现
  - 新增静音状态管理：server.js
    - muteState 对象存储静音状态和之前音量
    - muteAllDisplays() 静音所有显示端
    - unmuteAllDisplays() 取消静音恢复音量
  - 新增静音 API 端点
    - GET /api/mute 获取静音状态
    - POST /api/mute 执行静音
    - DELETE /api/mute 取消静音
  - 新增语音命令处理：core/voiceCommand.js
    - handleMuteCommand() 处理静音命令
    - handleUnmuteCommand() 处理取消静音命令
    - 支持指令：静音、全部静音、取消静音、恢复音量
  - 设计文档：docs/task/2026-03-31_提醒增强与静音功能.md
- ~~✅ 音量滑条拖动禁止图标~~ (已移除，影响用户体验)
  - ~~新增 CSS 样式：public/css/upload.css~~
    - ~~拖动时显示 not-allowed 光标~~
  - ~~新增事件监听：public/js/controls.js, public/js/floating-control.js~~
    - ~~mousedown 添加 dragging 类~~
    - ~~mouseup/mouseleave 移除 dragging 类~~
  - 设计文档：docs/task/2026-03-31_提醒增强与静音功能.md
- ✅ 今日/明日提醒功能实现
  - 新增 handleTodayReminders() 函数：core/voiceCommand.js
    - 筛选今日提醒（每日提醒 + 今日一次性提醒）
    - 按时间排序并语音播报
  - 新增 handleTomorrowReminders() 函数：core/voiceCommand.js
    - 筛选明日提醒（每日提醒 + 明日一次性提醒）
    - 按时间排序并语音播报
  - 支持语音指令：今日提醒、今天提醒、明日提醒、明天提醒
  - 设计文档：docs/task/2026-03-31_提醒增强与静音功能.md
- ✅ ViewBind 视图绑定模块实现
  - 创建 core/viewbind 目录
  - 实现 ViewBind 类：core/viewbind/ViewBind.js
    - 数据存储、绑定/解绑管理、变更通知
    - 支持通配符绑定和指定 key 绑定
    - 支持深度比较，避免相同数据触发通知
    - 支持 set/update 方法修改数据
    - 支持在通知过程中延迟解绑
  - 实现 ViewBindList 类：core/viewbind/ViewBindList.js
    - 列表数据管理、列表变化通知
    - 支持 push/pop/remove/insert/clear 操作
    - 支持为每个元素创建 ViewBind
    - 支持 forEach/map/filter/find 方法
  - 扩展 DataSnapshot 类：core/data-snapshot/DataSnapshot.js
    - 添加 bind/unbind/unbindAll 方法
    - 修改 _save 方法触发变更通知
  - 添加单元测试
    - ViewBind 测试：10 个用例
    - ViewBindList 测试：13 个用例
    - DataSnapshot 绑定测试：6 个用例
  - 创建实现文档：docs/spec/viewbind.md
  - 更新文件：docs/spec.md, docs/todo.md
- ✅ ViewBind 视图绑定功能需求分析
  - 创建设计文档：docs/design/viewbind.md
  - 分析 Unity C# 版本 viewbind 实现的核心功能
  - 设计 JavaScript 版本的 ViewBind 类和 ViewBindList 类
  - 设计与 DataSnapshot 模块的集成方案
  - 定义前端使用示例和模块集成方案
  - 创建任务文档：docs/task/2026-03-31_ViewBind实现.md
  - 更新文件：docs/design/viewbind.md, docs/design.md, docs/todo.md
- ✅ DataSnapshot 数据快照模块
  - 创建 core/data-snapshot 目录
  - 实现 DataSnapshot 基类：core/data-snapshot/DataSnapshot.js
    - 使用 Proxy 代理属性访问，实现透明的数据持久化
    - 支持嵌套对象修改自动保存
    - 支持默认值定义（static defaults）
    - 支持批量操作（batch 方法）
    - 自动创建目录结构
    - 深度克隆和深度合并
  - 实现 JsonFile 工具类：core/data-snapshot/JsonFile.js
    - 静态方法：read, write, exists, delete, readOrDefault
  - 创建模块入口：core/data-snapshot/index.js
  - 重构 config.js 使用 DataSnapshot
    - Config 类继承 DataSnapshot 基类
    - 保持原有 API 兼容性
    - 简化代码，移除手动加载/保存逻辑
  - 添加单元测试：core/data-snapshot/DataSnapshot.test.js
    - 11 个测试用例全部通过
    - 覆盖：默认值、自动保存、嵌套对象、删除属性、批量操作、文件加载、深度合并
  - 设计文档：docs/design/data-snapshot.md
  - 实现文档：docs/spec/data-snapshot.md
  - 任务文档：docs/task/2026-03-31_DataSnapshot实现.md
- ✅ 能力组合系统实现
  - 创建能力管道执行器：aasc/pipeline.js
    - PipelineContext: 管道执行上下文，支持数据存储、步骤结果、错误管理
    - PipelineStep: 管道步骤定义，支持输入输出映射、错误策略、重试机制
    - PipelineExecutor: 管道执行器，支持顺序/并行执行、能力调用
    - PipelineBuilder: 管道构建器，支持链式调用
  - 创建能力组合定义：aasc/composition.js
    - Trigger: 触发器定义，支持命令/事件/定时/手动/能力触发
    - CapabilityComposition: 能力组合，包含触发器、管道、降级管道
    - CompositionRegistry: 组合注册表，支持加载/保存/注册/查询
    - CompositionExecutor: 组合执行器，支持按触发执行
    - CompositionBuilder: 组合构建器，支持链式调用
  - 创建能力等级计算器：aasc/level-calculator.js
    - CapabilityScore: 能力分数，包含等级、权重、加权分数
    - ActorLevelScore: 执行者等级分数，包含综合等级、分类分数、建议
    - CapabilityLevelCalculator: 等级计算器，支持执行者/系统等级计算、排名
    - LevelCalculatorBuilder: 计算器构建器
  - 创建能力配置文件：config/capabilities.json
    - 定义 35+ 个能力，按等级分类
    - 包含基础能力（L1-L2）、专业能力（L3-L4）、特殊能力（L3-L5）
    - 支持能力继承和依赖关系
  - 更新入口文件：aasc/index.js
    - 导出所有能力组合系统模块
  - 更新文档：docs/spec/aasc.md
    - 添加管道执行器详细实现
    - 添加能力组合定义详细实现
    - 添加能力等级计算器详细实现
    - 添加使用示例和配置文件说明
  - 更新自测模块：public/js/self-test.js
    - 添加能力组合系统测试用例（8个）
    - 管道模块测试、组合模块测试、等级计算器模块测试
    - 能力配置文件测试、能力等级分布测试、能力分类测试
    - 能力继承测试、入口导出测试
  - 更新自测文档：docs/self-test.md
    - 添加能力组合系统测试项目说明
- ✅ 能力组合系统设计
  - 新增能力组合系统设计文档：docs/design/aasc.md 第12章
  - 定义原子能力（Atomic Capability）结构：输入输出模式、默认执行者、超时、重试策略
  - **核心原则：能力与执行者解耦**
    - 能力是独立定义的功能单元，不绑定到特定执行者
    - 一个能力可以被多个执行者共享使用
    - 执行者通过能力ID引用能力，声明自己拥有哪些能力
  - 定义能力组合（Capability Composition）：触发条件、执行管道、降级管道
  - 设计能力管道（Pipeline）执行流程：顺序执行、并行执行
  - 设计能力等级评估体系：综合等级计算、分类得分、组合得分
  - 设计能力配置系统：JSON配置文件、配置管理器
  - 提供完整示例：报时功能、天气播报、提醒播报
  - 更新文件：docs/design/aasc.md, docs/spec/aasc.md, docs/todo.md
- ✅ 现有系统功能抽象
  - 梳理 core/ 目录下所有核心模块功能
  - 梳理 aasc/actors/ 目录下所有执行者功能
  - 抽象为 25+ 个独立能力，按等级分类：
    - 基础能力（L1-L2）：时间解析、消息处理、事件触发、状态管理、文本显示、显示状态
    - 专业能力（L3-L4）：语音合成、语音播报、提醒管理、媒体搜索、天气获取、网页搜索、AI对话、重要记录
    - 特殊能力（L3-L5）：整点报时、媒体库管理、连接管理、语音命令、系统指令、私聊模式
  - 定义能力组合示例：报时功能、提醒播报、天气播报、播放媒体
  - 创建任务文档：docs/task/2026-03-31_能力组合系统实现.md
  - 更新文件：docs/todo.md
- ✅ AASC 系统架构设计文档
  - 创建完整的设计文档：docs/design/aasc.md
  - 包含消息协议规范、执行者模型、用户模型、能力继承机制
  - 新增执行者能力等级评级（L1-L5）
  - 新增用户模型：用户认证、保密等级（0-5级）、权限控制
  - 新增用户记录功能：系统记录指令、记录存储和查询
  - 新增分布式部署方案和迁移计划
  - 更新文件：docs/design/aasc.md, docs/design.md, docs/todo.md
- ✅ AASC 系统核心实现
  - 第一阶段：消息总线基础
    - 创建消息协议模块：aasc/message.js
    - 创建消息总线核心：aasc/message-bus.js
    - 创建执行者基类：aasc/actor.js
    - 创建消息路由和过滤：aasc/router.js
  - 第二阶段：执行者模型
    - 创建执行者注册表：aasc/registry.js
    - 实现能力等级评级（L1-L5）
    - 实现安全等级（0-5级）
  - 第三阶段：用户模型
    - 创建用户模块：aasc/user.js
    - 实现用户存储、权限管理
    - 创建用户记录模块：aasc/record.js
  - 第四阶段：能力继承
    - 创建能力模块：aasc/capability.js
    - 实现能力继承解析器
    - 定义默认能力集
  - 第五阶段：模块迁移
    - 创建提醒执行者：aasc/actors/reminder-actor.js
    - 创建聊天执行者：aasc/actors/chat-actor.js
    - 创建语音命令执行者：aasc/actors/voice-command-actor.js
    - 创建媒体控制执行者：aasc/actors/media-control-actor.js
    - 创建媒体库管理执行者：aasc/actors/media-library-actor.js
    - 创建画面渲染控制执行者：aasc/actors/display-render-actor.js
    - 创建系统指令执行者：aasc/actors/system-command-actor.js
    - 创建私聊模式执行者：aasc/actors/private-chat-actor.js
    - 创建重要记录执行者：aasc/actors/important-record-actor.js
    - 创建搜索执行者：aasc/actors/search-actor.js
    - 创建语音播报执行者：aasc/actors/tts-actor.js
  - 第六阶段：分布式支持
    - 创建集群模块：aasc/cluster.js
    - 实现集群节点管理
    - 实现跨节点路由
    - 实现边缘计算编排
  - 更新文件：docs/spec/aasc.md, docs/spec.md
- ✅ AASC 系统任务文档
  - 创建任务文档：docs/task/2026-03-30_AASC系统实现.md
  - 包含设计需求、实现规范、自测用例、性能测试、风险评估、预计工时
- ✅ AASC 系统自测用例
  - 新增 AASC 模块加载测试
  - 新增 AASC 消息 API 测试
  - 新增 AASC 执行者注册表测试
  - 新增 AASC 用户存储测试
  - 新增 AASC 能力注册表测试
  - 新增 AASC 集群状态测试
  - 改动文件：public/js/self-test.js, docs/self-test.md
- ✅ 自测功能
  - 控制端新增测试按钮（绿色按钮 🧪）
  - 自动测试显示端连接、WebSocket连接、播放控制、画面控制、语音功能等
  - 测试结果按类别分组显示，支持导出 JSON 报告
  - 改动文件：public/js/self-test.js, public/css/upload.css, public/upload.html
- ✅ 自测文档
  - 包含自测流程、测试项目、注意事项
  - 改动文件：docs/self-test.md

### Bug 修复
- ✅ 修复播放媒体时没有收到 media 类型确认消息的问题
  - 问题：mediaBatch 消息没有 displayId 字段，导致 displayData 为 undefined，代码直接 return
  - 原因：mediaBatch 处理逻辑在 `if (!displayData) return;` 之后
  - 修复：将 mediaBatch 处理逻辑移到 `if (!displayData) return;` 之前
  - 改动文件：server.js
- ✅ 修复播放媒体时显示端确认消息类型错误的问题
  - 问题：点击播放媒体时，控制端会发送裁剪消息，导致显示端确认消息显示为 crop 而不是 media
  - 原因：showPreview 函数调用 recalculateSize 时会自动发送 crop 消息
  - 修复：给 recalculateSize 添加 sendToDisplay 参数，showPreview 时传入 false 不发送数据
  - 改动文件：public/js/crop.js
- ✅ 修复AI助手界面搜索记录撑大界面导致操作区域被遮挡的问题
  - 问题：搜索记录没有高度限制，会撑大整个聊天界面
  - 修复：给 chat-container 添加 max-height: 500px 限制
  - 修复：给 chat-main 添加 overflow-y: auto 和 min-height: 0 使其可滚动
  - 修复：给 chat-search-history 添加 max-height: 150px 和 overflow-y: auto
  - 修复：给 search-history-list 添加 max-height: 100px
  - 改动文件：public/css/chat.css
- ✅ 修复获取天气失败 Request failed with status code 502
  - 问题：wttr.in 天气API服务不稳定，偶尔返回502错误
  - 修复：添加重试机制，最多重试3次，每次间隔1秒
  - 修复：增加请求超时时间从10秒到15秒
  - 修复：优化错误提示信息
  - 改动文件：core/voiceCommand.js
- ✅ 修复90度和270度时，上下拖动裁剪框，显示端是左右方向的问题
  - 问题：旋转90或270度后，拖动方向没有根据旋转角度调整
  - 修复：在 onMouseMove 中根据旋转角度交换 dx 和 dy
  - 修复：90度时 dy 取反，270度时 dx 取反
  - 修复：调整大小时根据旋转角度选择正确的 delta 值
  - 改动文件：public/js/crop.js
- ✅ 新增消息确认机制：控制端发给显示端的消息，显示端进行确认，控制端显示确认结果
  - 需求：控制端发送命令后需要知道显示端是否正确接收并处理
  - 实现：显示端处理命令后发送 commandAck 确认消息
  - 实现：控制端在聊天界面显示确认结果
  - 改动文件：public/display.html, server.js, public/js/websocket.js, public/js/chat.js, public/css/chat.css
- ✅ 新增群聊模式多处理器功能：同一消息可被多个执行者处理
  - 需求：群聊模式下，如"今天天气很好"，可以同时触发天气查询和AI助手回复
  - 实现：添加 checkMultiHandlerKeywords 方法检测多处理器关键词
  - 实现：添加 executeMultiHandlers 方法执行多个处理器
  - 实现：支持天气、提醒、报时、搜索、自定义指令等多处理器
  - 改动文件：public/js/chat.js
- ✅ 修复控制端选择媒体播放，显示端没有响应的问题
  - 问题：sendMedia 函数没有正确等待异步操作完成
  - 修复：将 sendMedia 改为 async 函数，使用 await 等待 sendMediaWithRatio 完成
  - 改动文件：public/js/websocket.js
- ✅ 新增私聊模式不响应系统命令功能
  - 需求：私聊模式下只响应"系统"开头的命令和"退出私聊"命令
  - 实现：在 handleSystemCommand 开头添加私聊模式检查
  - 改动文件：public/js/chat.js
- ✅ 新增自测功能：判断显示端是否接收到控制端指令
  - 需求：自测时需要验证显示端是否正确接收并处理指令
  - 实现：显示端在处理指令后发送 commandAck 确认消息
  - 实现：服务端转发 commandAck 到控制端
  - 实现：自测功能添加 waitForAck 方法等待确认消息
  - 改动文件：public/display.html, server.js, public/js/websocket.js, public/js/self-test.js
- ✅ 修复播放媒体没有发到显示端的问题
  - 问题：handlePlayCommand 和 handlePlaySelection 没有 callbacks 参数支持
  - 修复：添加 callbacks 参数，支持控制端播放语音提示
  - 修复：媒体始终发送到显示端，语音提示根据 playOnControl 决定播放位置
  - 改动文件：core/voiceCommand.js
- ✅ 修复天气结果没有在显示端播报的问题
  - 问题：显示端 handleVoiceCommand 缺少 weatherResult action 的处理
  - 修复：添加 weatherResult 和 playChoices action 的处理
  - 修复：添加 showPlayChoicesPopup 函数显示播放选择弹窗
  - 改动文件：public/display.html, public/css/display.css
- ✅ 修复控制端播放媒体功能不生效的问题
  - 问题：控制端 handleSystemCommand 缺少播放命令的处理
  - 修复：添加 handlePlayCommand 方法，检查显示端选择并发送播放命令
  - 改动文件：public/js/chat.js
- ✅ 修复天气命令不支持控制端播放的问题
  - 问题：天气命令只支持显示端播放，控制端开启"在控制端播放语音"时无法获取天气结果
  - 修复：修改 processVoiceCommand 和 handleWeatherCommand 支持 callbacks 参数
  - 修复：服务端传递 playOnControl 回调函数，支持在控制端播放天气结果
  - 改动文件：core/voiceCommand.js, server.js
- ✅ 修复控制端无法执行静音/取消静音命令的问题
  - 问题：控制端 handleSystemCommand 缺少静音和取消静音的处理
  - 修复：添加 handleMuteCommand 和 handleUnmuteCommand 方法
  - 修复：server.js 添加 mute 和 unmute 消息类型处理
  - 修复：websocket.js 添加 muteResult 和 muteState 消息类型处理
  - 改动文件：public/js/chat.js, server.js, public/js/websocket.js
- ✅ 修复系统指令帮助内容不完整的问题
  - 问题：帮助内容缺少静音、取消静音、今日提醒、明日提醒、天气、播放等指令
  - 修复：更新帮助模态框内容
  - 改动文件：public/upload.html
- ✅ 修复显示端横竖判断未考虑旋转角度的问题
  - 问题：getDisplayList 函数未返回 rotation 属性
  - 修复：在 getDisplayList 中添加 rotation 属性
  - 改动文件：server.js
- ✅ 修复 DataSnapshot Proxy 导致无限递归的问题
  - 问题：Proxy handler 检查 `prop in DataSnapshot.prototype` 只检查基类原型，导致子类方法无法正确访问
  - 当 `config.js` 设置 `module.exports.get = ...` 时，由于 `module.exports = config`（Proxy 对象），实际上修改了 `config.get`，形成循环引用
  - 修复：将 `prop in DataSnapshot.prototype` 改为 `prop in target`，检查整个原型链
  - 改动文件：core/data-snapshot/DataSnapshot.js
- ✅ 修复音量滑条拖动时鼠标变成禁止图标的问题
  - 问题：之前故意添加的禁止图标功能影响用户体验
  - 修复：移除 CSS 中的 `cursor: not-allowed` 样式和 JS 中的 `dragging` 类事件
  - 改动文件：public/css/upload.css, public/js/controls.js, public/js/floating-control.js
- ✅ 修复 floating-control.js 调用错误方法的问题
  - 问题：调用 DisplayList.selectDisplay 方法不存在
  - 修复：改为调用 DisplayList.select 方法
  - 改动文件：public/js/floating-control.js
- ✅ 修复 90度和270度时裁剪框拖动方向错误的问题
  - 问题：旋转后拖动方向与实际方向不一致
  - 修复：在 onMouseMove 中根据旋转角度调整拖动方向
  - 改动文件：public/js/crop.js
- ✅ 修复自定义指令配置文件保存问题
  - 问题：WebSocketManager 缺少通用 send 方法
  - 修复：添加 WebSocketManager.send 方法，创建 chat-commands.json 初始文件
  - 改动文件：public/js/websocket.js, config/chat-commands.json
- ✅ 修复自定义指令无法保存到文件的问题
  - 问题：WebSocket 连接是异步的，loadCommands 在连接完成前被调用，导致数据未加载
  - 修复：添加 WebSocket onopen 回调，连接成功后重新加载 commands 数据
  - 问题2：`if (!displayData) return;` 检查在 setChatCommands 之前，导致没有显示端时无法保存
  - 修复：将 chatHistory、chatSession、chatCommands 相关消息处理移到 displayData 检查之前
  - 改动文件：public/js/websocket.js, public/js/chat.js, server.js
- ✅ 新增服务器状态 API 和时间解析 API
  - GET /api/status：获取服务器运行状态
  - POST /api/time/parse：解析时间表达式
  - 改动文件：server.js

### Bug 修复（历史）
- ✅ 修复 DisplayList.getDisplays 方法未定义导致的 WebSocket 消息解析失败
  - 问题：floating-control.js 调用了不存在的 getDisplays 方法
  - 修复：在 display-list.js 中添加 getDisplays 方法
  - 改动文件：public/js/display-list.js
- ✅ 修复自定义指令没有保存到文件的问题
  - 问题：setCommands 函数使用展开运算符错误合并数据结构
  - 修复：正确处理 commands 数据结构
  - 改动文件：core/chat.js
- ✅ 修复新增本地媒体库后无法访问文件的问题
  - 问题：静态路由只在服务器启动时设置，新增媒体库时未动态添加
  - 修复：在添加媒体库 API 中动态注册静态路由
  - 改动文件：server.js

### 新增（历史）
- 显示端控制页面重构
  - ✅ 浮动控制面板：固定在页面右下角，可在所有页面访问
  - ✅ 快速播放命令：输入文件名直接播放
  - ✅ 显示端选择、播放控制、音量控制、画面填充
  - 改动文件：public/upload.html, public/css/upload.css, public/js/floating-control.js
- 播放命令功能
  - ✅ 指令：`播放{文件名}` 搜索并播放媒体文件
  - ✅ 支持搜索所有媒体库
  - ✅ 多个匹配时列出选项让用户选择
  - 改动文件：core/voiceCommand.js, server.js
- 通用时间解析功能
  - ✅ 支持"今天"、"明天"、"后天"等相对日期
  - ✅ 支持"X秒/分钟/小时/天/周/月/年前/后"等相对时间
  - ✅ 支持"X月X日"、"X年X月X日"等绝对日期
  - ✅ 支持中文数字和阿拉伯数字混合
  - 改动文件：core/timeParser.js, docs/spec/timeParser.md
- 天气语音播报
  - ✅ 天气查询结果自动生成 TTS 语音播报
  - 改动文件：core/voiceCommand.js
- 聊天系统重构
  - ✅ 群聊/私聊模式支持
  - ✅ 系统指令功能（系统帮助、私聊、退出私聊）
  - ✅ 控制端语音播放（TTS 服务生成）
  - ✅ 统一的聊天记录格式和存储
  - ✅ 所有聊天消息进行语音播报
  - ✅ 根据当前选择播报到对应设备（显示端/控制端）
  - ✅ 自定义指令配置和执行
  - ✅ 重要记录功能：`系统记录{内容}`
  - ✅ 搜索功能整合到聊天系统
  - ✅ 语音播报在显示端播报时同时显示文本

### 已实现功能（现有代码）
- 提醒功能：`提醒{时间} {内容}`、重复提醒
- 报时功能：`报时`、`现在几点`、`开启/关闭报时`
- 搜索功能：`搜索{关键词}`
- 取消操作：`拒绝`、`取消`
- 指定助手对话：`{助手名字}{消息}`
- 播放命令：`播放{文件名}`

### 改动文件
- core/timeParser.js: 新增通用时间解析模块
- core/voiceCommand.js: 新增播放命令处理、天气语音播报
- public/upload.html: 新增浮动控制面板
- public/css/upload.css: 新增浮动面板样式
- public/js/floating-control.js: 新增浮动控制面板模块
- public/js/display-list.js: 同步浮动控制面板状态
- public/js/websocket.js: 同步浮动控制面板状态
- public/js/main.js: 初始化浮动控制面板
- server.js: 设置媒体库管理器到语音命令模块
- docs/design/display-control-refactor.md: 新增设计文档
- docs/spec/timeParser.md: 新增时间解析实现文档
- docs/task/2026-03-29_显示端控制页面重构.md: 新增任务文档

### 修复
- ✅ 已完成 [2026-03-29][2026-03-29] 修复自定义系统指令无法正确识别的问题
  - 问题原因：server.js 中 processVoiceCommand 返回 commands 类型时没有处理
  - 改动文件：server.js, docs/spec/voiceCommand.md
- ✅ 已完成 [2026-03-29][2026-03-29] 修复控制端语音输入自定义指令和报时指令无法识别的问题
  - 问题原因：控制端 processVoiceCommand 没有检查自定义指令，timeAnnounce 消息处理在 displayData 检查之后
  - 改动文件：public/js/chat.js, server.js, docs/spec/chat-system.md
- ✅ 已完成 [2026-03-29][2026-03-29] 修复控制端聊天框输入内置指令无法识别的问题
  - 问题原因：handleSystemCommand 只检查自定义指令，没有检查内置指令（报时、提醒、搜索）
  - 改动文件：public/js/chat.js
- ✅ 已完成 [2026-03-29][2026-03-29] 优化指令执行提示，显示执行结果
  - 报时：显示当前时间
  - 搜索：显示正在搜索的内容
  - 提醒：显示设置的提醒内容
  - 今日提醒：显示查询提示
  - 改动文件：public/js/chat.js
- ✅ 已完成 [2026-03-29][2026-03-29] 添加天气查询功能
  - 使用 wttr.in API 查询天气
  - 支持城市名称查询，默认北京
  - 改动文件：core/voiceCommand.js, public/js/chat.js

### 2026-03-29 优化系统帮助指令

**已修改功能：**
- 系统帮助指令从"系统帮助"精简为"系统"
- 帮助弹窗从 alert 改为 HTML 模态框实现，体验更好
- 修复语音命令中系统指令无法正确识别的问题

**改动文件：**
- public/js/chat.js: handleSystemCommand 改为调用 showHelp()，新增 showHelp/hideHelp 函数
- public/upload.html: 新增 chatHelpModal 模态框 HTML
- public/js/websocket.js: 新增 showHelp 消息类型处理
- core/voiceCommand.js: 系统指令改为返回 { type: 'showHelp' }
- server.js: 新增 showHelp 消息类型处理
- docs/spec/chat-system.md: 更新伪代码描述

### 2026-03-29 修复群聊助手名字显示问题

**已修复问题：**
- 群聊中发送以 AI 助手名字开头的消息时，自动匹配对应助手模板回复
- 发送给 AI 的消息去掉助手名字前缀，但显示和保存的消息保留完整内容
- 流式消息显示时助手名字正确显示（匹配到的助手名或默认助手名）

**改动文件：**
- public/js/chat.js: sendMessage 区分 displayMessage 和 sendMessage，分别用于显示和发送
- public/js/chat.js: showStreamingMessage 函数新增 assistantName 参数，显示正确的助手名字
- server.js: chatMessage 处理时使用 displayContent 保存用户消息
- docs/spec/chat-system.md: 更新 sendMessage 伪代码描述

### 2026-03-29 控制端语音播放改用 TTS 服务

**已完成功能：**
- 控制端播放语音改用 TTS 服务生成音频文件
- 移除浏览器 Web Speech API (speechSynthesis) 的使用
- 统一使用服务端 TTS 生成，确保语音一致性

**改动文件：**
- server.js: playOnControl 时调用 tts.generateTTS 生成音频，返回 audioUrl
- public/js/chat.js: playOnControlDevice 改为使用 Audio 对象播放音频文件
- docs/spec/websocket.md: 更新消息格式和处理流程

### 2026-03-29 修复控制端音频播放被打断问题

**已修复问题：**
- 控制端播放多句语音时，旧的句子没播完就被打断了
- 原因：每个句子生成后立即播放，没有等待上一个音频播完

**改动文件：**
- public/js/chat.js: 实现音频播放队列，等待上一个音频播完再播放下一个

### 2026-03-29 修复聊天模板持久化保存问题

**已修复问题：**
- 聊天模板没有保存到文件，重启后丢失
- 模板 id 改为使用名字，名字不能重复
- 私聊 AI 时用模板名字匹配系统提示词
- 私聊验证改用模板列表，而非旧的 assistantConfig
- 私聊消息显示对应 AI 助手名字而非"助手"
- 群聊消息错误地被保存为私聊消息（群聊消息的 target 应为 null）
- 群聊点击语音播放按钮播放的是私聊内容（索引错误）
- 系统帮助指令改用弹窗显示，而非 toast 提示

**新增功能：**
- 只发"私聊"时自动进入第一个模板对应的助手
- 群聊时消息以助手名字开头，自动使用该助手模板回复
- 私聊消息隔离：私聊模式只显示当前助手的私聊消息，群聊不显示私聊消息
- 默认模板：首次启动自动创建"小爱"模板并保存到文件
- 系统消息改为 toast 提示弹出，不再显示在聊天记录中
- 左侧页签快速切换聊天模式（群聊/各助手私聊），切换时自动刷新消息列表
- 群聊模式未指定助手时自动使用第一个模板的助手
- 移除底部模板下拉框，改用左侧页签切换
- 清空消息只清空当前页签对应的消息（群聊清群聊，私聊清对应助手）

**改动文件：**
- core/chat.js: 添加 TEMPLATES_FILE 常量和 loadTemplates/saveTemplates 函数
- core/chat.js: addTemplate 使用名字作为 id，重复名字更新内容
- core/chat.js: 新增 getTemplateByName 函数
- core/chat.js: 添加 DEFAULT_TEMPLATES 常量，首次启动自动创建默认模板
- core/chat.js: clearHistory 支持按模式清空消息
- server.js: 私聊时用 chat.getTemplateByName 匹配模板
- server.js: 群聊时使用 templateTarget 指定模板，消息 target 为 null
- server.js: /api/chat/clear 接收 mode 和 target 参数
- public/js/chat.js: deleteTemplate 改用名字参数
- public/js/chat.js: 私聊验证改用 templates 列表
- public/js/chat.js: sendMessage 检测助手名字开头的消息
- public/js/chat.js: sendMessage 群聊时发送 templateTarget 而非 target
- public/js/chat.js: renderHistory 使用 originalIndex 保留原始索引用于播放
- public/js/chat.js: renderHistory 私聊消息显示 target 作为名字
- public/js/chat.js: addSystemMessage 改为 toast 提示
- public/js/chat.js: handleSystemCommand 系统帮助改用 alert 弹窗
- public/js/chat.js: render 添加左侧页签切换，移除模板下拉框
- public/js/chat.js: setMode 切换时调用 render 刷新消息
- public/js/chat.js: clearHistory 发送 mode 和 target 参数
- public/css/chat.css: 添加页签样式

### 2026-03-29 优化聊天历史记录发送逻辑

**已优化功能：**
- 非私聊模式下不再发送历史记录给 AI 助手
- 私聊模式下保留历史记录以维持对话上下文

**改动文件：**
- core/chat.js: buildMessages 添加 includeHistory 参数
- server.js: 私聊模式传入 includeHistory: true

### 2026-03-29 修复用户消息显示名称问题

**已修复问题：**
- 控制端发送的消息重连后显示为"控制端"而非"用户"
- 原因：renderHistory 没有正确处理 role='control' 的情况

**改动文件：**
- public/js/chat.js: renderHistory 中将 role='control' 映射为用户消息显示

### 2026-03-29 修复聊天记录保存问题

**已修复问题：**
- 聊天名字垂直居中显示
- 聊天记录没有正确保存用户消息
- 原因：chatStream 函数内部使用旧格式保存消息，与 server.js 中新格式保存冲突

**改动文件：**
- public/css/chat.css: 添加 align-self: center 使名字垂直居中
- core/chat.js: 移除 chatStream 内部的消息保存逻辑，由 server.js 统一处理

### 2026-03-29 句子分割支持全角波浪号

**已完成功能：**
- 合成语言时，全角波浪号"～"也作为句子结束符

**改动文件：**
- core/chat.js: isSentenceEnd 函数添加全角波浪号 '～' (U+FF5E)
- docs/spec/websocket.md: 更新句子结束符列表说明

### 2026-03-29 控制端新增搜索页签

**新增功能：**
- 侧边栏新增搜索页签入口
- 显示搜索历史记录列表
- 支持手动输入关键词搜索
- 搜索记录可点击播放结果（TTS 播报）
- 支持删除单条搜索记录
- 支持清空全部搜索历史

**改动文件：**
- public/upload.html: 添加搜索页签 HTML 结构和导航按钮
- public/js/search.js: 新增搜索模块，处理历史显示、搜索、播放、删除操作
- public/js/websocket.js: 添加 searchHistory 消息分发到 Search 模块
- public/js/main.js: 初始化时调用 Search.init()
- public/css/upload.css: 添加搜索页签样式
- docs/spec/search.md: 新增搜索功能规格文档
- docs/spec/sidebar.md: 更新功能模块列表
- docs/spec.md: 更新模块列表
- docs/design/control.md: 更新功能模块描述

**交互流程：**
1. 进入搜索页签自动加载搜索历史
2. 输入关键词点击搜索，发送到服务端执行语音搜索
3. 点击播放按钮，TTS 播放搜索结果摘要
4. 点击删除按钮，删除单条记录
5. 点击清空按钮，清空所有历史

**Bug 修复：**
- ✅已完成 [2026-03-29][2026-03-29] 搜索功能无需显示端连接即可执行
  - 改动文件：server.js, core/voiceCommand.js, public/js/search.js
  - 问题：服务端处理控制端消息时，如果没有选择显示端会直接 return，导致搜索请求无法处理
  - 修复：将 voiceCommand 相关消息处理移到显示端检查之前，搜索时允许 displayId 为空

**功能优化：**
- ✅已完成 [2026-03-29][2026-03-29] 搜索功能改用 axios + cheerio 方案
  - 改动文件：core/voiceCommand.js, docs/spec/voiceCommand.md
  - 改进：使用 axios + cheerio 替代 puppeteer，更轻量、更稳定
  - 特性：
    - 支持 AI 回答 (#b_pole 区域)
    - 支持普通搜索结果 (li)
    - 无需启动浏览器，响应更快
    - AI 回答内容限制 500 字符

### 2026-03-29 实现语音命令处理功能

**新增功能：**
- 显示端语音状态显示：识别到语音时更新状态为"语音识别中"，显示语音识别文字
- 提醒功能：支持"X分钟后"、"每天"、"每周"、"每月"、"每年"等时间表达式
- 报时功能：支持"报时"、"现在几点"、"开启/关闭报时"语音命令
- 搜索功能：支持"搜索XXX"语音命令，搜索结果语音播报并显示
- AI助手响应：支持自定义助手名字（默认"小爱"），触发对应助手响应

**改动文件：**
- core/voiceCommand.js: 新增语音命令处理模块
- server.js: 集成语音命令模块，添加 WebSocket 消息处理
- public/display.html: 添加语音文字显示、命令响应弹窗
- public/css/display.css: 添加语音状态和弹窗样式
- public/js/chat.js: 更新语音命令处理逻辑
- public/js/websocket.js: 添加搜索历史和助手配置消息处理
- docs/spec/voiceCommand.md: 新增语音命令实现文档
- docs/spec.md: 更新模块列表

**语音命令触发流程：**
- "提醒" -> 解析时间和重复规则 -> 语音确认 -> 添加提醒
- "报时/现在几点" -> 立刻报时
- "开启/关闭报时" -> 切换报时功能状态
- "搜索XXX" -> 执行搜索 -> 语音播报结果
- "小爱XXX" -> 触发对应助手响应

### 2026-03-29 优化 SMB 媒体库配置界面

**改进内容：**
- 将 SMB 共享路径拆分为"服务器地址"和"共享路径"两个独立字段
- 服务器地址：输入 SMB 服务器 IP 或域名（如 `192.168.1.100`）
- 共享路径：输入共享名称，不需要包含服务器地址（如 `share` 或 `share/subfolder`）

**改动文件：**
- public/js/media-library.js: 添加服务器地址输入框，修改表单验证逻辑
- core/media-library.js: SmbProvider 添加 `_buildSharePath` 方法，支持 server 和 share 参数组合
- server.js: POST 路由添加 server 字段解构
- docs/spec/media-library.md: 更新配置结构说明

### 2026-03-29 改进 SMB 连接错误提示

**改进内容：**
- 添加 SMB 共享路径格式验证，提供更清晰的错误提示
- 错误 `name invalid` 通常是路径格式不正确导致

**改动文件：**
- core/media-library.js: `connect` 方法添加路径格式验证

**SMB 共享路径格式：**
- Windows 风格：`\\服务器IP\共享名`（前端输入时需转义为 `\\\\服务器IP\\共享名`）
- Unix 风格：`//服务器IP/共享名`

### 2026-03-29 修复 Node.js 17+ SMB 连接加密算法不支持错误

**已修复问题：**
- Node.js 17+ 使用 OpenSSL 3.0，默认禁用了 SMB 认证需要的旧加密算法（DES/MD4）
- 错误：`Error: error:0308010C:digital envelope routines::unsupported`

**改动文件：**
- package.json: 添加 `start:legacy` 脚本，使用 `--openssl-legacy-provider` 参数启动

**使用方式：**
- `npm start` 默认启用 SMB 支持

### 2026-03-29 修复 HTTP 媒体库配置保存丢失 URL 字段

**已修复问题：**
- 控制端添加 HTTP 类型媒体库后，重启服务端报错：`Cannot read properties of undefined (reading 'replace')`
- 原因：`saveConfig` 方法保存配置时只保存了 `path` 字段，没有保存 HTTP/SMB 类型需要的 `url`、`username`、`password` 等字段

**改动文件：**
- core/media-library.js: 修复 `saveConfig` 方法，根据媒体库类型保存对应字段

---

## 历史记录

### 2026-03-29 显示端语音识别状态显示

**已完成功能：**
- 控制端显示端列表显示语音识别状态图标
- 状态图标：🎤 识别中（闪烁动画）、🎤 就绪（半透明）、🎤 不支持（灰色）

**改动文件：**
- public/display.html: 添加 sendVoiceStatus 函数上报语音状态
- server.js: 添加 voiceStatus 消息处理和状态存储
- public/js/display-list.js: 渲染语音状态图标
- public/css/upload.css: 添加语音状态样式和动画

### 2026-03-29 修复媒体库符号链接访问错误

**已修复问题：**
- 本地媒体库遇到损坏的符号链接时抛出 ENOENT 错误

**改动文件：**
- core/media-library.js: 使用 lstatSync 代替 statSync，跳过损坏的符号链接

### 2026-03-29 显示端语音识别转发到控制端

**已完成功能：**
- 显示端启动时自动启动语音识别
- 语音识别结果通过 WebSocket 转发到控制端
- 控制端 Chat 模块接收显示端语音输入
- 支持在显示端说"聊天xxx"触发控制端对话

**改动文件：**
- public/display.html: 添加语音识别初始化和结果发送
- server.js: 添加 voiceInput 消息转发
- public/js/websocket.js: 添加 voiceInput 消息处理
- public/js/chat.js: 添加 handleDisplayVoiceInput 方法
- docs/spec/websocket.md: 更新消息类型文档
- docs/design/display.md: 更新设计文档

### 2026-03-29 语音输入功能

**已完成功能：**
- 控制端添加语音输入按钮
- 支持语音识别（Web Speech API）
- 说"聊天xxx"触发语音对话，自动发送消息给 AI 助手
- AI 回复后自动播放到显示端

**改动文件：**
- public/js/chat.js: 添加语音识别功能和语音命令处理
- public/css/chat.css: 添加语音输入按钮样式
- docs/spec/websocket.md: 更新伪代码描述

### 2026-03-29 优化媒体库 URL 生成

**已优化功能：**
- 默认 uploads 目录使用静态文件服务 `/uploads/`
- 其他本地目录使用动态静态路由 `/media/{id}/`
- HTTP 媒体库直接使用原始 HTTP 路径，不走代理

**改动文件：**
- core/media-library.js: LocalProvider 添加动态路由支持，HttpProvider 直接返回原始 URL
- server.js: 初始化时动态添加本地媒体库静态路由，确保路由在服务器启动前注册
- docs/spec/media-library.md: 更新伪代码描述

### 2026-03-29 聊天语音手动播放句子分割

**已完成功能：**
- 聊天语音手动播放时，进行句子分割
- 长文本按句子分批生成 TTS 并播放

**改动文件：**
- server.js: TTS play action 处理逻辑添加句子分割
- docs/spec/websocket.md: 更新伪代码描述

### 2026-03-29 修复 TTS 语音播报 404 错误

**已修复问题：**
- 显示端语音播报播不出来
- 整点报时无法正常播放
- 原因：TTS 文件路径改为 `uploads/tts/`，但多处代码返回的 URL 仍是 `/uploads/xxx`
- 修复：所有 TTS 相关代码返回正确的 URL `/uploads/tts/${fileName}`

**改动文件：**
- server.js: /api/tts/generate 和 Chat TTS 返回正确的 audioUrl
- core/timeAnnounce.js: 整点报时返回正确的 audioUrl
- core/reminder.js: 提醒功能返回正确的 audioUrl

### 2026-03-29 修复本地媒体库播放 404 错误

**已修复问题：**
- 新增的本地媒体库播放报错 404 Not Found
- 原因：本地媒体库 URL 错误地使用 `/uploads/` 路径，但服务器只映射了 `./uploads` 目录
- 修复：所有本地媒体库统一使用代理 API `/api/media-libraries/{id}/proxy/`

**改动文件：**
- core/media-library.js: LocalProvider.getPublicUrl 使用代理 API
- docs/spec/media-library.md: 更新伪代码描述

### 2026-03-29 AI 聊天助手播放功能

**已完成功能：**
- AI 聊天助手每条消息添加播放按钮
- 点击播放按钮通过 TTS 播放聊天内容

**改动文件：**
- public/js/chat.js: 添加 playMessage 方法，renderHistory 添加播放按钮
- public/css/chat.css: 添加播放按钮样式
- docs/spec/websocket.md: 添加 Chat 模块伪代码描述

### 2026-03-29 TTS 文件存储路径调整

**已完成功能：**
- TTS 生成的音频文件保存到 `uploads/tts/` 文件夹

**改动文件：**
- core/tts.js: 修改 TTS 文件保存路径

### 2026-03-29 控制端媒体库管理

**已完成功能：**
- 控制端添加媒体库 UI（添加/编辑/删除媒体库）
- 支持添加本地磁盘、HTTP远程、SMB网络共享三种类型媒体库
- 编辑媒体库：修改名称、只读模式、设为默认
- 删除媒体库

**改动文件：**
- public/js/media-library.js: 添加 showAddLibraryDialog, showEditLibraryDialog, onTypeChange, addLibraryFromForm, updateLibraryFromForm, deleteLibrary 方法
- public/css/media-library.css: 添加模态框和表单样式
- core/media-library.js: addLibraryFromConfig 支持 HTTP 和 SMB 类型配置
- server.js: POST /api/media-libraries 支持更多参数
- docs/spec/media-library.md: 更新伪代码描述

### 提醒功能
- 提醒类型：临时提醒、每天提醒
- 提醒方式：语音播报、弹窗提示
- 每次提醒重复次数：每次触发时重复播报/弹窗的次数（1-10次）
- 重复提醒：触发后按间隔时间再次提醒
- 编辑提醒：支持编辑已创建的提醒
- 单独测试提醒：可测试单条提醒，支持发送到选中显示端或所有显示端
- 媒体管理界面显示端选择：在媒体管理界面也可以选择显示端

### Bug 修复
- 修复提醒编辑弹窗无法显示问题（`.chat-modal-overlay.active` CSS 样式缺失）

### 配置文件目录
- 配置文件统一迁移到 `config/` 目录
  - `config/config.json` - 主配置文件
  - `config/chat-history.json` - 聊天历史记录
  - `config/media-libraries.json` - 媒体库配置
  - `config/reminders.json` - 提醒配置

### 显示端语音功能
- 显示端支持通过 tts.js 生成语音功能

### 控制端功能
- 合并播放和暂停按钮
- 画面填充和旋转按钮选中状态背景颜色切换
- 本地配置表（保存端口配置、语音服务地址等）
- 控制端媒体列表标注当前播放的媒体
- 保存显示端当前播放列表、画面填充设置
- 服务端重启按钮

### 页面交互
- 界面左侧页签导航

### 控制端查看显示端信息
- 显示端 navigator.userAgent
- 控制端显示列表新增详情按钮

### CSS 文件拆分
- display.html CSS 拆分到 `public/css/display.css`
