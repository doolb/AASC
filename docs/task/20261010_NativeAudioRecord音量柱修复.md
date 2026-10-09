# Native AudioRecord 音量柱修复

日期：2026-10-10；状态：实现、93项最终定向回归及code56内外网发布完成，手机现场待验收。

需求：原生 AudioRecord 采集时，音量柱应跟随真实声音。用户随后确认控制端模式按钮放到“监听 VAD / 底噪检测”卡片，已单独实现，与原生绘图合并发布。

设计：docs/design/display-voice-conversation.md 的待确认方案；原生 PCM 已计算 RMS，绘图却只读取 WebView AnalyserNode，因此原生采集进入待机动画。

伪代码：docs/spec/display-voice-conversation.md；有效 PCM 更新 RMS 与时间，唯一动画循环读取平滑音量，过期衰减；暂停/停止清零，浏览器保持频谱路径。

受影响代码：display.html、js/pcm-audio-capture.js；新增针对真实原生 PCM 与实际绘图函数的自测，并运行既有语音 UI、采集和生命周期回归。

自测：静音与不同幅度 PCM 的柱高变化；无 AnalyserNode 的原生监听；暂停/恢复/停止和过期信号；浏览器频谱、数组复用和单个动画循环。

兼容/性能：不修改 Android 桥接协议、采样率、VAD、ASR、声纹及状态栏显隐；不增加 AudioContext、录音链路或每帧数组。实际 Android 音量反馈需设备验收。

风险：RMS 是音量而非频谱；应明确视觉含义，避免陈旧信号卡在高柱。预计工时 20–40 分钟，发布校验另计。

需求分析：主 L4，单一采集到绘图的数据衔接；证据为 native 有 latestRms、原图仅检测 analyser、原生没有该节点。可开发，置信度 0.90，评分 94/100，风险低，无需能力下放，按上述输入、清理与绘制步骤落地。既有发布授权保留，新增代码须先确认。

实施及验证：新增 tests/display-native-audio-monitor.test.js 三项真实 PCM/绘图用例，静音、轻声、较大音量柱高、500ms 超时衰减、暂停及恢复清零、停止、全局/TTS 暂停、浏览器频谱数组复用和每帧唯一请求通过；联合 display-voice-ui、display-asr-audio-pipeline、display-audio-capture-config 四文件共16/16通过，无跳过。未修改原生代码；真实设备待验收。

2026-10-10 最终发布：code-v56.zip已发布LAN/WAN，16,936,308字节，SHA-256 3ca3606613e95faa931daa8a974154f2776a6cd6e087beba525cf3d421731e42；源提交34671c31。931文件快照及运行资源完整、ZIP CRC/RSA/组件约束、内外网全部组件HTTP大小/SHA-256通过，签名清单完全一致，精确清理无错误，两端code目录仅保留code-v56.zip。21文件93/93通过，无跳过；servicePackage=false，minApk=true/dependenciesPackage=false保持，未构建原生APK或恢复旧声纹。手机现场验收保留。
