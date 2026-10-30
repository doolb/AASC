# HMR2 独立 Python GPU 服务

✅ 已完成 [2026-10-21] 用户确认“复制现有模型和必要依赖到目标目录（推荐）”后新增[hmr2_gpu_service.py](<E:/ai/ai-depthmap/hmr2_gpu_service.py>)（838行）并验证CUDA FP32/API；正式服务未启动，用户手动运行。

## 请求、设计与实际范围

用户要求在指定深度目录放一个可用GPU的Python服务文件，沿用既定FP32。新入口包含常驻HMR2.0b生命周期、原生图像预处理、GPU模型/LBS/相机/投影、标准库HTTP、CLI/CPU自测；配套资源位于同目录models/hmr2与hmr2_runtime。只复制本机已有模型/必要纯Python包/许可证，正常启动不依赖旧Web tmp目录；无对应npm script，已检查package.json，执行目标解释器。

[设计](../design/hmr2-python-gpu-service.md)、[spec](../spec/hmr2-python-gpu-service.md)、[使用](../usage/hmr2-python-gpu-service.md)。不改[深度脚本](<E:/ai/ai-depthmap/depthmap.py>)、旧runner/七原JSON/CPU/GPU精度结果、Torch/vision安装包、AASC/MMD前端/API接线、ONNX、检测/AMP/FP16、Web/Offline产物或Git，不操作用户服务PID或替换服务。

## 实现与资源

- 524文件/2,720,583,552字节，含checkpoint2,709,521,501字节、model_config、mean、原hmr2及五纯包（einops/timm/yacs/smplx/omegaconf）及许可证；模型SHA c9ea09c834161468638c9de7a782c614e300c622709bf52967274c543ec72fcf与原一致。原模型/CPU site保留，目标75安装包不变。
- GPUFP32固定、mmap/meta/strict assign、原8 SMPL shape/map，GPU索引默认0、4线程、seed42、确定性、禁TF32/AMP；load幂等，缺资源/CUDA明确拒绝，无CPUfallback。
- namespace绕训练/渲染顶层，原ViT/head/geometry/dataset/lbs不改，相机函数AST；cv2一次BGR解码、原256方crop+宽裁32，不默默纠正旧runner的xywh/xyxy歧义。
- 默认127.0.0.1:8768，GET /health、POST /infer（JSON image_base64+可选bbox_xyxy，缺框整图fallback不是检测）；BODY25/rotations24/betas10/camera/深度/输入SHA/耗时/显存。
- 非阻塞GPU锁busy503，请求24MiB/图16MiB/40Mpx/15s socket超时；坏JSON/重复键/未知字段/NaN/框/类型/长度拒绝，安全UTF8 JSON；非loopback要token、精确CORS、无HTTP配置写入。

## 实测与保护

目标Python3.10.10/Torch2.10.0+cu126/GTX1660，本次最终完整验证23 GPU推理、33协议/预处理/生命周期检查全过；原三图精确NPZ输入6字段XYZ/XY/24rot/betas/predCam/cameraTranslation对旧GPUFP32**差均0**。新原生环境NumPy2.2.6/cv2 4.13与旧cache input最大分量差2.3841858e-7，XYZ最大0.000298023mm、XY最大0.000061035px，仅说明预处理版本差而非网络精度错，不改vendor强追旧hash。

9热sample引擎同步total中位198.8049ms，范围188.2780～227.8797ms；seated/anime/diagram中位198.8603/202.3445/191.5435ms，network中位183.6303ms。total含图片prep/上传/GPU同步/DtoH，不含HTTP base64/JSON/传输；不归因旧260ms差为确定优化。引擎峰allocated/reserved2.6259/2.7031GiB，最终RPC不同线程的Torch workspace等占用可另有，不能当完整进程显存。

额外50连续真实HTTP infer全部200、结果一致，模型只加载一次；1/2/5/10/25/50次allocated都2678.0547MiB，warm后增长0，临时服务已finally关闭。缺模型和CUDA_VISIBLE_DEVICES空的负例均拒绝、0模型加载/无CPUfallback/无监听；--help（UTF8）、--check与标准库--self-test通过，后者不是GPU验收。

原11深度文件、35HMR资源/CPU报告、75包版本、旧GPU FP32/Half raw和524复制文件SHA检查保持；本轮只启自有测试进程内临时loopback，全部关闭，未启动8768正式服务。上游timm/cross弃用warning无错误，不改包。

## 过程错误与修正

1. 首复制已完成模型/全部纯包，最后repo许可证用LICENSE而实际LICENSE.md而停止；补实际许可证并重建清单。随后清单检查误用checkpoint别名，改用真实manifest checkpoint路径复核，没有再次覆盖或重复制模型。
2. 首完整GPU/HTTP测试仅在CORS GET期望失败：带正确token的外源GET200但无ACAO正确，测试原期待403；只修测试期待，源码不变。重跑最终完整验证exit0，外源预检403/许可来源204及实际Bearer检查通过。

## 风险、工时与后续

确认前预计30～60分钟，实际包含只读调查/方案确认、复制校验、单文件实现/静态检查、两轮完整GPU/API与50连续请求、自测文档。共享6GiB GPU仍可能与其他应用争用，图片限额/全图fallback/HTTP认证与网络边界均需按实际使用选择；测试不保证无限时长/所有负载质量。已有姿态/脚掌问题未修复，SMPL模型仅本机许可使用，许可证保留。

本轮已从todo移除并记changelog。正式用户手动启动/其他应用接线不自动代做；未遗留本轮实现待办。

## 证据

[清单](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-251d3b2f/manifest.json) / [重放自测](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-251d3b2f/verify-service.py) / [完整结果](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-251d3b2f/verification.json) / [统计](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-251d3b2f/summary.json) / [原生预处理差](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-251d3b2f/preprocess-check.json) / [禁CUDA/缺资源负例](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-251d3b2f/negative-check.json) / [连续RPC](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-251d3b2f/http-stress.json)。源码SHA 3d9f00749bd13170cb6cd2f7efb0cabd312f69ae649a0c8b687e2368060229b8。
