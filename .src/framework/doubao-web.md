#skill: ai-code-translation

# framework/豆包网页运行时

## 已有声明

- 豆包官网页面提供浏览器登录态、网页签名方法、聊天与媒体请求 // 逐次签名须由当前页面生成
- Chat2API 提供账号、模型、Responses 流和错误映射 // 避免新增第二份聊天状态
- AASC 任务引擎提供常驻服务启动、停止和任务面板 // 统一运行生命周期

## 新增定义

- BrowserBinding { accountId, profilePath, browser, page, verifiedIdentity }
- DoubaoRequest { requestId, accountId, operation, payload, sessionId, deadline }
- DoubaoResult { requestId, upstreamStatus, events, media, conversationId }
- TaskState { running, address, activeAccount, pendingCount, lastError }

## 操作流程

- 读取任务参数并规范化浏览器路径、调试端口、账号与监听地址 // 配置经既有权威链路保存
- 为账号建立独立持久 profile 并打开豆包官网页 // 登录与验证码由用户在该页处理
- Android 用隔离进程 WebView 服务和随机令牌本机桥复用外部登录 Cookie // 不在 Node 子进程保存第二份浏览器资料
- 核对官网来源、当前账号身份、页面签名能力与请求额度 // 防止跨账号会话串用
- 生成当次用户消息、会话标识和模型参数 // 不复用抓包中的消息与旧会话
- 在页面内生成当次签名并调用同源请求 // 使官网前端参与逐次参数生成
- 将同次响应流按请求标识传回 Node 并解析终态 // 仅完整结果提交会话
- 将聊天、图片、视频、音乐和文件请求分别映射到任务能力 // 保持接口职责独立
- 文件上传依次执行 Prepare、签名 Apply、TOS、签名 Commit；文件问答加入附件块 // 上传和问答均固定账号
- 媒体及文件任务用临时页，请求流完成后关闭 // 避免累积官网标签页
- 将任务能力暴露为独立兼容 API 并接入现有 Chat2API // 保留现有应用调用入口
- 遇登录失效或安全验证时返回可识别错误并提示人工处理 // 不自动求解或改换账号
- 取消或停止时终止当前请求并释放监听与浏览器资源 // 已发送且结果未知时不自动重发
- 保留官网历史和原账号选择 // 用户此前要求暂不自动删除或切号
