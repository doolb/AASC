# 正式 Android 显示端完整离线 APK

## 豆包登录Node资料采集（2026-10-14，已实现，待min56发布）

正常隔离登录WebView读取固定官网设备/web资料与当前UA，使用同批Cookie fp组装既有nodeProfile，资料完整后才完成账号回调。Activity将profile由内部字符串转换为嵌套JSON，既有服务账号校验/保存流程持久化；聊天请求无需网页。新增纯采集器6项测试及原生271项零失败/1既有环境跳过。account-web只读模式保持不提交账号，旧账号需正常重新登录补全；不自动生成设备身份。代码/spec/self-test对应chat2api-doubao-web，min56出包和正式真机结果后续记录。

## min 首次语音模型提示与ASR/声纹分组（2026-10-14，已实现并发布min55）

用户确认仅合并下载入口：ASR与声纹归为“ASR/声纹”组，保留sensevoice/voiceprint的模型ID、可信摘要、发布路径及独立缓存；TTS保持独立组，LLM仍逐项选择。“本机模型”入口可一键准备组内模型，完整缓存复用，部分缓存只下载缺项，组内各模型依然独立原子提交，取消不删除已完成文件。

min首次服务健康且显示页成功打开后，弹出默认勾选“TTS”和“ASR/声纹”的原生确认，显示所选组待下载量；不在模型状态查询时弹窗或联网。已有完整验证缓存不需要提示，取消/稍后不下载，后续从“本机模型”手动准备；首次提示记录在本机SharedPreferences，不随日常重启重复弹出。普通/完整APK不自动弹此首次提示。

准备进度按组内字节量汇总；失败可重试，已完成项保留；取消覆盖当前与尚未开始的组内项，迟到回调不加载旧选择。TTS/ASR准备完成进入现有原生引擎加载，声纹不改变用户开关，后续启用时加载。min55已构建发布，基础依赖与模型归档路径不改变。任务：`docs/task/20261014_Min首次语音模型提示与ASR声纹分组.md`。

验收：Android265项0失败/1既有环境跳过，新增9项全通过，首装63/63。SM-N9500覆盖安装min55保留原模型，首次两组默认勾选、无选择时按钮禁用、稍后不下载且冷启动不重复；手动ASR/声纹组仅补39.2MiB声纹，ASR大小/mtime保持，三模型filesReady=true、TTS/ASR引擎ready。此为覆盖安装/部分缓存验收，未另行清空应用重做干净首装。


## min 独立首装修复（2026-10-14，min54已生成，干净首装通过）

SM-N9500卸载完整Offline APK后单独安装min，首装暴露两处问题：min51的种子恢复遗漏合法空实例目录，使latest校验失败；min52恢复目录后，Node缺少配套`libc++_shared.so`；min53已打入该库但安装器另一份旧白名单仍拒绝。最终min54恢复目录与文件，在目录就绪后转换latest，解析器和安装器共用精确动态库白名单，保留链接防护、已有文件和重试行为，不人工制造结果文件。

min54：89914041 bytes，SHA256 `ed8075e671415711da0ad11c103eafa7b6f595c27c1c2b97f030b61a7e19cc14`，同一签名、allserver-min/updateOnly、CRC及配套库真实字节验证通过。再次卸载并从空应用目录独立安装54，原生确认LAN约60MiB，下载code87/common10/android9/seeds86，HTTPS status=ok，活动指针pendingHealth=false；llm-server/results/40f3b6b1与time.announce/results/728486a7已恢复，latest为有效相对链接。首装不恢复旧备份，不借旧服务或诊断复制文件。

Node由ProcessBuilder启动独立子进程，只在子进程环境搜索Node配套C++库；MNN在Android应用进程使用APK的NDK C++库。两者地址空间与库路径分离，不替换MNN运行库。此前APK库无法提供Node所需符号，不能互相代用。当前验证覆盖Node启动及库映射，未进行MNN真实模型推理。

Pi30/30、依赖106/106、首装63/63、Android254项0失败/1既有环境跳过。服务87/依赖10和独立ORT/Pi已发布，common展开由约402MiB降至130MiB。min54覆盖本次修复；其后其他TTS原生/服务修改仍要求新产物，保留minApk/servicePackage=true，dependenciesPackage=false。备份与验收证据见 `docs/task/20261014_PiAgent可选依赖与minAPK干净首装.md`。

## 整包安装后一次性切回内置服务（2026-10-14，已实现并发布full50）

