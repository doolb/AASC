# Native AudioRecord 音量柱修复

日期：2026-10-10；状态：原因已定位，代码方案待用户确认，尚未修改代码。

需求：原生 AudioRecord 采集时，音量柱应跟随真实声音。控制端目前只有录音能力“监听”入口，没有实时/单次模式专用切换；本轮询问位置不视为要求新增入口。

设计：docs/design/display-voice-conversation.md 的待确认方案；原生 PCM 已计算 RMS，绘图却只读取 WebView AnalyserNode，因此原生采集进入待机动画。

伪代码：docs/spec/display-voice-conversation.md；有效 PCM 更新 RMS 与时间，唯一动画循环读取平滑音量，过期衰减；暂停/停止清零，浏览器保持频谱路径。

受影响代码：display.html、js/pcm-audio-capture.js；新增针对真实原生 PCM 与实际绘图函数的自测，并运行既有语音 UI、采集和生命周期回归。

自测：静音与不同幅度 PCM 的柱高变化；无 AnalyserNode 的原生监听；暂停/恢复/停止和过期信号；浏览器频谱、数组复用和单个动画循环。

兼容/性能：不修改 Android 桥接协议、采样率、VAD、ASR、声纹及状态栏显隐；不增加 AudioContext、录音链路或每帧数组。实际 Android 音量反馈需设备验收。

风险：RMS 是音量而非频谱；应明确视觉含义，避免陈旧信号卡在高柱。预计工时 20–40 分钟，发布校验另计。

需求分析：主 L4，单一采集到绘图的数据衔接；证据为 native 有 latestRms、原图仅检测 analyser、原生没有该节点。可开发，置信度 0.90，评分 94/100，风险低，无需能力下放，按上述输入、清理与绘制步骤落地。既有发布授权保留，新增代码须先确认。
