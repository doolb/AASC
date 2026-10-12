# AI模型外网发布与双向同步

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
