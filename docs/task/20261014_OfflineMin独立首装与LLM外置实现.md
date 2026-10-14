# Offline min 独立首装与 LLM 外置源码实施

## 任务、授权与状态

用户确认前轮具体改动方案，并在权限调整后要求继续。2026-10-14完成源码、配置、伪代码及自测实施；未构建正式APK/服务包、未发布资源或安装设备。前轮需求及评审见`20261013_OfflineMin独立安装与LLM外置实施设计.md`，本文件记录当前真实结果。

LAN只读发布基线code78/dependencies8/min41/full38；工作区候选full43/0.2.41-offline、min44/0.2.42-offline-min。完整包候选服务基线79/8，防止其新网页被已发布旧code78反向覆盖；实际出包前重新核对发布最高版本与源码覆盖。发布状态minApk=true、servicePackage=true、dependenciesPackage=false，生产依赖集合未变。

## design 与 spec

- design：`docs/design/android-display-offline-apk.md`、`docs/design/ai-model-sync.md`顶部2026-10-14完成小节。
- spec：对应两份spec的“实际流程”；历史草案保留，标记新实现记录优先。自测伪代码在`docs/spec/self-test.md`。
- 需求落地为原生确认→固定签名快照→流式校验/受限ZIP→初始化种子/HTTPS→版本目录→健康提交，以及可信模型定义→显式准备→独占缓存→原生加载。

## 实施模块与代码

| 模块 | 文件与结果 |
|---|---|
| 首装/就绪/健康 | 新增OfflineBootstrapManager、OfflineRuntimeState、OfflineBootstrapHealth；修改MainActivity、NodeRuntimeInstaller、NodeServerService、OfflineUpdateManifest/Manager。文件锁/每请求取消令牌/启动代次去重，保留用户数据、恢复latest；API版本/路径、HTTPS页面及无业务角色WS握手后提交 |
| 模型缓存/来源/交互 | 新增OfflineModelStore、OfflineModelRecovery、OfflineModelPreparationDialog、OfflineModelStatusBridge；修改NativeBridge及ASR/TTS/声纹/LLM管理器，固定LAN与HTTPS WAN、可信文件集、归并/取消、旧缓存恢复、动态目录与各自revision |
| 打包与过渡 | build-apk、prepare-android-node-runtime、offline-update-package、offline-min-apk-package、新offline-runtime-contract及两份app.json；bootstrap资产独立清单、full小型定义/空LLM集合、签名code运行契约、旧指纹从既有签名清单保留 |
| 归档/目录 | ai-model-common、publish-ai-models、新offline-model-catalog及src内两份小型JSON，TTS14项声明完整性、LLM三段白名单及缺项拒绝；修改llm-model-manifest-service，无资源仍列5种定义，ready=false |
| 自测/网页 | display.html“本机模型”，self-test.js只读原生桥；新增offline-model-catalog.test.js、OfflineBootstrapTest，更新Runtime/版本/min包/源码包与受影响静态夹具，新增npm test:offline-bootstrap |

模型文件状态和引擎ready分别表达；API查询与自测不下载、不预热。用户“加载”已存在模型后校验失败，需重新确认下载。TTS旧播报、ASR旧录音和LLM旧请求不重放。缓存所有者为APK，Node不复制Qwen。

## 自测、兼容与执行记录

- `npm run test:ai-models`：36/36通过，包含真实本地Python事务、HTTP夹具、TTS/LLM完整性、非法目录、本机定义及只读自测。
- `npm run test:offline-bootstrap`：60/60通过，包含动态库白名单不扩张、min独立HTTPS/目录资产、full无LLM权重/合法空集合、过渡旧指纹、签名/种子与完整服务快照。均是隔离临时夹具，不是正式APK出包。
- Android `:app:testDebugUnitTest`：编译与218/218单元通过。新增用例覆盖版本目录、无LLM环境、种子/已存在文本latest/有效链接重试、ZIP越界、LAN/WAN安全源、定义路径、空兼容集合、WebSocket摘要以及模型/首装中断恢复。
- 扩展回归：`android-offline-apk`、`llm-model-download`、`apk-llm-capability-release`、`offline-update-sync`共46项43通过3失败。使用HEAD原始静态用例及HEAD源码只读重现27项23通过4失败；浮层leftMargin、旧displayId种子、登录按钮锚点三项同名失败保留待维护，Qwen绑定受影响用例已更新并通过。
- `/tmp`配额造成大文件夹具失败、沙箱造成Gradle缓存只读及子进程EPERM；切换项目tmp并按授权重试后，核心测试通过。未删除用户临时文件或改变系统Node配置。
- JS模块及display.html普通内联脚本语法、定向差异空白检查通过；文档相对链接与代码块闭合另检查。测试及构建中间文件保留在忽略目录，不提交Git。
- 提交前按暂存快照复跑：模型36/36、首装打包60/60、Android218/218通过，JS16模块语法与JSON解析通过。共享文件仅暂存本任务变更，未纳入另一任务的分层依赖实现；临时测试快照保留在忽略的tmp目录。

## 性能与兼容边界

模型传输为64KiB流式缓冲，落盘校验后同卷切换；同模型请求串行归并，缓存验证标记使用revision/大小/mtime/摘要，不复制Qwen到服务目录。首装先按下载量、再按真实ZIP展开量复核空间，健康窗口120秒。临时夹具用时只说明测试成本，不代替真实设备环境下载、峰值空间/RSS和模型加载耗时。

实际旧full23/38与min41的系统覆盖安装、干净min首装、WAN完整Qwen/TTS下载、无网推理、低内存和掉电恢复仍待设备验收。当前只读LAN旧指纹为`e64518394baf8576a6b69b6e737b074412dafd7cc6eb43c67b00f09088449aeb`，缺历史cohort证据时不得宣布跨指纹自动兼容。生产依赖8为既有发行输入，未验证所有真实设备的原生模块/平台组合；启动健康失败不会误报ready。

## 发布与剩余任务

1. 先部署新版模型同步器，核对实际TTS/Qwen所有必要文件并完成上传/HTTP大小与SHA-256验收；4种缺失LLM不报告已上传。
2. 出包机生成包含可信定义与runtimeCompatibility的服务代码快照及种子，生产依赖集合不变可复用现有依赖包；发行代码与候选full服务基线协调。
3. 构建签名min、按旧cohort过渡清单发布，再验收实际首装和覆盖安装。已有旧源不提供新运行契约时，独立min明确提示先更新发布资源。
4. 完整无LLM APK只有用户明确要求才构建，沿用独立full-apk-manifest；本任务未授权扩大为完整发布。

源码完成条目从todo删除，只保留上述部署/设备验收和3个既有自测维护项。Git只归档本任务代码、元数据、状态和文档，不包含模型/日志/APK/ZIP或其他任务改动。

## 风险与工时

主要剩余风险为真实依赖平台兼容、历史指纹cohort及公网资源准备，需要实际出包/设备证据。本期未新增可配置HTTP接口，运行配置继续使用AASC已有流程。前轮预计2–4个工作日是实现/全设备迁移估算，本轮已完成源码与自动验证；实物发布和设备性能验收另计。
