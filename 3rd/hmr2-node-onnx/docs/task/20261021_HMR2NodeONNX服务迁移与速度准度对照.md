# HMR2 Node ONNX服务迁移与速度/准度对照

日期：2026-10-21启动，2026-10-22 **阶段A完成**。用户批准的隔离Node DirectML FP32同Tensor导出/速度/数值试验已完成；原图API阶段B与正式替换未批准。原Python服务、模型、页面、runtime和原结果不改，用户GPU窗口后顺序测试，未操作用户服务器PID。

## 用户需求、设计与范围

原请求：将当前[Python HMR2服务](<E:/ai/ai-depthmap/hmr2_gpu_service.py>)改为Node.js+ONNX并比较速度和准度。用户选择先做Node＋DirectML数值/速度试验，允许独立目录依赖与多GB外部模型；保留[原图片/3D页](<E:/ai/ai-depthmap/hmr2_test.html>)和CUDA作为对照。不是Node外壳转调Python，不迁移原图预处理、HTTP或生产MMD客户端。

[设计](../design/hmr2-node-onnx-service.md)、[实现伪代码](../spec/hmr2-node-onnx-service.md)、[使用](../usage/hmr2-node-onnx-benchmark.md)、[完整实测报告](<E:/ai/ai-depthmap/hmr2_node_onnx/results/phase-a-report.md>)。

## 已实现模块与文件

全部运行代码/新依赖/模型/输出在独立目录，不改根生产依赖，不出Offline/APK，不上传Git或发布模型。

- [独立npm脚本和依赖](<E:/ai/ai-depthmap/hmr2_node_onnx/package.json>) / [lock](<E:/ai/ai-depthmap/hmr2_node_onnx/package-lock.json>)：onnxruntime-node1.26.0，Node24.13.0；Windows原生CPU/DirectML/实验WebGPU，不包含CUDA。
- [完整Tensor包装器和导出](<E:/ai/ai-depthmap/hmr2_node_onnx/export-hmr2.py>)：ViT-H（670459037参数）/Transformer head/原6Ddecode/SMPL LBS/6890vertices与extra-joint Gather/BODY25/full camera/XY。固定四FP32输入，九FP32输出，dynamo无fallback，IR10/op18，1433标准节点。
- [固定形状DML候选](<E:/ai/ai-depthmap/hmr2_node_onnx/specialize-reshapes.py>)：39个Reshape中-1特化为原固定value_info维度，原572 initializer、浮点节点/属性及权重不变；新图2,468,364B＋2,701,262,848B外部权重。保留[原导出清单](<E:/ai/ai-depthmap/hmr2_node_onnx/models/fp32-op18/manifest.json>)与[候选清单](<E:/ai/ai-depthmap/hmr2_node_onnx/models/fp32-op18-dml-static/manifest.json>)。
- [Node基准](<E:/ai/ai-depthmap/hmr2_node_onnx/benchmark.mjs>) / [冻结输入与合同](<E:/ai/ai-depthmap/hmr2_node_onnx/benchmark-common.mjs>) / [九输出比较](<E:/ai/ai-depthmap/hmr2_node_onnx/compare-results.mjs>) / [8项CPU自测](<E:/ai/ai-depthmap/hmr2_node_onnx/test-benchmark.mjs>)。
- [未改原服务prepared控制](<E:/ai/ai-depthmap/hmr2_node_onnx/bench-native-prepared.py>)，与静态parents包装器分开，避免将包装器变化或旧窗口高p95归因Node收益。
- [仅自有进程监督](<E:/ai/ai-depthmap/hmr2_node_onnx/run-measured.py>)记录spawn→ready/首输出、working-set与整卡只读采样；[末次独立审计](<E:/ai/ai-depthmap/hmr2_node_onnx/audit-artifacts.py>)与[报告聚合](<E:/ai/ai-depthmap/hmr2_node_onnx/build-report.py>)。小算子/前缀诊断工具保留失败记录，不作正式速度基线。

## 正式速度结果

GTX1660 6GB，CPU四Tensor→完整模型→全部CPU输出校验拷贝；每图10次预热后50次重复，模型顺序运行。未测decode/裁图/HTTP；原prepared另含输入SHA/锁/同步/显存metadata，不能只归因语言。

