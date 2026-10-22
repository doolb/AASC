# HMR2 Node代码入3rd与模型获取/服务启动

日期：2026-10-22。**代码与CPU自测已完成**；用户已明确确认完整原图＋自测、本机校验导入兼远程URL。真实新增DML HTTP与浏览器实屏另需用户窗口，不替换原Python/8768/生产MMD。

## 需求与已实现

- [独立子包](<../../3rd/hmr2-node-onnx/package.json>)按core/framework/app；Node≥22，固定ORT1.26.0、Sharp0.35.5、OpenCV.js4.12.0-release.1、bmp-js0.1.0。独立lock安装，根生产依赖不增加。
- [根npm](<../../package.json>)增加download:hmr2-model/start:hmr2/test:hmr2，原start不变。模型默认项目res外置，原E盘模型/报告只读保留。
- [模型获取](<../../3rd/hmr2-node-onnx/core/model-files.mjs>)固定图2468364B/data2701262848B、两完整SHA；已有正确cache复用、目标无效不覆盖、ordinary/no links、流式锁/temp/双验证/hardlink无覆盖提交/installed最后；无合法源清晰失败，不伪造公共URL或上传SMPL权重。
- [引擎](<../../3rd/hmr2-node-onnx/framework/engine.mjs>)一次完整ONNX session，含SMPL LBS、四输入九输出；请求decode到输出单飞busy503，原BODY25/rot/betas/相机aliases保持。CPU可显式配置；Windows默认DML，不填CUDA或自动fallback。
- [HTTP](<../../3rd/hmr2-node-onnx/framework/http-service.mjs>)构造真未listen/不导入ORT，原图health/infer与严格UTF8/JSON/原base64语义/CL-TE/Bearer/精确CORS/finite错误。Node parser更早400差异明确说明。
- [独立Node页](<../../3rd/hmr2-node-onnx/public/index.html>)固定同源选图/粘贴/框/2D/本地Three；全绘制前严格Node来源/schema/model/requestedEP-device/FP32 I/O/canonical BODY25，旧CUDA/错来源不叠2D。无外站APIURL或生产storageKey。

## 预处理与实测纠错

[预处理](<../../3rd/hmr2-node-onnx/core/preprocess.mjs>)保留NumPy2逐步float32框/aspect/factor/sigma、sigma²/系数舍入、nearest Gaussian double/对称原累加/axis0→1、r0仍double、CV32FC2点/M64/INTER_LINEAR/BORDER_CONSTANT、有blurdouble/无bluruint8、Fpixel/double mean,std/最终FP32与中心192宽。不是sharp.resize。

首轮CMYK因Vips色彩管理产生解码max134/规范化输入max2.10893；改为保留CMYK working/output空间和原OpenCV256移位整数换色后，补变化K/EXIF方向，29case四输入SHA全部一致，maxAbs0。旧错误报告不覆盖。BMP依赖忽略bfOffBits，已收紧40-byte DIB、palette/真实起点/完整stride；扩展V4/V5/gap拒400，不静默错误。

## 精度、计时和兼容边界

- FP32权重与I/O已固定；DML内部精度/TF32、allocator与无profile节点实际分配未知。dml:N仅requested目标，DXGI原序号，不虚填NVIDIA或假cuda。
- health.gpu为对象/CPU null，与旧ordinal整数不同；cold device反映请求目标。显存原四allocator键及deviceFreeMiB/deviceTotalMiB保留null，hostRSS单独说明非显存。
- modelRun/inferenceMs完整ORT run至CPU九输出拷贝校验，不能直接比旧Torch network+LBS。modelLoadMs仅session.create，startupMs含两SHA与preprocessor初始化，不是进程全启动/依赖安装。不可拆阶段null。
- PNG/JPEG/WebP/标准BMP、边长<32767；默认image16MiB/40M、request24MiB、blur12M/r64。部分编码/资源接纳比原Python窄。特殊ICC/YCCK/gAMA/未来版本不由29case普遍保证。
- 默认正式8769由用户执行CLI；先bind检查端口冲突再load，warming healthfalse/infer503。不查杀用户PID、不控制8768。

## 验证结果

- 根test:hmr2静态＋CPU **89项：87通过、0失败、2file symlink明确跳过**；junction拒绝实测通过。包括原8合同/CPU Add、模型tiny/cache/竞争、raw协议/nonce/CORS、WASM/BMP、fake engine/CLI、VM页面9项。
- 真本机2.7GB import两SHA完成，再cache复用；start:hmr2 --check配置/模型验证成功，listenerStarted=false/modelLoaded=false。
- 29当前Python继承prepare_image CPU参考同bytes/框四输入SHA一致，decoded/warp/M逐阶段记录。原函数未重写，override仅CPU依赖初始化，-B/CUDA禁用，不构造模型。
- 完整CPU ONNX实际session＋自有port0四次HTTP（原3＋Gaussian）、actual HTML/Three/nonce、cold/ready/final、loadCount1通过并关闭自有资源。[整图CPU证据](<../../tmp/hmr2-node-onnx/service-cpu-integration-20261022.json>)。
- 原DML同Tensor速度/九输出报告仍[阶段A](<E:/ai/ai-depthmap/hmr2_node_onnx/results/phase-a-report.md>)，不是新增HTTP端到端。无带真值识别准确率结论；真实浏览器和DML HTTP待用户窗口。

[使用](<../usage/hmr2-node-onnx-service.md>)、[实现](<../spec/hmr2-node-onnx-project-service.md>)、[任务](<../task/20261022_HMR2Node代码入3rd与模型获取启动.md>)。模型/日志/node_modules不Git；servicePackage原已true，其余发布状态不扩大，未构建/发布或启动正式服务器。