用户确认仅在安装整包后的首次启动使用APK内置服务和生产依赖，随后仍允许热更新；追加要求删除之前下载的代码和依赖目录。当前NodeRuntimeInstaller迁移整个updates目录，旧active-release.json仍有优先级，因此整包内置版本可能没有实际启动。

方案采用APK安装身份（versionCode、lastUpdateTime及内置Runtime版本）的一次性状态，区分每次整包安装与日常重启；同版本重装也触发，min/普通APK不触发。新整包强制执行内置环境安装与校验，事务切换后退出旧active指针，启动根目录内置服务/根node_modules。保存必要的旧指针与切换状态，健康检查核对内置版本、路径和服务能力，成功后才提交完成状态与删除旧下载版本目录；失败不清理旧目录，并报告/沿用已有回滚能力。后续热更新可以再次创建active指针，不因日常重启被重置。

清理严格限定aasc-server/updates/code/code-v<digits>和updates/dependencies/dependencies-v<digits>普通目录，子项删除不跟随链接，未匹配项保持；不会删除APK根目录源码/node_modules、私人配置/账号、本机模型缓存、任务/results、日志、data-repair或下载ZIP。完整环境换根保留额外下载的Node模型文件，新包自带同路径定义采用APK版本；本次备份清理不跟随链接。用户已追加授权验证后构建并发布新整包；新versionCode高于当前最高47，整包包含code85/deps9/基线3，完整发布不替换服务manifest。具体安装身份、健康提交与中断恢复见新task/spec；已完成原生源码与246项单元验证，full48已生成并验证85/9/基线3，两端镜像发布成功。随后发现的分组ZIP校验问题另见本模块修复章节。


## origion 仓库合并（2026-10-14）

独立 min / LLM 外置源码与 `origion/master` 的文档、豆包登录保存和只读列表验证提交合并，双方功能与验收记录保留。项目默认 Git 远端明确为 `origion`；本次未出包，已提交的 minApk/servicePackage 待出包状态不得被远端旧值清除。另一任务未提交的分层依赖和发布状态在工作区继续保留。

## Offline 显示端本机模型入口位置（2026-10-14）

Offline APK 显示页的“本机模型”入口在具备原生模型管理能力时显示，并固定在交互舞台左上角，按屏幕安全区及软键盘内缩量留边；聊天、角色按钮和语音控件继续位于原交互位置。网页端不显示该原生入口。布局位置使用显示舞台现有旋转安全区变量，避免刘海和横竖屏旋转遮挡。

## 独立 min 与 LLM 外置源码实现（2026-10-14）

前轮方案已确认并完成源码实施。新增 `OfflineBootstrapManager`、`OfflineRuntimeState`、`OfflineBootstrapHealth` 和本机模型管理模块；以下描述新版源码行为，正式资源尚未构建或部署。工作区配置为 full v43 / min v44，完整包服务基线改为待发布 code79/dependencies8，避免被现有 code78错误覆盖；LAN 当前发布仍为 code78/dependencies8/min41/full38。

- min首次安装不再要求已有full。原生界面先验签清单并显示总大小与来源，确认后下载同一快照的code/dependencies/nodeMinSeeds；只复用APK里的Node本体与动态库，不执行Android npm安装。发布清单需包含新增的arm64/Node26/contract1运行契约，旧清单无法作为干净首装来源。
- 首装使用文件锁、独占staging、大小/SHA-256和既有受限ZIP检查；config、userconfig、task分别恢复到config、home/.config/aasc-user、res/tasks，已有用户文件保持。已有文本latest会在实例目录就绪后恢复为相对链接，重试保持已有有效链接；进程中断后只清理严格命名的首装暂存目录。
- HTTPS证书对与可信模型目录由独立bootstrap资产清单提供，不扩大update-only动态库白名单。候选active-release经本机API版本/路径、HTTPS控制页/显示页及WebSocket Upgrade校验后提交；探测使用无业务角色路径，不创建临时显示端。无previous失败撤销指针，下载缓存与用户目录保留；当前代码不把模型就绪作为环境检查条件。
- 首装取消使用每次请求独立令牌与启动代次；后来的确认不能恢复旧取消任务，排队旧启动会被忽略。断线与失败可重新确认后重试，不自动重新下载未获确认的环境。
- 显示页增加“本机模型”原生列表，可逐项确认下载/校验/加载，固定LAN源和HTTPS WAN源必须满足APK可信文件定义。缓存优先，SDK状态查询、自测和定时业务不触发模型下载；坏本地文件需要重新确认下载，不把“加载”确认转为隐式下载。模型管理器动态选择有效缓存，TTS/ASR下载结束不重放旧请求。
- Qwen与其他LLM由APK持有文件，Node只保留定义；旧files/models/llm/bundled缓存可校验复用。下载任务串行、按模型归并；取消保留旧完整文件，进程中断恢复旧缓存目录且不跟随链接。已验证文件状态与引擎ready分开，文件属性未变时复用验证标记；切换其他LLM使用该模型自己的revision。
- full配置只选择SenseVoice/TTS/声纹，LLM的图、权重、tokenizer、视觉文件及目录内配置均不进入APK。保留MNN/JNI和两种包共用的小型可信目录/LLM定义。min继续models=[]与updateOnly=true。
- 新更新器使用runtimeCompatibility且允许空bundled集合；过渡清单默认保留既有签名min清单的旧模型指纹，不从新full空集合派生。当前LAN旧指纹为`e64518394baf8576a6b69b6e737b074412dafd7cc6eb43c67b00f09088449aeb`；不同旧cohort和full23真实设备仍待迁移验收。

