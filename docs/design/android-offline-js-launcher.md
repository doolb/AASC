# Offline 可热更 JS 启动器与本地网页 UI

## 需求与当前状态

2026-10-16 用户确认把首装、服务/依赖/任务/数据修复更新、模型下载及首次提示从 APK 业务层迁到 JS，启动器自身也支持热更；随后确认启动器 UI 一起改为网页。源码与定向自测已完成，min60/code106已发布。min60实机发现两处宿主缺陷，已修正并在签名机生成本地min61，通过保留数据覆盖升级/冷启动/本地网页/启动器自更新验证；min61尚未发布LAN/WAN。

## 分工

| 层级 | 职责 |
| --- | --- |
| APK 最小宿主 | 安装 Node/原生库和可信基线；进程管道；WebView；权限/通知/系统 APK 安装；原生 ASR/TTS/声纹/MNN 引擎 |
| APK 内置固定 JS supervisor | 重新验签候选 ZIP 并核对解压后的启动器字节；固定入口启动、握手超时、进程切换、上一健康启动器与内置基线回退 |
| 可热更 JS 启动器 | 空环境引导、签名下载、安全 ZIP 解压、种子补齐、服务组合规划和健康回滚、数据修复门槛、模型目录/缓存/下载/取消、首次提示策略、自身更新编排 |
| 可热更本地网页 | 首装检查与确认、版本检查与更新、模型分组选择与下载/取消、进度和错误重试、重启服务、返回显示端 |
| 服务子进程 | 既有 HTTP/WebSocket/AASC 业务和显示页；服务与 node_modules 缺失不阻断启动页 |

新模块只依赖 Node builtin 与随基线携带的共享纯模块。Android 不运行 npm 安装。`ServiceProcess` 直接监督 `server-app.js`，沿用当前数据根与任务上下文；普通 `server-launcher.js` 的子服务器更新路径不变。

## 自更新和信任链

启动器和网页复用已有签名 `code/code-vN.zip`，没有新增发布产物。APK 的 `offline-launcher-manifest.json` 描述内置基线资产，固定 supervisor 始终从该基线运行；业务入口 `entry.js`、各业务模块和 `ui/index.html` 可从已验证代码版本运行。宿主/状态 API 均为 1，不兼容候选要求先更新 APK。

旧 JS 先准备目标代码，不更改活动服务指针。固定 supervisor 重新验证清单签名、ZIP 大小/SHA-256、候选启动器文件与 ZIP 字节及 API 声明；停止旧启动器和服务，再启动候选。候选以当前已提交服务验证真实版本/目录健康，空环境则握手后等待安装确认；健康后提交 `updates/launcher-state.json`，向新 JS 重放原安装/更新请求。失败恢复原健康启动器，继续失败则用 APK 基线；原请求明确失败，可重试。未提交 pending 在进程重启时丢弃。

APK 固定基线不被 JS 覆盖；原生能力、Node 或宿主协议变化仍需新 APK。模型定义随签名代码更新不意味着原生引擎可支持任意新增模型架构。

## 通信与网页隔离

原生与 supervisor 使用每行 JSON 管道，带 type/requestId/generation，最大 2 MiB；stdout 仅协议，日志写 stderr。supervisor 与业务启动器、业务启动器与服务之间用 IPC。旧代次结果被丢弃，页面重建读取权威状态快照。

`OfflineLauncherActivity` 不对外导出，通过固定 HTTPS 本地来源加载内置或 supervisor 已核验的 HTML。页面禁止外部导航、网络资源、iframe、文件/内容 URI 和子窗口；消息桥只接受固定启动器命令，不暴露显示端 NativeBridge。页面实例独立请求 ID 避免热更重载后的结果串线。系统 APK 安装始终由原生校验包名/签名/profile 后交给系统。

## 数据兼容和唯一写者

存在新 APK 资产时，NodeServerService 与原生门面转发到 JS；没有该资产的历史 profile 继续原路径。下载、版本规划、active-release 和模型事务只由 JS 写入，原生不并行运行旧更新器。

