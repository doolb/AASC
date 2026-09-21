# Web MediaCenter - 未完成任务列表（更新于 2026-09-21）

## 控制端

- ⏳可选任务 [2026-08-31] 能力拆分为内置任务或用户任务
  - 候选：天气查询、媒体搜索/播放、提醒管理、显示端控制、TTS 生成、系统诊断、RSS/数据处理和自定义工作流。
  - 建议优先级：`weather.query` → `media.search` → `reminder.*` → `display.control`。
  - 当前仅登记方案，暂不实现，也不创建对应任务实例。

- ⏳待处理 [2026-08-30] Pi Agent 主动压缩上下文
  - Pi AgentSession 自带上下文压缩能力，当前 PiRuntimeManager 暂不封装手动压缩入口和自动阈值触发；保留后续增加控制端按钮或按上下文占用触发的需求。
  - 关联任务：`docs/task/2026-08-30_Pi主动压缩暂不实现.md`。

- ⏳待处理 [2026-08-30] 群聊统一历史中的旧工具调用异常文本
  - 现象：未指定角色的群聊使用 `group/default` 历史时，可能收到并播报 `[Error: write after end]`。
  - 疑似来源：旧 Pi Agent/工具调用流程遗留的未闭合 Chat2API 工具调用记录；当前历史中存在 `profileName=qwen3.5`、`templateId=default` 的异常内容，具体产生流程待后续确认。
  - 已完成当前 Chat2API canonical 工具标签解析残留修复；历史中已经保存的异常消息和 `write after end` 清理仍暂不处理。
- 处理决定：仅记录，暂不修改代码、历史文件或 TTS 行为。
  - 关联任务：`docs/task/2026-08-30_群聊历史遗留工具调用异常.md`。

## Android ASR APK

- ⏳待现场验收 [2026-09-11] 在独立 ASR 测试 APK 原生页面使用测试 WAV 完成 Sherpa 声纹注册和三种测试模式回归
  - APK 已构建、安装和启动；设备 UI 自动化桥返回空 root，尚未自动完成注册、单段、多段、快速多段及双降噪开关的点击验证。
  - 2026-09-12 已通过同一 APK 的 HTTPS 测试页面完成三个模型/FP32-INT8 的单段和普通分段回归；原生页面按钮链路仍待单独现场点击验收。
  - 相关实现：`docs/design/android-voiceprint-test-apk.md`；`docs/spec/android-voiceprint-test-apk.md`；`docs/task/2026-09-11_ASR测试APK原生页面接入Sherpa声纹UI.md`。

## TTS

## 文本媒体

## 聊天系统

- 🔄进行中 [2026-09-19] 修复 Qwen Chat2API 请求通道返回固定拒答
  - 已复现：同一账号和 `Qwen3.6-Flash → Qwen3.7` 映射下，本地 Chat2API 会把 Qwen 上游固定拒答或风控 JSON 归一化为空成功回复。
  - 当前修复：网页聊天请求不再注入固定 `X-Platform/X-DeviceId`；风控 JSON 改为明确错误；保持 Qwen 原生 `session_id/parent_req_id/scene_param` 首轮与续接契约。
  - 现场验证：当前上游返回 `FAIL_SYS_USER_VALIDATE` 验证码响应，代码已能识别，但仍需有效网页登录风控状态后确认正常答案链路。
  - 关联文档：`docs/design/chat2api-builtin-task.md`、`docs/spec/chat2api-builtin-task.md`、`docs/task/20260919_Chat2API_Qwen发送链路修复.md`。

- ⏳待现场验证 [2026-09-19] 临时模式首次唤醒确认提示区分
  - 纯助手名已改为从“嗯，我在”“啊，我在”“我在呢”“在呢”“听着呢”中随机播报；助手名带内容已从“好的”“收到”“明白”“好嘞”“没问题”“交给我吧”中随机确认，后续临时消息和一次性群聊不重复使用临时确认。
  - 需使用真实显示端确认短确认与模型回答的连续 TTS 播放顺序，以及显示端 TTS/服务端 TTS 两种配置下的实际播放目标。
  - 关联文档：`docs/design/display-voice-conversation.md`、`docs/spec/display-voice-conversation.md`、`docs/task/20260919_临时模式唤醒确认提示区分.md`。

