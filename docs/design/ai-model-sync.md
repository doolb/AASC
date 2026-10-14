# AI模型外网发布与双向同步

## ASR/声纹仅合并下载入口（2026-10-14，已实现并发布min55）

用户选择原生下载入口合为“ASR/声纹”，继续保留sensevoice/voiceprint的发布目录和各模型可信文件定义，不改变主清单分类或旧APK路径。首次min原生默认提示TTS和ASR/声纹，确认后按组准备缺少的模型。当前45项TTS/ASR等文件已在LAN/WAN发布并逐项HTTP校验；无需为入口分组重新归档模型。详见Android设计和对应任务。


## TTS / LLM 归档与原生来源实现（2026-10-14，源码完成、待发布）

`ai-model-common`、远端Python事务及镜像共用规则已扩展至tts/llm；TTS严格要求全部14个声明文件，LLM目录存在但缺文件/摘要不符时阻止发布，完全缺失目录只保留定义。根清单仍是files/path结构，LLM三段路径按安全目录与必要文件名白名单校验，不收集测试音频、脚本或推理缓存marker。

新增源码小型`offline-model-catalog.json`与`llm-model-definitions.json`，共8种定义（ASR/TTS/声纹及5种LLM）；构建读取同一可信目录，APK无权重也能提供模型列表，服务代码无res/models/llm仍能枚举定义且ready=false。当前可验证的Qwen必要文件仍为9项544,130,168 bytes；其余4种LLM没有本机权重，不表示已发布或可下载。

APK来源适配以固定可信文件定义校验aimodel主清单，所有必要项大小/摘要一致才开始传输。LAN HTTP仅限192.168.1.39与10.221.70.87的/mnt/aimodel/路径，WAN使用https://c.aasc.us/mnt/aimodel/；凭证、查询参数、重定向、越界文件名均拒绝。在线通用下载器的HTTPS/回环规则保持；Offline默认镜像不开-aimodel时仍不请求模型。

本轮36项模型测试通过，包含真实本地Python事务、HTTP夹具、完整集合与路径拒绝、自测只读和无权重定义查询。后续已完成TTS15项增量发布、45项LAN/WAN全内容验收与min54/55语音模型下载；Qwen实物及其他LLM尚未发布，不能将其定义列表视为可下载集合。详见[任务](../task/20261014_OfflineMin独立首装与LLM外置实现.md)；下文“待实施”是2026-10-13历史方案。

## TTS / LLM 发布及 APK 来源契约（2026-10-13，设计完成、待实施）

延续下节评审，主清单仍为 schemaVersion=1 的 files/path/size/sha256/totalBytes，不把 APK 的 models 结构混入镜像协议。新增 tts 与 llm 分类时，本地共享规则、远端 Python 事务、同步器、Offline `-aimodel` 路径验证与选组参数同步更新；原五组保持既有行为。先部署兼容客户端再扩展清单，不允许旧同步器忽略未知项后提交不完整清单。未知外部客户端继续使用发布前旧镜像或升级同步器；本期不另建版本化公开入口。

| 分类 | 允许文件 | 收集依据 |
|---|---|---|
| tts | `tts/manifest.json` 及清单中的14个必要文件，已有 README/LICENSE 可按白名单保留 | 读取声明逐项校验；缺少任意必要文件或哈希不匹配则该完整模型不可发布 |
| llm | `llm/manifest.json` 及 `llm/<directory>/<declaredFile>` | modelId/directory 安全且唯一，文件名为单段白名单，逐项大小/SHA-256校验 |

LLM 只发布实际本地完整模型的声明运行文件；本机 Qwen 目前9项、544,130,168 bytes，约518.92 MiB，其余4种只有定义。定义列表可以保留5种，但 aimodel 下载可用列表只能包含全部必要项已发布的模型。完全缺失的目录记为未发布并跳过；目录存在但不完整或哈希不符，发布预检失败，不能用它覆盖当前完整发布。未知文件、测试音频、缓存 marker、推理日志、脚本与符号链接不收集；不再上传 `.manifest.json` 推理缓存标记。

