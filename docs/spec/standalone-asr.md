# 独立语音识别实现伪代码

```text
项目 := /mnt/asr {android, web, models/sensevoice}
模型 := model.int8.onnx + tokens.txt；两端各自本地加载
录音按钮点击 → 请求麦克风权限 → PCM 采集 → RMS 检测
RMS >= 0.01 → 记录语音开始和最后有声时间
语音 >= 300ms 且静音 >= 500ms → 提取当前音频 → SenseVoice 识别 → 显示结果
点击停止 → 释放麦克风；识别异常或权限拒绝 → 显示错误并释放资源
WAV 输入 → 转为 16kHz 单声道 → SenseVoice → 结果
无声纹、流式识别、降噪模型及相关界面
```

```text
识别进行中 → 不缓存新语音；播放与模型均在本机
静态服务仅暴露 web 与 models/sensevoice，默认监听 127.0.0.1
Android 模型随 APK 打包，首次启动复制到私有目录；WAV 仅接受 PCM 16-bit
```

```text
网页入口 URL := /mnt/asr/；模型根 := 相对网页入口 ../aimodel/sensevoice/
Worker 位于 js 子目录 → 相对于 Worker 解析 ../../aimodel/sensevoice/
本地预览 /mnt/asr/ → web 目录；/mnt/aimodel/sensevoice/ → 本地 SenseVoice 模型
静态发布仅包含网页文件；模型使用站点已有 aimodel 目录
```

```text
Worker WASM 就绪 → prepare 加载模型和词表、创建识别器 → 成功才启用录音及 WAV 识别
加载或初始化失败 → 禁用录音 → 展示错误与重试；运行时失败 → 提示刷新重试
PCM → 同一 RMS 值更新按钮内填充；红线位置对应同一 VAD 阈值
VAD 输出当前语音持续时间、静音剩余时间和截止原因 → 界面显示等待/说话/静音倒计时/识别
短语音结束 → 丢弃并继续等待；有效语音静音 500ms 或上限 59s → 提交识别
```

```text
模型、词表响应 → Cache-Control public/max-age=0/must-revalidate + ETag + Last-Modified
If-None-Match 匹配 → 304；否则按 If-Modified-Since 判断（仅无 If-None-Match）
不匹配或文件变化 → 200 和当前内容；浏览器决定是否存储与复用
线上 Apache 规则精确匹配两个公开资源，本地预览使用文件大小与修改时间生成 ETag
Sherpa IndexedDB 继续禁用；模型载入与初始化状态逻辑不变
```

```text
Android 加载内置模型 → 禁用录音和 WAV → 成功开启，失败显示错误与重试
Android 麦克风 PCM → VAD 单一 RMS 与阈值 → 圆按钮高度和红线
语音进行 → 显示时间；低于阈值 → 显示 500ms 截止倒计时
最短语音不足 → 丢弃；有效语音遇静音截止或 59s 上限 → 异步识别
停止、页面不可见或失败 → 停止采集、清空音量展示；只在模型就绪时允许重新开始
```
