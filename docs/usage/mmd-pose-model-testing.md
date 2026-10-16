# MMD 图片姿态：不同模型的测试方法

记录日期：2026-10-16。本说明记录本项目实际使用的 MediaPipe、RTMPose-m、DWPose、传统 OpenPose 四模型对照方法，以及默认模型接入/恢复的集成测试。观察结果见[四模型试验记录](../task/20261016_MMDAR四模型姿态效果对照.md)，当前应用流程见[Human 使用说明](mmd-human-interface.md)。

## 测试分为三层

| 层次 | 检查对象 | 不能据此声称的结论 |
|---|---|---|
| 模型推理 | 原图 → 预处理 → 原始输出 → 还原到原图的二维点 | 已正确驱动三维骨架 |
| 四模型对照页 | 相同图片、人物范围和身体语义下，比较髋膝踝、肩肘腕及缺点 | 模型整体准确率、真实深度或公平速度排名 |
| 当前全身 IK 集成 | 粘贴/文件 → MediaPipe检测/33点估计world → 当前角色骨长重定向 → VaM实际骨骼 → 相机匹配 | 所有遮挡姿态均已还原、手机性能已验收 |

2026-10-16用户最终选择**恢复最早的MediaPipe Pose**；默认Worker与新构建清单为人物检测＋Pose两个ONNX，RTMPose兼容代码和历史临时报告仍保留。下文RTMPose/深度/刚体对照的“当前”指该次试验时间点，不表示本次恢复后仍为默认。OpenPose在对照中使用Python CPU，未移植浏览器ONNX。

## 固定样本、环境与权重

样本依次为真人侧身坐姿（236×314）、二次元跪坐（450×407）、交叉腿人体示意图（236×314）。复测时记录本机图片路径、文件 SHA-256、解码后尺寸，使用原图；去文字、裁剪或改图必须作为单独变体，不能覆盖基线。用户图片与截图不提交 Git。

MediaPipe、RTMPose、DWPose、YOLOX 使用 Edge / ONNX Runtime Web 1.26.0，`executionProviders=['wasm']`、`wasm.numThreads=1`，配套 JS/WASM 同源加载。OpenPose 使用本机临时 Python 环境，PyTorch 2.6.0+cpu / 4 线程、NumPy 2.2.6、SciPy 1.15.3、opencv-python-headless 5.0.0.93。这些是本次环境记录，不要求其他测试直接升级到这些版本。

| 权重 | 字节数 | 本机固定 SHA-256 |
|---|---:|---|
| person_detection_mediapipe_2023mar.onnx | 11990159 | `47fd5599d6fa17608f03e0eb0ae230baa6e597d7e8a2c8199fe00abea55a701f` |
| pose_estimation_mediapipe_2023mar.onnx | 5557238 | `9d89c599319a18fb7d2e28451a883476164543182bafca5f09eb2cf767ed2f3f` |
| RTMPose-m Body7 m384 的 end2end.onnx | 54850856 | `a4c4f6fd983c0be353042a7a6b3845b0894ada22b8c02964373554afcdcd6e8e` |
| dw-ll_ucoco_384.onnx | 134399116 | `724f4ff2439ed61afb86fb8a1951ec39c6220682803b4a8bd4f598cd913b1843` |
| yolox_l.onnx | 216746733 | `7860ae79de6c89a3c1eb72ae9a2756c0ccfbe04b7791bb5880afabd97855a411` |
| body_pose_model.pth | 209267595 | `25a948c16078b0f08e236bda51a385d855ef4c153598947c28c0d47ed94bb746` |

