# Web MediaCenter - 未完成任务列表

## 功能完善

- ✅已完成 [2026-08-16][2026-08-16] Android 显示端 GPU Compute 桥（GLES 3.1 离屏计算）
  - 设计文档：docs/design/android-compute-bridge.md
  - 实施计划：docs/task/2026-08-16_android-gpu-compute桥.md
  - 实现：ComputeEngine.kt（离屏 EGL 3.1）+ ComputePixels.kt（像素翻转/通道）+ NativeBridge.compute() + JS NativeCompute 封装
  - 真机验证（三星 Note 8 / Android 9 / display 2）：数值翻倍 [2,4,6,8]、坏 shader 合法 JSON 错误、Float32Array 归一化、图像上下/红蓝正确
- ✅已完成 [2026-08-15][2026-08-15] Android APK 显示端（跨域控制增强）：WebView 包装 + 原生桥（真实像素截图 + 跨域输入注入），浏览器显示端保留并声明无跨域控制能力
  - 设计文档：docs/design/android-display.md
  - 实施计划：docs/task/2026-08-15_android-apk显示端.md
  - 实现：src/apps/android-display/（APK 工程）+ display.html 桥截图/输入链 + 能力声明 + 控制端提示
  - 真机验证（三星 Note 8 / Android 9，WebView 升级到 132 后）：
    - 跨域 html（example.com）原生截图稳定回传（1280x623，mode=native）
    - 无障碍真实触摸注入生效（InputDispatcher Delivering touch to WebView）
    - 能力声明 crossOriginControl:true 正常上报
    - 原生桥截图改同步返回（回调式在 WebView 不可靠）
- ✅已完成 [2026-08-16][2026-08-16] html 模式持久化 + 显示端自动刷新 + 控制端主动刷新/重载服务端 + 视频自动播放
  - html 滚动模式持久化到服务器，显示端重启后恢复
  - 显示端每 8 秒轮询 /api/display-version 自动 reload（无需重启 APK）
  - 控制端「刷新」按钮主动刷新显示端；系统设置「重载代码」按钮重启服务端
  - 视频自动播放 muted 绕过拦截（真机视觉待用户确认）
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
