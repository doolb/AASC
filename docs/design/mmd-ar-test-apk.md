# MMD AR 独立测试 APK / HTTPS 网页设计

## 状态

- 设计日期：2026-09-23
- 2026-09-24 增加同一测试页的 HTTPS 静态网页形态，发布到 `https://c.aasc.us/mnt/mmd-ar/`；原 APK 构建保留作回归基线。
- 状态：独立 APK 已加入当前 JS 跟踪器与 MindAR 1.2.5 的单摄像头 A/B 对比，并为 Android 启动阶段加入诊断和 Insets 空值降级；MindAR 编译回调缺失已修复并显示编译进度/启动错误，当前修正版已上传外网，实际相机图片跟踪数据和布料物理仍待现场验收
- 工程位于 `3rd/mmd-ar-test/`；原测试 APK 不依赖 AASC 服务、不替换正式 APK，但后续停止维护，继续维护 HTTPS 测试页。

## 1. 目标

### HTTPS 网页形态

浏览器直接打开 `https://c.aasc.us/mnt/mmd-ar/` 测试同一套默认米娅 PMX、图片定位、当前 JS/MindAR 跟踪器、灯光、VMD/布料物理和拖动旋转，不安装 APK，也不运行 AASC 服务。网页静态资源全部同源，模型、MindAR 与 Three.js 在构建时校验/打包，不在运行时依赖第三方 CDN。浏览器只在用户启动定位时请求摄像头许可。

网页部署在 `/mnt/mmd-ar/` 子路径下，构建时只改生成副本的资源 URL；原显示端文件与 APK 本地路由不变。网页与 APK 的浏览器 origin 不同，原 APK 保存的定位图和灯光设置不会自动迁移，首次网页使用需要重新校准。实际识别成功率仍需手机现场验证。

HTTPS 测试页提供独立的模型加载进度条：PMX 主文件下载、纹理项完成、VMD 下载与模型/物理初始化分段展示，模型真正可显示才报 100%。百分比为分段权重进度，并非全部资源的精确字节占比；服务器没有提供长度时，保留阶段提示而不伪造下载字节数。进度回调为可选项，测试 APK 和正式显示端不传入，界面保持现状。

独立 HTTPS 页在视口或舞台尺寸变化时调用已有 `DisplayMmd.resize()`，WebGL 画布、相机宽高比和 AO 绘制缓冲随之调整。正式显示端的灯光面板标题后增加只读 Canvas 绘制缓冲宽×高像素，并由共用灯光脚本在画布变化时更新，HTTPS 页直接复用；这反映实际渲染分辨率，不是 CSS 视口大小或手机屏幕标称分辨率。沿用渲染器最多 2 倍像素比的性能上限。独立测试 APK 后续不再维护。

提供可独立安装启动的 Android 测试 APK，用于现场验证图片基准图 AR 与当前默认 PMX。页面、AR 跟踪代码、PMX 模型和所需配套资源全部随 APK 提供；运行时不访问 AASC 服务或公网。

测试对象为默认 `miya-default`：米娅 PMX、该模型声明的纹理资源和当前默认循环 VMD。只打包这一套模型资源，不包括其他 PMX/VRM、LLM、ASR、TTS 或 AASC Node 服务。

## 2. 保留的交互能力

- 图片拍摄、四角选区、定位图本地保存、摄像头跟踪和模型姿态叠加。
- 当前 PMX 灯光设置面板和本地持久化。
- PMX/VMD 运行动画与布料/刚体物理。
- 在模型上拖动旋转；点按与拖动的语义沿用现有显示端实现。
- 相机首次使用时由 Android 系统申请 CAMERA 权限；系统权限弹窗期间保留待授权请求，普通退出/切后台时停止跟踪并释放摄像头。

## 3. 架构

