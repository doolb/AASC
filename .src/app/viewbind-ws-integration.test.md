#skill: ai-code-translation

# 应用集成自测

## 模块
app

## 目标文件清单
- `src/apps/server/boot/server-app.js` // 替换 AASC 后的功能验证

## 测试场景

### 显示端生命周期

- 显示端连接后 controlClients 收到 displayList 更新
- 显示端断连后 controlClients 收到 displayList 更新（列表变短）
- 多个显示端并发连接全部可追踪

### 控制端生命周期

- 控制端连接后收到当前 displayList
- 多个控制端都独立收到 broadcast

### 消息转发

- 控制端发送 media 到指定显示端，显示端收到
- 控制端发送 control 到指定显示端，显示端收到
- 显示端上报 canvasSize，控制端广播中体现
- 显示端上报 browserInfo，控制端广播中体现

### 边界情况

- 无效 JSON 不崩溃
- 未知消息类型不崩溃
- 空消息不崩溃
- 急速连接/断开不泄漏

### 与现有 fallback 等价验证

- handleDisplayMessageFallback 中的逻辑在新 handler 中行为一致
- handleControlMessageFallback 中的逻辑在新 handler 中行为一致
- broadcastDisplayList 输出格式与现有 getDisplayList() 一致
