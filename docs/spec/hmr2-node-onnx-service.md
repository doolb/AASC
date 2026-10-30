# HMR2 Node + ONNX 服务实现伪代码

日期：2026-10-21启动，2026-10-22阶段A完成。已实现完整ONNX导出、39个Reshape静态特化、Node DML完整图/CPU校验、原Python prepared控制、热50次与各3冷进程、末次模型SHA/保护审计和报告；原图API/网页消费者阶段B未实现。Node热p50本轮比原CUDA慢9.45%–11.74%，输出差很小但无真值等准度结论。见[设计](../design/hmr2-node-onnx-service.md)和[最终报告](<E:/ai/ai-depthmap/hmr2_node_onnx/results/phase-a-report.md>)。

## 状态、隔离与阶段

```text
请求 := 独立Node服务运行同HMR2.0b ONNX，并给速度/数值差异证据；不是Node外壳转调Python
批准门 := 用户确认新目录/Node依赖/外部权重/实际GPU EP/基准阶段后才创建运行代码与模型
保留 := 原Python服务 + hmr2_runtime + checkpoint + 原图/NPZ/历史输出；只读引用，不覆盖，不重启用户8768
阶段A := exporter可行性 → 同冻结Tensor基准 → Node实际GPU后端速度/数值证明
阶段B := 阶段A值得继续且用户方案包含该阶段 → 独立Node图像预处理/API/网页与兼容回归
替换门 := 实际结果 + 用户再次选择是否采用；慢/失败/偏差过大只报告，不自动替换
依赖 := 新hmr2_node_onnx目录独立锁定npm包；既有PythonONNX包只读复用，缺包另隔离；不动根生产依赖
后端 := Windows预编译CPU/DirectML、实验WebGPU；CUDA仅另批准源码构建/平台方案，不把包名当CUDA支持
```

## 一次性导出

```text
资产检查 := 原checkpoint/config/8组SMPL buffers/BODY25-map/670459037网络参数与SHA对应
环境 := 原Torch2.10+cu126及已装ONNX/onnxscript版本实际核验 → batch1/eval/FP32/禁TF32与AMP
包装 := 独立nn.Module引用backbone与head、注册原SMPL buffers；不写原vendor/runtime
parents := 可信checkpoint parents读成Python整型常量 → 展开24transform chain；原数学操作保持
输入 := img Float32[1,3,256,192] + box_center[1,2] + box_size[1] + img_size[1,2]
张量图 := backbone(img) → head(features，原6Ddecode) → global/body24旋转+betas+predCam
SMPL := pose2rot=false LBS → 原6890vertices/24joints → 21extra vertex gather → 原BODY25-map
相机 := focal=(5000/256)*ReduceMax(img_size) → 原cam_crop_to_full(含bs+1e-9) → tz采用reciprocal(bs)*(2*focal)，保持PyTorch浮点scalar反除实现而非Tensor直接div → q=xyz+camera → depth=q.z → 原xy/focal/principalPoint
输出 := xyz[1,25,3],xy[1,25,2],rotations24[1,24,3,3],betas10[1,10],predCam[1,3],cameraTranslation[1,3],cameraDepth[1,25],focal/principalPoint
导出 := 明确dynamo、目标opset与IR、external_data=true、禁止隐式exporter fallback；优先适配DML文档≤opset20
检查 := 图无ATen/PythonOp/未知custom节点；输入4个shape、FP32权重、输出shape、所有external路径与文件SHA
保存 := 版本化model.onnx(<2GB)+相对weights分片+manifest；checker按文件路径检查，不将大权重合回protobuf
失败 := 保留诊断与实际阶段；不创建假成功清单、不改dtype/左右/相机公式凑通过
```

## Node Tensor引擎（已测）与原图兼容层（阶段B未实施）

```text
加载 := 验证manifest/相对权重/实际包版本/可用EP → InferenceSession.create(model路径)；不fs.readFile整个2.7GBblob
GPU请求 := 所选DML或WebGPU确实可初始化才标ready；失败报错，不静默全CPU服务
诊断 := DML init E_INVALIDARG时先小Add/LayerNorm/GatherNN/Gemm各自验证；保存verbose初始化日志/失败JSON，必要时仅在新候选小图等价分解不支持算子，保留原图/权重SHA
兼容候选 := 最小复现证实Reshape allowzero=1且shape含-1失败而显式尺寸成功 → 用每个固定Tensor value-info维度特化含-1的Reshape shape，逐个校验输入/输出元素数相等 → 新版本小图与相同SHA外部权重，算术/精度/旋转约定不改 → CPU数值对照再测DML
显卡 := DXGI EnumAdapters1实际枚举映射deviceId，不能假设Intel/NVIDIA顺序；本次index0/1均GTX1660
DML := fixed-shape + executionMode=sequential + enableMemPattern=false + 同session单请求锁；默认优化all，故障时另测显式disabled并在报告完整记录，不换FP32输入/权重或静默CPU
验证 := finite输出、24rot/10betas/BODY25形状、正camera/depth、focal/principalPoint/原图元数据匹配
来源 := 真实checkpoint provenance + ONNX版本 + requested/actual EP/precision已知或unknown；DML绝不填cuda设备名
释放 := 自有session/测试进程关闭，保留用户进程；峰值仅按可得口径报告，不冒充Torch allocator
解码 := image header/EXIF/字节像素限额 → 原IMREAD_COLOR等价3通道与定向W,H（PNG/JPEG/WebP/BMP/alpha/gray专测）
框 := 仅可省略xyxy、不可null/越界/退化 → float32中心scale → [192,256]aspect扩展为正方形bbox_size
抗锯齿 := factor=bbox_size/512；factor>1.1时sigma=(factor-1)/2 → float64 nearest边界空间axis0→1 separableGaussian，truncate4/radius=int(4*sigma+.5)，不滤通道
采样 := 无blur使用uint8量化，有blur使用float64 → 原控制点float32与getAffineTransform矩阵 → OpenCV INTER_LINEAR表/坐标/舍入及BORDER_CONSTANT0的256方crop
规范化 := BGR→RGB → CHW复制float32 → 逐通道原mean/std*255规范化 → 宽32:-32得到256x192
准入 := 先对每类图分支比较W/H/框/trans/tensor max&RMS/SHA，再运行graph；不以resize或另一插值冒充等价
混合边界 := 阶段A用冻结Tensor或Python预处理只称后端/混合试验，不声称独立Node原图端到端通过
```

