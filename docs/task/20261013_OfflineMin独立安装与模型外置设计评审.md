# Offline min 独立安装与模型外置设计评审

## 任务与状态

2026-10-13用户要求“检查下当前设计”。本轮只审阅此前提出的方案与真实代码，记录候选修订和验收条件；源码实施、模型发布及APK构建未开始。后续仍需按AGENTS.md先说明代码改动文件和方案、等待确认。当前min profile为v36，full profile为v23，不新增APK产品或包名。

需求范围：现有min支持无full时下载服务环境；ASR/TTS/LLM可按需准备；TTS与本机LLM加入aimodel；full不打入Qwen；已有full/min数据与更新能力可继续使用。模型归档仅覆盖实际本地完整文件，不能把LLM清单中缺失的四种模型也当成已上传。

## 结论及证据

方向可行，现方案需补充后才能实施，直接开发风险高。最关键的修订是将运行环境完整性、内置LLM资产、可下载模型定义、原生模型就绪和APK升级兼容分开。

| 项目 | 当前证据 | 影响及修订 |
|---|---|---|
| min原生运行库已在包内 | `scripts/ops/prepare-android-node-runtime.js:711`的update-only构建复制Node可执行库和allowlist动态库 | 前一版“下载完整Node运行环境”范围过大；复用APK原生库，下载服务代码/生产依赖/初始化数据 |
| 首装入口被拦截 | `MainActivity.kt:400`检查hasFullOfflineInstall；`NodeRuntimeInstaller.kt:196`要求完整Offline安装 | 仅修改界面提示无效；需独立的原生bootstrap流程和模型无关的环境就绪检查 |
| 无Qwen产生合法空LLM元数据 | `prepare-android-node-runtime.js:239`只从display-models生成models；`:946`写入offline-model-manifest；`NodeRuntimeInstaller.kt:209`拒绝空models | full保留ASR/TTS/声纹并不使此models非空。首次复制可能完成，但之后快速复用、full识别、min升级会被拒绝；须支持合法空LLM集合并保留损坏检测 |
| 默认Qwen与内置绑定 | `NativeBridge.kt:286`在offlineMode固定注入bundledModelId；`MnnLlmModelManager.kt:111`查询状态即排队默认模型 | 移除资产后仍走bundled物化并失败。应按实际资产/旧缓存选择来源，缺失时提示下载；状态查询不得自动下载 |
| 定义目录随模型一起消失 | `apk-build-profile.js`的resolveSelectedModelFiles移除Qwen后没有llm/manifest.json | LLM列表和默认选择所需小型定义应独立于权重打包，不得依赖服务器持有Qwen权重 |
| 老更新器先阻止新APK | `OfflineUpdateManager.kt:986`完整安装前提，`:1001`严格比较指纹，`:1028`为所有bundled LLM预物化；`offline-min-apk-package.js:125`从full写入指纹 | 新full空集合指纹不能直接替换legacy字段。需过渡清单保留旧字段，新版本解耦服务/ABI兼容与模型集合；已验证旧缓存应复用 |
| 代码与依赖不足以首装 | code ZIP只包含src和package文件；签名清单另含nodeMinSeeds，但Android OfflineUpdateManifest没有对应字段 | 必须解析并恢复config/userconfig/task/results/latest，补齐本机HTTPS、native模式和offline-update-client初始化，建立active-release并验证服务健康 |
| 上传归档不等于APK下载支持 | ai-model-common和发布器Python仅接受五组两段路径；APK清单是models/id/files/name，aimodel是files/path；RemoteModelManager拒绝LAN HTTP | 本地/远端规则、语义清单映射、LAN/WAN来源适配和APK模型管理器要一起修改。ASR/TTS当前offline目录存在参数就只校验内置资源，不回退远端 |
| 旧同步工具不接受新分类 | ai-model-common.validateManifest遇到tts/llm会拒绝整个根清单 | 扩展主清单前更新同步器或引入明确的版本化入口；默认未开启-aimodel的Offline同步不新增模型请求 |

代码路径中的Android文件均位于`src/apps/android-display/app/src/main/java/com/aasc/display/`。现有full的PMX/VMD/纹理仍是既有服务代理按需资源，不纳入本次推理模型归档。

## 候选design与spec设计

1. 沿用allserver-min产品和update-only原生资产契约，在应用启动层增加首装初始化能力。首装下载界面在Android原生层，不依赖尚未启动的本地服务。
2. 读取同一已验签发布快照，选择匹配的code、dependencies、nodeMinSeeds；校验lock指纹和ABI。利用APK原生库和最小HTTPS/模式元数据完成staging，再初始化版本化active-release，健康检查通过才确认。
3. 环境就绪与每种模型就绪独立。现有有效内置/已下载文件优先复用；缺少某模型只提示对应模型，不阻止控制页和服务更新。
4. 将LLM默认模型ID/定义和实际内置资产分开。完整APK不带Qwen权重，小型定义保留；旧full物化缓存继续可用，下载模型由APK持有，服务不复制一份权重。
5. aimodel增加tts与llm严格路径规则，主清单仅记录已发布文件；模型可下载状态要求声明文件全部存在。上传后按实际HTTP大小/哈希验收。
6. 首个过渡min清单兼容旧更新器读取的字段；新的服务/ABI兼容契约不再要求非空bundled模型集合。避免只有新APK代码支持迁移，而老APK在获得新代码之前就拒绝升级。
7. 不修改现有-aimodel默认关闭的镜像规则；同步器/公开清单的迁移顺序必须明确。LAN模型HTTP与LLM现有安全源限制的适配方式需写入实施设计。

