# Web MediaCenter - 未完成任务列表

## 功能完善

- ✅已完成 [2026-08-15][2026-08-15] Android APK 显示端（跨域控制增强）：WebView 包装 + 原生桥（真实像素截图 + 跨域输入注入），浏览器显示端保留并声明无跨域控制能力
  - 设计文档：docs/design/android-display.md
  - 实施计划：docs/task/2026-08-15_android-apk显示端.md
  - 实现：src/apps/android-display/（APK 工程）+ display.html 桥截图/输入链 + 能力声明 + 控制端提示
  - 待真机验证：目标盒子（三星 Note 8 / Android 9）系统 WebView 71 过旧无法运行 display.html 现代语法，Play Store 损坏无法更新，需解决 WebView 升级或换设备
- 重构ai开发流程

## 批量播放模式

- ✅已完成 [2026-08-14][2026-08-14] 批量播放模式：媒体库文件夹级批量播放
  - 文件夹「批量播放」按钮 → 模式设置框（递归/间隔/顺序随机/排序/方向/循环/播报文件名）
  - 服务端 PlaylistManager 扫描生成列表一次性下发，显示端本地自循环播放
  - 进度回传 + 暂停/继续/上一个/下一个/停止干预，单文件播放打断批量
  - 临时模式裁剪区多文件/文件夹批量上传
  - 改动文件：
    - src/apps/web-mediacenter/modules/media/playlist-app-service.js (新增)
    - tests/playlist-app-service.test.js (新增)
    - src/apps/server/boot/server-app.js
    - src/apps/web-mediacenter/ui/public/display.html
    - src/apps/web-mediacenter/ui/public/js/websocket.js
    - src/apps/web-mediacenter/ui/public/js/media-library.js
    - src/apps/web-mediacenter/ui/public/js/upload.js
    - src/apps/web-mediacenter/ui/public/css/upload.css
    - docs/design/batch-playlist.md (新增)
    - docs/spec/batch-playlist.md (新增)
