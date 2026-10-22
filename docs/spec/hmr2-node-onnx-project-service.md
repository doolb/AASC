# HMR2 Node项目服务与模型获取实现

状态：2026-10-22，用户已明确确认“实现代码＋自测、本机校验导入＋远程URL”。代码、真实本机准备、89项CPU测试及29图输入/完整CPU HTTP已完成；新增DML HTTP与浏览器实屏待用户窗口，原Python不替换。

```text
共享接口 := core/errors ServiceError.status/code/message；engine.health与predictBytes；http createService返回未listen Server，纯协议不importORT
模型接口 := core/model-files loadCatalog、verifyModel、acquireModel；输入modelDir/catalog/sourceDir/baseUrl，返回已验证文件与cache/local/remote真实source
库 := ORT1.26.0/Sharp0.35.5/OpenCV.js4.12.0-release.1，独立子包锁版本；原OpenCV4.13必须逐图验证
精度补充 := NumPy2 bbox/aspect/factor/sigma及sigma²/指数系数逐步float32；Gaussian半径0仍float64整图和float64warp
HTTP补充 := 实际非白名单Origin不改变状态，只不发ACAO；预检才拒绝；严格重复JSON/UTF8，base64先于null bbox检查，图像/bbox范围在engine忙锁后
```

```text
代码根 := 3rd/hmr2-node-onnx，独立package/lock与core/framework/app，不改根生产依赖；原E盘模型/结果保留
根命令 := download:hmr2-model → app/download-model.mjs；start:hmr2 → app/server.mjs；用户执行正式启动，AI仅普通测试与port0
模型目录 := 默认res/models/hmr2-node-onnx/fp32-op18-dml-static，参数/环境可选本机源或HTTPS base URL；当前没有已验证官方下载地址
候选 := 固定batch1 IR10/op18，model.onnx2468364B、model.onnx.data2701262848B；完整SHA从已核验候选manifest逐项读取并生成catalog，再按实际文件复核，不手工简写摘要
```

## 模型获取

```text
缓存 := 两普通文件/大小/预期SHA完整 → 复用且报告真实来源，不重复下载；无效目标不静默覆盖
来源 := 用户确认本机导入兼远程URL方案，或用户提供具体远程源；无源报清晰错误，不伪造/发布URL
本机 := 校验已生成候选 → 流式copy到自有临时文件，不改变原图/数据
远程 := 只取固定两个文件 → 状态/重定向/字节/超时/凭据日志规则 → 流式SHA+大小验证，不加载2.7GB Buffer
提交 := 两文件都通过 → 在确定目标目录原子安装 → 再核验结果，失败不产生ready清单
路径 := 输出包含性/普通文件/符号链接校验；清理/rename只操作自有已核对绝对路径，不删或替换用户原资源
```

## 引擎与原图预处理

```text
启动 := 规范化host/port/modelDir/provider/token/origins/limits；默认localhost8769/WindowsDML，非loopback无token拒绝
会话 := 校验固定候选与ORT1.26 → 一次create，串行/禁memPattern/intra4/inter1/优化all → 四输入九输出元数据FP32固定shape
生命周期 := constructor threads必须1–32正整数否则400；closePromise复用，closing先置位→等待loadPromise/active→detach session仅release一次；load创建session后若closing不标ready，防止关闭后复活
EP := 明确requested与actual证据，不静默全CPU；device dml:0不是cuda:0；内部精度/TF32及ORT GPU allocator unknown
原图 := 严格base64/编码/字节/像素/EXIF/decode/颜色 → 原float32框中心/尺度/aspect扩展
CMYK := JPEG四原始CMYK通道经实测对齐原OpenCV公式转换，不用Vips CMYK至sRGB色彩管理冒充原字节；逐case验证
BMP := 仅40-byte DIB/未压缩标准位深，约束palette数量与bfOffBits等于真实decoder起点，核验rowStride×H，扩展/gap拒绝而不静默读错
Gaussian := 原门限bbox_size/512>1.1 → sigma=(factor-1)/2，nearest/truncate4/axis0→1/float64，不滤通道
仿射 := 原控制点与OpenCV INTER_LINEAR/BORDER_CONSTANT 256方crop；blur分支float64，无bluruint8，保持舍入/采样表
规范化 := RGB CHW FP32/原mean/std/宽32:-32 → 四Tensor与imageSize/boxXYXY/bboxSource/inputTensorSHA
对照 := 同bytes/框当前Pythonnative vs Node输入max/RMS/SHA → 再九输出；不把旧cache微差当ORT差或任意宣称等准度
```

## HTTP与独立页面

```text
路由 := GET /health 与POST /infer，原image_base64/可省bbox_xyxy；不新增配置读写HTTP接口
校验 := 未知字段/null框/退化框/重复key/传输/限额/Bearer/精确CORS/错误码；鉴权、限额和busy规则覆盖失败分支
锁 := 同一请求内decode/预处理/run/输出验证受单请求busy保护，第二请求立即503，不排队积压6GB GPU
本机批次 := imageSize正整数与img_size一致/像素预算/boxXYXY合法/bboxSource只能supplied或full_image_fallback且全框/输入SHA一致，先400 invalid_batch再run
完整图测试 := app/test-service-integration默认CPU，只自有port0，cold health不load、一次load、四图HTTP真session、实际固定HTML/Three、finally关闭；DML仅用户窗口显式选择
结果 := 原type/schema/BODY25名字边/xyz/xy/24rot/10betas/predCam/fullcam/depth/focal/projection/meta；precisionFP32 I/O，来源/EP/内存如实
输出门禁 := cameraDepth各点>0且cameraTranslation.z>0；主点须等于原图W/2,H/2，不生成非法相机
绘制门禁 := 2D/3D/成功提示前统一schemaVersion1/modelHMR2.0b/Node来源/dml或cpu/FP32 I/O，旧CUDA或错来源不得先叠图
时间 := preprocess/modelRun/total/modelLoad分开；不能可靠拆H2D/LBS/network时标unknown，不与旧network183ms相除
页面 := 独立同源Node选图/粘贴/框/2D/Three副本，真实DML标签；当前Python页/生产MMD默认不改
启动测试边界 := 仅自有测试port0，生产8769启动由用户npm命令执行；不查杀/接管用户PID或8768
```

## 自测与保护

```text
CPU := 原8项合同/路径/数值/稳定旋转/显式EP优化/真实CPU Add回归迁移
获取 := 小文件本地HTTPfixture + 本机源 → 缓存/SHA错/截断/404/限额/无源/目录越界/临时文件失败；不是2.7GB真实公共源证明
HTTP := 自有port0假引擎 → health/infer/鉴权/CORS/限额/未知字段/非法结果/busy503；mock不计为真实GPU原图通过
原图 := 三已有图 + 大框Gaussian/边界/EXIF1–8/gray/alpha/PNGJPEGWebPBMP → 当前Python输入与Node比较、有限/shape/projection与九输出
GPU := 用户再次提供窗口 → Node与原Python顺序实测，不并存两大模型，不将CPU/协议toy冒充DML
保护 := 原服务/页/模型/runtime/NPZ/历史结果/75包不改；新结果独立tmp，模型/日志/node_modules不提交Git
```

[设计](<../design/hmr2-node-onnx-project-service.md>)、[中文流程](<../../.src/framework/hmr2-node-onnx-project-service.md>)和[使用/限制](<../usage/hmr2-node-onnx-service.md>)。CPU89项87通过/2明确skip，29图四输入SHA全一致，真完整CPU port0四图/单load通过；新DML HTTP或视觉实屏不能由这些证据替代。
