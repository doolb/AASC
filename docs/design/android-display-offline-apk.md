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
- 显示 WebView 上层固定放置“控制端”按钮。点击后在同一个 `webContainer` 内显示同源 `/control` WebView；再次点击隐藏，显示 WebView 保持原状态。按钮始终位于控制 WebView 之上。
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
