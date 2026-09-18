# 正式 Android 显示端完整离线 APK

## 需求

新增一个独立的正式显示端离线 APK 构建入口。该 APK 在包内携带 Android Node.js Runtime、正式显示端服务器代码、生产依赖和当前正式运行模型；安装后不要求连接外部主服务器即可在本机启动服务器、加载显示页面和控制页面。

普通 `com.aasc.display` APK 的构建、包名、连接主服务器和子服务器行为保持不变。

## 方案

- 新增 `npm run build:apk:offline`，复用现有 Android Node Runtime 准备流程，并在构建生成目录中加入固定白名单模型。
- 离线 APK 的文件名为 `aasc-display-offline.apk`，包名为 `com.aasc.display.offline`，应用名称为 `AASC 显示端 Offline`，版本名追加 `-offline`。
- 包名不能包含连字符，因此使用 Android 合法的 `.offline` 后缀；文件名和版本名保留 `-offline` 标识。
- 离线模型包含当前正式显示端运行集：SenseVoice、streaming Zipformer、正式声纹 base FP32 与 pyannote、GTCRN、嵌入式 TTS、RapidOCR，以及默认 `yolo11n` 和类别文件。不包含测试 WAV、测试 APK 专用声纹变体、YOLO 其他尺寸、LFM-VL 和分割 PT 文件。
- 模型由构建脚本从仓库 `res/models` 复制到生成的 Node Runtime assets，模型文件不要求提交到 Git；manifest 记录大小和 SHA-256。
- Runtime 安装器将 `server/res/models` 安装到 APK 私有根目录的 `res/models`，Node 服务器继续通过既有模型路由和模型清单提供本地模型。
- 离线模式写入 `aasc.role = main`，本机 Node 只监听本地服务，不启动 AASC 子服务器远端连接流程；普通 APK 继续写入 `subserver`。
- 离线 APK 启动时默认使用 `https://127.0.0.1:8081`，自动连接本机 `/display`。保留地址输入和连接入口，便于现场诊断，但不依赖输入才能启动。
- 离线 APK 的显示页和控制页 WebView 初始页面比例按当前显示分辨率长边与 densityDpi 共同计算：`1280px@320dpi` 为 100%，比例为 `round((((长边 / 1280) + (densityDpi / 320)) / 2) × 100)`；普通 APK 保持 100%。两个 WebView 均使用所属 display Context 的像素分辨率和 densityDpi。
- 显示 WebView 上层固定放置“控制端”按钮，位于 `webContainer` 左上角，避免遮挡显示页右侧提示。点击后在同一个 `webContainer` 内显示同源 `/control` WebView；再次点击隐藏，显示 WebView 保持原状态。按钮始终位于控制 WebView 之上。
- 本地 Node 启动存在安装和监听竞态时，离线显示页有限次数自动重试；不对普通远程连接增加重试行为。

## 边界

- 本次不修改 AASC 远端配置流程；离线模式是 APK 构建/本地运行模式，不是服务端业务配置项。
- 本次不将独立 `3rd/tts-server/android-asr` 测试 APK 的模型和页面合并到正式显示 APK。
- 本次不包含外部 LLM、搜索、远程媒体服务等需要网络或外部进程的能力；已有 Android 节点能力裁剪继续生效。

## 失败处理

- 构建时缺少任一白名单模型，命令立即失败并指出相对路径，不生成可误用的半离线包。
- APK 首次启动 Runtime 或模型校验失败时不启动 Node，前台通知显示失败原因；下次启动可重新安装。
- 控制页加载失败不影响显示页；显示页保留，控制按钮可再次尝试打开。
- 本地 HTTPS 继续使用现有 `res/certs` 和 APK 内置证书信任配置，避免为了离线模式放宽证书校验。

## 实现状态（2026-09-12）

- 已完成离线模型白名单、Runtime manifest/安装、Gradle 独立标识、自动本机连接和控制端覆盖 WebView。
- 已验证离线 APK 可生成到 `src/apps/android-display/app/build/outputs/apk/offline/aasc-display-offline.apk`；实际包内模型 32 个，共 451,266,757 bytes。
- 普通 APK 无属性 Gradle 构建通过；生产命令默认使用项目内 Android Node Runtime，仍需提供生产服务器包。

## Offline APK WebView 按分辨率与 dpi 动态缩放（2026-09-17）