```text
3rd/mmd-ar-test/
├── Android 测试工程
│   ├── 仅绑定 127.0.0.1 的 APK 内置静态 HTTP 服务
│   ├── 单独测试 Activity 与相机授权
│   └── 本地静态 HTTP 服务只提供 MMD profile 和 APK assets
├── MMD AR 测试页面
│   ├── 复用 web-mediacenter 的 MMD、PMX、AR、跟踪及灯光模块
│   ├── 仅在测试 APK 内提供当前 JS / MindAR 跟踪器选择与指标面板
│   └── 仅提供模型舞台、定位面板和灯光面板
├── model-manifest.json
│   └── 当前默认 PMX 及配套资源的固定长度和 SHA-256
└── output/
    └── aasc-mmd-ar-test.apk
```

APK 启动时会在固定回环地址 `127.0.0.1:17836` 上启动静态 HTTP 服务，从 APK assets 提供页面、模型、纹理、动作和 WASM。固定 origin 确保跨启动保留 IndexedDB 定位图和本地灯光设置。WebView 只允许访问该回环 origin；服务不绑定 LAN 地址，也不启动 AASC/Node 服务。相机仅在网页请求视频捕获时申请 Android CAMERA 权限，WebChromeClient 只授权本地 origin 的视频捕获。

Android Activity 按窗口、本地资源服务、WebView 创建和页面加载分阶段启动。窗口内容挂载并获得焦点后才读取 `window.insetsController` 并请求沉浸式显示；若 controller 为空或厂商窗口 API 报错，恢复普通系统栏和默认内容布局后继续运行。同步启动异常会记录阶段与完整堆栈，并展示可截图、可选择文字的错误页；WebView 恢复失败或渲染进程退出时也显示诊断页。此诊断不改变相机权限时机或权限范围。

## 4. 资源边界

- 下载源使用已发布的 `miya-v1` 固定资源，构建前逐文件核对 manifest 声明的大小和 SHA-256。
- PMX、纹理与默认 VMD 存放在本地构建缓存并进入 APK assets；缓存和 APK 均不提交 Git。
- JS/CSS/Three.js/Ammo 仅从当前仓库现有显示端源码中按清单打包，避免复制维护另一份运行时实现。
- APK 内模型 URL 限于 `/api/mmd/static/` 固定前缀；HTTP handler 只接受 GET/HEAD 和静态 allowlist 路径，拒绝路径越界、非回环访问及外部资源回退。
- 测试 APK 固定内置 MindAR 1.2.5 的识别运行时代码和 Apache-2.0 许可证，构建下载缓存和 APK asset 均逐文件校验大小/SHA-256；运行时不访问 CDN。
- MindAR 运行时代码仅在用户选择 MindAR 时从 APK 本地资源动态加载；当前 JS 跟踪器仍为默认选项。两种算法不并行运行，不创建第二个摄像头流或 Three.js/MMD 场景渲染器，并复用当前 IndexedDB 中相同的参考照片和四角选区。MindAR 每轮将选区透视校正为独立目标图并重新编译；首锁时间包含首次本地 JS 模块加载，但不包含相机授权等待。
- 指标记录目标准备/编译耗时、识别首锁耗时、算法识别帧率、按时间加权的可见率、丢失次数和屏幕锚点 RMS 偏差。MindAR 不提供匹配置信度，测试页面明确不显示伪造的置信度值；锚点偏差需在目标静止时测量才可近似表示抖动。

### 4.1 跟踪器 A/B 对比范围

