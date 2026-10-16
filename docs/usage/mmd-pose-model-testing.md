# MMD 图片姿态：不同模型的测试方法

记录日期：2026-10-16。本说明记录本项目实际使用的 MediaPipe、RTMPose-m、DWPose、传统 OpenPose 四模型对照方法，以及 RTMPose 接入后的集成测试。观察结果见[四模型试验记录](../task/20261016_MMDAR四模型姿态效果对照.md)，当前应用流程见[Human 使用说明](mmd-human-interface.md)。

## 测试分为三层

| 层次 | 检查对象 | 不能据此声称的结论 |
|---|---|---|
| 模型推理 | 原图 → 预处理 → 原始输出 → 还原到原图的二维点 | 已正确驱动三维骨架 |
| 四模型对照页 | 相同图片、人物范围和身体语义下，比较髋膝踝、肩肘腕及缺点 | 模型整体准确率、真实深度或公平速度排名 |
| 当前全身 IK 集成 | 粘贴/文件 → RTMPose → 真实关节FK/限位/透视拟合 → VaM 实际骨骼 → 相机匹配 | 所有遮挡姿态均已还原、手机性能已验收 |

2026-10-16 起网页默认模型为 **RTMPose-m**。历史对照页的 MediaPipe“当前模型”标签指选型时的旧版，不是现版本默认值。OpenPose 在本轮使用 Python CPU，未移植浏览器 ONNX。

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

当前默认入口采用全图单人，未接入 YOLOX 多人检测。人物框版本是选型对照变体，不能混为当前默认配置。

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

## 当前 RTMPose 集成复测

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

真实浏览器用例要求 Edge/Chrome、完整 web-dist 及本机参考图片；缺环境会跳过，不算通过真实推理。构建会重建web-dist，必须完成后再运行包括Node真实PMX夹具在内的所有消费测试，不能并行构建和测试。检查17点无假world、低分跳过、坏输入原子保留、取消/无人不改目标、270子步实际骨架/骨长与相机恢复。额外图的弱透视对齐残差只是独立诊断（当前运行拟合为真实透视），不能当人工标注准确率或真实深度；同时检查实际目标差值和正侧面构型。

首版结果见[接入记录](../task/20261016_MMDAR接入RTMPose-m.md)，当前三维验证见[FK修正记录](../task/20261016_MMDAR二维姿态三维映射修正.md)。更新集成方法时未重跑四模型比较或更换RTMPose权重。