新增模型目录生成器，从可信声明生成统一运行定义 `{modelId, revision, files[{name,path,size,sha256}], totalBytes}`。TTS 声明不含大小，生成器从已核验的发布目录计算大小；不能在 APK 端写死75MB。ASR/声纹从既有目录定义生成。目录作为小型资产进入 APK，并作为生成文件进入 code ZIP 的 src 模块目录；两处使用同一生成规则。上传/下载后的 aimodel 文件清单须与该定义匹配。LLM 小型定义独立打包，不要求本机有该模型权重；已发布可用列表仍以真实文件核验为准。

原生 Offline 来源适配器将统一定义与 aimodel 主清单映射为现有管理器的文件列表，不新增独立配置 HTTP 接口，不把 `/api/llm/model/...` 指向本机不存在的权重。已有在线模型 API 保持职责；可配置运行选项继续经过 AASC/WebSocket 权威配置。LAN 固定源仅通过 Offline 专用策略启用 HTTP，使用 APK/签名 code 中的可信摘要校验；WAN 使用 HTTPS，所有跳转拒绝。同一模型 revision 失败换源时只能继续相同文件指纹，不能接受不同清单内容。

模型归档先验证本地及远端路径规则 → 完整性预检 → 版本/暂存文件上传与校验 → 主清单原子切换 → WAN HTTP 大小/SHA-256验收；镜像同样在全部选中项完整后提交主清单。现有 `sync:offline-update` 不带 `-aimodel` 时仍不请求模型。APK 端按需下载不要求先镜像全部模型；源不可用不影响已有本地缓存离线加载。

该协议尚未实现或发布，实施与验证矩阵见 [任务](../task/20261013_OfflineMin独立安装与LLM外置实施设计.md)。

## TTS 与 LLM 扩展评审（2026-10-13，待实施）

用户追加TTS和LLM模型上传到同一外网aimodel目录。本机TTS当前15项、77,727,859字节；LLM目录12项、544,140,129字节，其中实际完整模型仅为Qwen3.5 0.8B Claude Opus distilled，9个声明运行文件共544,130,168字节。LLM定义清单还有其他4种模型，但本机没有它们的文件。按全部上述源文件估算，现有30项加TTS/LLM共约1.665GB；最终发布项由必要文件白名单与完整性检查确定，不能硬编码此数量。

当前本地共享规则和远端Python校验均不支持tts/llm，且只允许两段路径。需增加TTS声明文件规则、LLM模型ID与三段路径规则，并同步上传、下载、Offline镜像和远端事务校验。测试音频、代码、推理缓存和未知子目录不因递归扫描而进入清单。LLM定义清单与已发布文件清单共同决定某模型是否可下载，只有定义不能标记可用。

aimodel主清单的files/path结构与APK现有models/id/files/name结构不同，需要明确适配层与下载路径映射。原生LLM下载器目前只允许HTTPS或回环HTTP，直接换成LAN的Apache HTTP路径不可行；LAN适配应单独定义，不全局放宽现有下载器。下载后的模型由APK单独持有，避免Qwen同时存入Node服务和显示端缓存。

新增分类会使旧版固定白名单同步器拒绝整个manifest，发布前必须先部署新版同步器或明确版本化清单入口。既有`sync:offline-update`默认不请求模型，`-aimodel`显式开启的规则继续保留。本轮现有模型同步自测30/30通过，TTS/LLM上传、HTTP验收和APK按需下载尚未执行。详见 `../task/20261013_OfflineMin独立安装与模型外置设计评审.md`。

## 需求与当前状态

2026-10-12用户要求上传YOLO、ASR和声纹模型至`https://c.aasc.us/mnt/aimodel/`，并明确选择全部本地模型、同时支持上传和下载。当前范围以`res/models`内五组目录为准：`yolo11`、`sensevoice`、`streaming-zipformer`、`voiceprint`、`speech-enhancement`；包含全部现有ONNX、现有YOLO分割PT、词表、类别JSON、已有校验文件及README/LICENSE，不包含WAV、代码、训练缓存、日志或其他模型目录。