- ⏳待现场验证 [2026-09-19] Pi Agent Chat2API 工具格式错误回退普通回复
  - 代码已在 Provider 层对损坏工具协议保留安全普通文本，不执行不完整工具调用，也不向聊天/TTS输出协议残留；需使用真实 Chat2API 模型复现一次缺少开始标签的响应，确认聊天正文和 TTS 均正常恢复。
  - 关联文档：`docs/design/llm-agent-mode.md`、`docs/spec/llm-agent-mode.md`、`docs/task/20260919_Chat2API工具格式错误保留普通回复.md`。

- 🔄进行中 [2026-09-19] 控制端与显示端 render 刷新来源诊断
  - 通用 render 诊断打印暂时关闭；TTS 输入历史已移除会导致原生弹窗自动关闭的失焦节点重建，改为独立 autocomplete 表单，后续仅保留通用 render 异常复现任务。

- 🔄进行中 [2026-09-19] 显示端聊天与 VRM/MMD 同位分层
  - 已确认使用单个 `display.html`，拆分 `display-stage.js`、`display-chat.js`、`display-mmd.js` 和独立 CSS，不使用 iframe。
  - 聊天位于 MMD 上层并可单独隐藏；隐藏后 MMD Canvas 接收点击，通过 Raycaster 触发本地动作，聊天联动默认关闭。
  - 当前实现范围：同页模块总线、聊天入口/对象选择/会话选择、流式消息、聊天隐藏切换，以及无外部运行时时的 MMD Canvas 交互降级。
  - 已完成静态 VRM 模型迁移：默认模型通过 `http://c.aasc.us/mnt/mmd/` 文件资源加载，服务端 DNS 解析为 IPv4 后不保留 Host，并支持 `.vrm`、`.glb` 及 zstd 压缩文件的安全 profile 切换；模型不打入 APK。VMD/VRMA 动作资源和复杂动作生成仍留在后续阶段。
  - 聊天/MMD 两个显示开关已调整到左下角，保留安全区和软键盘内缩。
  - 已修复 `defer` 模块初始化时序，聊天入口会在模块注册后生成聊天窗口。
  - render-display 已调整为仅高于媒体层；聊天页面主题化，对象/会话切换改为 HTML 下拉菜单；下拉菜单已区分未选中、悬停/聚焦和已选中颜色；聊天已改为全屏透明背景、控件实色；code v11 已发布并完成真机验收。
  - 普通 `response` TTS 弹窗已统一进入 MMD 与聊天之间的播报辅助层，聊天打开时隐藏，关闭后按原生命周期恢复；code v21 与 dependencies v5 已发布到 LAN/WAN。
  - 已修复普通聊天和天气播报在有 `voicePlayback` 能力的来源端重复显示文字弹窗的问题；code v23 已发布到 LAN/WAN，沿用 dependencies v5。
  - TTS 播报文字已按逻辑画布和文本长度自适应字号与竖屏边距；code v24 已发布到 LAN/WAN，沿用 dependencies v5。
  - 首期沿用全局聊天上下文，按 `displayId` 独立保存留待后续。
  - 关联文档：`docs/design/display-chat-mmd.md`、`docs/spec/display-chat-mmd.md`、`docs/task/20260918_显示端聊天与MMD分层设计.md`、`docs/superpowers/plans/2026-09-18-display-chat-mmd.md`。

- ⏳待处理 [2026-09-16] 将显示端聊天模式与私聊目标按 displayId 独立保存和路由
  - 当前 offline APK 暂时沿用服务进程全局 chatSession，控制端手动切换后同步当前在线且启用语音监听的显示端；后续需支持每个显示端独立的群聊/私聊模式、助手目标、session 和语音路由。
  - 关联任务：`docs/task/2026-09-16_Offline启动权限串行与语音聊天自动路由.md`。