原生/资产及服务/网页受影响，`minApk=true`、`servicePackage=true`；生产依赖集合未变且旧依赖元数据保持兼容，`dependenciesPackage=false`。验证及发布门槛见 [实现任务](../task/20261014_OfflineMin独立首装与LLM外置实现.md)。下文2026-10-13“待实施”段为历史设计，当前源码以本节及对应spec完成记录为准。

## min 独立安装与 LLM 模型外置实施设计（2026-10-13，待代码方案确认）

本节继续前次评审并补齐实施契约；以下均为目标行为，尚未实现。前次评审中的 full v23 / min v36 是历史基线；本轮工作区为 full v38 / min v37，full v38 仍包含 Qwen。沿用 `allserver`、`allserver-min`、`com.aasc.display.offline` 和既有签名；下次 min 版本必须高于当前两种包及发布索引中的最高 versionCode，当前最低为 v39，实际出包时重新检查。

### 产品边界

| 安装方式 | APK 内资源 | 首次使用 | 后续离线使用 |
|---|---|---|---|
| 新 min 独立安装 | Node 本体/动态库、原生推理库、验签公钥、首装元数据、本机 HTTPS 资源；无服务代码/生产依赖/模型权重 | 原生确认后下载 code、dependencies、nodeMinSeeds；模型逐项确认下载 | 环境与已下载模型均复用，不要求安装 full |
| 新完整 Offline APK | 现有服务环境、SenseVoice/TTS/声纹、小型模型定义；不带任何 LLM 模型运行文件 | 控制端及 ASR/TTS 可离线使用；本机 LLM 首次需准备模型 | 已下载 LLM 可离线推理 |
| 旧 full / min 升级 | 原有有效环境、用户数据和旧 Qwen 缓存 | 先保护旧 APK 独有资产，再覆盖升级 | 保留已验证模型与用户配置 |

“不打包 LLM”按此前评审范围定义为不内置 LLM 模型文件，包括图、权重、视觉分支、tokenizer 和模型目录内配置；保留 MNN/JNI 推理能力及 `llm/manifest.json` 小型定义。安装新 min 无需另一个 full APK，但空白设备首次准备环境需要联网。环境未下载时显示原生初始化页；环境就绪而模型缺失时仍允许控制页、媒体展示和服务更新。

### 首装环境与就绪契约

新增独立 `OfflineBootstrapManager`，复用更新器的验签、受限 ZIP、流式下载、版本目录和健康提交能力；将共用能力抽到小模块，不向 Activity/更新器堆叠条件分支。保留 update-only Runtime manifest 的动态库白名单；HTTPS、模式及模型定义走独立的 `offline-bootstrap-manifest.json` 资产清单，不能混进 allowedRuntimeLibraryPaths。完整包与 min 从同一生成器取得小型定义。

服务安装检查改为 `runtimeReady`：检查 APK Node 可执行库、ABI/受支持的 Node 主版本与运行契约、已安装动态库、有效配置、证书对、服务入口、生产依赖、包/lock 指纹及已确认的 release 元数据。读取 active-release 时检查其指向的版本目录，不能仍固定检查根目录的 src/node_modules。旧根目录完整安装采用兼容适配，检查通过后写新的环境标记。`offline-model-manifest` 格式缺失、字段错误属于模型元数据异常；合法 `models=[]` 可解析。模型异常只影响对应能力，不能用它代替环境检查；内置模型缓存就绪另查完整文件。

原生首装操作：