- 对比入口和 MindAR 适配器只注入到生成的 `3rd/mmd-ar-test/` 测试 APK 页面，不写入正式 `display.html` 或生产显示端 tracker。
- 一次只运行一个算法；每轮都使用同一保存目标、选区、视频层和现有 MMD 姿态映射。算法初始化计时从 tracker 启动开始，不含系统摄像头授权等待。
- 当前 JS 的“准备时间”统计参考图载入/特征提取；MindAR 统计选区矫正/目标编译。两者是各自引擎对应的目标预处理阶段，结果用于设备侧对比，不宣称算法内部操作完全相同。
- “识别帧率”按各 tracker 实际产出的新识别样本计数，MindAR 由其 `processDone` 回调计样本，避免把重复读取的旧姿态算成新帧；可见率按时间加权，减少两种引擎帧率不同造成的抽样偏差。
- MindAR 运行时状态不得在共享摄像头已就绪后继续显示“请求摄像头权限”：目标编译期间明确提示引擎准备阶段，启动后切换为寻找定位图，错误仍由共享 AR 状态机显示。
- MindAR `Compiler.compileImageTargets` 调用必须提供进度回调；进度同步到定位状态和 A/B 提示，编译/初始化失败时显示具体错误，禁止继续显示“正在寻找定位图”。
- 竖屏测试页左上提示需为右上灯光按钮及安全 Insets 留出完整宽度；长文案允许换行，横屏布局保持现状。该规则只作用于独立测试 APK 的生成页。

## 5. 明确不做

- 不包含 AASC server、Node Runtime、WebSocket、控制端、聊天、LLM、ASR、TTS、媒体上传或热更新。
- 不改正式显示端的默认启动流程和服务器 MMD 发布流程。
- 不包含除 `miya-default` 外的模型或模型选择功能。
- HTTPS 网页单独发布到 `/mnt/mmd-ar/`，不覆盖安装正式 APK，也不修改 Offline 服务更新清单。
- 不切换生产默认跟踪算法，也不在 Offline/正式 APK 引入 MindAR。

## 6. 验收标准

1. `npm run build:apk:mmd-ar-test` 可构建独立 APK，applicationId 为 `com.aasc.mmdartest`，与 AASC 正式/Offline APK 不同。
2. APK 离线启动后自动加载米娅 PMX 与默认 VMD；无服务器地址输入、连接提示或 AASC 服务进程。
3. 图片校准与本地跟踪可申请和使用摄像头；结束或切后台时释放轨道。
4. 灯光面板正常，PMX 布料/刚体物理继续运行，模型拖动旋转有效。
5. APK 只包含固定的默认模型资源；模型完整性检查通过，且 APK 中没有 Node 服务/额外模型。
6. 在真实 Android 设备上验证相机授权、WebGL、VMD/布料物理、灯光和旋转交互。
7. 同一设备分别运行两个 tracker，比较准备/编译、首锁、实际识别帧率、时间加权可见率、丢失次数和静止目标锚点偏差；确认 MindAR 资源全部来自 APK 本地。
8. MindAR 摄像头就绪后，编译期间提示“MindAR 准备中”而非“请求摄像头权限”；引擎启动后显示寻找定位图状态。
9. MindAR 目标编译持续回报进度；编译失败时显示错误并且不启动 Controller。
10. 竖屏窄视口下顶部说明可换行且不覆盖灯光按钮；横屏布局不发生回归。

## 7. 风险与处理

- WebView 本地页需被识别为安全来源：使用 `127.0.0.1` 回环来源，并由 WebChromeClient 只授予本地 origin 的摄像头视频捕获权限；静态服务仅绑定回环地址。
- 当前工作区不含 PMX 二进制：构建工具按固定资源清单下载，并在构建前校验长度/SHA-256；下载或校验失败即终止。
- Android 设备 WebView/图形驱动的 PMX 物理表现可能不同：测试 APK 保留明确状态提示，最终视觉与性能仍需真机验收。

## 8. 当前真机验证记录

