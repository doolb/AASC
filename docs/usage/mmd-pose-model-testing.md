# MMD 图片姿态：HMR2.0b 与人物分割测试

更新日期：2026-10-16。用户确认本机姿态试验仅保留 **HMR2.0b** 与暂时保留的 **人物分割**。四模型对照、RTMW3D/XYZ、NLF-S/L及SAM 3D Body旧独立试验不再作为可运行入口；历史观察与命令保留在[历史任务](../task/20261016_MMDAR四模型姿态效果对照.md)、[三维辅助评估](../task/20261016_MMDAR人体三维深度辅助模型评估.md)、[NLF-S](../task/20261016_NLFS浏览器骨骼试验.md)、[NLF-L](../task/20261016_NLFL浏览器骨骼试验.md)及[清理执行记录](../task/20261016_MMD姿态试验仅保留HMR与人物分割.md)。

**本次只清理本机临时试验，不把正式全身IK改成HMR。正式默认仍是MediaPipe人物检测＋33点估计world，RTMPose兼容代码、生产模型缓存与既有集成测试不变。**

## 打开两类报告

从项目根目录由用户在另一个终端运行：

```powershell
node tmp/mmd-pose/depth-eval/serve-report.cjs
```

该入口现在使用HMR完整本机服务，输出实际端口的HMR地址；固定三图和自选/粘贴图片均可使用。服务只绑定`127.0.0.1`。不要沿用历史56173/60934端口，端口不固定；不自动停止、重启或替换用户原有服务器。

在同一输出端口下打开：

| 报告 | URL路径 |
|---|---|
| HMR2.0b | `/_depth/hmr2-sam3d/report.html?image=seated` |
| 人物分割三输入 | `/_depth/rigid-projection/person-seg/report.html?image=seated` |
| 真人左右腿对应 | `/_depth/rigid-projection/person-seg/leg-report.html` |

三图参数为`seated`、`anime`、`diagram`。也可由用户直接运行`node tmp/mmd-pose/depth-eval/hmr2-sam3d/custom-report-server.cjs`，使用它输出的端口。已有旧静态服务不包含自选图HMR接口；只刷新页面不能给已载入内存的旧服务补接口。

## HMR2.0b 固定三图与自选图片

[报告](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/report.html)读取同目录[页面逻辑](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/report.mjs)、状态及七份结果。三列为原图二维叠点、受光圆柱/球形关节骨架、整图相对深度；人物左蓝、右橙，3D可拖动旋转、双击复位，不加投影阴影。WebGL不可用时回退线条预览，深度缺失或来源SHA不匹配时只提示缺失，不影响原图/骨架。

动漫可切原版、扩框、人物框左移/右移、镜像输入五份HMR结果。四候选均未改善脚掌，原版仍默认；切候选不改变原图深度。BODY25左右标签和原始JSON不被静默修补。

自选图：选择PNG/JPEG/WebP、按Ctrl+V/⌘V或用粘贴按钮；确认处理后像素的X/Y/宽/高人物框，点击“识别 HMR＋深度”。HMR通过同机Python处理一次性临时PNG，Depth Anything在当前浏览器本地ONNX/WASM推理。原文件上限20MiB、解码像素上限4096²，处理后最长边1600；HMR任务串行，自选结果不覆盖固定三图JSON。

### 模型、环境与边界

官方4D-Humans源码固定提交`efe18deff163b29dff87ddbd575fa29b716a356c`；归档2,710,589,440字节，checkpoint 2,709,521,501字节，实际资源摘要见[状态](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/status.json)。保留[运行环境](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/venv/)、官方源码、Windows缓存/OpenGL适配补丁与解压模型。

checkpoint包含完整SMPL层张量；[推理脚本](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/run-hmr2.py)严格加载网络并校验SMPL形状/BODY25映射，用相同`smplx.lbs`/顶点选择路径重建关节和原图投影，不额外下载独立SMPL人体文件。不能将它描述为逐字调用官方完整包装类。