1. 先检查已有环境；完整可用则直接启动，缺失则显示“准备本机服务”及下载源、实际包大小、所需空间、下载/稍后按钮。未同意不下载，首次模型准备另行确认。
2. 使用现有 Offline LAN/WAN 源和 APK 公钥获取已验签快照。code、dependencies、nodeMinSeeds 必须来自同一 payload；code.requiredDependencyVersion、code.requiredLockSha256 必须与 dependencies 匹配。新增首装流程要求 nodeMinSeeds，旧环境更新仍允许旧清单缺该组件。同版本不同摘要拒绝；备用源仅能提供该快照相同摘要的组件，不组合各源的“最新版本”。
3. 将原生运行要求加入签名发布元数据，并与 APK 的 ABI、Node 主版本和运行契约版本比较。依赖包的 lock 一致不能证明 Android 可用；保留现有 Android 能力策略，并验证实际服务启动与必需模块导入。首装不在 Android 上执行 npm install，不下载另一个 Node 可执行文件。旧清单没有新契约时可供旧环境更新，但不作为新版干净首装的依据。
4. 使用应用私有目录、单一安装锁与持久事务记录准备 staging。先验签/大小/SHA-256，检查 ZIP 展开总量、条目数、重复条目、路径及链接，再解包。下载前预算压缩包与保留目录；解包前按真实展开量再次检查空间。已有有效环境/配置/模型不被覆盖。
5. 种子仅允许 config/userconfig/task：config → `config/`，userconfig → `home/.config/aasc-user/`，task → `res/tasks/`。`results/latest` 的普通文本实例 ID 仅在同一 results 下存在对应目录时恢复为相对链接；未知链接拒绝。保留已有用户文件，缺失文件才补种；不从 app.json 新增 tasks。调用现有 `NodeServerConfig` 设置本机端口、Offline main 身份和原生 ASR/TTS 模式。
6. 本机 cert.pem/key.pem 沿用当前 APK 证书构建输入，经 min 独立资产清单校验后安装到 `res/certs/`；不放进公开种子 ZIP。两者不全、无法建立 HTTPS 则不进入 ready，不因 HTTP `/api/status` 可访问而误判 Offline 页面可用。
7. 将 code/dependencies 安装为 `updates/code/code-vN`、`updates/dependencies/dependencies-vN`，创建 `offline-update-client.json` 与候选 active-release，复用现有 pendingHealth 流程。干净首装没有 previous；健康失败时撤销候选指针，回到可重试首装页，保留验过的下载文件。已有环境则回滚 previous。证书 HTTPS 状态、服务/依赖版本、控制页资源与 WebSocket 初始化均通过后才写环境确认标记。

### 模型准备、缓存与来源

新增来源适配/准备协调模块，供 ASR/TTS/声纹/LLM 管理器使用。每个模型以 `{modelId, revision, files, totalBytes}` 描述；定义中的每项含安全相对路径、大小和 SHA-256。可信定义来自 APK 资产或已验签代码包中的生成目录，aimodel 根清单用于确认已发布完整性，不能用 LAN 返回的新哈希替代可信定义。

已有有效 APK 资产/旧解包目录和 `files/models` 缓存优先；无有效本地文件才读取 aimodel。ASR/TTS 不再因为传入 Offline 目录就永久禁用远端回退；无 Qwen 资产时不能注入假的 bundled 来源。LLM 默认 ID 保留，状态查询只返回 missing/available/ready 等状态，不触发下载或加载；用户选择/请求明确准备才进入协调器。

模型准备状态与原生引擎加载状态分开：文件 verified 后才可 load，只有原生自检/预热成功才报 ready；内存不足保留已验模型。网络缓存落在现有 `files/models` 对应目录，不复制 Qwen 到 Node 的 res/models；服务持有小型目录定义，Offline 原生模型请求从适配的 aimodel 来源取得文件，避免向本机缺失权重接口请求形成循环。

LAN 下载通过专用 Offline 模型来源策略接入：仅接受现有发布源对应的固定局域网 IP 和 `/mnt/aimodel/` 前缀、无凭证/查询/重定向；由可信定义校验大小与哈希。WAN 使用 `https://c.aasc.us/mnt/aimodel/`。通用 `RemoteModelManager` 的 HTTPS/回环 HTTP 规则保持，专用策略显式注入，不全局允许任意 HTTP。已有在线 APK 的模型 API 继续使用原接口。

业务交互约定：