- ⏳待验证 [2026-09-13] 临时页签连续切换角色：确认收到服务端快照后选择器可再次选择

- ⏳可选任务 [2026-09-01] 自动测试请求级聊天隔离
  - 当前自动测试仍可能连接现有服务器并写入真实群聊；聊天历史持久化已先增加防误删保护。
  - 后续可增加 `testOnly/testRunId` 临时会话命名空间，禁止测试持久化 AASC、Pi 和 Responses 历史。
  - 本次配置排查确认现有聊天相关测试使用临时目录或只读契约，不直接写入真实 `config/config.json`；后续仍需补充统一测试隔离。
  - 临时页签角色选择使用服务端 WebSocket 快照，不新增测试持久化配置；统一测试隔离仍待后续处理。

- ⏳待处理 [2026-08-31] 控制端无 `displayId` 时无法启动普通 Pi Agent 聊天
  - 现象：控制端发送 `chatMessage` 且不带 `displayId` 时，服务端回退处理因缺少显示端上下文提前返回，不产生 `chatChunk` 或 `chatResponse`。
  - 当前带已连接显示端 ID 的控制端流程正常；后续需将普通聊天处理从显示端上下文门控中拆出，支持无显示端的控制端会话。

- ⏳待处理 [2026-08-31] `commandMode` 开关当前未使用
  - 现代显示端的 `waitingWake` 由会话状态门控过滤，`activeGroup` 和 `activePrivate` 会绕过该过滤；当前开关只保留配置、控制端同步和旧调用路径兼容。
  - 暂不删除或重定义，后续再决定是否移除，或改为控制 Agent 系统工具权限。

- ⏳待讨论 [2026-08-31] 私聊聊天 Agent 调用受限系统工具
  - 设计文档：`docs/design/private-chat-agent-tools.md`；当前只记录方案，不实现代码。
  - 待确认工具确认策略、静音是否包含取消静音、切换助手后的历史/session 规则，以及 Pi/Codex 统一工具协议。

## 开发工具

## 媒体播放

## AI 角色

## Android APK

