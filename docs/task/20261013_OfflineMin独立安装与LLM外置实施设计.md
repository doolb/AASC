# Offline min 独立安装与 LLM 模型外置实施设计

2026-10-14续记：方案确认后源码已完成，当前实现/验证/尚待实物发布边界见[实现任务](20261014_OfflineMin独立首装与LLM外置实现.md)。下文2026-10-13状态为当时设计记录。

## 任务描述与本轮结果

2026-10-13用户要求继续此前“min APK 可独立安装、Offline APK 不打包 LLM”的设计。本轮补齐首装、模型准备、旧包迁移和发布契约；只更新文档，不实施源码、不改 profile、不构建或发布。前次评审保留在 `20261013_OfflineMin独立安装与模型外置设计评审.md`，本任务作为后续实施依据。

现状证据：master工作区 full profile v38/0.2.36-offline、min v37/0.2.35-offline-min；full仍有Qwen。min带Node本体和动态库，但Activity及安装器要求已有full；模型元数据检查拒绝空models；旧更新器比较模型指纹且要求至少一种bundled模型。当前dependencies内部仅声明version/lock，尚无新运行契约。上述问题均尚未修复。

## design 需求与决策

对应设计为 `docs/design/android-display-offline-apk.md` 的“min独立安装与LLM模型外置实施设计”与 `docs/design/ai-model-sync.md` 的“TTS/LLM发布及APK来源契约”。

- 沿用现有包名、签名和profile。下一次min高于full/min及发布索引最高versionCode，当前至少v39，实际出包时重新计算。
- 空白设备安装min后，在原生页明确确认，下载同一签名快照中的code/dependencies/nodeMinSeeds；复用APK原生运行库，首装不运行npm install。环境就绪不要求任何模型就绪。
- full移除所有LLM模型运行文件，保留MNN/JNI和小型定义；继续内置现有SenseVoice/TTS/声纹。LLM首次准备联网，已下载缓存可离线使用。
- HTTPS证书对与模式/小型模型目录作为min独立bootstrap资产，沿用现有证书构建输入；不混入动态库白名单，不公开打进种子包。
- 首装种子映射与full一致：config、home/.config/aasc-user、res/tasks，补齐latest和任务结果；已有文件优先，保护用户数据。
- trusted runtimeCatalog来自APK或签名code；aimodel主清单仅确认完整发布。固定LAN HTTP通过专用策略接入，WAN HTTPS；通用下载器安全源限制保留。
- status查询不下载/加载；按modelId/revision归并，取消通知等待者。ASR/TTS/LLM下载后用户重试原业务，不自动重放旧录音/播报/请求。
- 过渡min保留旧cohort指纹，新增运行兼容契约；旧APK资源先物化，新更新器允许空内置集合。不同旧指纹不能靠单字段全部自动迁移。

## spec 设计与模块拆分

伪代码在 `docs/spec/android-display-offline-apk.md` 与 `docs/spec/ai-model-sync.md` 的实施草案小节，明确标注尚未实现；现行实现小节保持历史事实。

| 模块 | 输入 → 输出 | 责任 |
|---|---|---|
| OfflineBootstrapManager（新增） | 原生确认 + 签名快照 → 可健康提交环境 | 首装事务、源快照、种子/HTTPS初始化、重试；不负责模型权重 |
| Offline运行检查/共享包工具（拆出） | assets/active-release/legacy根 → 环境完整性与包校验结果 | ABI/Node运行契约、入口/依赖/lock、受限ZIP、原子目录与提交 |
| Offline模型来源/准备协调器（新增） | modelId/revision + 可信目录 + 用户确认 → 已验缓存 | 本地优先、aimodel映射、专用LAN策略、归并/取消/进度 |
| 现有模型管理器 | 已验文件 → 原生ready/error | ASR/TTS/声纹/LLM加载自检、缓存与内存错误区分 |
| 目录生成与模型发布 | 可信声明 + 完整本地文件 → 小型目录/aimodel清单 | 两段TTS/三段LLM路径、全文件校验、定义与权重分离 |
| 过渡APK发行 | 旧构建真实指纹 + 新runtime契约 + APK → 签名清单 | 老更新器可读、新版独立运行、版本与签名检查 |

运行事务须持久记录快照摘要、阶段、候选/previous和本轮创建目录。已验下载缓存可复用，未提交候选不算ready；干净首装没有previous时不能套用“回滚到旧full”。健康失败回首装页，有旧环境时回滚。空间计算须含下载、解包和保留旧版本，用溢出检查和真实ZIP展开量复核。