- 首次缺模型显示名称、总大小、来源和“下载/稍后”；查询、预热、定时任务不弹框或自动联网。缺模型的定时报时/提醒返回 model_not_ready 并记录，不延后播放。
- 下载任务按模型 ID+revision 归并，多个调用者收到相同进度；同一模型不同 revision 串行，新选择使旧请求失效。同一设备默认一个模型下载任务运行，其他等待；环境首装先完成。
- ASR 下载后进入“可开始录音”，用户重新开始，下载期间不缓存麦克风音频。TTS 不积压旧播报；LLM 保留用户输入供重试，不自动发送旧请求。后续需要恢复原请求时必须携带 requestId/generation 并验证有效，本期不自动重放。
- 取消中止本轮模型准备并通知全部等待者，清理本轮未完成临时文件，保留验证完整的缓存及旧 revision。不会顺带卸载已就绪模型。进程退出后通过事务记录恢复；本期以单文件完整重试为准，不承诺 HTTP Range 续传。
- 模型文件 staging 完整验过后同卷切换；引擎未释放旧目录时不删除旧 revision。单纯更新 APK 不清除模型。坏缓存只将该模型标记缺失并允许重试，不重新下载服务环境。

### 旧更新器迁移与版本发布

第一版支持首装的新 min 必须采用过渡清单。`apkMin.modelCompatibilitySha256` 保留经过核验的旧 Qwen cohort 指纹；从已发布旧 full 的真实构建元数据提取，禁止从新 full 的空集合自动派生。新字段声明 runtimeCompatibility 供新版更新器判断环境兼容；旧字段继续在签名中。旧 full 升级路径仍先将 APK 内模型物化到 files/models，再请求系统安装；新更新器允许内置模型集合为空。

发布前对 full v23、full v38、min v36/v37 的模型指纹逐一核验。单一旧字段只能兼容一种指纹，不能声称支持所有旧 cohort；相同指纹走自动迁移，不同指纹保留旧入口并提供明确的手动升级路径，已就绪缓存保留。未经物化直接手动覆盖旧 full 可能丢失 APK 独有 Qwen，需重新下载，不能承诺其原始 assets 自动保留。新 full 无 Qwen 和干净 min 安装统一使用新运行兼容契约，后续无需伪造旧模型条目。

顺序为：完成同步器新分类兼容与测试 → 上传并核验实际 TTS/Qwen 文件 → 发布含小型模型目录和首装契约的 code/dependencies/nodeMinSeeds → 发布高版本过渡 min → 验收旧包覆盖/新包首装 → 用户明确要求时构建不含 LLM 的 full。全量 full 使用现有独立 `full-apk-manifest.json`，不写入服务 manifest。本轮只做文档，现有 app.json、发布状态、源码与资源均不变。

实施文件、L4 伪代码、自测与待确认范围见 [实施任务](../task/20261013_OfflineMin独立安装与LLM外置实施设计.md)；前次评审证据在下文保留，实施时以本节补充契约为准。

## min 独立安装与 Qwen 外置评审（2026-10-13，待方案确认）

用户要求沿用当前 min APK 产品，在没有安装 full APK 时支持下载服务运行环境和 ASR/TTS 模型；TTS、LLM 同时归档至外网 aimodel，完整 Offline APK 不再打入 Qwen。评审结论为方向可行、需补齐初始化与迁移契约，尚未开始源码实施。详细证据与验收矩阵见 `../task/20261013_OfflineMin独立安装与模型外置设计评审.md`。

纠正前一版下载范围：现有 min APK 已携带 Node 可执行库和所需动态库，首装应复用它们，主要下载服务代码、生产依赖和初始化种子。继续使用 `allserver-min`、`com.aasc.display.offline` 和现有签名，不新增 APK 产品；新增能力仍需要发布高于当前 v36 的 min 版本。

必须修订的设计：

- 服务环境就绪和模型就绪分开。当前 `offline-model-manifest.models` 实际仅包含内置 LLM，Qwen 移除后它为空；不能再把它的非空条件作为服务完整、快速复用或 min 升级的前提。保留对服务、依赖、ABI和元数据合法性的检查。
- 原生首装界面在本机服务启动前完成来源选择、下载确认、验签和安装。复用签名清单里的 code/dependencies/nodeMinSeeds，并补齐配置、userconfig、任务/results、latest恢复及本机HTTPS资源；code.requiredDependencyVersion与dependencies.version、code.requiredLockSha256与dependencies.lockSha256匹配，首次建立版本化active-release。
- Qwen默认选择、可下载定义、内置资产和本地缓存是四个不同状态。保留小型LLM定义，检测实际资产后才选择bundled路径；旧full物化的Qwen缓存可复用，新安装则提示下载，单纯状态查询不触发网络下载。服务进程不再另存一份Qwen推理权重。
- 旧更新器会先校验min清单中的modelCompatibilitySha256。过渡发布须保留其可接受字段或安排显式手动升级，不能只修改新APK内部逻辑并换成空模型集合指纹。新更新流程以服务/ABI兼容为依据，模型集合不阻断原生升级；替换旧APK之前仍保护尚未物化的内置权重。
- 完整APK拟仅保留SenseVoice、TTS与现有voiceprint白名单；新min首装可在模型全部缺失时正常运行控制页，再逐项准备模型。首次使用未下载的LLM依赖联网，缓存就绪后可本机推理。
- aimodel的新分类/目录、APK清单适配、LAN HTTP下载限制和旧同步器迁移要同时完成；`-aimodel`仍是显式镜像开关。不能把模型文件已上传等同于APK已支持下载。