- 🔄进行中 [2026-09-16] Offline APK 服务热更新与原生增量 APK
  - 🔄待现场验收 [2026-09-20] code v12 与 min v21 已联合发布，包含聊天播报文字隐藏和服务器启动后 30 秒隐藏分辨率诊断；待 SM-N9500 通过外网更新卡片确认 code/min 更新及真机行为。
  - [2026-09-21] 更新卡片下载/校验/安装期间已支持 10 秒无触摸收起，收起入口按进度填充并显示状态色；分辨率/DPI/缩放诊断提示改为 10 秒隐藏；修复 code-only 在已有热更依赖时错误使用 `legacy-root`，并在 Offline Node 启动时迁移旧 active release，按清单动态选择依赖版本；控制端收起按钮贴合屏幕边缘。Android JVM 单测 25/25 通过；min APK v31（`0.2.29-offline-min`）已构建并发布，仍待真机现场安装验收。
  - 待处理：完整 Offline APK 首次安装不创建 `updates/active-release.json`；首次 code-only 更新找不到版本化依赖目录时会将根目录内置依赖标记为 `legacy-root`。暂不修复，后续需确定是否在首次启动初始化版本化基线 release。
  - 服务更新支持 `code-only`（lock 指纹一致时不发布/下载依赖）与 `all`（代码+生产依赖）；`code-only` 检测到 lock 指纹变化时自动升级为 `all` 并递增依赖版本；`allserver-min` 只更新原生代码和 allowlist Runtime 动态库，保留服务数据与模型缓存。

  - Node 更新包/发布器与 Android 验签、服务代码/依赖切换、APK 签名/包名/版本检查及系统安装流程已实现；本轮服务更新 Node 定向测试 31/31、Android JVM 单测 25/25 通过。全量 `npm test` 为 826/827，唯一失败是既有 Windows 子显示端声纹策略断言，与本任务无关。
  - full v2/min v3 APK、code/dependencies v3 包及 min v3 更新清单已生成并通过静态完整性/签名校验；min v4 已升版为 `0.2.2-offline-min` 并正式发布，LAN/WAN manifest 字节一致且签名有效。
  - min v4 APK 地址为 `http://192.168.1.39/mnt/aasc-offline/apk/aasc-display-offline-min-v4.apk` 和 `http://120.79.245.103/mnt/aasc-offline/apk/aasc-display-offline-min-v4.apk`，大小 `89205130` bytes，SHA-256 `be31e437ca17488fab20eefd1874be2a1b40689cac59f667873e761dd17b1027`；LAN HTTP 整包、WAN 远端文件及 WAN HTTP 首段/HEAD 校验通过。
  - 固定显示端 ID 与 Chat2API 完成按钮的 min v6 已追加发布：`http://192.168.1.39/mnt/aasc-offline/apk/aasc-display-offline-min-v6.apk`、`http://120.79.245.103/mnt/aasc-offline/apk/aasc-display-offline-min-v6.apk`；大小 `89208438` bytes，SHA-256 `0f7af47dbba366758ebbe818994da37f39028bd8174ba6b3dfa8754f33366b68`，两站点 manifest/签名和 HTTP Content-Length 已复验。
  - v7（`0.2.5-offline-min`）已正式发布到 LAN/WAN，APK 大小 `89535999` bytes，SHA-256 `80501f7ea36a96377f8cddec3f238e0ec31b2d2bc30681d3f4b650c3ada324af`；SM-N9500 真机已安装并确认 Activity 位于 Display 2，固定 `offline-display` 服务健康接口和 UI 自动化按钮检查通过。v7 校正前按 1280 像素长边计算为 150%；真实触控/截图受 `touch NONE` 和 Desktop 虚拟屏限制未完成，现行比例以 v8 DPI 校正记录为准。
  - v8（`0.2.6-offline-min`）已完成 DPI 校正并正式发布，APK 大小 `89231402` bytes，SHA-256 `470c19c57ca528d84e87729ece45b74d48a3e2acdfbf124a16751a04786b0d2c`；按 `1280px@320dpi=100%` 公式，Display 2 `1920×1080@160dpi` 为 75%。SM-N9500 真机已覆盖安装并确认 Display 2 窗口、固定 `offline-display` 健康接口和 Qwen ready 状态正常。
  - v9（`0.2.7-offline-min`）已完成右下角诊断浮层构建、真机验证和 LAN/WAN 正式发布，APK 大小 `89233662` bytes，SHA-256 `32181e75e3dbfe7b381bd0660f49778860ca62c4683bc69d7dbb3254eef549b7`；UI 自动化读取到 `分辨率 1920×1018 | DPI 160 | 缩放 75%`。默认域名 `c.aasc.us` 返回备案拦截 403，本次使用 WAN 直接 IP 验收。
  - v11（`0.2.9-offline-min`）已发布本次控制端输入框自动缩放修复，APK 大小 `89235646` bytes，SHA-256 `0b3ab8871ca17e32fa1dc5db767ef8b31049a973d8d678faa471e1ad4ac396da`；LAN/WAN HTTP、清单、签名、ZIP 完整性和远端 hash 均通过，尚未覆盖安装真机。
  - v12（`0.2.10-offline-min`）已正式发布控制端聊天设置 profile 协议保护；APK 大小 `89236426` bytes，SHA-256 `c4c20af9ab6b71c5e0e5dad1b4d3d2f1cdfce8cb7eaee91d6dde0ff1afdcf253`，服务 code v4 大小 `13996510` bytes、SHA-256 `7ca5adf90be5738ee94b47e31534d574b411a1934e3b0d0db6702955b1247bd2`；更新日志已写入签名清单，LAN/WAN 直连 IP HTTP、清单签名、APK v2 和远端文件校验通过。
  - [2026-09-20] 聊天 TTS 打断与 Offline 前台定时更新已联合发布：code v14（`15173599` bytes，SHA-256 `a0fd191e9d9b2eeabb9e56807b0c6715818cd5e60f9b31c518b085b6d5f6aa8d`）复用 dependencies v4；min v24（`0.2.22-offline-min`，`89264782` bytes，SHA-256 `faed86143a39eff7fa398b2815b9952e35867c68d5776cd0d9a565cec195c7b6`）已同步 LAN/WAN，清单/签名/HTTP/远端 hash 和旧版本精确清理通过。
  - full 已对齐 min v9（`versionCode=9`、`0.2.7-offline`）并发布为 `aasc-display-offline-v9.apk`，大小 `957310007` bytes，SHA-256 `b1625bdf269e256d98aa45254c14a9531dcdfa3399d0b7d31b18daccbe1f83a7`；LAN/WAN IP HTTP 200、Content-Length 和远端 hash 一致，旧 full v2 已清理，服务 manifest 未替换。
  - full v12（`0.2.10-offline`）已对齐当前 min versionCode 12 并正式发布为 `aasc-display-offline-v12.apk`，大小 `957319386` bytes，SHA-256 `b107d7963bf4dd18068404427e12f4edc72ff8253e8914e3d1909ca66e6c8183`；LAN/WAN 直连 IP HTTP、Content-Length、远端 hash、APK v2 签名和 ZIP 完整性均通过，旧 full v9 保留。
  - full v13（`0.2.11-offline`）已正式发布本轮 Chat2API 账号凭证与 Android 外部网页恢复代码，文件 `aasc-display-offline-v13.apk`，大小 `957338670` bytes，SHA-256 `326d30feada394860925d2f11320bd4fb60b84cae1a710135303b89be203429c`；LAN/WAN 直连 IP HTTP、Content-Length 和远端 hash 均通过，服务 manifest 未替换。
  - min v14（`0.2.12-offline-min`）已配套发布，文件 `aasc-display-offline-min-v14.apk`，大小 `89245126` bytes，SHA-256 `062aee3158d5534c18b57bf8dcf28dccdffe9b27ebd33cbaa00b35fc0143382f`；versionCode 高于 full v13，LAN/WAN 直连 IP 的清单、签名、HTTP 200/Content-Length、完整 hash 和 SM-N9500 v10 更新提示均通过。
  - Chat2API 账户管理四按钮问题已通过 code-only v5 修复并发布：`code/code-v5.zip`，大小 `14005201` bytes，SHA-256 `dae26685353195f23afb4828980b829bb30e5aef6822887233e927714576de9e`；沿用 dependencies v3 和 apkMin v14。SM-N9500 重启后已原子切换 `code=5, dependencies=3`，设备脚本含独立账号凭证导出/导入按钮。
  - full v14（`0.2.12-offline`）已覆盖安装到 SM-N9500，内置 API 28 归档签名兼容读取；随后 min v15（`0.2.13-offline-min`）已在真机完成下载、校验、系统确认安装，安装后版本码为 15，服务数据和 Node 启动均保留。
  - min v15 文件 `aasc-display-offline-min-v15.apk` 大小 `89245994` bytes，SHA-256 `ad33c255829a01045d47c665d2dc18705eb9233f47502c77d2bb181fc5284def`；full v14 文件 `aasc-display-offline-v14.apk` 大小 `957339538` bytes，SHA-256 `39b6b907cfa334d98870a7ba20814099bd9f7a074ed7bd8e0de84c907698978e`。LAN/WAN 直连 IP HTTP、Content-Length、签名和远端 hash 已复验。
  - full v2 APK 已上传外网 `http://120.79.245.103/mnt/aasc-offline/apk/aasc-display-offline-v2.apk`，远端完整 hash 与本地一致；本次追加 min v6、v7、v8 版本文件并更新签名清单。
  - 独立 RSA 密钥对已接入打包工具并存放于 `~/.config/aasc-user/`；更新包构建已支持临时工作区与输出目录跨文件系统，归档复制到输出同目录临时文件后再原子切换。
  - 外网主机登录 shell 为 fish；发布器已通过 `/bin/sh -c` 执行远端 POSIX 脚本，并在远端 manifest 原子切换前设置 `0644`，真实发布通过。
  - SM-N9500 真机原有 v1 APK 已按测试要求卸载，fresh install full v2 成功，首次解包约 911 MiB；`/api/status`、`/v1/models` 和默认模型聊天通过。
  - 已修复 ZIP 目录项规范化后的 `src` / `node_modules` 根目录白名单问题；真机 fresh install 后 code/dependencies v3 成功应用，`active-release.json` 的 `pendingHealth=false`，`/api/status`、`/v1/models` 和默认模型聊天通过。
  - min v3 已携带 `libaasc_node.so` 并在 SM-N9500 Android 9 上原位安装成功；配置、任务、模型缓存和 code/dependencies v3 active release 保留，`/api/status`、`/v1/models`、默认模型聊天和显示端 WebSocket 通过。正式发布的 min v4 已完成双站点工件验收，设备安装回归仍待单独执行。
  - 仍待：回滚/异常降级、code-only 与 LAN/WAN fallback/bad-hash/低空间场景，以及 ASR/TTS 完整业务回归；v10 缩放曲线和本次 code v5 账号按钮发布已完成。
  - 设计：`docs/design/android-offline-hot-update.md`；伪代码：`docs/spec/android-offline-hot-update.md`；任务：`docs/task/2026-09-16_OfflineAPK服务热更新与原生增量APK.md`。

