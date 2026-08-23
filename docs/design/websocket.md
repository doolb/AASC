# WebSocket 通信设计文档

## 连接端点

| 端点 | 用途 |
|------|------|
| `/display` | 显示端连接 |
| `/control` | 控制端连接 |

## 显示端同 ID 重连生命周期

浏览器显示端会将 `displayId` 保存在 `localStorage`，网络抖动、页面刷新或测试浏览器重连时可能复用同一个 ID。服务端必须保证一个 `displayId` 只对应一个当前 WebSocket：新连接接管前关闭旧连接，旧连接的异步 `close` 事件不能删除新连接；连接登记层和业务层的显示端列表也必须保持单条记录。

验收条件：

- 同一 `displayId` 重连后显示端列表数量不增加。
- 旧 WebSocket 延迟触发 `close` 时，新 WebSocket 仍可收发消息。
- 当前连接关闭时才移除显示端并触发断开处理。

## 消息流向

```
控制端 ──────► 服务器 ──────► 显示端
        ◄──────       ◄──────
```

## 消息类型

### 服务器 → 显示端

| 类型 | 说明 |
|------|------|
| serverStartTime | 服务器启动时间 |
| displayId | 分配的显示端ID |
| url/base64 | 媒体数据 |
| control | 控制指令 |
| restoreState | 恢复状态 |

### 显示端 → 服务器

| 类型 | 说明 |
|------|------|
| canvasSize | 画布尺寸 |
| userAgent | 浏览器信息 |

### 服务器 → 控制端

| 类型 | 说明 |
|------|------|
| serverStartTime | 服务器启动时间 |
| displayList | 显示端列表 |
| displayState | 显示端状态 |

### 控制端 → 服务器

| 类型 | 说明 |
|------|------|
| getState | 获取显示端状态 |
| media | 发送媒体 |
| control | 发送控制指令 |

---

# 已完成功能

## 配置文件
 - ✅已完成 配置文件统一迁移到 `config/` 目录
   - config/config.json - 主配置文件（服务器端口、TTS配置、显示端状态、聊天配置）
   - config/chat-history.json - 聊天历史记录
   - config/media-libraries.json - 媒体库配置
   - config/reminders.json - 提醒配置
   - 改动文件：src/apps/server/modules/config/config-app-service.js（历史路径：src/core/config/config.js）

## 显示端语音功能
 - ✅已完成 显示端支持通过 tts.js 生成语音功能
   - 改动文件：src/external/tts/tts-service.js
   - 功能：播放媒体时，显示端会自动播放语音，语音内容是当前媒体的名称