首装断网、坏包、空间不足、进程退出和健康检查失败须能重试且保留已有有效目录；同一模型多次触发下载必须归并。下载期间业务暂停/恢复、取消和缓存损坏处理仍需在实施设计中写明。已有发布状态保留，本轮只完成评审与文档。

## 需求

新增一个独立的正式显示端离线 APK 构建入口。该 APK 在包内携带 Android Node.js Runtime、正式显示端服务器代码、生产依赖和当前正式运行模型；安装后不要求连接外部主服务器即可在本机启动服务器、加载显示页面和控制页面。

普通 `com.aasc.display` APK 的构建、包名、连接主服务器和子服务器行为保持不变。

## 方案

- 新增 `npm run build:apk:offline`，复用现有 Android Node Runtime 准备流程，并在构建生成目录中加入固定白名单模型。
- 离线 APK 的文件名为 `aasc-display-offline.apk`，包名为 `com.aasc.display.offline`，应用名称为 `AASC 显示端 Offline`，版本名追加 `-offline`。
- 包名不能包含连字符，因此使用 Android 合法的 `.offline` 后缀；文件名和版本名保留 `-offline` 标识。
- 离线模型以当前`release/apkbuild/allserver/app.json`的models与实际APK目录为准。2026-10-12核对当前profile选择Qwen、SenseVoice、TTS与voiceprint；声纹仍只选base FP32和Pyannote。实际已发布完整v23在YOLO/ASR/声纹同步范围内仅内置SenseVoice/base FP32/Pyannote三个ONNX，不把历史兼容列表中的Zipformer/GTCRN/OCR/YOLO自动视为已内置。不包含测试APK专用声纹变体、YOLO其他尺寸、LFM-VL或分割PT。
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

## Offline 手机显示缩放上限校正（2026-09-20）

- 现场设备 `2309×1080@480dpi` 的等权混合结果为 `165%`，现场反馈显示端和控制端仍偏小；该设备仅作为验算样例，不做分辨率或 DPI 特判。
- Offline WebView 按 `smallestScreenWidthDp` 区分手机和电脑，再使用设备类别系数计算缩放因子：`clamp((长边 / 1280) × (densityDpi / 320) × deviceCoefficient, 1.0, 3.0)`。
- 手机系数为 `1.108705`，电脑系数为 `1.0`；`2309×1080@480dpi` 的手机样例计算约为 `3.0`，转换为 WebView 初始比例约 `300%`。普通 APK 继续固定 `100%`。
- 只调整 WebView 页面初始比例，不修改系统 density、物理/逻辑分辨率、媒体源分辨率、模型渲染尺寸或输入坐标协议。
- 显示页、控制页、render-display 内容和 Offline 诊断浮层复用同一策略，避免诊断值与实际比例不一致。
- Android JVM 单元测试已通过；min v23（`0.2.21-offline-min`）已重新构建并发布到 LAN/WAN。APK 大小 `89264066` bytes，SHA-256 为 `dfed13b4b2a1946dd14c64ae0cfae1881ea1728184d82a43ea58c92e533950d0`；两端签名清单、HTTP `200`/`Content-Length` 和旧 min 精确清理通过。

## Offline 高 DPI 屏幕上的 TTS 位置（2026-10-12）

- Offline 显示 WebView 保留现有分辨率/DPI 初始缩放；仅归一化 TTS/ASR 共用语音文本节点在 0°/180°使用的固定边距。
- `DisplayWebView` 保存实际传给 `setInitialScale` 的百分比，并由显示页的 `NativeBridge` getter 原样提供。语音文本节点将 160 CSS px 基准偏移除以初始缩放因子，使 112%、150%、300%缩放下的物理偏移仍为 160 px。
- 90°/270°继续使用原有旋转包围盒中心锚点；普通 APK、浏览器和不支持新 getter 的旧 APK 回退到 100%。语音状态行和 Offline 控制页不随本次调整。
- 变更触及 Android 原生桥和服务网页：`minApk`、`servicePackage` 状态保持 true，待下次出包/服务包处理；本次不构建或发布 APK。