## 受影响代码与具体实施方案（待确认）

Android路径前缀为 `src/apps/android-display/app/src/main/java/com/aasc/display/`。

| 文件 | 拟改动 |
|---|---|
| MainActivity.kt、res/layout/activity_main.xml、res/values/strings.xml | 用原生首装确认/进度/取消/重试替换“必须先安装full”的启动拦截 |
| NodeRuntimeInstaller.kt、NodeServerService.kt、NodeServerConfig.kt | 环境检查从模型检查分离；识别active-release；复用动态库安装与健康流程，补齐首装种子/HTTPS/native配置 |
| OfflineUpdateManifest.kt、OfflineUpdateManager.kt | 建模nodeMinSeeds和新运行契约；共享签名/下载/ZIP能力；空bundled支持；旧cohort迁移兼容 |
| 新增OfflineBootstrapManager.kt及共享安装检查模块 | 首装独立状态机和可恢复事务，避免扩大已有大型条件分支 |
| 新增Offline模型来源/准备协调模块 | 可信目录适配、固定LAN策略、归并/取消、staging安装；模块名称实施时按职责确定 |
| NativeBridge.kt、MnnLlmModelManager.kt、AsrModelManager.kt、TtsModelManager.kt、VoiceprintModelManager.kt | 明确实际本地来源；去除查询触发下载/加载；缺内置时回退已验缓存或按需下载；区分文件与引擎就绪 |
| RemoteModelManager.kt、ModelDownloader.kt | 仅在Offline来源适配范围注入下载策略，复用流式校验；在线模型API契约保留 |
| scripts/ops/apk-build-profile.js、prepare-android-node-runtime.js、build-apk.js | 小型定义独立于模型选择；min独立bootstrap资产清单；full无LLM运行文件、合法空集合 |
| release/apkbuild/allserver/app.json、allserver-min/app.json | full移除Qwen模型ID；按最终发布基线递增版本；min继续updateOnly及models=[] |
| scripts/ops/offline-update-package.js、offline-min-apk-package.js | 新首装运行契约/小型目录进签名包；legacy指纹显式从旧发布输入取得，禁止依赖新full空指纹 |
| scripts/models/ai-model-common.js、publish-ai-models.js、sync-ai-models.js、ai-model-catalog.json及新增目录生成器 | 本地与远端TTS/LLM白名单一致、完整集合预检、单源定义生成、仅完整模型标可下载 |
| scripts/ops/sync-offline-update.js、相关清单验证 | 显式-aimodel保持；接受新增合法路径；默认镜像不请求模型 |
| src/apps/server/modules/llm/llm-model-manifest-service.js、model-distribution相关模块与显示端准备交互 | 定义查询不依赖权重；Offline来源映射不请求本机缺失文件；原请求generation与model_not_ready契约 |
| tests/、Android对应单元测试、web self-test.js、docs/spec/self-test.md | 新增有行为意义的安装/失败/兼容测试；自测状态查询保持只读 |

实施分三批：A运行环境与空模型契约；B模型归档/来源/准备交互及full资源选择；C过渡发布、真机矩阵和性能验收。每批先修订对应spec再写代码，代码与实际受影响发布状态一起上传Git。原生/资产改动置minApk=true，服务/网页改动置servicePackage=true；生产依赖集合未变不因文档/元数据改动自动置dependenciesPackage。历史依赖包缺新首装契约时必须按既有命令生成新版本包，不能重写已发布文件；出包完成覆盖该阶段代码后才复位对应状态。

## 自测用例与兼容性测试

1. 干净min确认前无下载；确认后完整首装；缺种子/新运行契约、错lock/ABI/Node、坏签名/哈希/截断/越界ZIP、空间不足均拒绝，且无ready标记。
2. 候选版本只包含版本目录时环境检查通过；legacy根适配通过；删除真实关键文件时失败；合法空模型不阻断环境，模型字段缺失不能伪报模型ready。
3. 中断每个事务阶段后重启：无previous回可重试页、有previous回滚；完整已验组件可复用，用户配置/任务/results/latest及模型不丢失。
4. 证书对缺失或HTTPS握手失败不能ready；控制页资源和WebSocket初始化可用；环境健康检测不要求ASR/TTS/LLM加载。
5. 同model/revision并发请求只下载一次；取消、选择换代、断网换源、坏缓存与内存不足行为正确；查询/定时任务无下载，TTS旧消息不自动播报。
6. ASR/TTS缺内置目录时从可信aimodel文件准备；Qwen只在files/models有一份权重；LLM无权重时目录仍可查询，未发布4种模型不报可下载。
7. 旧full23/full38/min36/min37按指纹cohort覆盖升级；无Qwen新full→min；干净min→后续min；签名/包名/版本不符拒绝。不同cohort走明确手动路径，原APK独有资产保留条件单独记录。
8. LAN/WAN文件大小与SHA-256一致；非法HTTP主机/目录/重定向拒绝；已下载模型断网重启无请求；默认Offline镜像无模型流量，-aimodel显式扩展兼容。
9. APK产物检查：full无LLM目录运行文件，min无服务代码/依赖/模型权重，bootstrap资产小且完整。使用独立空白测试设备/环境，不卸载当前业务设备构造首装。

