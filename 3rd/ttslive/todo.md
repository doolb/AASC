# TTS Live 实时语音对话系统

## 已完成功能

### 核心功能
- ✅ 基于 Node.js 实现实时 TTS 对话
- ✅ 支持 Ollama 本地 LLM (默认 huihui_ai/qwen3.5-abliterated:4B)
- ✅ 支持 OpenAI 兼容 API
- ✅ 支持 Ollama 上下文长度设置 (默认 4K)
- ✅ 服务器配置动态加载到前端

### TTS 语音合成
- ✅ 支持 Balcon TTS (Microsoft Xiaoxiao)
- ✅ 支持 TTS-API 远程服务
- ✅ 支持 GPT-SoVITS 语音克隆
  - 自动读取参考音频文件夹
  - 网页选择参考音频
- ✅ 按句子分割生成语音
  - 句子结束符: . ! ? ~ ～ 。 ！ ？ ； ; " " ' ' …
- ✅ TTS 生成后立即播放，不等队列完成
- ✅ 空内容不生成 TTS

### ASR 语音识别
- ✅ 支持 sherpa-onnx-node + SenseVoice 模型
- ✅ VAD 静音检测 (1s 静音自动停止)
- ✅ 语音输入有效性检查 (需包含中文/英文/数字)
- ✅ 无效语音自动忽略并恢复监听

### 对话打断功能
- ✅ 发送新消息时打断上一次 LLM 生成
- ✅ 新会话第一个音频到达时中断当前播放
- ✅ 服务器端会话管理，中断旧会话流式生成
- ✅ 前端 session_id 校验，跳过旧会话数据

### 不打断模式
- ✅ 默认开启"不打断"开关
- ✅ TTS 播放时停止录音
- ✅ 等待 LLM 生成完成且所有 TTS 播放完成后再恢复监听
- ✅ 防止 TTS 语音被 ASR 误识别
- ✅ 修复自动监听模式下 TTS 不播放的问题
  - 修复 `audioContext.resume()` 未被等待的问题
  - 修复 `wasListeningBeforePlayback` 初始化问题
  - 改进 `playNextAudio` 中的条件判断逻辑

### 自动化功能
- ✅ 浏览器打开自动开始监听
- ✅ 每 5 分钟自动清理 10 分钟前的音频文件
- ✅ 前端根据服务器配置设置默认选项

### UI 功能
- ✅ 3D 球体可视化音频效果
- ✅ 实时音频频谱显示
- ✅ 对话历史记录
- ✅ LLM/TTS 引擎选择
- ✅ 参考音频选择 (GPT-SoVITS)
- ✅ 不打断模式开关
- ✅ 浏览器自动播放解锁机制
  - 页面加载时显示解锁覆盖层
  - 用户点击后解锁音频播放
  - NotAllowedError 时自动显示解锁提示
  - 解锁后自动播放队列中的音频

## 配置说明

环境变量配置:
```
LLM_ENGINE=openai          # LLM 引擎: openai / ollama
TTS_ENGINE=ttsapi          # TTS 引擎: ttsapi / balcon / gptsovits

# OpenAI 配置
OPENAI_API_URL=http://192.168.1.12:8080/v1/chat/completions
OPENAI_MODEL=gpt-3.5-turbo

# Ollama 配置
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=huihui_ai/qwen3.5-abliterated:4B

# TTS-API 配置
TTS_API_URL=http://192.168.1.16:3000/api/tts

# GPT-SoVITS 配置
GPT_SOVITS_HOST=http://localhost:9880

# ASR 配置
SHERPA_ONNX_MODEL_DIR=models/sensevoice
```

## 运行

```bash
npm install
npm start
```

访问 https://localhost:8000 (需要 HTTPS 才能使用麦克风)