## Offline 控制端输入框聚焦缩放（2026-09-18）

- Offline 控制端单独关闭输入框获得焦点时的页面自动缩放，避免弹出软键盘后控制页面被放大；显示端 WebView、普通 APK 和用户已有页面缩放行为保持不变。
- 控制端仍使用 Offline 的初始分辨率/DPI 缩放比例；本次只补充控制页 viewport 的 `maximum-scale=1`、`user-scalable=no` 约束，不修改系统 density、分辨率、键盘高度、输入坐标或显示端媒体渲染。
- 原生 `DisplayWebView` 通过控制页标记注入一次性 viewport 约束，页面加载完成后执行；若页面已有 viewport 则更新内容，没有则创建，避免修改服务端网页源文件并影响浏览器控制端。
- 已完成：`DisplayWebView.kt`、`MainActivity.kt` 和 Offline 静态回归已覆盖；Android JVM 单测 `BUILD SUCCESSFUL`。真实控制端键盘回归仍需下一次安装新包后现场确认。
- v11（`0.2.9-offline-min`）已构建并发布到 LAN/WAN，APK 大小 `89235646` bytes，SHA-256 为 `0b3ab8871ca17e32fa1dc5db767ef8b31049a973d8d678faa471e1ad4ac396da`；两站点 HTTP 200、Content-Length、远端 hash 和签名清单校验通过。此次发布暂未覆盖安装到真机。

## Android 启动权限串行申请

显示端启动流程先完成现有共享存储权限处理，再依次申请录音、摄像头和 Android 13+ 通知权限。每个权限请求都等待系统回调后才进入下一项；用户拒绝某项时也继续处理后续权限，避免 Android 丢弃同一时刻并发发出的权限对话框。已授权的权限跳过，不重复弹窗。

录音或摄像头权限在本轮启动中获准后，等权限队列结束再统一重载 WebView，使网页能力探测读取最终授权状态；通知权限不触发 WebView 重载。权限请求不改变用户主动关闭显示端语音监听的设置。

## Offline APK WebView 文件选择器（2026-10-13）

- WebView 页面通过 `<input type="file">` 发起文件选择时，由 Android 原生层启动系统文件选择器，并将所选 URI 交还给网页。显示页 WebView 与控制页 WebView 共用该流程，因此 Chat2API 控制页的账号凭证 JSON 导入可以直接弹出系统文件选择界面。
- 原生层采用 Activity Result API 管理选择器结果，并使用 WebView 提供的 `FileChooserParams.createIntent()` / `parseResult()` 保留页面声明的类型筛选和多选行为。
- 同一 Activity 只保留一个未完成的文件选择回调；新请求会先以取消结果结束旧请求，用户取消、启动失败或 Activity 销毁时也会以空结果完成回调，避免网页选择状态悬挂。
- 仅授予系统文件选择器返回的 URI，不新增通用存储权限；普通 APK 和 Offline APK 的页面能力保持一致。
- 已完成 `DisplayWebView` 与 `MainActivity` 接入，Node 静态定向回归通过，Android JVM 单元测试通过；`minApk=true` 等待下次签名构建，真机文件选择交互待安装新包后确认。

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
- 2026-09-18 已完成实现并通过 Node 39 项 Offline/APK 回归与 Android `OfflineUpdateManifestTest`；旧清单缺少字段时日志区域保持隐藏。

## Offline 屏幕诊断信息浮层（2026-09-18）

- Offline APK 在 `webContainer` 右下角显示小型诊断浮层，内容包含当前应用区域分辨率、densityDpi 和 WebView 初始缩放百分比，例如 `分辨率 1920×1018 | DPI 160 | 缩放 100%`；Display 2 的底层显示分辨率仍为 `1920×1080`。
- 诊断数据复用 `DisplayWebView` 使用的所属 Display `displayMetrics` 和 `WebViewScalePolicy`，避免浮层显示值与实际缩放策略不一致。
- 浮层只在 Offline APK 显示，普通 APK 保持原有界面；更新卡片、启动遮罩和控制端按钮保持更高层级，诊断文字不抢占交互区域。
- 屏幕配置变化时重新读取当前 metrics 并刷新文字；不修改系统 density、分辨率、媒体尺寸、截图像素和输入坐标协议。

## Offline 更新卡片与缩放诊断提示自动隐藏（2026-09-21）