伪代码已记录到`docs/spec/android-display-offline-apk.md`与`docs/spec/ai-model-sync.md`的明确“尚未实现”小节。设计记录在对应design中，现行行为描述仍保留原样。

## 预计受影响模块与文件

- 原生入口/安装/更新：MainActivity、NodeRuntimeInstaller、NodeServerService、OfflineUpdateManifest、OfflineUpdateManager；宜拆出独立OfflineBootstrapManager，避免继续扩展大型条件分支。
- 模型来源与缓存：NativeBridge、MnnLlmModelManager、AsrModelManager、TtsModelManager，必要时统一模型来源适配；声纹缺失路径也应兼容，无需扩大默认模型集合。
- 构建与发行元数据：release/apkbuild/allserver/app.json、现有min profile、apk-build-profile、prepare-android-node-runtime、offline-min-apk-package及相关签名清单验证。
- 模型归档：ai-model-common、publish-ai-models、sync-ai-models、ai-model-catalog、Offline镜像规则验证；本地规则和远端Python规则必须一致。
- LLM目录与状态：llm-model-manifest-service及既有模型查询链路；保持业务查询职责，不另建远端配置HTTP接口。
- 文档：design/spec/task/todo/changelog/self-test；源码实施后仅标记实际受影响的Offline发布状态。

## 需补充项

| 类别 | 缺失原因 | 补充建议 | 不补充风险 |
|---|---|---|---|
| 输入输出契约 | 环境包组成、nodeMinSeeds解析、本机HTTPS资源和native模型目录没有完整首装契约 | 约定签名快照、版本/lock/ABI、种子映射和模型定义适配；环境完整与模型完整分开 | 服务能下载但启动不了，或本地模型接口循环下载本机缺失文件 |
| 业务规则 | 首次触发时提示、下载完成后的原业务恢复、取消及重复触发未写明 | 原生环境确认；模型单独确认且相同ID归并；明确旧TTS/ASR请求是否恢复及何时清理 | 用户未确认即下载，下载后播放过时内容，多路下载覆盖缓存 |
| 异常与边界 | 首装中断/空间不足/健康失败及源切换未定义完整事务 | staging、可重试状态、有限重试、签名快照一致、空间预算；旧有效目录与用户配置保留 | 半安装、错误就绪、跨源混合文件、更新覆盖配置 |
| 依赖与约束 | 旧更新器绑定旧模型指纹，LAN HTTP不被现LLM下载器接受 | 先设计过渡发布，再实现来源适配；先更新同步器再扩展清单 | 旧设备无法升级，新目录有文件但APK无法使用 |
| 验收与观测 | 尚无无full首装及空bundled集合实测 | 按下表覆盖干净安装、旧包升级、断网重启和模型缓存；记录下载/校验/启动/首次加载耗时 | 现有同步测试通过被误认为新功能已经可用 |

## 自测、兼容与性能验收

- 本轮已跑`npm run test:ai-models`，30/30通过，无跳过；仅证明当前五组同步行为。
- 只读探测：TTS与LLM目标路径均被当前allowedPath拒绝；去掉Qwen后的resolveSelectedModelFiles返回29项、无任何llm文件。没有生成APK或修改模型文件。
- 待实现自测：合法空bundled集合、损坏元数据、首装版本化release、种子latest恢复、lock/ABI不匹配、坏哈希/截断/空间不足、取消和并发下载归并、LAN/WAN一致性、外网Qwen真实下载、缓存无网加载。
- 兼容矩阵：旧full v23→过渡min；当前min v36→新版min；新full无Qwen→min；干净min首装→后续min；更新后配置/task/results和旧Qwen缓存保留。
- 真实干净安装使用独立测试环境，不通过卸载当前设备现有Offline安装来构造测试。已安装设备的覆盖升级另测。
- 性能记录：环境下载/校验/解包/Node健康就绪分别计时；Qwen首次下载/校验/加载分别计时；第二次无网启动不重复下载、不重复拷贝大型权重。采用流式处理，磁盘预算包含临时包、解包目录与保留旧版本。

## 需求等级评审（enterprise）

主L7（首装服务拓扑/分发与升级迁移），次L6（模型归档/来源契约）、L5（确认/下载/安装状态流）。四条L7强证据为沿用min新增首装能力、环境与模型分开、本机服务启动前的初始化、旧更新器前置兼容；L6强证据为aimodel扩展，L5中证据为首次触发提示。证据权重12/17，跨两层一致性0.75，算法置信度0.53。评分：层级清晰24/25、证据20/20、实现完备9/20、风险暴露18/20、L4可落地10/15，总分81/100；结论需补充、直接开发风险高、必须下放至L4。拆解为签名快照→来源选择→staging校验→种子/HTTPS初始化→健康确认，以及模型定义→文件选择→确认→下载校验→原生状态。

本轮完成设计评审，未自动调用后续技能。预计实现、自测及迁移验证2–4个工作日，真实设备和外网传输时间另计；具体时长取决于首装包契约和迁移路径确认。

需求分析技能规定的后续动作选择（不代表源码实施已确认）：

1. 调用ai-code-translation，基于当前L4草案进入翻译流程。
2. 调用project-pseudocode-sync，基于判级结果同步项目伪代码。
3. 仅保留本次判级结果，暂不执行后续步骤。