三张原图及人工框由[样本配置](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/sample-config.json)固定：真人236×314、动漫450×407、示意236×314；框依次为`[10,15,226,299]`、`[96,10,280,375]`、`[40,8,160,300]`（xywh）。图片仍在本机用户目录/Temp，不提交Git；Temp图片可能被系统清掉，报告状态不代表路径永远有效。

注意：现有环境必须保留。历史Python锁清单未覆盖`psutil`，仅依赖锁文件不能承诺完全重建；原审计框验证与推理xywh语义的统一仍待后续修正，不在清理任务中改变模型路径。

### HMR复测

没有专用npm script；从项目根依次执行，推理命令会写状态/本机结果，复测前保留基线：

```powershell
& tmp/mmd-pose/depth-eval/hmr2-sam3d/venv/Scripts/python.exe -X utf8 tmp/mmd-pose/depth-eval/hmr2-sam3d/audit.py
& tmp/mmd-pose/depth-eval/hmr2-sam3d/venv/Scripts/python.exe -X utf8 tmp/mmd-pose/depth-eval/hmr2-sam3d/run-hmr2.py
& tmp/mmd-pose/depth-eval/hmr2-sam3d/venv/Scripts/python.exe -X utf8 tmp/mmd-pose/depth-eval/hmr2-sam3d/run-hmr2.py --anime-foot-trials
node tmp/mmd-pose/depth-eval/hmr2-sam3d/check-report.cjs
node tmp/mmd-pose/depth-eval/hmr2-sam3d/check-custom-report.cjs
# 真实Python端到端，非快速UI替身检查：
node tmp/mmd-pose/depth-eval/hmr2-sam3d/check-custom-report.cjs --real
```

默认自选图检查注入HMR测试结果但真实运行浏览器Depth，不能当成Python推理通过。真实HMR历史三图单图前向约0.7～2.0秒、模型加载约6.1秒、进程峰值约5.9GiB；这是Windows CPU记录，不是手机性能。真人抬高膝仍被误归右腿，左脚超画幅；动漫脚趾候选仍在y=389～404且偏离鞋面，示意末端也偏。数值/工具通过不代表姿态正确；不接入VAM。详见[单模型测试](../task/20261016_HMR2单模型三图骨骼测试.md)、[动漫复测](../task/20261016_HMR2动漫脚掌重测.md)、[自选图片](../task/20261016_HMR2自选图片文件粘贴.md)。

## 人物分割：暂时保留完整试验

[person-seg目录](../../tmp/mmd-pose/depth-eval/rigid-projection/person-seg/)整体保留：PPHumanSeg权重/版权、mask、透明人物/裁剪/抠图输入、二维点、实际Ammo/PMX正侧结果、三图报告、真人左右腿报告、旧快照和复测工具。

PPHumanSeg原精度ONNX为6,163,938字节，SHA-256 `552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24`；RGB192×192/NCHW/负1到1，两类概率先逆映回原图再判人物，单线程WASM Worker并保留取消/资源释放。

原图、人物框裁剪、同框灰底抠图分别使用相同RTMPose-m二维权重；映回原图后比较，不提高模型分数、不补隐藏z。正式MediaPipe构建不再分发RTMPose，故**仅试验静态服务**把其固定请求URL映射到[既有RTMPose缓存](../../3rd/mmd-ar-test/model-cache/pose-onnx/rtmpose-m-body7-384x288.onnx)，不修改正式构建和生产缓存。

人物分割仍依赖已有[原图二维缓存](../../tmp/mmd-pose/depth-eval/inference-wasm.json)、[深度浮点图](../../tmp/mmd-pose/depth-eval/rigid-projection/depth-results.json)、321骨初值、rig/drive、肩髋模块及历史控制JSON。它们只作为保留功能依赖，不再开放旧刚体/肩髋独立报告。可以沿用缓存重跑分割与物理；已清理的RTMW3D全链缓存生成工具不再提供，不能声称仍支持旧四模型/RTMW全流程从零重建。

三图结构筛查不代表语义正确：动漫猪剑被保留，两新三维分支拒绝并回退原图；真人/示意仅本次观察允许实验。深度仍用原图上下文，新变体仅取概率≥0.8且完整邻域位于人物内部的表面线索，不对抠图重新推理深度。

