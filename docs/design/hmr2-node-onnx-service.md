# HMR2 Node.js + ONNX 独立服务与对照试验

日期：2026-10-21启动，2026-10-22 **阶段A完成**；完整原图API阶段B与正式替换未批准。Node完整Tensor图已运行，原Python/模型/runtime/网页/结果保留。详见[最终实测报告](<E:/ai/ai-depthmap/hmr2_node_onnx/results/phase-a-report.md>)、[任务](../task/20261021_HMR2NodeONNX服务迁移与速度准度对照.md)和[伪代码](../spec/hmr2-node-onnx-service.md)。

## 需求与范围

用户希望[当前Python CUDA FP32服务](<E:/ai/ai-depthmap/hmr2_gpu_service.py>)迁移为Node.js+ONNX并比较速度和准度。用户选定先做**同冻结Tensor的Node DirectML FP32速度/数值试验**，允许新独立目录、锁版本Node依赖和多GB外部模型；不自动替换服务、不以Node转发Python冒充ONNX推理。现有[图片/3D页](<E:/ai/ai-depthmap/hmr2_test.html>)保持。

当前网络ViT-H（256×192、patch16、embed1280、32层、16头）＋Transformer SMPL head，670459037参数、FP32裸网络2,681,836,148B，SMPL buffers约19MB，原checkpoint2,709,521,501B。已完整导出backbone→head/原6Ddecode→SMPL LBS6890vertices/extra-joint Gather→BODY25→全图camera/depth/XY，不用24FK替换足趾脚跟，不换模型/左右/脚掌语义。

历史内部198.805ms/network183.630ms只是旧时间窗口；本轮另测原服务prepared完整CPU输入→CPU输出，不用旧window或仅network stage与ORT相除。

## 实际环境与后端选择

