# Node子显示端退出与mpv回收（2026-10-24）

按TUI的`q`/`Ctrl+C`、操作系统`SIGINT`/`SIGTERM`/`SIGHUP`退出时，共用幂等的关闭协调器。协调器依序停止系统监控、等待VoiceDisplay释放录音/网络/媒体资源、销毁TUI，最后退出进程；多种退出来源同时到达时只执行一轮。

VoiceDisplay停止过程逐项尝试资源关闭，个别组件异常时仍必须关闭NodeMediaController。MpvPlayer现有会话回收通过mpv子进程SIGTERM，等待1秒后仍存活再SIGKILL；本次保留该有界回收语义。

范围只覆盖可捕获信号和应用键盘退出。`SIGKILL`、系统断电或内核直接终止进程不会运行Node清理代码，不能保证关闭子进程；该限制明确记录。退出测试通过实际独立mpv fixture验证按键入口最终关闭子进程、清除IPC临时目录，且重复退出只关闭一次。

修改`src/apps/voice-display-node/tui.js`、`main.js`、`shutdown-controller.js`及退出测试；Node独立包待重新构建。没有Android APK或服务端代码变更。