- SM-N9500 / Android 9（API 28）通过 ADB 安装 `aasc-mmd-ar-test.apk`，包名为 `com.aasc.mmdartest`；停止旧实例后，单实例已切换到内屏 display 0 前台运行。
- APK 内回环 HTTP 服务可提供主页、`miya-default` profile、PMX 和默认 VMD，测试请求均返回 HTTP 200；访问经 ADB forward 验证，转发端口随后已移除。
- 内屏起初处于 OFF；发送唤醒键后 display 0 状态变为 ON。ADB 截图可见测试页面控件和米娅 PMX 模型，证明 WebView/WebGL 可见渲染通过。
- Insets 真机值为 top 24、right 48 CSS px（对应设备物理 Insets top 42、right 84 px）；灯光/定位控件按 Insets 移入安全区域。触摸日志确认两个按钮 DOM target 正确，灯光与定位面板均可打开/关闭，模型拖动旋转继续可用。
- 完整相机授权、图片校准/跟踪和布料物理验收仍待现场执行。
- 2026-09-24 状态/竖屏布局修正版 APK 大小 `13,620,354` bytes，SHA-256 `3409e3e6a182339118b5cc09a32ce3e5ca0aea46a6e9e5bbe45f980dc548174e`；已覆盖安装 SM-N9500 / Android 9/API 28 并在 display 0 前台运行。临时切换竖屏截图确认左上提示与右上灯光按钮无重叠；设备自动旋转设置已恢复。相机授权后的 MindAR 编译与首锁未实测。
- A/B 版内置 MindAR 1.2.5，编译缓存与许可证在 APK 中；现场对比结果尚未采集，当前生产显示端仍只使用原 JavaScript tracker。
- 若旧 Activity 仍存活时再以另一 display 启动一个 Activity 实例，固定端口会导致第二个实例绑定失败。测试时通过停止旧进程再单实例启动绕过；如何支持多实例/重复启动待确认后处理。

## 9. Android WebView 触摸安全区域

- Android 沉浸式窗口的绘制 frame 可能大于应用实际可用区域；控件布局不能只依赖 CSS `env(safe-area-inset-*)`，因为旧版 Android WebView 未必提供对应值。
- Activity 读取当前窗口 Insets，将实际安全距离按 WebView CSS 像素换算后写入页面 CSS 自定义属性；测试页的右上角灯光/定位控件据此向内偏移。
- Activity 记录右上区域原生触摸的 raw/local 坐标；测试页记录 DOM `pointerdown`/`click` 目标与面板状态，通过 WebChromeClient console 日志对照验证事件链；蓝色点击高亮不作为事件成功的唯一依据。
- 测试 harness 必须保留 `.display-interaction-layer` 的 `z-index: 50` 层叠上下文；只抽取内部按钮会使 `z-index: 10` 的交互 canvas 抢占 DOM hit-test。
- 修复仅作用于 `3rd/mmd-ar-test/` APK，不修改正式显示端共享 CSS/JS；验收需确认灯光面板和定位面板均可开合，模型拖动旋转仍有效。
- 根因：独立测试 harness 只抽取灯光/定位控件，没有保留正式页面 `.display-interaction-layer` 的 `z-index: 50` 层叠上下文，导致 `z-index: 10` 的 MMD canvas 抢占 DOM 命中。补回交互层包装后，pointerdown/click 均命中按钮；动态 Insets 同步同时解决右侧布局落入系统安全区的问题。

## 10. 跟踪器 A/B 版本设备冒烟

- 更新后的独立 APK 大小 `13,607,730` bytes，SHA-256 `7ece4967af75858667c1b300d8d9c5d2d893ee5cd08c4ed04094408cf508131c`；APK ZIP 完整性和 APK v2 签名验证通过。APK 内 14 个模型文件及 6 个 A/B 资源通过构建时内容验收。
- 已覆盖安装到 SM-N9500 / Android 9 / API 28 并在 display 0 启动；ADB 截图可见米娅 PMX、定位面板和算法选择器，能在“当前 JS”与“MindAR 1.2.5”之间切换。
- 经临时 ADB 回环转发读取 APK 内的 MindAR 入口脚本、Controller chunk 和 UI chunk，下载响应 SHA-256 与构建清单一致；临时转发已移除。LICENSE 已由 APK 内容验收校验，但本地静态服务不开放其 HTTP 路径。
- 本次未触发摄像头权限、未拍摄环境图，也未开始实际跟踪；因此没有首锁/识别帧率/可见率/丢失/锚点偏差的真机 A/B 数据，需使用可控纹理目标现场测试。
