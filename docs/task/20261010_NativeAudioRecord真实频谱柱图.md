# Native AudioRecord 真实频谱柱图

## 任务描述
修复 Native AudioRecord 录音模式下音频监视图所有柱子高度相同的问题，使柱图表达 PCM 的不同频率成分，同时保持现有录音、VAD、WAV 和 ASR 数据流。

## Design 需求
- Native AudioRecord 继续只回传 PCM16。
- JavaScript 采集器基于固定 PCM 窗口计算 Hann 窗 FFT。
- 将正频率幅值按对数频段合并为显示柱数据。
- RMS 继续供 VAD 使用，不再复制为所有柱高。
- 暂停、停止和数据超时清除频谱显示。

## Spec 设计
- `NativePcmAudioCapture.feedPcm16` 解码 PCM、计算 RMS、累计 FFT 窗口并更新 `latestSpectrum`。
- `drawNativeMonitor` 按每个频段独立平滑并绘制柱高。
- 浏览器 `AnalyserNode` 路径保持不变。

## 受影响模块和代码
- `src/apps/web-mediacenter/ui/public/js/pcm-audio-capture.js`
- `src/apps/web-mediacenter/ui/public/display.html`
- `tests/display-native-audio-monitor.test.js`

## 自测用例
- Native PCM 静音、低音量、高音量生命周期。
- 纯音输入产生不同频段柱高。
- 数据超时、暂停、恢复和停止清除旧频谱。
- 浏览器 AnalyserNode 复用路径不回归。

## 兼容性测试
- Node.js 内置测试运行时。
- Native AudioRecord 仍使用既有 PCM16/16kHz 桥接契约。

## 性能测试
- FFT_SIZE=256，每约100ms PCM块更新频谱；计算量限制在页面端短窗口内。

## 风险评估
- 频谱柱是短时幅值估算，不等同于专业音频分析仪。
- 低频分辨率受 256 点窗口限制；柱图显示使用对数频段以提高语音频段可见性。

## 预计工时
约 1 小时。