## 性能测试

环境下载、校验、解包、HTTPS/页面/WebSocket健康分别计时；模型下载、校验、首次加载/预热分别计时。记录首次峰值空间、RSS与第二次无网启动耗时。本期性能验收：第二次启动不重复下载/拷贝大型权重；同模型并发网络次数=1；所有大型文件流式处理；下载/校验不阻塞界面线程。首装健康窗口沿用现有120秒，从进程启动计时，不把大文件下载计入健康超时。

## 风险评估与待验证项

| 风险/待验证证据 | 处理与实施门槛 |
|---|---|
| 旧full23已清理，尚无全部cohort真实指纹核验 | 使用保留构建元数据/设备只读元数据核验；缺证据不得宣布该版本自动兼容 |
| 当前生产依赖只有version/lock，不能证明新首装Android可运行 | 新增签名运行契约与Android模块导入/健康测试；新首装包发布前验收 |
| min新增HTTPS材料尚未检查出包机输入可用性 | 沿用既有证书输入，独立资产校验；缺材料拒绝出包，不自动降HTTP |
| TTS/LLM归档及真实公网下载尚未执行 | 发布前核验全部必要文件、WAN读取、LAN镜像；定义存在不等于发布成功 |
| 下载失败/内存不足影响原生能力 | 服务与模型就绪分开，已验文件保留；不重复下载服务或破坏旧环境 |

上述证据在实施/设备验收阶段取得；无额外产品范围疑问。用户确认代码方案后才能修改源码，规则来自 `AGENTS.md` 注意事项1。预计源码与自测2–4个工作日，出包机、模型上传和多设备兼容验收时间另计；本轮设计整理已完成。

## 本轮验证记录

- `npm run test:ai-models`：30/30通过、无跳过，仅覆盖现行五分类，不代表新分类已实现。
- 无对应聚焦npm script，运行 `node --test tests/apk-build-profile.test.js tests/offline-apk-build-profile.test.js tests/offline-min-apk-package.test.js tests/offline-update-signing.test.js`：23项22通过1失败。`apk-build-profile.test.js:83`写死versionCode=31，但现有profile=37；另有旧versionName断言。该用例未改，后续实施时应以隔离fixture验证版本字段并用发布基线检查真实递增关系。
- 本轮未运行Android构建/模型下载、未测试新首装功能；没有修改自测源码，因为代码方案尚未确认。
- 定向 `git diff --check` 通过；5份主要design/spec/task的代码块闭合、相对链接与未实现状态检查通过。

## 需求等级评审（enterprise）

需求本身主L7（安装拓扑与分发迁移），次L6（运行/模型输入输出契约）、L5（确认/取消状态流），混层，必须下放至L4。沿用原评审证据：L7四条强证据权重12，L6一条强证据3，L5一条中证据2；跨两层系数0.75，置信度=12/17×0.75=0.53，故评审结论仍为“需补充”，直接开发风险中。评分：层级清晰24/25、证据充分20/20、实现完备16/20、风险暴露19/20、L4可落地14/15，共93/100；设计完备度不替代真实设备证据。

需补充项已分三类列入上表：输入输出契约缺运行依赖实测，建议新增签名要求与导入测试，否则可能下载成功但Node启动失败；依赖约束缺历史cohort/证书证据，建议只读核验，否则老包拒绝迁移或HTTPS不可用；验收观测缺真实首装/公网下载，建议按自测矩阵与分阶段计时取得证据，否则可能把旧同步测试误判成新功能可用。L4已有声明/新增定义/操作流程已分别写入两份spec草案，当前建议实施能力等级L4，模块契约仍受L6约束。

本轮仅继续设计，未自动调用其他技能。需求分析技能的后续选项为：1）ai-code-translation进入翻译；2）project-pseudocode-sync仅同步伪代码；3）保留设计，暂不调用。技能选择不代替AGENTS规定的源码方案确认。