- ⏳可选 [2026-09-15] 统计 offline APK 首次启动的分阶段耗时
  - 真机完整校验版本首次安装已测得 Runtime 解包约 133.5 秒、Node launcher 总耗时约 133.6 秒、Activity 启动约 2.1 秒；当前默认不校验版本已测得内容安装约 116.9 秒。仍待补充 APK 进程、WebView、8081 就绪、`llm-server` 恢复和模型首次加载的统一时间线。

- ⏳待现场验收 [2026-09-14] Chat2API Android Provider 真实网页登录验证
  - 普通 APK 已完成构建、安装和启动冒烟；仍需使用测试账号验证网页登录、Authorization/localStorage/Cookie 捕获、Provider 接口校验和账号保存。
  - offline APK 已使用包含当前 Chat2API 源码和生产依赖的运行包重新构建、卸载重装并完成本地聊天/语音接口验收；本轮已导入本机 Qwen 账号并完成真实 Chat Completions 请求，空映射下 `Qwen3.6` 成功而 `Qwen3.6-Flash` 返回 `no_available_account`（该别名仍需显式映射）；控制端手动聊天的 `qwen3.5` profile 当前为 `agent/pi`，真实 WebView 登录捕获仍需现场测试账号，Pi Provider manifest 缺失问题已由 code-only v15 修复并在真机日志中确认不再出现。
  - Offline APK 的 Pi SDK hidden Provider manifest 打包、安装恢复和 active dependency 选择已完成自动化及真机链路验证；真机单条 Pi 回复仍受 MNN 请求超时/服务进程稳定性影响，需另立任务处理。Android 节点策略仅明确禁用外部 CLI（Codex），未将 Pi 标记为业务禁用。
  - 2026-09-15 已生成 `release/apkbuild/allserver/output/aasc-display-offline.apk`，内含 release 配置、任务 results 和默认 MNNChat 模型；本次只完成构建与静态校验，未替代真实 Provider 登录验收。
  - 关联文档：`docs/design/android-chat2api-login-control.md`；`docs/spec/android-chat2api-login-control.md`；`docs/task/20260914_Android Chat2API登录与显示端控制端开放.md`。