真人leg报告默认按用户本图标注保留髋、交换膝踝（26/28→左25/27），蓝左、黄橙右；可切原图/抠图、原始/局部/整腿、PMX/刚体。整腿候选几何失败未采用，本图修正不是通用自动左右识别。抠图抬高膝仍远169.37mm、整体投影8.132%，完整姿态未通过，正式IK不变。详见[分割任务](../task/20261016_MMDAR人物分割辅助姿态计算.md)和[腿对应任务](../task/20261016_MMDAR真人坐姿左右腿归属修正.md)。

### 人物分割复测

以下完整重跑会改写inference及实际结果；旧[视觉复核](../../tmp/mmd-pose/depth-eval/rigid-projection/person-seg/visual-review.json)绑定原inference SHA，重跑后必须重新人工复核并绑定，不能沿用旧资格。

```powershell
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/check-unit.cjs
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/run-person.cjs
# 人工复核新mask并更新visual-review的inference摘要后，再运行物理。
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/run-physics.cjs
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/check-results.cjs
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/build-report.cjs
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/check-report.cjs
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/check-leg-unit.cjs
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/run-leg-correspondence.cjs
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/check-leg-results.cjs
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/build-leg-report.cjs
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/build-report.cjs
node tmp/mmd-pose/depth-eval/rigid-projection/person-seg/check-leg-report.cjs
```

仅查看既有报告或运行`check-unit`/`check-leg-unit`/`check-results`/`check-leg-results`/报告检查，不会重算原始推理与物理结果。检查脚本启动自己的临时HTTP/Edge并关闭，不替换用户服务器。缓存的protectedHashes包含工作区绝对路径，迁移目录后需审查来源，不能直接改摘要让检查通过。

## 共享深度与清理后检查

Depth Anything V2 Small量化ONNX、预处理配置、三张PNG和原图浮点深度保持。HMR固定三图按原图SHA对照深度清单；颜色为每图5%～95%独立归一化，黄色近、蓝色远，只表示可见表面相对顺序，不是米制关节深度、遮挡真值或掌面旋转。

`node tmp/mmd-pose/depth-eval/check-retained.cjs`定向核对七份HMR结果、人物分割历史输入摘要、相对模块依赖、保留HTTP资源、RTMPose缓存路由、移除的旧入口及非法HMR框；不重新运行Python或改写推理结果。加`--worker`真实重跑PPHumanSeg/RTMPose三图九输入，并验原尺寸mask、原图逐点一致、两session释放、取消和本机GET；只更新独立检查摘要，不覆盖历史推理/物理/视觉复核。

模型/私人图片/环境及大结果仍只留本机，不随Git分发；新检出工作区需要恢复保留资产。共用Three/Ammo/ORT来自既有web-dist及node_modules，不在清理范围。

## 正式MediaPipe集成测试（未改变）

正式使用说明见[Human](mmd-human-interface.md)，恢复验证见[任务](../task/20261016_MMDAR图片识别切回MediaPipePose.md)。只有缺web-dist或正式代码变化时才构建；构建完成后再跑消费测试，不并行构建与测试。

```powershell
npm run build:web:mmd-ar-test
node --test --test-concurrency=1 tests/mmd-ar-human-pose-fk.test.js tests/mmd-ar-human-rtmpose.test.js tests/mmd-ar-human-image-pose.test.js tests/mmd-ar-human-physics.test.js tests/mmd-ar-human-pose-camera.test.js tests/mmd-ar-human-pose-projection.test.js tests/mmd-ar-human-camera-ownership.test.js tests/mmd-ar-human-damping.test.js
$env:PUPPETEER_EXECUTABLE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node --test --test-concurrency=1 tests/mmd-ar-human-image-pose-browser.test.js tests/mmd-ar-human-image-pose-clipboard-browser.test.js
```

缺浏览器/参考图/模型环境导致跳过不算真实推理通过；手机性能、系统剪贴板、更多PMX/遮挡/坐姿质量仍待实机验收。单张图无3D真值，模型参考RMS不能冒充人体标注准确率。
