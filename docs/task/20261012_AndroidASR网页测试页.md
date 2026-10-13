# Android ASR 测试 APK 网页版任务

## 任务描述

把 `android-asr` 测试 APK 的普通 SenseVoice ASR 和 Sherpa 声纹测试流程迁移为 Apache 可静态托管网页，浏览器模型根使用 Apache 同源 `/mnt/aimodel/`。用户已确认按已告知方案实施。暂不包含流式 ASR，也不部署网页到外网 Apache。

需求等级：L6 独立测试模块，评估 92/100；浏览器端基础声纹能力此前存在接口风险，已通过组合 WASM 对 base 模型实际完成 512 维提取、临时注册和匹配验证。

## Design 需求

- 文件选择/麦克风录音、音频回放、离线识别、临时声纹注册。
- 复现 APK 的 Sherpa 单段、多段、快速多段模式和自动/1–5 说话人数；显示分段/识别/embedding/总耗时。
- 仅加载 SenseVoice INT8 + tokens、ERes2Net base FP32；多段时加载 Pyannote INT8。
- 浏览器 Worker 内推理与注册库；不得上传音频、访问正式语音/声纹 API、持久化临时数据库。
- 不加载 GTCRN、不做流式识别；Apache 部署包由 npm script 本地生成。

## Spec 设计

见 `docs/spec/android-asr-web-test.md`：顺序加载模型，音频转 16 kHz 单声道；Worker 保持内存 Map；单/多/快速多段共用 APK 的阈值和后处理规则；构建只复制静态源码与固定 WASM 运行资产。

## 受影响模块与代码

- 新增 `3rd/tts-server/android-asr/web/` 页面、Worker、音频/分段模块及 `vendor/` 最小固定 WASM 资产和许可。
- 新增 `scripts/ops/build-android-asr-web.js`、`tests/android-asr-web.test.js`。
- 修改根 `package.json`、`.gitignore`、根 design/spec 索引、自测、usage、todo、changelog。
- 不修改 Android APK、AASC 正式 ASR/声纹服务、Apache 配置、模型同步内容或 Offline 发布状态。

## 自测用例

1. 构建输出包含首页、worker、JS/WASM、许可证，目标目录之外文件不被删除。
2. 模型路径固定使用 `/mnt/aimodel/` 同源地址和当前官方 base 文件名；缺模型/HTTP错误有明确提示。
3. WAV 解析、浏览器录音、16 kHz 重采样、空音频校验、URL/麦克风释放。
4. 使用测试 WAV 对 ASR、512 维 voiceprint 提取/注册/匹配、Pyannote 多段及快速模式做集成验证。
5. 单段/普通多人/快速多人结果结构、注册库同名替换、刷新清空；确保未调用正式 API 和流式路由。
6. `npm run test:android-asr-web`、静态文件语法、`git diff --check`；浏览器 Worker 加载 Smoke Test。

## 兼容性测试

- Chromium 桌面通过 HTTP 页面加载 WASM、音频文件与 HTTPS/localhost 麦克风。
- Firefox/Safari 做静态/WASM 能力边界检查；若专项设备不可用，记录未验收。
- 当前 Android WebView 不在正式产品链路内；移动浏览器的大模型内存占用单独说明。

## 性能测试

- 顺序加载模型，显示下载状态，避免重复创建 Worker/识别器。
- 记录本地短 WAV 的 ASR、embedding 和 diarization 耗时；浏览器主界面保持响应。
- 观察 WASM 内存与重复操作后资源释放；不将单机结果外推为手机性能保证。

## 风险评估与预计工时

- 主要风险为首次下载约 270 MB 模型、浏览器内存上限和手机浏览器较慢；同源 Apache、模型资源命名错误或跨源 CORS 也会阻止加载。
- 通过隔离 Worker、按需/顺序模型加载、逐项状态、零持久化降低风险；避免把声纹结果写进正式库。
- 预计约 3–5 小时，含网页、Worker、测试、文档和构建验证；不含 Apache 发布和移动设备现场验收。

## 执行结果

- 已完成独立静态网页、Worker 内 Sherpa WASM 推理、WAV/麦克风输入、单段/多人/快速多人声纹测试与临时注册管理；ASR 和声纹复用 APK 的基础模型文件名及阈值。WASM 就绪后自动 HEAD 检查 Apache 的四个模型资源，模型仍按功能首次使用时下载。
- 新增 `3rd/tts-server/android-asr/web/` 源码和固定 Sherpa JS/WASM 资产及许可；新增 `scripts/ops/build-android-asr-web.js`、`tests/android-asr-web.test.js`；根 `package.json` 增加 `build:web:android-asr` 与 `test:android-asr-web`，`.gitignore` 忽略生成目录 `3rd/tts-server/android-asr/web-dist/`。
- 更新根 design/spec 索引、对应设计与伪代码、自测文档、`docs/usage.md`、`docs/todo.md` 和 `changelog.md`。构建结果为 16 个静态文件、约 13.5 MB，不包含模型。
- `npm run test:android-asr-web` 4/4 通过；真实 Chromium 通过 HTTP 同源映射加载 WASM 与本地已同步模型，验证 SenseVoice、512 维声纹注册、Sherpa 单段、Pyannote 多段及快速多人流程。ASR 返回“你好啊你好啊你好啊。”；三种声纹流程均成功完成并返回分段/匹配和阶段耗时。
- `node --check`、`git diff --check` 通过。未测试真实设备麦克风、Firefox/Safari 与手机性能；Apache 网页尚未部署。本次未修改 APK、服务端业务 API、Apache 配置或 Offline 发布状态。
- 后续补测 `res/models/sensevoice/zh.wav`、`en.wav`（与 `3rd/ttslive/models/sensevoice/` 同名副本 SHA-256 一致）：自动语言模式分别识别为“开放时间早上9点至下午5点。”与“The tribal chieftain called for the boy and presented him with 50 pieces of gold.”。网页显示解码耗时 2831 ms、3824 ms；按钮到结果分别 7537 ms（含本机首次模型装载）和 3981 ms（模型已热）。
- Apache 模型 sidecar 与本地 SenseVoice SHA-256 均为 `c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51`；tokens.txt 两端 SHA-256 均为 `f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc`。因此本次浏览器识别使用与 Apache 校验一致的模型文件经本机同源 HTTP 映射；直接冷下载 239,233,841 字节模型在 180 秒测试窗口内未完成，1 MiB Range 实测约 0.66 MiB/s。ASR 耗时只计模型就绪后的音频解码阶段。
