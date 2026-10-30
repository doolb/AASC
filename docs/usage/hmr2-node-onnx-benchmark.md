# HMR2 Node ONNX阶段A基准工具

**阶段A已完成（2026-10-22）**：Node请求DirectML运行完整HMR2.0b Tensor图，已测与原Python CUDA的速度/九项数值差。原图API、HTTP与页面替换未实施。工具只在独立目录，保留原服务/模型/runtime/结果。

[完整实测报告](<E:/ai/ai-depthmap/hmr2_node_onnx/results/phase-a-report.md>)｜[报告JSON](<E:/ai/ai-depthmap/hmr2_node_onnx/results/phase-a-report.json>)｜[末次审计](<E:/ai/ai-depthmap/hmr2_node_onnx/results/final-audit.json>)。

## 环境与结果摘要

- [独立npm配置](<E:/ai/ai-depthmap/hmr2_node_onnx/package.json>)及[lock](<E:/ai/ai-depthmap/hmr2_node_onnx/package-lock.json>)：Node24.13.0 / onnxruntime-node1.26.0；Windows预编译CPU/DirectML/实验WebGPU，无CUDA。
- 仅导出/原生对照使用原Python3.10.10 / Torch2.10+cu126 / 既有ONNX1.22，没有安装/改变原75Python包。
- GTX1660 6GB，每图10warm+50hot：原Python CUDA p50 **188.537/185.668/187.110ms**，NodeDML **208.534/207.467/204.797ms**（seated/anime/diagram）；Node时间增加 **9.45%–11.74%**，本轮纯提速不建议替换。
- 三图最大XYZ点差 **0.000450005mm**、XY点差 **0.0000915527px**、稳定旋转角 **0.0000421685°**；无真值/通过阈值，不称识别等准度。
- 各3独立新进程、OS页缓存未清：首输出中位Python12.889s/Node6.871s，模型加载中位却均约6.52s；n=3的p95只粗估。Host峰不稳定、整卡显存不归因独占/节省，DML内部精度与按进程GPU allocator unknown。

## 模型与输入

[冻结输入清单](<E:/ai/ai-depthmap/hmr2_node_onnx/fixtures/manifest.json>)是原三图NPZ的四项精确小端FP32 Tensor+shape/SHA，img[1,3,256,192]、box_center[1,2]、box_size[1]、img_size[1,2]。不重新decode/裁图、无HTTP或图片检测。

- [原导出清单](<E:/ai/ai-depthmap/hmr2_node_onnx/models/fp32-op18/manifest.json>)：IR10/opset18/1433标准节点，图2,464,522B、外部数据2,701,262,848B，完整backbone/head/6Ddecode/SMPL LBS/BODY25/fullcam/XY。
- **运行DML须显式选择静态候选**：[候选清单](<E:/ai/ai-depthmap/hmr2_node_onnx/models/fp32-op18-dml-static/manifest.json>)图2,468,364B，同SHA外部权重；39个Reshape的-1改为已知固定尺寸，原572 initializer和浮点节点/属性不变。
- 模型图与同目录外部权重须保持相对文件名完整；ORT按路径加载，不将整2.7GB外部数据读成JS Buffer。主候选只支持本轮固定batch1输入shape，不能随意换batch或图像Tensor尺寸。
- 原图本机DML初始化有E_INVALIDARG；bench:node默认保留原图路径作历史/CPU对照，DML命令务必传下面的静态候选路径。不是非法ONNX修复，也不泛称所有DML版本不支持-1。

## 正式复测命令

在隔离目录运行，优先用已有npm脚本。新label/out是新文件名，不覆盖原始证据；以下my-*如已存在须另选新名称。

```powershell
npm run check
npm run verify:protected
# 独立profile，不能混入50次热测；显式静态候选。
npm run bench:node -- --model models/fp32-op18-dml-static/model.onnx --provider dml --profile --out results/my-profile.json
# self-owned进程监督器默认使用已通过的静态候选，原Python则未改prepared控制。
npm run bench:measured -- --mode node --label my-node --warmup 10 --repeats 50
npm run bench:measured -- --mode native --label my-native --warmup 10 --repeats 50
npm run compare -- --node results/my-node.json --torch results/my-native.json --out results/my-comparison.json
# 单独新进程cold示例；再用新label顺序测各3次，不清OS文件缓存。
npm run bench:measured -- --mode native --label my-cold-native-1 --warmup 0 --repeats 1
npm run bench:measured -- --mode node --label my-cold-node-1 --warmup 0 --repeats 1
# 原图CPU仅结构控制，0+1不适合作正式热p50/p95。
npm run bench:node -- --model models/fp32-op18/model.onnx --provider cpu --warmup 0 --repeats 1 --out results/my-cpu-structure.json
```