- 🔄进行中 [2026-09-13] Android 子服务器媒体库 `~/` 映射到应用专属外部目录
  - 目标目录为 `/storage/emulated/0/Android/data/com.aasc.display/files`，需完成旧字面 `~` 目录迁移和 APK 真机验证。

- 🔄进行中 [2026-09-13] APK 内置 Node 子服务器支持 Android 10 及 Android 11+ 共享存储文件访问
  - 已完成 SAF 文件夹选择器、原生回环网关、虚拟根 `/`、Node provider 和本地回归；SM-N9500 Android 9/API 28 已验收 APK 启动、Node 健康接口和旧版媒体库列举；Android 10/11+ 真机媒体库验收仍待执行。

- ⏳待现场验收 [2026-09-08] 完成 APK 内置 Node.js 子服务器的生产依赖打包和真机业务验收
  - Node Runtime、安装器、Service、主服务器主动连接和能力裁剪已实现；生产 `node_modules` 已用于 offline APK，server-app 启动、AASC 注册、本地聊天、显示端 ASR/TTS 路由已完成 API 级真机验收。
  - 仍待验收媒体库浏览/上传/直连播放、热更新，以及 Android 10/11+ SAF 真机流程。
  - 设计：`docs/design/android-embedded-node-server.md`；实现伪代码：`docs/spec/android-embedded-node-server.md`；任务：`docs/task/20260908_APK内置Node.js子服务器.md`。