这些摘要用于固定本次测试输入，不冒充作者公开摘要清单。下载地址和许可分别见 [RTMPose 固定归档/模型说明](../../3rd/mmd-ar-test/pose-onnx-NOTICES.md)、[OpenCV Zoo 固定版本](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models)、[DWPose ONNX 参考实现](https://github.com/IDEA-Research/DWPose/tree/onnx/ControlNet-v1-1-nightly/annotator/dwpose)、[DWPose 权重](https://huggingface.co/yzd-v/DWPose)、[ControlNet OpenPose 身体实现](https://github.com/lllyasviel/ControlNet/tree/main/annotator/openpose)与[权重](https://huggingface.co/lllyasviel/Annotators)。不使用 SD 生成用的 `control_v11p_sd15_openpose` 来检测图片关键点。

## 各模型的预处理与解码

### MediaPipe：检测、候选排序、33 点

历史默认实现基线为 `fa03c46b`（RTMPose 接入提交为 `b2b6ec85`）。预后处理兼容函数仍在 `3rd/mmd-ar-test/web-human-pose-core.mjs`：

1. `prepareDetector` 等比缩放到 224 方形、居中补边、RGB 转 NCHW，像素 `/127.5-1`，检测补边张量填 0。
2. 检测输出 `Identity:0` 为 2254×12、`Identity_1:0` 为 2254 分数；sigmoid 后阈值 .35，IoU .3 去重，最多 3 候选。
3. 用检测给出的髋中心和全身方向点建立旋转 ROI；检测头部附近的 box **不是全身裁剪框**。`preparePose` 生成 256×256 RGB/NHWC，像素 `/255`。
4. Pose 输出 `Identity` 39×5、`Identity_1` 总分、`Identity_4` 39×3 world；总分至少 .5，再用 `decodePose` 逆旋转回原图，取前 33 人体点。
5. `rankPoseCandidates` 优先肩髋完整，其次身体 12 点质量；不要直接选检测最高分，二次元图的小猪曾形成误检。身体点使用 visibility/presence 的较小值，显示门槛 .5。
6. 热图变体保持同一个候选，仅对 `Identity_3` 的 64×64×39 热图做局部 7×7 sigmoid 加权质心，峰值至少 .5 才更新二维 xy。单独标为变体，保留原 world/分数，不宣称能修好腿部深度。

**旧脚本限制：** `tmp/mmd-pose/probe-current-pose.cjs` 先调用当前 Worker，再核对 MediaPipe 的 detection；当前 Worker 已切换 RTMPose，该脚本不能直接在新构建上重跑为“MediaPipe”。要复现历史结果，应在独立本机测试夹具中直接调用上述兼容函数和两个旧权重，或使用已经保留的历史 JSON；不要切换/覆盖当前工作区源码，也不要把现版本 Worker 输出标为 MediaPipe。当前构建不会自动分发旧权重。

### RTMPose-m：单人全图与相同人物框

固定模型是 Body7 `rtmpose-m_simcc-body7_pt-body7_420e-384x288-65e718c4_20230504`，实际输入 `[1,3,384,288]`，17 点。归档旧 pipeline 的 192×256 字段与模型不符，以实际输入和输出核查，不能盲用该字段。

- ROI 取整张图，或取 YOLOX 的同一个人物框；中心保持，扩到宽高比 288:384，主对照 padding=1.25，另测 1.0。
- RGB，mean `[123.675,116.28,103.53]`，std `[58.395,57.12,57.375]`，NCHW；双线性采样，出界黑边。生产实现逐邻点插值黑边，早期临时探针在边界外整点归零，复测应记录实现版本，边缘像素处可能有差别。
- `simcc_x=[1,17,576]`、`simcc_y=[1,17,768]`，每轴 argmax/2 得输入坐标，再逆仿射回原图。分数是两轴最大值的均值；不要套 DWPose 的 min。
- 17 点是二维；无 world、无手指，不按画面 x 大小交换人体左右。当前生产显示门槛 .3；其他不支持的 33 槽置 null。

17点包含鼻/双眼/双耳，但当前三维初始化未单独驱动头部；足部只有踝，没有脚跟/脚趾，也未生成足部旋转目标。复测应区分二维头部点、脚踝位置与尚未实现的头脚朝向，不能用前两者验收后者。

RTMPose作为默认时采用全图单人，未接入YOLOX多人检测。人物框版本是选型对照变体，不能混为相同配置；恢复MediaPipe后的默认入口使用其原人物检测器。

### DWPose：YOLOX + 133 点，色序单独核查

先运行 YOLOX-l：640×640、左上对齐等比缩放、右下填 114，BGR/NCHW、0～255，不除 255。输出 `[1,8400,85]`，按 stride 8/16/32 解码；person 分数为 objectness×person class，阈值 .3，NMS IoU .45，再还原原图框。

对 `dw-ll_ucoco_384.onnx` 使用与 RTMPose **相同的全图或 YOLOX 框和 padding**，输入尺寸、均值/方差同上；本次主变体按参考流程使用 BGR，另加 RGB 变体排查色序。输出为 `[1,133,576]` / `[1,133,768]`，argmax/2 后逆仿射；分数取两轴最大值的 **min**。

只取前 17 个 COCO 身体点作共同比较，额外脸、手、脚点不画，不能拿 133 点数量证明身体更准。二次元样本 YOLOX 在 .3 下没有人物框，显式回退全图；对照页注明“回退全图”，不手工补框冒充检测成功。

### 传统 OpenPose：整图多阶段网络与 PAF

使用 ControlNet 参考 `body.py/model.py/util.py` 与 `body_pose_model.pth`，`cv2.imread` 的 BGR 图，保持官方身体网络和 PAF 连接算法。临时副本只移除未用绘图依赖并使用 `torch.load(..., map_location='cpu', weights_only=True)`；`torch.set_num_threads(4)`。本机实际为 CPU；换机器若有 CUDA，需明确固定 CPU，不能静默改成 GPU 后混记结果。

- `boxsize=368`；参考默认 `scale_search=[.5]`，有效高度约 184；第二档只改为 `[1.0]`，高度约 368。两档各运行一次，**不是多尺度融合**。
- cv2 cubic 等比缩放，右/下 pad 到 stride 8，padValue=128；NCHW float，`/256-.5`。
- 原生 heatmap/PAF 上采样并去 padding，恢复原图。保持峰值阈值 .1、PAF 阈值 .05、10 点采样及原生子集过滤；少于 4 关节或平均分低于 .4 的子集删除。
- 保留全部人物子集，显示时按关节数、子集分数排序。缺失索引为 -1，转换成 null，不补关节或硬连腿。
- 统一到 COCO17 的索引依次为原 OpenPose `[0,15,14,17,16,5,2,6,3,7,4,11,8,12,9,13,10]`。

## 本机临时工具的使用记录

项目没有“四模型对照”专用 npm script。以下工具是本机 `tmp/mmd-pose/` 中已存在的临时试验文件，**未纳入 Git，新检出仓库不会自带这些脚本/权重/Python 环境**；应先检查存在，再按上面的契约重建夹具。它们不是新的生产测试接口。`build-model-comparison.cjs` / `build-dual-comparison.cjs` 含历史图片路径和文件名，要用新样本时先改本机副本的输入映射，不能只改一条环境变量就覆盖原三图记录。

以下 PowerShell 示例从项目根执行；`$poseSamplePath` 改为实际本机文件。不要把真实用户图片路径写入公共测试数据。

```powershell
npm run build:web:mmd-ar-test
# 等构建结束，再运行任何依赖 web-dist 的浏览器测试。
$poseSamplePath = 'C:/path/to/reference.png'
$env:POSE_PROBE_SAMPLE = $poseSamplePath
$env:POSE_PROBE_PREFIX = 'trial'
Get-FileHash -LiteralPath $poseSamplePath -Algorithm SHA256

# YOLOX人物框；查看 trial-yolox.json 中 selected，选择同一个人物给RTM和DW。
node tmp/mmd-pose/probe-yolox.cjs

# RTMPose全图；脚本同时输出 padding1.25 和1.0，JSON中[0]是1.25。
$env:POSE_COMPARE_MODEL = '3rd/mmd-ar-test/model-cache/pose-onnx/rtmpose-m-body7-384x288.onnx'
$env:POSE_COMPARE_LABEL = 'RTMPose-m'
$env:POSE_COMPARE_BGR = '0'
$env:POSE_COMPARE_PREFIX = 'trial-rtmpose'
Remove-Item Env:POSE_COMPARE_BBOX -ErrorAction SilentlyContinue
node tmp/mmd-pose/probe-rtmpose.cjs

# DWPose全图；同脚本，显式选择权重/色序/名称，名称也决定分数解码规则。
$env:POSE_COMPARE_MODEL = 'tmp/mmd-pose/dw-ll_ucoco_384.onnx'
$env:POSE_COMPARE_LABEL = 'DWPose'
$env:POSE_COMPARE_BGR = '1'
$env:POSE_COMPARE_PREFIX = 'trial-dwpose'
node tmp/mmd-pose/probe-rtmpose.cjs

# OpenPose两档；python须为可使用已准备临时依赖的解释器。
python tmp/mmd-pose/run-openpose.py
```

同框变体：把 `POSE_COMPARE_BBOX` 设置成检测输出中的原图像素 JSON 数组 `[x1,y1,x2,y2]`，分别用 RTM 与 DW 配置再跑一次，换独立输出前缀（例如 `trial-rtmpose-detected`）。无框时清空该变量并注明全图回退。RGB 排查仅把 DW 的 `POSE_COMPARE_BGR` 改 `0`、换输出前缀；跑完清除这些 `POSE_*` 环境变量，防止后续测试误用上次图片/色序/框。

## 对齐、展示与验收

统一画身体 12 点，按语义转换，不按点在图中从左到右重新命名：

| 语义 | MediaPipe | COCO17 / RTM / DW | OpenPose18 |
|---|---:|---:|---:|
| 左肩/右肩 | 11/12 | 5/6 | 5/2 |
| 左肘/右肘 | 13/14 | 7/8 | 6/3 |
| 左腕/右腕 | 15/16 | 9/10 | 7/4 |
| 左髋/右髋 | 23/24 | 11/12 | 11/8 |
| 左膝/右膝 | 25/26 | 13/14 | 12/9 |
| 左踝/右踝 | 27/28 | 15/16 | 13/10 |

全都先还原原图像素，再画相同连线与比例；左腿橙、右腿蓝。MP 点门槛 .5，RTM/DW 展示门槛 .3，OP 保留原生子集门槛；低分空心、缺失留空。分数只用于各自筛选，不能跨模型排准确率。

历史预览文件为 `tmp/mmd-pose/model-comparison/index.html`，原始数据在同目录 `results.json` / `datasets.json`；页面内嵌图与坐标，切换按钮不会重新推理。60934 是本次临时服务端口，不是项目固定端口。`?image=seated|anime|diagram` 可定位样本。

历史三图页面生成顺序为 `node tmp/mmd-pose/build-model-comparison.cjs` 再 `node tmp/mmd-pose/build-dual-comparison.cjs`，前者需要真人各变体，后者还需要 anime4/diagram4 各原始 JSON；输入不齐不能生成。生成会覆盖本机对照页，应先保留现有结果。已有服务可用时，可运行 `verify-model-comparison.cjs`、`verify-dual-comparison.cjs`、`verify-diagram-comparison.cjs`；这三个脚本当前硬编码 60934，端口不同要改本机副本。

验收依次检查：四画布与原始 JSON 点数/有限坐标；OP 184/368、RTM/DW 全图/同框切换确实改变对应结果；腿部/手臂裁剪、低分/名称/骨架开关；三图切换且同尺寸图片不混用；390px 无横向溢出、页面异常 0。失败原因在页内显示，空骨架不强补；截图人工检查腕、两髋、两膝、两踝及前后遮挡连接。没有人工标注真值，本轮不报告 AP/PCK。

计时拆成下载、session 初始化、预处理、`session.run`、后处理、3D拟合/物理稳定。旧 RTM/DW 探针的 `ms` 只包围 `session.run`；旧 OpenPose 的 `ms` 包围整个 `Body(image)`，包含图像预后处理。当前 Worker 的 `inferenceMs` 又包含预后处理，不能直接和旧探针数值作等价比较；首次与后续各记、注明并行渲染负载。不要把 Python CPU4线程与 WASM单线程排速度名次，也不要用桌面结果推断手机。

## 默认集成复测（当前MediaPipe，保留RTMPose兼容测试）

恢复MediaPipe后，下列真实浏览器用例已改验两个ONNX按需请求、33点有限world、MediaPipe来源/原图比例、身体质量候选和既有交互；RTMPose解码/FK纯函数测试继续保留。接下来的RTMW/XYZ文字是切回之前的临时试验历史，不会被恢复后的默认流程加载。

2026-10-16追加腿部对应候选：`xyz-report.html`现为三图原始/换踝/换膝踝对照，默认保留原始，使用下拉切换候选可同时看原图与XYZ上的人物左右颜色、COCO号及“目标←来源”；三候选实际骨架可切正侧/参考与匹配相机/图上叠加。旧XYZ页另存`xyz-report-before-correspondence.html`，原始推理与历史xyz-results保持哈希不变。先运行同目录`make-xyz-eval.cjs`、`check-correspondence.cjs`、`run-correspondence.cjs`、`check-correspondence-results.cjs`、`build-xyz-report.cjs`、`check-correspondence-report.cjs`；完整命令见评估任务，期间不重建web-dist。最终统一321骨快照、395项辅助检查通过，但真人候选有实际肩臂限位失败而不自动采用；另两图无交换依据。历史两轮XYZ/深度方法见下文，不将新初值结果与旧轮直接判优。

2026-10-16追加完整XYZ临时试验：复用相同X输出，先用其自身像素xy/相对z共同回投影，不拼RTMPose的xy；方向初值与二维/方向软约束固定参数，保留原预测冲突。`xyz-report.html`与原`report.html`分别保留；新页可看原始XYZ旋转、实际正侧面、图上骨架等比对齐/直接相机投影。复测先依次`make-xyz.cjs`、`make-xyz-eval.cjs`、`check-xyz.cjs`，再`run-xyz.cjs`、`check-xyz-results.cjs`、可选延长诊断`diagnose-xyz.cjs`、`build-xyz-report.cjs`、`check-xyz-report.cjs`，路径均在`tmp/mmd-pose/depth-eval/`；详细命令/输入见同一评估任务。不要同时重建web-dist。65/94/36项辅助检查通过，真人XYZ实际变差、示意未改善、仅二次元相机通过；这些失败保留，不能当成Python仓库完整检测/裁剪流水线的复现，正式代码与下列集成测试保持原样。

2026-10-16补充：[人体三维辅助模型试验](../task/20261016_MMDAR人体三维深度辅助模型评估.md)已在本机完成，比较当前FK、RTMPose+旧MP深度、RTMPose+RTMW3D深度。三图原二维点保持相同，单独融合髋中点相对深度，不拼异源world；三轴维度、单位、根定义、同初始误差及后端一致性均另核查。临时工具/模型不随Git分发，具体复测命令与输入准备见任务记录。9分支中1模型失败、2实际相对关节诊断失败均保留，不能因辅助检查通过称全部姿态还原。该试验尚未加入正式全身IK模式，以下是现有正式集成测试，不会加载RTMW3D。

这组脚本已入库，不依赖上述临时四模型工具。先完成 `npm run build:web:mmd-ar-test`，再执行：

```powershell
node --test --test-concurrency=1 tests/mmd-ar-human-pose-fk.test.js tests/mmd-ar-human-rtmpose.test.js tests/mmd-ar-human-image-pose.test.js tests/mmd-ar-human-physics.test.js tests/mmd-ar-human-pose-camera.test.js tests/mmd-ar-human-pose-projection.test.js tests/mmd-ar-human-camera-ownership.test.js tests/mmd-ar-human-damping.test.js

$env:PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
# 可选变量：本机二次元图；额外图片路径组成JSON数组。缺省只跑公开参考图/空图/取消等。
# $env:AASC_MMD_POSE_ANIME_IMAGE = 'C:/path/to/anime.png'
# $env:AASC_MMD_POSE_EXTRA_IMAGES = '["C:/path/to/seated.png","C:/path/to/diagram.jpg"]'
# 可选诊断输出：父目录需已存在，图片及JSON不提交Git。targetErrorsWorldUnits为场景单位，不是米。
# $env:AASC_MMD_POSE_EXTRA_SCREENSHOT_PREFIX = 'E:/path/to/results/applied-'
# $env:AASC_MMD_POSE_VIEWS_PREFIX = 'E:/path/to/results/view-'
node --test --test-concurrency=1 tests/mmd-ar-human-image-pose-browser.test.js tests/mmd-ar-human-image-pose-clipboard-browser.test.js
```

真实浏览器用例要求Edge/Chrome、完整web-dist及本机参考图片；缺环境会跳过，不算通过真实推理。构建会重建web-dist，必须完成后再运行包括Node真实PMX夹具在内的所有消费测试，不能并行构建和测试。当前检查33点估计world、仅两MediaPipe模型请求、低分跳过、坏输入原子保留、取消/无人不改目标、270子步实际骨架与相机恢复。历史RTMPose二维分支仍要求17点不能伪造world。可选额外图若检测器不识别或实际投影不改善，须保留失败诊断；弱透视对齐残差不是标注准确率或真实深度，同时检查实际目标差值和正侧面构型。

RTMPose历史接入见[接入记录](../task/20261016_MMDAR接入RTMPose-m.md)，其三维分支验证见[FK修正记录](../task/20261016_MMDAR二维姿态三维映射修正.md)。恢复默认模型的执行与实际验证见[MediaPipe恢复任务](../task/20261016_MMDAR图片识别切回MediaPipePose.md)；没有重跑四模型比较或修改各模型权重。

## RTMPose二维刚体与Depth Anything V2 Small（2026-10-16，本机临时评估）

[刚体/深度执行记录](../task/20261016_MMDAR二维投影驱动刚体姿态评估.md)保存固定模型revision/摘要、RGB/minimal等比缩放/14倍数/归一化、原图逆对应、浮点图与表面取样规则、同321骨初值的18支真实物理和完整复测命令。工具位于忽略目录`tmp/mmd-pose/depth-eval/rigid-projection/`；没有package script，因此按任务列出的Node命令运行，不并行重建web-dist。模型和三张私有原图只留本机；WASM单线程推理约1.44/2.61/2.88秒，手机/WebGPU未验。

本机报告`http://127.0.0.1:56173/_depth/rigid-projection/report.html?image=seated`可切三图/三初值及原生或实际PMX叠加，比较纯二维和实验性深度弱力、代理/实际人物正侧、收敛与原生锚点/共享角度/接触。报告显示实际回读而非3D目标；没有逐步缩放评分。射线横向力保留前后自由，固定28°与身体尺度，根深度弱支撑；没有联合恢复相机。

102合成、145实际数据与22报告检查通过仅证明工具/数据链，18支姿态质量失败全部保留。当前初值真人8.29→8.42%、动漫7.36→7.36%、示意7.67→7.67%；深度没有稳定改善。3/1/0条表面候选仍未验证是否属于关节，不能因深度图平滑当有效隐藏关节z，尤其不能据此恢复脚掌/手掌和骨段绕轴。正式全身IK入口仍维持现有RTMPose流程，当前报告是独立临时评估。

## 肩膀与骨盆两侧深度补充（2026-10-16）

新临时工具在`tmp/mmd-pose/depth-eval/rigid-projection/torso-depth/`，保留父目录原二维/八段深度模型和报告不变。先运行check-unit.cjs、prepare.cjs、run-torso.cjs、check-results.cjs、build-report.cjs、check-report.cjs；完整命令/前提见[肩髋执行记录](../task/20261016_MMDAR二维投影驱动刚体姿态评估.md)。不重推理，只读固定Depth Anything浮点图与RTMPose点；原点和向内8%/16%局部统计/噪声/符号筛选，分数门槛0.65保持，肩髋独立、允许扭腰，不由躯干近侧硬指定手脚近。

本机页`http://127.0.0.1:56173/_depth/rigid-projection/torso-depth/report.html?image=seated`比较原八段与新增肩髋的实际投影、胶囊/PMX正侧、肩髋膝腕深度、owner/施力次数和拒绝理由，并列9条历史二维。鲜跑旧9支实际坐标精确复现历史，同初值新9支比较，72新图；248项工具检查通过但27条姿态质量通过0。真人只接受肩线索，髋低分拒绝，默认前膝仍更远19.33cm；动漫无提示完全回退，示意基本不变。新约束已实现于临时原型，正式全身IK没有切换，手机仍未测。

## 先分离人物再做姿态：三输入对照（2026-10-16）

[人物分割任务](../task/20261016_MMDAR人物分割辅助姿态计算.md)记录PPHumanSeg原精度ONNX固定revision/6,163,938字节/SHA、RGB192×192/NCHW/负1到1、两类先逆映回原图再比较、Worker/取消及完整命令。工具在忽略目录rigid-projection/person-seg，依次check-unit、run-person、视觉复核并绑定本次inference SHA、run-physics、check-results、build-report、check-report；复测不能将旧视觉资格用于不同mask输出。

本机报告`http://127.0.0.1:56173/_depth/rigid-projection/person-seg/report.html?image=seated`可切原图、人物裁剪、同框灰底人物图，显示原尺寸mask/透明人物、局部点及映回原图点、原图与新实际PMX/胶囊正侧、各自目标与共同原图参考RMS。深度仍使用原图上下文，新变体用概率≥0.8且完整内部邻域筛选取样，不加姿态分数或补隐藏z。真人/动漫留边后裁剪恰为整图，示意才有局部裁剪。

三图结构筛查通过不代表语义正确：动漫猪剑被保留，两新三维分支拒绝，回退图明确标识；真人/示意仅本次观察允许实验。135项工具检查通过而7实际姿态质量0通过，真人前后腿没有改善，示意裁剪相对共同参考好于本次抠图。图片/模型/结果仅本机缓存，正式全身IK仍原流程，手机与正式取消集成未验。

### 示意图当前分支实际使用的深度辅助（2026-10-16）

分割对照页仍接入Depth Anything原图浮点深度，新变体用人物mask过滤；没有对去背景图重新推理深度。已核查physics.json：diagram原图保留1组左右肩近远约束（chest实际施力77/720步）；crop候选全部拒绝，实际0条深度约束，肩因mask边缘、髋因低分、肢体因低分或差值不足；cutout保留1条rightKnee→rightAnkle前后弱约束，双肩/双髋拒绝。cutout这一条表示被接受的软约束，不代表每子步一定施力或恢复每关节米制z。可在报告“原图深度＋人物掩码”查看各条接受/拒绝原因。此为现有行为核对，没有新推理、物理运行或算法变更。

### 真人坐姿左右腿修正对照（2026-10-16）

本机`http://127.0.0.1:56173/_depth/rigid-projection/person-seg/leg-report.html`默认按用户标注保留髋、交换膝踝；蓝左、黄橙右，因此原黄色抬高腿修正后进入蓝色实际左腿。可切原图/抠图、原始/局部/整腿对应，以及实际PMX/刚体，查看二维源索引、实际投影和PMX/胶囊正侧。整腿候选几何失败，未采用；主三图报告留原结果，真人页新增此入口及旧报告快照。

这是本图显式对应修正，不是换了RTMPose权重或通用自动识别左右；原26/28映到左25/27，原25/27映到右26/28，髋与上半身不变，坐标/分数整点转移。深度重新采样但腿部仍无合格提示，抠图抬高膝还比另一膝远169.37mm，整体投影8.132%，完整姿态未通过。正式全身IK未切换。

复测在原人物分割环境和缓存完整时，按[任务](../task/20261016_MMDAR真人坐姿左右腿归属修正.md)依序执行check-leg-unit、run-leg-correspondence、check-leg-results、build-leg-report、build-report、check-leg-report。六支同321骨/相机/720步，两个原始控制精确复现；新118项工具检查与旧135项回归通过，不当姿态质量通过。


## HMR2.0b 本机三图对照（2026-10-16，已完成测试）

本机报告由临时服务启动后使用其实际端口打开`/_depth/hmr2-sam3d/report.html?image=seated`；旧`56173`端口可能已结束。可切真人/动漫/示意图，浏览器读取本机Python真实HMR结果、原图和既有Depth Anything V2 Small相对深度PNG；蓝色为人物左侧，橙色为人物右侧。三列依次为原图二维叠点、受光圆柱/球形关节3D视图、整图相对深度，窄屏按顺序折行。3D可拖动旋转、双击复位，可展开相机/来源；用户选择不加投影阴影。WebGL不可用时显示旧线条骨架，深度缺失时只提示缺失。动漫图额外可切原版、扩框、人物框左移/右移、镜像输入五个HMR结果；四个实验候选都标注“脚掌未改善”，原版保持默认，切候选不改变深度图。该显示不会改正坐姿左右腿或动漫脚掌识别错误。正式全身IK仍使用MediaPipe，手机浏览器本地推理不在本轮范围。

深度PNG位于本机忽略目录`tmp/mmd-pose/depth-eval/rigid-projection/`，三张输入原图SHA与HMR报告一致；报告运行时也对照两份状态清单的原图SHA，来源不符则不显示可能过期的图。颜色按每张图的5%–95%输出独立归一化：黄色较近、蓝色较远，不能跨图按颜色比较米制距离；背景、衣物和道具的可见表面也在图中。它不能推断遮挡关节或脚掌内部朝向，不与HMR骨骼XYZ混合为“真值”。其他设备或新检出工作区若没有这些PNG，报告会保留原图/骨架并提示深度缺失。深度显示执行记录见[任务](../task/20261016_HMR2报告整图相对深度.md)。

官方4D-Humans源码固定提交`efe18deff163b29dff87ddbd575fa29b716a356c`；HMR2.0b公开归档2710589440字节，SHA-256 `0fdf9e66ec97503fe1b995f4942e021a6df748f4ccbc5574718742d975a6e19b`，其中checkpoint 2709521501字节，SHA-256 `c9ea09c834161468638c9de7a782c614e300c622709bf52967274c543ec72fcf`。归档未单列SMPL中性模型文件，但checkpoint的`state_dict`已有完整SMPL层张量；脚本严格加载ViT/SMPL head全部权重并校验SMPL形状和BODY25映射，调用相同`smplx.lbs`/顶点选择路径重建关节，不额外下载人体模型。Windows本机源码仅加缓存目录HOME缺失回退及OpenGL平台win32两处适配，补丁`windows-compat.patch`与审计SHA在临时目录，模型计算不改。官方源码、权重、原图和推理结果仍在忽略目录；现在选择性跟踪`run-hmr2.py`、`report.html`、`report.mjs`和`check-report.cjs`四份试验源码，不上传私有原图或模型。

固定三张原图与NLF对照一致，使用相同人工框seated=[10,15,226,299]、anime=[96,10,280,375]、diagram=[40,8,160,300]。HMR输出BODY25、相机和原图2D投影。真人坐姿的用户标注“抬高膝属于人物左腿”仍未被可靠识别：模型右膝投影(179.6,172.2)更接近可见抬高膝，左膝(209.8,191.2)偏右，左脚投影超出236px原图宽度。动漫手/脚和示意图交叉腿末端也有偏差；这仅是三图视觉观察，不能当成全数据集准确率。

```powershell
& tmp/mmd-pose/depth-eval/hmr2-sam3d/venv/Scripts/python.exe -X utf8 tmp/mmd-pose/depth-eval/hmr2-sam3d/audit.py
& tmp/mmd-pose/depth-eval/hmr2-sam3d/venv/Scripts/python.exe -X utf8 tmp/mmd-pose/depth-eval/hmr2-sam3d/run-hmr2.py
& tmp/mmd-pose/depth-eval/hmr2-sam3d/venv/Scripts/python.exe -X utf8 tmp/mmd-pose/depth-eval/hmr2-sam3d/run-hmr2.py --anime-foot-trials
node tmp/mmd-pose/depth-eval/hmr2-sam3d/check-report.cjs
```

需持续查看报告时，在另一个终端运行`node tmp/mmd-pose/depth-eval/serve-report.cjs`，用输出的本机端口打开`/_depth/hmr2-sam3d/report.html?image=seated`。立体网格读取现有`build:web:mmd-ar-test`产生的本地Three.js模块；报告浏览器不运行HMR2.0b推理，也不请求外网资源。

无对应npm script，以上是临时测试命令。Windows Python3.10 CPU真实三图推理与Edge展示通过：模型加载约6.1秒，单图前向在两轮中约0.7–2.0秒，进程峰值工作集约5.9GiB；这不是手机浏览器性能。报告三图真实结果、四个动漫候选、390px布局及本机GET通过。动漫原版左脚大/小趾约`(268,394)`/`(289,388)`；四候选脚趾Y仍在`389–404`，未落回右侧可见鞋面，未采纳。镜像候选交换BODY25左右语义后，XYZ/相机重投影与XY差小于`0.001px`。左右腿与脚掌质量未达标，故不接入VAM、不替换MediaPipe。完整数学路径可复核源码；未通过独立SMPL文件实例化官方`HMR2.load_hmr2`包装类，不宣称逐字原版包装调用。任务记录见[HMR2单模型测试](../task/20261016_HMR2单模型三图骨骼测试.md)与[动漫脚掌重测](../task/20261016_HMR2动漫脚掌重测.md)。

## NLF-L 独立骨骼试验（2026-10-16，已完成）

本机报告：`http://127.0.0.1:56173/_depth/nlf-l/report.html?image=seated`；并排对照：`http://127.0.0.1:56173/_depth/nlf-l/compare.html`。浏览器可切三张原图，查看2D叠图与可旋转原始XYZ，并以WASM或WebGPU重新识别。蓝色为人物左侧，橙色为右侧；人物框为人工固定，55°相机为假设。与S均使用官方v0.2.0，同原图/框/相机；L输入384×384，S输入256×256，不能把模型大小差异当作同算力速度排名。

官方`nlf_l_multi.torchscript`为495696900字节，SHA-256 `2090b041ccebbd395018033152628c4f24afe519aed3a299861621547582cdad`。固定SMPL24点`nlf-l-joints.onnx`为471422850字节，SHA-256 `8b49d420715668532dc6783425234dd1afbf7892f34bd1355ad91c9d7a269850`。原模型/ONNX/三张私有图片/报告脚本均在忽略目录`tmp/mmd-pose/depth-eval/nlf-l/`，不随Git分发。浏览器请求均为本机GET，没有上传图片。

复现（无对应npm script；原模型和临时Python环境需已存在）：

```powershell
python tmp/mmd-pose/depth-eval/nlf-l/run-reference.py
python tmp/mmd-pose/depth-eval/nlf-l/export-core.py
python tmp/mmd-pose/depth-eval/nlf-l/verify-onnx.py
node tmp/mmd-pose/depth-eval/nlf-l/check-math.mjs
node tmp/mmd-pose/depth-eval/nlf-l/run-browser.cjs wasm
node tmp/mmd-pose/depth-eval/nlf-l/run-browser.cjs webgpu
```

官方完整半精度封装在本机CPU过慢，参考仅调用其单人裁剪、特征、解码和重建函数的FP32路径。CPU ONNX对该FP32参考最大归一化差三图为1.37e-6、5.42e-6、7.15e-6；JS重建XYZ最大差低于0.001mm。浏览器本机WASM热推理三图约1705–1740ms，GTX1660 WebGPU首图969ms、其后128–140ms；390px无横向溢出。数值对齐不是姿态真值；真人抬高腿仍归右，动漫手臂与示意图交叉腿有偏差，未显示比S稳定改善。未接入VAM，MediaPipe默认保持，手机性能未测试。

## NLF-S 独立骨骼试验（2026-10-16，已完成）

- 本地报告：http://127.0.0.1:56173/_depth/nlf-s/report.html?image=seated ，可切换 anime / diagram，原图叠加及可拖动XYZ。蓝=人物左侧，橙=右侧；首次显示已保存浏览器实测，按钮重新本机推理。
- 官方 v0.2.0 `nlf_s_multi.torchscript`：300606810字节，SHA256 `d5ce59d2efcee5cd15a865a152739082abc2da5d596f8f1bc949a709b417b67d`。封装用来取得官方预处理、关节查询和参考结果，不作为网页下载模型。
- 固定SMPL 24点：`cano_all.smpl`末24点及官方`smpl_24`名字/连线。解码网络提取为`nlf-s-joints.onnx`，83725857字节（83.7 MB / 79.8 MiB），SHA256 `100d29feb3d5b21972a655b6c6322d6a35212859d1300d14b7d2a96a80202a99`。保留脚踝和脚尖，无完整足底旋转、手指或面部。
- 人物框为人工固定：seated=[10,15,226,299]，anime=[96,10,280,375]，diagram=[40,8,160,300]；不是自动检测测试。相机FOV55度是假设，报告使用官方导出的裁剪矩阵。
- 浏览器从原图本地做gamma/透视双线性裁剪、ORT推理及JS三维重建。当前三图均为第0级金字塔，其他降采样级会明确拒绝；不是任意图片上传产品。JPEG浏览器解码及半精度取整产生少量输入差异。
- 数值验证：官方完整流程与拆分裁剪输出最大差0.00049mm；JS重建对官方XYZ最大差0.00060mm；ONNX CPU对官方FP32头归一化输出最大误差3.1e-6；浏览器同输入FP32 XYZ差WASM<0.003mm、WebGPU<0.005mm。原图完整浏览器流程对官方半精度XYZ最大差3.82mm。以上仅证明移植一致，不是对真实人体的准确率。
- 本机Edge无头：WASM三图约194–211ms；WebGPU首图约1035ms（首次编译包含在内），后两图约38–46ms；下载/初始化另计。390px布局无横向溢出；没有手机真机性能测试。
- 已核查WASM网络请求全为本机GET，实际读取ONNX及原图，无上传/远端推理。WebGPU同一代码路径也执行三图数值验证。
- 目视结果：真人抬高腿仍标为右腿，与用户先前确认的左腿归属冲突；动漫手脚与原图明显偏离；示意图腕部仍偏。原始识别不满足自动还原要求，所以本轮不进一步接入VAM，不改MediaPipe默认，不用交换左右掩盖失败。

复现（没有对应npm script，使用直接命令）：
```powershell
python tmp/mmd-pose/depth-eval/nlf-s/run-reference.py
python tmp/mmd-pose/depth-eval/nlf-s/export-core.py
python tmp/mmd-pose/depth-eval/nlf-s/verify-onnx.py
node tmp/mmd-pose/depth-eval/nlf-s/check-math.mjs
node tmp/mmd-pose/depth-eval/nlf-s/run-browser.cjs wasm
node tmp/mmd-pose/depth-eval/nlf-s/run-browser.cjs webgpu
```

脚本、权重、图片结果、reference.json、onnx-check.json、browser-*.json、manifest.json位于忽略目录`tmp/mmd-pose/depth-eval/nlf-s/`，不随Git分发；重建环境需先恢复该目录。依赖安装在既有`tmp/mmd-pose/python-env`目标目录，不改生产package.json/lock。模型按作者非商业研究使用范围进行本地实验。

实现注意：当前GitHub main的重建公式与v0.2.0权重内序列化代码不同。使用权重内RMS归一化、无效点权重0.0001、正则0.01；固定解码替换动态轴列表，必须与官方头输出比较。实验未改变生产构建输入，不触发新的Offline出包项。