- 更新卡片在等待用户确认、服务代码/依赖下载、校验、安装提交等状态下，10 秒没有触摸操作时收起到右侧入口；后台下载和校验继续执行，不取消任务。
- 收起后保留右侧“更新”入口，点击入口只恢复完整卡片并继续显示实时进度；下载失败或需要用户确认安装时重新展开卡片，保证错误和系统确认提示可见。
- 更新卡片收到进度刷新时不因为后台进度自动展开，也不重置“无触摸 10 秒”计时；用户主动触摸卡片才重新开始计时。
- 分辨率/DPI/WebView 缩放诊断浮层在 Offline Node 服务启动成功后显示 10 秒，随后自动隐藏；屏幕配置变化仍刷新当前值，但不会改变 WebView 缩放比例。

## APK 原生 OpenAI `_vendor` 资源路径修复（2026-09-21）

Android Gradle 的 assets 默认忽略以下划线开头的目录，导致完整 Offline APK 中虽然保留了
`openai/lib/ChatCompletionStream.mjs`，却丢失其依赖的 `openai/_vendor`。构建器将 `_vendor`
仅在 APK assets 中映射为 `aasc-openai-vendor`，安装器完成 SHA-256 校验后再恢复为标准
`openai/_vendor`，不改变生产依赖包、代码热更新包和 Node.js 的模块导入路径。

该映射只作用于完整 APK 的内置 Runtime；min APK 不携带服务器依赖，code/dependencies
热更新包继续使用原始 `_vendor` 目录。构建和 Android JVM 测试必须同时覆盖 APK 物理路径、
安装后逻辑路径以及 `ChatCompletionStream.mjs` 的导入目标。

实现结果：顶层 OpenAI 包和 Pi SDK 内嵌 OpenAI 包均已覆盖；完整 APK v22 的 ZIP 结构和
压缩数据校验通过，安装器单元测试确认 marker 只重命名为 `_vendor`，不进行二次文件复制。

发布结果：修复后的完整 APK 使用 v23 发布，min APK 使用 v32 发布；完整 APK 不写入服务
manifest，min APK 发布时原子更新 manifest 并继续引用 code v19/dependencies v4。内网和
外网均完成资源 hash/Content-Length 校验及旧版本精确清理。

## 完整 APK 基线 active release 初始化（待处理，2026-09-21）

当前完整 Offline APK 将内置代码和依赖直接安装到 Runtime 根目录，并通过
`offline-update-client.json` 记录基线版本；首次安装不会创建
`updates/active-release.json`、版本化 code 目录或版本化 dependencies 目录。
因此首次 code-only 更新若找不到对应的版本化依赖，会把根目录内置依赖写入
active release 并标记为 `legacy-root`。该问题只记录在此，暂不改变启动和更新行为。

## 平台依赖分组（2026-10-14）

签名清单增加固定common/android/linux64/win64依赖组，组合版本和锁指纹绑定代码。Android只选择common+android，要求ARM64/Bionic/Node26，原生Node ABI147/NAPI最高10；组内容未变复用缓存，元数据及实际文件指纹均验证，组装拒绝覆盖。热更新和min首装共享OfflineDependencyGroups，继续使用现有完整依赖版本目录、pending健康指针及整组回滚。组JNI仍在APK；旧单包可读取用于迁移，旧解析器需先安装新版min。

## 外网真机分组依赖更新失败修复（2026-10-14）

外网真机报告缺少dependency-manifest.json。根因为OfflineDependencyGroups把组ZIP交给旧完整依赖校验；common仅有dependency-group.json，android组也不含Express。按组件分派验证规则，保留归档安全、签名SHA、实际内容指纹、组合后的Express和生产锁检查。已批准的原生更新器范围内补充修复与真实ZIP回归；发布修复原生APK，现有v9分组包不修改、不伪造额外Express或全局元数据。full48已发布，修复版用新数字版本，不覆盖旧产物。

修复已实现并通过Android251项及真实v9组合/锁验证：dependencyGroup单独校验；生产锁使用本地安全路径检查允许@scope，下载URL限制保持原规则。追加ADB SM-N9500覆盖与更新验收已获用户授权；full50/min51已正式发布两端，ADB实际APK公网隔离安装链与真实应用健康/清理/日常重启验收完成。

当前正式完整APK为v50、min为v51，服务85/9/repair3/seeds85。真实Note8覆盖启动后根路径85/9，旧code76健康后清理，日常重启无再次安装；公网原生ALL安装在独立目录验证，fixture已清理。原生修复不能仅依赖JS数据修复包，旧客户端须安装新APK。
