# Node Linux TTS共享输出

状态：用户确认后，先更新伪代码再完成代码及自动测试；目标设备部署混音待验。

- 任务描述：处理Linux TTS通过aplay默认ALSA设备播放时报Device or resource busy的问题。
- design需求：docs/design/node-display-mpv.md的Linux TTS设备占用章节。
- spec设计：docs/spec/node-display-mpv.md的共享输出伪代码；保留aplay，自动选择可达共享入口或显式设备。
- 受影响模块与代码：新增src/apps/voice-display-node/linux-audio-output.js；修改audio-player.js/main.js/config.example.json，补Node音频设备选择与原队列/取消/Windows回归，更新使用与自测文档。
- 自测用例：Pulse与PipeWire可达/不可达、ALSA插件/探测命令缺失、超时、显式PCM、安全独立参数、探测缓存、停止与owner取消后的旧代次隔离、PCM/AEC只一次、原TTS录音回调与字幕通知。
- 兼容性：Windows保留PowerShell，Linux无共享服务时仍可使用default或显式ALSA设备；mpv与TTS需要处在可达同一共享音频会话内，DISPLAY认证不等于音频会话认证。
- 性能：有界探测且按实例缓存，避免逐句探测；已开始的播报不自动跨后端重试，防止重复。
- 风险：目标可能与工作机不同；插件存在不等于服务可达；不同用户/会话可能无法访问共享服务，自动回退default不能保证解决所有硬件占用。
- 当前诊断：用户日志已确认下载完成、错误发生于ALSA打开；工作机arch0的pactl显示PipeWire兼容层，aplay列出pulse/pipewire，fuser显示播放PCM由pipewire占用。诊断阶段仅只读检查；后续工作机静音验证观察到pulse输出流，无系统配置变更。
- 已确认：加入自动/显式共享输出选择；不修改目标机系统ALSA配置或停止其他进程。
- 预计工时：约1～2小时；适配与定向回归已完成，实际目标混音验收另计。
- 验证入口：优先npm run test:node-display-mpv与现有配置/独立包测试；mpv50/50、配置4/4、独立包22/22、语音/重连/Windows输入22/22，共98项自动测试通过；显式PCM、真实超时进程、停止与owner取消、AEC及原Windows路径均覆盖。

- 实机验证边界：工作机全静音音频经aplay的pulse共享输出播放完成；mpv与TTS同时输出未确认，不声明目标故障已验收。
- 发布：voiceDisplayNodePackage原已true，保持待构建；其他产物状态保留，未构建发布包。