- ⏳可选任务 [2026-09-02] 为 Android YOLO11 测试 APK 增加带标注验证集的准确率评估
  - 当前已记录 `bus.jpg` 单图定性结果；正式 Precision、Recall、mAP 需要目标场景的图片和标注数据。

- ⏳待处理 [2026-09-01] 将 Termux 服务器试运行整理为正式 Android 节点
  - 当前 `~/aasc-server-test` 已能在 Termux 以 runit 服务运行，使用 8081 端口；服务器发布包现由 `npm run build:server-package` 显式生成，主服务器媒体索引聚合、远程媒体直连优先/代理回退、控制端媒体写入、APK 子服务器重启恢复和节点就绪后的正常播放重播已完成，后续仍需认证和完整 Android 生产包现场验收。
  - 当前 ASR、TTS Wine、Puppeteer 暂不迁移；正式节点需要在配置和控制端明确不可用能力。

- ⏳待处理 [2026-08-25] 修复 APK 原生 ASR 识别结果为空及声纹 native 崩溃
  - 2026-09-13 offline APK 在 display 2 上使用 SenseVoice 测试音频已返回“你好，小爱。”；当前待处理范围收敛为声纹稳定性、原生桥异常日志、速度/P95 和长稳内存压测，不再把普通 ASR 空结果作为当前复现结论。
  - 2026-08-27 对照测试：WeSpeaker 单段和 Sherpa 两种流程均可返回文字/声纹；WeSpeaker 多段滑窗 embedding 在四个音频上均触发 OOM，即使不加载 ASR 模型仍复现。
  - 2026-08-27 独立测试 APK 已移除 WeSpeaker 测试，当前验收范围仅保留 Sherpa 单段/多段；WeSpeaker 多次 embedding 的 OOM 不再阻塞该 APK。
  - 仍需继续定位生产显示端原生桥异常/结果日志，修复后再完成速度、P95 和长稳内存压测。

## AASC 网络

- ⏳待处理 [2026-09-05] 设计并实现 AASC 权限认证
  - 在节点注册、媒体索引和任务路由稳定后，再增加用户、节点、媒体库和操作权限。

## 批量播放模式

# 当前任务

## 显示端 VRM/MMD

- 🔄进行中 [2026-09-20] 将默认 VRM 模型改为公网静态资源代理，并支持多模型文件名配置
  - 静态根地址为 `http://c.aasc.us/mnt/mmd/`，Node 服务解析域名后使用 IP 请求，不保留 Host。
  - 默认文件为 `default-vroid.vrm`；完成服务端代理、显示端 profile、APK 构建和真机外部网络验证后移除本条。

