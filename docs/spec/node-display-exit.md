# Node子显示端退出实现伪代码（2026-10-24）

```text
已有声明 := TUI(q/Ctrl+C)、main(SIGINT/SIGTERM)、VoiceDisplay.stop、NodeMediaController.close、MpvPlayer.close/disposeSession
新增定义 := ShutdownController { pending, stopMonitor, stopDisplay, destroyTui, exit, reportError }

按键退出 := 非文本输入模式收到q/Ctrl+C → TUI.onExit → shutdown(0)
系统退出 := SIGINT/SIGTERM/SIGHUP → shutdown(0)
启动失败 := VoiceDisplay.start失败 → shutdown(1)
协调 := 若pending存在则返回同一Promise；否则先停止监控，再停止显示端，再销毁TUI，最后按退出码结束进程
组件回收 := VoiceDisplay.stop逐项停止录音/音频/ASR/WebSocket/快捷键；任一项异常只记录并继续；最后仍关闭media
mpv回收 := MpvPlayer.close → disposeSession → SIGTERM → 最多等待1秒 → 仍存活则SIGKILL → 最多等待1秒 → 删除本次IPC临时目录
失败 := 协调步骤继续执行；清理步骤失败报告错误并将最终退出码设为1
不可捕获 := SIGKILL/断电/内核终止不会执行用户态清理，不承诺主动回收子进程
验收 := TUI退出入口调用一次stop；重复退出共享Promise；实际mpv子进程最终结束且临时目录移除；SIGINT/SIGTERM/SIGHUP共用协调器
```