## HTTP、网页与消费者（阶段B未实施）

```text
CLI := 独立建议127.0.0.1:8769；非loopback需token；模型一次加载，启动失败不回CPU
请求 := GET /health + POST /infer JSON(image_base64,可省bbox_xyxy)；未知key/null框/重复key/不支持传输/超限按原协议拒绝
结果 := 保留type/schema、原BODY25/24rot/相机/box/hash；source/device/runtime/memory如实描述ONNX实际环境
静态 := GET /测试页随机nonce + GET /hmr2-three.js只固定同目录MIT模块；无CDN/任意文件/CSP放宽
网页副本 := 原文件选择/粘贴/xyxy/2D/可旋转3D保持；严格但支持真实DML/实验WebGPU标签，不伪装CUDA
消费者边界 := 当前MMD客户端严格CUDA/source不直接接受DML；阶段A不改生产客户端或8768，最终采用需另确认适配
安全 := 原Bearer/精确CORS/无外源任意文件/图16MiB及40M像素/请求24MiB/无密钥持久化/结果textContent
```

## 基准与证据

```text
固定输入 := 三个旧精确NPZ(image,box_center,box_size,img_size) → 新raw little-endian FP32+shape/SHA清单；原NPZ不修改
后端对照 := 同四Tensor → 原PyTorch FP32参考/ORTCPU结构验证/Node实际GPU EP；same tensor-to-complete CPU outputs边界
原生速度控制 := 另测未修改HMR2Engine._predict_prepared，含原parents GPU标量索引同步/校验/计时元数据但无图像decode/HTTP；与等价静态wrapper分别列出，不将wrapper改进算Node收益
旋转度量 := 保留原矩阵component/正交/det和trace角；增加仅用于度量的normalized quaternion相对atan2角消除trace的FP32正交误差底噪，绝不修改预测
图片对照 := 原bytes+同xyxy → 当轮Python native与Node兼容层；先tensor再最终骨骼，不追旧native SHA相同
误差 := 每点XYZ欧氏mm和XYpx max/RMS、24rot组件+SO3角/正交/det、betas/predCam/fullcam/depth/focal；不镜像/配准/改框隐藏差异
阈值 := 用户未提供数值通过界限，报告实测max/RMS与dtype/TF32/内部精度known或unknown；包装器自身等值校验要求九项差0，但ORT跨EP不自动得bitwise或等准度保证
样本边界 := 三图非泛化识图准确率；真值精度需另有标注集及MPJPE/PA-MPJPE/PCK
速度 := 同batch/输出/线程/独占GPU窗口；进程冷启动(OS缓存未清除需标明)/session加载/首推/预热10次+每图50次完整内部p50p95/真实HTTP另报
监督 := 仅spawn自己的Node或Python基准，以child epoch记录进程到ready/首输出；0.25秒取自有进程working-set、1秒只读整卡显存/利用率/频率，无PID查杀；另3个独立冷进程顺序测试(OS页缓存不清，n=3的p95只作粗估)，保存日志与资源口径
profiling := 与热测分开记录EP分区/CPU算子/传输；ORT run若含H2D/D2H不同步拆分不可和Torch network单阶段直接比较
资源 := 权重大小/SHA、host RSS、实际可得GPU总占用/allocator口径、加载峰/稳态/释放；不将全GPU空闲变化归一单进程
回归 := 整图/有框、Gaussian大框/边界、EXIF1-8/gray/alpha/编码格式、坏图/鉴权/CORS/忙503、连续请求、桌面390px3D/取消失效清空
保护 := benchmark只管理自己的port0/进程，6GB不同模型顺序运行，用户自行停旧服务；570旧文件与75包/旧报告SHA不变
报告 := 必须final-audit passed及两份10warm/每图50hot完成；主速度表仅原native vs NodeDML，增加比例=nodeP50/nativeP50-1；包装器旧非平稳窗口仅附数学对照，不能当提速基线；九输出flat原单位+XYZ点mm/XYpx/稳定旋转角；各3冷进程显示原始值/中位/p95(粗估，OS缓存不清)，模型加载与进程首输出分开；working-set/整卡显存不作独占差值，DML内部精度unknown；阶段B未实施，纯速度优先保留PythonCUDA
最终审计 := 当前两小图hash与39个仅Reshape第二输入差分+原572 initializer完全相同；重读两份2.7GB实际权重SHA相同；三图CPU×首尾×九项2310有限标量相同；诊断仅1融合图执行3次/无CPU EP Node事件；冷热结果文件SHA+570资源/75包重查并写带时间audit，不宣称未列文件/驱动/PID或独占VRAM被证明
```

阶段A上述导出/固定Tensor基准/审计已实际完成，证据以最终报告和结果文件为准；原图兼容、HTTP、网页与消费者段仅为阶段B规划，不表示服务已替换。内部精度unknown、无真值/数值阈值，不宣称Node提速或等准度。
