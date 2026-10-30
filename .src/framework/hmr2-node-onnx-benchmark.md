#skill: ai-code-translation
# framework/HMR2 Node ONNX同Tensor基准

## 范围与已有声明
- 引用 已批准且完成的阶段A与原HMR2Engine固定FP32网络/SMPL链 // 只翻译完整Tensor推理，不换模型/左右/脚掌语义
- 引用 [项目spec](<docs/spec/hmr2-node-onnx-service.md>)和[阶段A实测报告](<E:/ai/ai-depthmap/hmr2_node_onnx/results/phase-a-report.md>) // 原图API、HTTP与生产客户端阶段B未实施
- 引用 原三个NPZ与CUDA FP32参考 // 隔离后端数值差，不混入decode/裁图差异

## 新增定义
- 无额外协议或业务对象 // 本次仅对齐已实现JSON和实际文件，不再生成目标代码
- 引用 FixtureManifest { schemaVersion, scope, inputShapes, outputShapes, samples } // 四项原输入必须由双方按SHA逐字节复用
- 引用 FixtureSample { name, label, imageSha256, imageSize, boxXYXY, inputs, referenceOutputs } // 以真实样本/框/输入元数据配对
- 引用 BenchmarkResult { schemaVersion, kind, model, fixtures, runtime, timings, samples, graph } // requestedEp和actualAssignment置于runtime，加载时间置于timings
- 引用 TensorOutput { dims, data } // 九输出保留批次维和FP32平铺数值
- 引用 比较JSON { schemaVersion, kind, scope, environment, comparisons, assessment } // 准度仅为三图输出数值差，不是带真值精度
- 引用 监督记录 { mode, exitCode, spawnEpochMs, processToReadyMs, processToFirstOutputMs, peakWorkingSetBytes, gpuSamples } // 只监督自有子进程，整卡采样不可当进程VRAM

## 目标文件清单（已有真实文件，仅作为映射）
- [export-hmr2.py](<E:/ai/ai-depthmap/hmr2_node_onnx/export-hmr2.py>) // 完整Tensor包装、导出、冻结输入与原保护核验
- [specialize-reshapes.py](<E:/ai/ai-depthmap/hmr2_node_onnx/specialize-reshapes.py>) // 39项固定shape特化，不改浮点数学/权重
- [benchmark.mjs](<E:/ai/ai-depthmap/hmr2_node_onnx/benchmark.mjs>) // Node完整图与独立profile/热时序
- [benchmark-common.mjs](<E:/ai/ai-depthmap/hmr2_node_onnx/benchmark-common.mjs>) // 四输入九输出形状、字节、小端/对齐/SHA/有限与深度验证
- [compare-results.mjs](<E:/ai/ai-depthmap/hmr2_node_onnx/compare-results.mjs>) // 逐项max/RMS、点欧氏和稳定旋转角，不改原预测
- [bench-native-prepared.py](<E:/ai/ai-depthmap/hmr2_node_onnx/bench-native-prepared.py>) // 另测未改原服务，不能用静态parents包装器冒充生产控制
- [run-measured.py](<E:/ai/ai-depthmap/hmr2_node_onnx/run-measured.py>) // 仅spawn自有冷热基准，读自有句柄working-set与整卡资源
- [audit-artifacts.py](<E:/ai/ai-depthmap/hmr2_node_onnx/audit-artifacts.py>) // 图差分、当前实际权重/结果SHA、2310CPU标量与570资源/75包核验
- [build-report.py](<E:/ai/ai-depthmap/hmr2_node_onnx/build-report.py>) // 审计通过后聚合主速度表、九输出单位、各3新进程冷数据/资源口径
- [test-benchmark.mjs](<E:/ai/ai-depthmap/hmr2_node_onnx/test-benchmark.mjs>) // 8项CPU合同/数值/路径/选项/旋转及真实CPU Add自测

## 操作流程
### 准备冻结输入与原生包装
- 校验 原NPZ并将四项输入转原字节序FP32文件 // 不重新裁图或覆盖原缓存
- 保存 三样例FixtureManifest与原570资源/75包快照 // Node依赖隔离，不污染原Python环境
- 包装 原backbone/head/6D/SMPL LBS/6890顶点与extra-joint Gather/BODY25/相机/XY // 固定batch1保留九输出
- 冻结 原可信parents为Python整数并展开24链，保持Tensor焦距与reciprocal(bs)*(2*focal)反除舍入 // 去导出Python依赖，不固化图像宽高或改相机数值
- 比较 同一原CUDA模型的包装器与原prepared输出 // 三图九输出maxAbs为0后建立参考
- 导出 标准IR10/op18完整FP32图和外部权重 // 禁ATen/custom/FP16/隐式exporter回退，checker及SHA留证