- Node比较/监督结果用新名且拒绝覆盖，审计/报告默认输出也一次生成；原Python工具默认结果可能刷新，复测优先用bench:measured的新label，不手删历史。
- 已导出模型，不要为了复测直接重跑export:fp32/model:static或bench:torch默认脚本。导出/特化拒绝覆盖已有模型版本；若需新模型/参考，请另建版本或另一个隔离实验根，并保留现有结果。
- `--optimization disabled` 仅独立故障诊断配置，报告如实记录；固定候选正式配置all、串行、禁memPattern、intra4/inter1，没有切FP16或默默CPU代跑。

## GPU窗口与保护

必须由用户提供无大模型竞争的GPU窗口，AI不查杀用户PID或接管8768。各大模型**顺序运行并退出/释放**，不能同时驻留6GB GPU；原native控制在加载前检查CUDA可用显存≥3600MiB，不达安全门就报错等待用户。Node supervisor只使用自有child句柄，nvidia-smi只读整卡资源。

[DXGI枚举结果](<E:/ai/ai-depthmap/hmr2_node_onnx/results/hardware-dxgi.json>)确认本机Node DML deviceId0是GTX1660；序号不是PCI device编号或WMI列表下标，机器/虚拟显示变化后重新枚举。

[末次带时间审计](<E:/ai/ai-depthmap/hmr2_node_onnx/results/final-audit.json>)确认当前实际两份外部权重SHA相同、39纯shape变换、三图CPU首/尾九项2310标量相同、完整profile、原570资源/75包名版本/原服务页Three SHA。保护不涵盖未列文件、驱动或用户PID状态。

## 证据与度量限制

- [包装器等价](<E:/ai/ai-depthmap/hmr2_node_onnx/results/wrapper-equivalence.json>)三图九项差0；[原Python正式控制](<E:/ai/ai-depthmap/hmr2_node_onnx/results/torch-native-final.json>)与[Node正式输出](<E:/ai/ai-depthmap/hmr2_node_onnx/results/node-dml-final.json>)配对同样本/输入SHA。旧静态parents包装器窗口非平稳，不是原服务主速度基线。
- 热边界目标是CPU四Tensor→全部CPU输出校验/拷贝，无decode/HTTP/写盘；原prepared额外包括锁、SHA/合法性/同步/显存metadata，Node预先建立feed，不能只归因为语言速度。
- [独立profile](<E:/ai/ai-depthmap/hmr2_node_onnx/results/node-dml-static-profile.json>)是同一个完整接口DML融合图在3次诊断各执行一次，未见CPU EP Node事件；不是3原始节点/全流程无CPU，短Node dur不能宣传为完整GPU完成时间。正式热测为避免扰动未profile，以同模型同配置的独立证据证明兼容，不声称每热run都独立追踪。
- [全九项数值对照](<E:/ai/ai-depthmap/hmr2_node_onnx/results/dml-vs-native-comparison.json>)包含每项flat max/RMS、XYZ点mm/XYpx、rot组件/det/正交与度量专用四元数相对角。camera/depth flat仍米；原trace角有FP32非正交底噪，不用SVD修正原预测。无真值和人为通过阈值。

## 后续阶段B

如为统一Node部署仍要迁移，需另确认原图API/客户端适配。原OpenCV EXIF/decode、bbox float32/aspect、SciPy风格float64 Gaussian nearest/truncate4、uint8或float64 INTER_LINEAR仿射及RGB CHW规范化不能用sharp.resize代替；原三图均无Gaussian，须补大框/边界/EXIF1–8/gray/alpha/多格式。HTTP鉴权/CORS/忙态/取消、Three桌面手机、MMD真实DML标签均另验收，不能伪装CUDA。Windows必须NodeCUDA需另评SDK/cuDNN/MSVC和ORT+Node绑定源码构建。

见[设计](../design/hmr2-node-onnx-service.md)、[spec](../spec/hmr2-node-onnx-service.md)与[任务](../task/20261021_HMR2NodeONNX服务迁移与速度准度对照.md)。