保留 `updates/active-release.json`、code/dependencies/task-code 版本路径、配置、账号、results 和既有模型候选目录/校验标记。种子只补缺失文件，恢复空目录与合法 latest 链接；数据基线只初始化真正空环境，journal 支持中断继续。整包根首次组合更新时物化代码版本，失败回退删除热更指针。旧 legacy-root 依赖指针在已有版本依赖校验后迁移，不联网。

平台依赖只选择 common/android，核对平台、元数据、内容指纹及生产锁包版本。任务包验证契约、实际文件集合和字节。数据修复复用原服务 runner 的快照/回滚能力，JS 校验数据/APK/代码版本和敏感能力声明，不重复执行已包含或已应用修复。

服务 HTTP 健康检查核对实际 code/dependencies 路径及 taskCode 版本、摘要、API/锁指纹，成功后提交组合。精确清理只扫描受管数字版本目录，同时保留服务与活动/上一健康/pending 启动器引用，拒绝链接和特殊文件。清理失败只记录重试，不回滚健康服务；ZIP 和用户数据不清理。

## 模型与首装提示

模型门面读取 JS 的目录/状态快照，加载前通过 JS 验证；模型准备按 ID 归并、允许取消、流式验大小与摘要，完整目录原子替换并兼容旧备份恢复。查询不下载，稍后不下载，原生加载与模型文件准备分开。网页默认提示 TTS 和 ASR/声纹，可手动选择其他模型。

首次提示由 JS 判定 min、前台、服务健康、显示页成功、未处理及缺少验证缓存。前台网页真实绘制后回传一次性令牌才消费提示；旧本地提示标记只作为首次迁移输入，后续决策由 JS 维护。页面返回显示端触发现有 singleTask Activity 重新连接。

## 文件与验证

- 新增 `src/apps/server/boot/offline-launcher/`、`scripts/ops/prepare-offline-launcher.js`；Offline profile 打包内置独立闭包及网页。
- 新增 Android LauncherSession/Client/Protocol/Activity、更新门面；适配 NodeRuntimeInstaller、NodeServerService、OfflineBootstrapManager、OfflineUpdateManager、OfflineModelStore、MainActivity、NativeBridge 与原模型 Dialog 兼容路径。
- `npm run test:offline-launcher`：26 项，含真实子进程候选切换/失败/超时/基线回退、本地 HTTP 下载与健康、平台依赖、task-only、种子/修复、模型、Chromium 页面交互。
- `npm run test:offline-bootstrap`：63 项；`npm run test:offline-data-repair`：72 项；Android Offline/Node 定向 JVM：147 项，编译与测试通过。
- 后续已验证SM-N9500 min59→min60→min61保留数据覆盖升级、真实WebView页面/桥、冷启动、JS启动器与服务105→106健康提交及重复冷启动；尚未验证新宿主空首装、旧full、实际模型加载/推理及性能。min61仅本地构建/安装，未清空手机；最新出包需求各项false，min61发布待办单列。

## min60 实机缺陷与修正范围（2026-10-16）

首次真实覆盖升级发现两处宿主缺陷：NativeBridge构造时JS模型快照未到导致崩溃；WebView统一403拦截误伤loadDataWithBaseURL的本地文档。用户已确认修复：目录查询使用可信APK目录占位、JS快照到达后动态切换；文档改为固定HTTPS顶层入口，由拦截器返回可信HTML。原生引擎加载前仍经JS校验，外部请求继续拒绝。min60不能视为已通过设备验收，需修正后的min包。


## min61 修复验证结果

min61（90,036,744字节/SHA256 `4eb5e8bcf01e78058139496c189fd87de215ba1799cbcfc34ef3ed5685ac9672`）通过CRC、签名、profile及真机两轮冷启动；本地页面实际截图/DOM与桥交互正常。网页确认服务更新后启动器active106/pending为空，code106/deps10/task1健康且pendingHealth=false，重启后仍用已验证JS106。主配置、用户配置、数据修复记录JSON与升级前相同，模型未自动下载。Android152、JS/网页26、首装打包63项通过。

切换期间新页面的初始查询可能被握手门禁暂时拒绝，显示“启动器暂不可用”；点击重新连接恢复，后续检查显示当前版本。自动重连体验作为可选优化单列，不误报更新失败或模型下载完成。备份、日志和截图仅保存在本机缓存，未提交产物。