### 固定形状兼容
- 隔离 本机allowzero1与[-1,2,3]的Reshape→Transpose→Gather链初始化错误 // 小链固定[24,2,3]成功不推广所有DML版本
- 读取 每个Reshape固定value_info和原shape，特化39个-1且校验元素数 // 本批次合同不改元素次序/浮点算术
- 另存 1433节点候选与同SHA外部数据，保持原导出图 // 原572 initializer不变，仅增39个INT64 shape
- 验证 恢复39条输入并删新增shape后整proto与源图完全相同 // 不凭manifest自述认定纯shape变换
- 对比 三图原/候选CPU firstRun与hotLast九输出共2310有限标量 // 实测逐值差0，不声称DML位级相同或动态batch可用

### Node完整图与EP
- 读取 FixtureManifest与reference已知审计字段并校验shape/SHA/字节数/finite/路径 // 对非对齐Buffer按小端DataView安全复制独立Float32
- 传入 模型文件路径而非2.7GB JS Buffer // native ORT加载相对external data
- 初始化 DXGI序号0的DML、图优化all、串行/禁memPattern、线程4 // 原生能力列表不等实际图分配
- 验证 完整九项CPU输出形状/finite/正深度并计完整run // 无decode/HTTP/写盘，原服务控制另有校验/锁/metadata边界限制
- 单独profile 同一完整接口DML融合图的3次诊断执行 // 事件3不是原始节点数，不把短Node dur当完整GPU时间
- 标记 该profile无CPU EP Node事件、宿主CPU工作仍可能存在 // 不宣传全流程零CPU；热测actualAssignment仍unknown，引用同模型/配置独立证据
- 标记 FP32权重/I/O与DML内部精度/TF32 unknown // dtype不能证明每个kernel的内部算术

### 数值、冷热与资源
- 配对 同样本/图像/四Tensor SHA，并比较九字段flat max/RMS // XYZ分量仍米、cameraTranslation/depth仍米，不混进mm点距离
- 换算 XYZ点欧氏至mm，保留XYpx、24rot组件/det/正交度 // 不镜像/换框/Procrustes或SVD修复预测
- 仅在度量中 将矩阵转单位四元数并用相对atan2角 // 保留原trace底噪，不误认同矩阵约0.03°为后端旋转差
- 测试 identity对90°、FP32非正交自身角接近0及小角 // 稳定角不等于修改预测
- 顺序测 每图10warm和50hot，主速度基线只用未改原prepared // 旧包装器非平稳p95不可当Node收益；原服务另含SHA/锁/同步/显存metadata
- 顺序交替测 各3独立新进程，记录spawn前→ready/首输出与session load/首run // OS页缓存未清，n=3线性p95只是粗估，不能称模型加载快一倍
- 只读取 自有child句柄的working-set、1秒整卡显存/频率采样 // 不查询用户服务器PID，host峰并非Node稳定更低，不能用整卡相减宣称独占显存节省
- 审计 当前小图/实际两份2.7GB权重SHA、全部冷热结果SHA、原570清单/75包/服务页Three // 范围不含未列文件/驱动/PID状态
- 输出 主表Node时间增加9.45%–11.74%与三图数值差、缓存未清首输出中位6.871s对12.889s // 仅本部署组合，不推出语言优势/真值等准度/原图API效果

### 测试与结果追踪
- 执行 Node内置8项CPU测试和真实CPU Add // 不把toy CPU成功当完整GPU成功
- 引用 完整CPU/包装器等值/checker/完整DML profile/两端各150hot与各3冷/末次审计 // 阶段A完成，不包含原3D可选故障注入
- 引用 [最终带时间审计](<E:/ai/ai-depthmap/hmr2_node_onnx/results/final-audit.json>)与[报告JSON](<E:/ai/ai-depthmap/hmr2_node_onnx/results/phase-a-report.json>) // 保留原失败记录，原运行文件未内嵌模型SHA的追溯限制如实说明

## 映射与已确认例外
- 以 项目docs spec为权威实现伪代码，此文件只作技能追踪补充 // 本轮只同步.src，不新增目标代码或Unity业务
- 保持 用户明确批准的E:/ai/ai-depthmap/hmr2_node_onnx代码根 // Node目标不擅自搬通用nodejs目录/hal，外部隔离例外已获准
- 返回 ai-code-translation阶段A收尾 // 原确认已覆盖导出/基准/自测；不重复请求阶段A授权，不进入未批准的原图API阶段B