- Offline APK 显示页和控制页的 WebView 初始比例以 `1280px@320dpi` 为 100% 基准，按 `round((((长边 / 1280) + (densityDpi / 320)) / 2) × 100)` 计算；普通 APK 保持 100%。
- Display 2 的 `1920x1080@160dpi` 得到 `100%`；手机 `2309x1080@480dpi` 得到 `165%`，设备覆盖分辨率 `720x1480@280dpi` 得到 `102%`；横屏和竖屏使用同一长边规则。
- 宽度、高度或 densityDpi 无效时回退 100%；策略只作用于 WebView，不修改系统 density、物理/逻辑分辨率、媒体源或输入坐标。

## Offline 缩放曲线校正（2026-09-18）

- 实测发现乘法曲线会让 `1920@160dpi` 仅为 `75%`，让 `2309@480dpi` 达到约 `271%`；改为分辨率比例与 DPI 比例的等权混合。
- 新公式为 `round((((长边 / 1280) + (densityDpi / 320)) / 2) × 100)`；目标结果为 Display 2 `100%`、2309 长边手机 `165%`、`720×1480@280dpi` `102%`。
- 普通 APK、无效参数回退、诊断浮层内容和系统显示/输入协议保持不变。
- v10 已完成构建、LAN/WAN 正式发布并安装到 SM-N9500 Display 2；UI 自动化读取 `分辨率 1920×1018 | DPI 160 | 缩放 100%`，发布入口使用 LAN 和 WAN 直连 IP。

## Android 启动权限串行申请

显示端启动流程先完成现有共享存储权限处理，再依次申请录音、摄像头和 Android 13+ 通知权限。每个权限请求都等待系统回调后才进入下一项；用户拒绝某项时也继续处理后续权限，避免 Android 丢弃同一时刻并发发出的权限对话框。已授权的权限跳过，不重复弹窗。

录音或摄像头权限在本轮启动中获准后，等权限队列结束再统一重载 WebView，使网页能力探测读取最终授权状态；通知权限不触发 WebView 重载。权限请求不改变用户主动关闭显示端语音监听的设置。

## Offline 显示端固定 ID（2026-09-17）

- Offline APK 使用专用显示端 ID `offline-display`，显示页加载时将该 ID 作为 `/display` 查询参数，并由页面 WebSocket 连接沿用该值。
- Release 任务结果中面向 Offline 显示端的目标统一保存为 `offline-display`，避免 APK 首次启动生成随机 ID 后无法匹配已配置任务。
- min 热更启动 Node 前迁移已安装数据目录中的 `render-display` 结果索引，确保旧 full APK 不重装也能匹配新的固定 ID。
- 该 ID 只由 Offline APK 的本地入口使用；普通 APK 和浏览器显示端继续使用原有持久化或随机 ID 流程。
- 同一服务端同时运行多个 Offline APK 时会共享该显示端身份，部署约定为一个本地服务对应一个 Offline 显示端。

## Offline 发布更新日志（2026-09-18）

- min APK 签名清单的 `apkMin` 组件可选携带 `releaseNotes`，发布命令从 UTF-8 文件读取并纳入清单签名。
- Offline 更新卡片检测到新版本时显示版本、大小和更新内容；日志缺失时保持旧版提示，日志最多展示 6 行。
- 日志只作为纯文本显示，不解析 HTML/Markdown，不改变下载、验签和 PackageInstaller 流程。

## Offline 屏幕诊断信息浮层（2026-09-18）

- Offline APK 在 `webContainer` 右下角显示小型诊断浮层，内容包含当前应用区域分辨率、densityDpi 和 WebView 初始缩放百分比，例如 `分辨率 1920×1018 | DPI 160 | 缩放 100%`；Display 2 的底层显示分辨率仍为 `1920×1080`。
- 诊断数据复用 `DisplayWebView` 使用的所属 Display `displayMetrics` 和 `WebViewScalePolicy`，避免浮层显示值与实际缩放策略不一致。
- 浮层只在 Offline APK 显示，普通 APK 保持原有界面；更新卡片、启动遮罩和控制端按钮保持更高层级，诊断文字不抢占交互区域。
- 屏幕配置变化时重新读取当前 metrics 并刷新文字；不修改系统 density、分辨率、媒体尺寸、截图像素和输入坐标协议。
