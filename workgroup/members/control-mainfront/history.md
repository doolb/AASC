# 专长画像
{}

## 经验约定

- 显示端浏览器会复用 localStorage 中的 displayId；服务端必须在同 ID 重连时关闭旧 WebSocket，并在 close 回调按 ws 对象身份校验，避免旧连接误删新连接。
- AASC 运行中服务优先使用 `npm run restart:server` 通过控制端重载；遗留 Puppeteer Chrome 可通过其 DevTools `Browser.close` 正常释放。

## 最近记录

- [2026-08-22] 关闭遗留 Agent Puppeteer Chrome（PID 3847490，display-fce1i3yy），修复 server-app 与 WSViewBindServer 的同 ID 重连清理，补充回归测试和 WebSocket 设计/spec 文档。