已核对30个文件，共1,042,798,505字节。YOLO包含n/s/m/l/x五种部署ONNX及分类标签、现有n-seg PT；ASR包含SenseVoice和Zipformer；声纹包含base/large/V2的FP32及INT8、Pyannote；降噪包含GTCRN。只提交脚本/清单/文档，不新增模型二进制Git提交。

外网SSH沿用`as@120.79.245.103`，发布物理目录`/home/as/a/aimodel`；首次检查该目录不存在、HTTPS返回404，现已创建并发布，目录入口HTTP200。发布后必须从指定HTTPS地址实际校验清单和文件，不能把SSH上传成功当作HTTP可用。

## 已完成的改动

- 新增`scripts/models/ai-model-common.js`：五组目录与文件规则、路径验证、流式SHA-256、稳定清单、临时文件和共享CLI选项。
- 新增`scripts/models/publish-ai-models.js`：扫描本地模型，生成清单，核对远端已有文件，只上传新增/变化内容，校验后逐文件原子替换，最后切换清单；通过SSH显式`/bin/sh -c`执行，不删除远端额外文件。
- 新增`scripts/models/sync-ai-models.js`：从HTTPS清单下载回`res/models`对应分类，可选择分类；大小/SHA-256匹配即复用，下载至临时文件并完整校验后替换，失败保留原文件。
- `scripts/models/ai-model-catalog.json`记录已发布的30项路径/大小/哈希快照。`package.json`提供`publish:ai-models`、`sync:ai-models`和定向自测命令；新增`tests/ai-model-sync.test.js`与`tests/ai-model-publish.test.js`，补充usage、design/spec索引、self-test、task、todo和changelog。
- 上传端持有SSH权限；下载端仅需要HTTPS。不新增运行时HTTP配置接口或改变Android下载API。第一次执行上传后校验全部HTTPS文件，下载先对本地已有文件验证复用，再使用有界临时样例验证真实传输。

## 数据与异常规则

清单包含版本、分类、每项相对路径/大小/SHA-256和总量，按路径排序，避免时间戳造成无意义上传。清单只允许五组内预期格式的普通文件，拒绝路径越界、符号链接和重复路径。远端临时传输目录不作为已发布版本；大小/哈希不一致不得替换正式清单。上传/下载只处理选中清单项，保留额外文件，无`--delete`。

大文件使用流式读写与有界并发，不把约1GB模型整体读入内存。选定文件必须检查本地大小/修改状态避免扫描与传输过程中源文件变化；失败清理本次临时文件，报告可重试项。HTTP中断、错误状态、长度越界或哈希失败不会留下半个正式模型。

## 需求等级分析（enterprise）

结论为可开发，主等级L6（模型同步模块），次等级L5（增量传输/校验/替换流程）；置信度0.90，直接实现风险中，建议下放为L4数据流。证据：指定aimodel目录提供外网输出契约；“全部模型”定义文件范围；“支持上传和下载”定义两个独立入口。评分：层级清晰24/25、证据19/20、实现完备18/20、风险暴露18/20、L4落地14/15，总分93/100。

L4拆解为模型规则→本地清单→远端/本地比较→变化项传输→大小与哈希校验→正式文件原子替换→清单发布/同步报告。关键风险为误选测试数据、半文件覆盖、远端shell引用和HTTP映射；对应措施为固定规则、临时文件与原子替换、显式shell/参数验证、上传后HTTPS逐项校验。用户先确认全部范围，再回复“上传”确认实施；脚本、自测与外网发布已完成。

## 已核对的完整文件清单

大小按十进制MB计算；18个模型文件加12个配套文件，共1,042,798,505字节（1.043 GB，约0.971 GiB）。大体积主要来自五种YOLO部署尺寸和声纹三型号的FP32/INT8版本。