| 样本 | 原Python CUDA p50/p95 ms | Node DML p50/p95 ms | Node p50时间增加 |
|---|---:|---:|---:|
| seated | 188.537 / 201.917 | 208.534 / 267.612 | 10.61% |
| anime | 185.668 / 190.329 | 207.467 / 223.050 | 11.74% |
| diagram | 187.110 / 197.672 | 204.797 / 217.858 | 9.45% |

[主对照](<E:/ai/ai-depthmap/hmr2_node_onnx/results/dml-vs-native-comparison.md>)：本轮原服务三图p50/p95均更低，**纯提速目的不建议切换**。旧静态包装器seated窗口非平稳，不可当Node提速依据。

各3个独立新进程、顺序交替，OS页缓存未清：spawn→首输出中位Python **12.889s**、Node **6.871s**；模型session load中位均约 **6.52s**，不能称模型加载快一倍。n=3的p95只作粗略描述，不是可靠尾延迟。冷原始值、加载/首推、working-set、整卡显存及限制均在最终报告；Node并非稳定更省宿主内存，按进程DML显存unknown，不能据整卡峰相减宣称节省。

## 数值与EP结果

- [包装器等价证明](<E:/ai/ai-depthmap/hmr2_node_onnx/results/wrapper-equivalence.json>)：三图包装器 vs 原Python九输出maxAbs全部0；相机tz必须保留原scalar反除的reciprocal乘法舍入。
- 三图Node DML vs 原CUDA最大XYZ点欧氏 **0.000450005mm**，XY点欧氏 **0.0000915527px**，度量专用归一化四元数相对角 **0.0000421685°**；全9字段max/RMS见[数值JSON](<E:/ai/ai-depthmap/hmr2_node_onnx/results/dml-vs-native-comparison.json>)。原trace角存在同矩阵约0.036–0.038°底噪，不修改原预测做SVD/镜像/对齐。
- 只比较3个冻结样本的后端输出，无真值/预设通过阈值，**不称识别等准度或MPJPE/PCK改善**；FP32 I/O/权重不证明DML内部严格FP32，内部精度/TF32仍unknown。
- [完整模型独立profile](<E:/ai/ai-depthmap/hmr2_node_onnx/results/node-dml-static-profile.json>)：同一4输入/9输出DML融合图执行3次，未记录CPU EP Node运行事件，不是3个原始节点/全流程零CPU；短Node dur不能当GPU完整时间。正式热测不profile，实际分区证据来自同模型同session配置的单独诊断。
- Node DML deviceId0按DXGI EnumAdapters1实际映射GTX1660，不是WMI猜序/PCI device编号；两个GTX条目不同LUID，换环境须重新枚举。

## 自测、兼容保护与问题记录

- `npm run check` 8/8 CPU合同/路径/数据/旋转/显式EP与真实CPU Add测试通过；ONNX checker、完整CPU原/候选结构与2310有限标量逐值相同、完整DML profile、两端各150热run与各3冷进程均通过。
- 原allowzero1配合[-1,2,3]的Reshape→Transpose→Gather小链本机初始化E_INVALIDARG，固定尺寸小链成功；39项静态特化修复当前完整候选。不是非法ONNX修复，也不推广所有DML版本或动态batch。
- [末次带时间审计](<E:/ai/ai-depthmap/hmr2_node_onnx/results/final-audit.json>)重读两份实际2.7GB权重SHA一致、小图差分与恢复原proto完全相同、所有冷热结果SHA及原570保护文件/75包名版本/服务页Three SHA再次通过。不证明未列文件、驱动或PID状态。
- 失败的初次相机舍入、Node reference审计字段拒绝、原图DML/default与关闭图优化诊断均保留，不删除错误记录伪装顺利。旧Python/页面/Three代码没有改。

## 后续仅待用户选择

阶段B未实施：原OpenCV decode/EXIF、bbox float32/aspect、Gaussian float64 nearest/truncate4、uint8或float64的INTER_LINEAR仿射/原RGB CHW规范化必须兼容，不能sharp.resize代替。现三图都不触发Gaussian，完整迁移还需大框/边界、EXIF1–8、gray/alpha与多编码原图对照、HTTP/鉴权/CORS/忙态/取消/Three桌面手机和MMD真实后端标签适配。DML不伪装CUDA。

纯速度优先保留PythonCUDA；如统一Node部署更重要，可接受本轮约10%热耗时代价后另批准阶段B。Windows必须NodeCUDA另评ORT+Node绑定源码构建及匹配SDK/cuDNN/MSVC，本次未装或实施。完整兼容粗估仍1–3工作日，非承诺；阶段A实际完成日期见报告时间。