## 控制端语音配置

- ⏳待现场验证 [2026-09-19] 浏览器显示端 ASR 来源绑定修复
  - 代码已让浏览器显示端只通过 multipart 表单 `displayId` 传递持久化来源 ID；已现场验证重启服务端后来源恢复为 `display-izhstb6o`，并成功进入 `voiceInput`/`voiceCommand` 链路。
  - 仍需在显示端刷新和首次启动场景观察日志不再出现 `requested=-`。
  - 关联文档：`docs/design/server-side-asr-voice-input-processing.md`、`docs/spec/server-side-asr-voice-input-processing.md`、`docs/task/20260919_修复浏览器显示端ASR来源绑定.md`。

- ⏳待处理 [2026-08-31] active 群聊/私聊中的其他指令按普通聊天发送
  - 当前仅“搜索”已改为 active 会话普通聊天；天气、提醒、播放、静音、报时、录音及其他自定义指令仍按现有命令优先级处理。
  - 后续逐项确认并调整；`进入群聊` 已按当前需求支持等待唤醒状态下免唤醒进入持续群聊，其他等待唤醒命令规则暂不改变。
  - 当前三种语音会话状态的使用说明见 `docs/usage/voice-conversation.md`。

# Android 显示端缩放

- ✅已完成 [2026-09-20] 发布设备类别缩放系数修正版 Offline min APK
  - 代码已按 `smallestScreenWidthDp` 区分手机/电脑；手机系数 `1.108705`，电脑系数 `1.0`，缩放因子通用限制为 `1.0～3.0`。
  - `2309×1080@480dpi` 仅作为验算样例，手机计算结果为因子 `3.0`；versionCode `23`、versionName `0.2.21-offline-min` 已发布到 LAN/WAN。
  - APK 大小 `89264066` bytes，SHA-256 `dfed13b4b2a1946dd14c64ae0cfae1881ea1728184d82a43ea58c92e533950d0`；两端签名清单、HTTP `200`/`Content-Length` 和旧 min 精确清理通过。

# Android 显示端音频

- ⏳待现场验收 [2026-09-20] 正式 APK 使用标准 Bluetooth SCO 接入 AIMIC-M4 单路录音
  - 已完成不接入厂商 SDK 的 SCO 路由、Android 12+ `BLUETOOTH_CONNECT` 权限、无设备/超时回退、录音停止/页面销毁恢复音频模式和自动化验证。
  - 仍需现场完成 API 28 真机录音、AIMIC-M4 断开回退、连续启停和 Android 12+ 权限流程验证。
  - 设计：`docs/design/android-display.md`；实现伪代码：`docs/spec/android-display.md`；任务：`docs/task/20260920_正式APK蓝牙SCO录音接入.md`。

## 外部应用焦点

- ⏳待现场验收 [2026-09-12] Windows 子显示端语音输入端到端回归
  - 需在 Windows 10/11 同步最新 Node 子显示端代码并重启，验证“开始输入”/“结束输入”提示完成后持续产生 `asrAudio`，普通文本注入、 “返回”、 “发送”保持输入模式、30 秒超时退出及窗口切换保护。
  - 还需验证 `Alt+C` 在 `inherit`/`false` 间切换、重启后本地持久化；缺失/`undefined`/`null` 的本地策略按 `false` 处理，显式 `inherit` 才跟随服务器；以及 `voiceRecordingConfig`/`displayRecordingRequest` 不再产生未知消息。
  - 当前主服务端已重启加载状态提示播放门控修复；本环境无 Windows，无法替代远端实机验收。
  - 关联文档：`docs/design/windows-voice-text-input.md`、`docs/spec/windows-voice-text-input.md`、`docs/task/2026-09-12_子显示端Windows语音转文字输入.md`、`docs/task/2026-09-12_Windows语音输入超时声纹策略与录音协议修复.md`。

## TTS 播放