| 相对res/models路径 | 字节 | MB |
|---|---:|---:|
| sensevoice/LICENSE | 71 | 0.00 |
| sensevoice/README.md | 104 | 0.00 |
| sensevoice/model.int8.onnx | 239233841 | 239.23 |
| sensevoice/model.int8.onnx.sha256 | 65 | 0.00 |
| sensevoice/tokens.txt | 315894 | 0.32 |
| sensevoice/tokens.txt.sha256 | 65 | 0.00 |
| speech-enhancement/gtcrn_simple.onnx | 535638 | 0.54 |
| streaming-zipformer/decoder.int8.onnx | 3486740 | 3.49 |
| streaming-zipformer/encoder.int8.onnx | 42980793 | 42.98 |
| streaming-zipformer/joiner.int8.onnx | 3228485 | 3.23 |
| streaming-zipformer/tokens.txt | 56317 | 0.06 |
| voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx | 39593761 | 39.59 |
| voiceprint/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k_int8.onnx | 10507249 | 10.51 |
| voiceprint/3dspeaker_speech_eres2net_large_sv_zh-cn_3dspeaker_16k.onnx | 116058710 | 116.06 |
| voiceprint/3dspeaker_speech_eres2net_large_sv_zh-cn_3dspeaker_16k_int8.onnx | 29798398 | 29.80 |
| voiceprint/3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx | 71441526 | 71.44 |
| voiceprint/3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common_int8.onnx | 18563540 | 18.56 |
| voiceprint/pyannote_segmentation_3_0_int8.onnx | 1540506 | 1.54 |
| yolo11/README.md | 527 | 0.00 |
| yolo11/yolo11l.classes.json | 938 | 0.00 |
| yolo11/yolo11l.onnx | 101744167 | 101.74 |
| yolo11/yolo11m.classes.json | 938 | 0.00 |
| yolo11/yolo11m.onnx | 80673677 | 80.67 |
| yolo11/yolo11n-seg.pt | 6182636 | 6.18 |
| yolo11/yolo11n.classes.json | 938 | 0.00 |
| yolo11/yolo11n.onnx | 10741399 | 10.74 |
| yolo11/yolo11s.classes.json | 938 | 0.00 |
| yolo11/yolo11s.onnx | 38051785 | 38.05 |
| yolo11/yolo11x.classes.json | 938 | 0.00 |
| yolo11/yolo11x.onnx | 228057921 | 228.06 |

## 2026-10-12 实现与发布验证

Offline可选镜像已实现：`sync:offline-update`默认不请求模型；使用`-aimodel`或`--aimodel`后，将同级全部模型和`manifest.json`镜像到本地静态`aimodel/`目录。父目录源和直接`aasc-offline/`源均映射到服务资源旁的同级目录；watch复用相同开关，逐轮串行。模型校验/下载失败时保留旧根清单；内容一致时复用模型和清单。独立`sync:ai-models`仍默认同步到项目`res/models`且不写根清单。详细行为见Offline design/spec及任务`docs/task/20261012_Offline同步增加aimodel开关.md`。

三个脚本与27项定向自测已完成，通过SHA-256流式处理、固定分类、SSH/rsync暂存、失败回滚和清单最后切换实施。首次上传30项1,042,798,505字节；重复发布复用30项无重传。服务器通过回环TCP与公开Host/SNI/CA验证读取同一HTTPS路径，完整校验30项；本机外网清单与目录HTTP200、13项小文件完整校验通过。客户端全分类同步复用30项，空目录GTCRN真实下载后再次复用。外网大文件全量客户端校验因下行较慢主动终止，改为上述回环全量与外网样例验证，不将回环校验记成跨WAN全文件传输。清单快照SHA-256为5e8d4daae59aa6fb9bbef3b58ec75c72737f832eabbd3b2e117f3846cb1356f8。

用户确认正式包只使用部分模型：当前普通APK按需取得默认YOLO11n和base FP32/Pyannote，正式代码包不带模型；实际已发布完整Offline v23与当前allserver profile，在本次范围内仅内置SenseVoice/base FP32/Pyannote三个ONNX。此次服务器资源归档不扩展运行时加载或APK白名单。其他文件需主动选择或实验使用，模型格式/精度的实际推理能力沿用既有模块。