- Node24.13.0、独立[onnxruntime-node1.26.0依赖/scripts](<E:/ai/ai-depthmap/hmr2_node_onnx/package.json>)与lock；原Python3.10.10/Torch2.10+cu126及既有ONNX1.22只读复用，原75包名版本不变。
- Windows npm预编译CPU/DirectML/实验WebGPU，无CUDA。按[1.26 README](https://unpkg.com/onnxruntime-node@1.26.0/README.md)和[安装元数据](https://unpkg.com/onnxruntime-node@1.26.0/script/install-metadata.js)核验，不沿用官网旧Linux11.8注脚或复制DLL凑WindowsCUDA。
- GTX1660 6GB；[DXGI EnumAdapters1枚举](<E:/ai/ai-depthmap/hmr2_node_onnx/results/hardware-dxgi.json>)索引0/1均GTX1660、不同LUID，显式Node DML deviceId0走真实枚举序号，不按WMI猜序或PCI device编号；设备变化后重查。
- DML固定shape、sequential、禁memPattern、intra4/inter1、优化all。原图本机初始化E_INVALIDARG，关闭优化仍失败；39项固定Reshape特化后完整候选成功。WebGPU与Node CUDA未测，不预报它们的性能。
- CUDA/PyTorch vs DirectML/ORT是部署栈对比，不是语言速度隔离。DML内部精度/TF32 unknown，FP32 I/O/权重不保证每个kernel内部严格FP32。

## 实际文件与模型架构

新运行代码/依赖/模型/结果只在用户批准的隔离根，不改根生产依赖、不出Offline/APK或上传Git。实际工具布局：

```text
E:\ai\ai-depthmap\hmr2_node_onnx\
  package.json / package-lock.json
  export-hmr2.py                       # 完整导出、冻结输入、静态parents包装器与保护
  specialize-reshapes.py               # 固定维度兼容候选，不改浮点数学
  benchmark-common.mjs / benchmark.mjs # 四输入九输出/完整Node run/独立profile
  bench-native-prepared.py             # 未改原Python服务prepared控制，不启动HTTP
  run-measured.py                      # 自有进程冷热时点/WS与整卡资源
  compare-results.mjs / build-report.py
  audit-artifacts.py / test-benchmark.mjs
  prepare-*.py / diagnose-*.mjs        # 保留故障小图/前缀诊断
  fixtures/manifest.json + samples/*   # 12份FP32输入bin/参考
  models/fp32-op18/                    # 原完整标准图与external数据
  models/fp32-op18-dml-static/          # 已通过DML的静态候选与同SHA数据
  results/                            # 原始输出、profile、冷热/审计与最终报告
```

原图IR10/opset18/1433标准节点，图2,464,522B；候选图2,468,364B，各外部数据2,701,262,848B。ORT按路径读external data，不转整2.7GB JS Buffer。原模型图保留，候选固定batch1，不扩展动态batch或其他Tensor尺寸。

固定输入FP32 img[1,3,256,192]、box_center[1,2]、box_size[1]、img_size[1,2]，值随图/框变化；输出FP32 xyz[1,25,3]、xy[1,25,2]、rotations24[1,24,3,3]、betas10[1,10]、predCam[1,3]、cameraTranslation[1,3]、cameraDepth[1,25]、focalLengthPx[1]、principalPointPx[1,2]。

parents可信整数展开24链；focal从img_size Tensor ReduceMax计算，不固化样例尺寸；tz保留原scalar反除reciprocal(bs)*(2*focal)舍入。原CUDA包装器/原服务三图九输出maxAbs0后建立参考，dynamo无fallback导出、无ATen/custom/FP16。

本机allowzero1+[-1,2,3]的Reshape→Transpose→Gather链失败，而显式[24,2,3]成功；据每个value_info/元素数特化39个-1，只新增39个INT64 shape常量/重定向第二输入。恢复39输入并删新增项后整ModelProto与源图序列化相同；两份实际外部文件SHA最终重读一致；三图CPU首/尾九项2310有限标量逐值相同。不是非法ONNX修复或所有DML版本兼容保证。

## 验收结果与度量

### 主速度控制

未改原Python prepared vs Node完整模型，各图10warm+50hot，CPU四Tensor→全部CPU结果校验/拷贝，无decode/HTTP/写盘；原prepared额外含锁/输入SHA/同步/显存metadata，边界并非完美语言隔离。静态parents包装器旧seated窗口明显非平稳，不当原服务速度控制。

| 样本 | 原PythonCUDA p50/p95 ms | NodeDML p50/p95 ms | Node p50时间增加 |
|---|---:|---:|---:|
| seated | 188.537 / 201.917 | 208.534 / 267.612 | 10.61% |
| anime | 185.668 / 190.329 | 207.467 / 223.050 | 11.74% |
| diagram | 187.110 / 197.672 | 204.797 / 217.858 | 9.45% |

本轮原服务三图p50/p95均更低，**纯提速不建议直接迁移**。各3独立新进程交替、OS页缓存未清：spawn→首输出中位Python12.889s/Node6.871s，session加载中位均约6.52s，n=3的p95粗估，不称模型加载快一倍。

### 数值、EP、资源与保护

- Node vs 原CUDA三图最大XYZ点0.000450005mm、XY点0.0000915527px、度量专用单位四元数相对atan2角0.0000421685°。九字段flat max/RMS保留各原单位；cameraTranslation/depth仍米。保留原trace/det/正交底噪，不SVD/镜像/换框/配准原预测。
- 3个图像样本无真值、无预设等价阈值；25点和50热重复不增加独立图像样本数，不称识别等准度/MPJPE/PCK改善。原脚掌/左右问题不由格式迁移修复。
- 独立profile记录同一4输入/9输出DML融合图执行3次，未记录CPU EP Node事件，不是3个原始节点/全流程零CPU；短Node dur不能作GPU完成时间。正式热测关闭profile，证据来自同模型同配置诊断，不声称每热run独立追踪。
- Working-set峰在3冷进程并非Node稳定更低；整卡显存/初始占用变化不可相减归因独占或节省；按进程DML allocator unknown。只读取自有child句柄，不查杀用户PID。
- CPU8/8自测、checker、包装器等值、原/候选CPU、完整DML profile、各150hot/各3cold及[最终独立审计](<E:/ai/ai-depthmap/hmr2_node_onnx/results/final-audit.json>)通过。当前两份实际权重/所有结果SHA及原570清单/75包名版本/服务页Three再次保持，不证明未列资源、驱动或PID状态。

## 阶段B：原图API与显示兼容（未批准、未实施）

尚未创建Node图片HTTP服务、网页副本或改生产MMD消费者。若统一Node部署重要且接受本轮约10%热耗时代价，再由用户选择阶段B；否则保留原PythonCUDA。

- 原OpenCV EXIF/decode/定向W,H/gray/alpha与编码兼容；xyxy float32/aspect扩展；sigma=(bbox_size/512-1)/2的nearest/truncate4/axis0→1 float64 Gaussian；无blur uint8、有blur float64的INTER_LINEAR/BORDER_CONSTANT仿射256方crop，BGR→RGB CHW/原mean/std/宽32:-32。不能sharp.resize冒充。
- 原三图都未触发Gaussian，需新增大框/边界/EXIF1–8/gray/alpha/PNG/JPEG/WebP/BMP的原图tensor、最终输出与HTTP对照。
- 未来 /health、/infer/image_base64/可省bbox_xyxy/full_image_fallback、忙503/限额/Bearer/精确CORS/取消/nonce/本地Three和桌面手机回归另实现。Node source/device/precision/memory如实，不填假cuda或Torch allocator。
- 当前[MMD客户端](../../3rd/mmd-ar-test/web-human-hmr2-client.mjs)及原网页严格CUDA/source，DML不伪装通过。阶段B需明确真实后端标签适配；阶段A不改任何生产客户端或8768。
- 建议未来独立8769，实际验收仅自有临时端口；本轮没有启动新HTTP监听或控制用户服务。Windows必须NodeCUDA则另评匹配ORT+Node绑定源码、SDK/cuDNN/MSVC，不能假设现cu126满足所有新版依赖；完整兼容粗估1–3工作日，非承诺。
