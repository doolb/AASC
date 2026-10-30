#skill: ai-code-translation

# framework：HMR2.0b 网页ONNX与MMD-AR双骨骼方式

当前状态：待确认；本轮只写方案，不生成目标代码或自测代码。

2026-10-19：用户提出独立服务/API地址方案，新增候选见[API流程](mmd-ar-hmr2-api-service.md)。以下浏览器ONNX保留备选，最终路线待确认，不同时生成两条HMR部署路线。
目标：浏览器JavaScript ES模块与ONNX；沿用现有MMD-AR工程及Python参考环境，不默认生成Unity或另一套独立应用。

## 已有声明

- 引用 createImagePoseClient.infer 与 createImagePoseClient.cancel // 保留图片识别代次和取消语义
- 引用 installImagePose 与 installPoseOverlay // 沿用选择、粘贴、识别、确认应用和实际PMX叠加交互
- 引用 prepareDetector 与 decodePeople // 只在需要时复用选人检测，不混用两模型骨骼
- 引用 retargetImagePose 与 applyImagePose // 保留PMX真实骨长和计算完成后提交目标的边界
- 引用 fitImageCamera 与 applyImageCamera // 保留相机所有者、revision与PMX token验证
- 引用 stagePoseAssets 与现有web-human-build列表 // 不手改构建产物或破坏MediaPipe默认清单
- 引用本机 run-hmr2 的 ViT、head、LBS、BODY25 与全图投影路径 // 以已有Python数值路径作为迁移基准

## 新增定义

- 定义 PoseEngineSelection { engineId, epoch, imageId, pmxToken } // 防止切换方式后应用旧结果
- 定义 HmrAssetManifest { revision, precision, runtime, opset, files, externalData, licenseScope } // 分开文件格式、数值版本和授权范围
- 定义 MigrationBaseline { imageSha256, boxFormat, boxXYXY, inputTensor, rotations, betas, camera, jointsBody25, projection } // 区分预处理误差与导出误差
- 定义 HmrRawResult { source, rotations, betas, cropCamera, jointsBody25, jointSchema, provenance } // 不伪装成MediaPipe原生33点
- 定义 PoseSemanticResult { source, rawResult, referencePoints, targets, qualityKind, jointAvailability } // 不给没有模型置信度的HMR填充可见度分数
- 定义 HmrLifecycle { worker, sessions, abortSignal, gpuCapability, memoryBudget } // 控制GB级权重的驻留开销

## 操作流程

### 冻结参考与导出边界

- 保留旧七份HMR结果与原始图片摘要，写入独立 MigrationBaseline // 不覆写清理后保留的历史证据
- 固定原三图的实际xyxy人物框和Python预处理张量 // Dataset与旧自选或镜像宽高处理存在混用，先锁实际输入
- 将新界面的xywh人物框显式转换为boxXYXY // 不将裁框变化误判为ONNX误差
- 以单人静态输入尺寸 1×3×256×192 导出ViT与head，输出旋转矩阵、betas、相机 // 固定位置编码不支持任意动态尺寸
- 将FP32模型图与外置权重分开，逐个记录大小和摘要 // 网络裸FP32约2.68GB，超过单个protobuf边界
- 对照Python与ONNX CPU的参数和输出，确认有限、旋转正交及重投影误差 // 导出成功不等于数值等价

### 浏览器与SMPL数值验证

- 在桌面安全上下文检查WebGPU、adapter特性、shader-f16及内存预算 // HTTPS或localhost才可用WebGPU，支持API不代表能装下模型
- 按固定ORT版本按需加载WebGPU与JSEP资源 // 现有WASM-only构建不能直接使用WebGPU
- 优先验证FP32数值，再验证混合FP16部署 // head零token、normalize等不能直接全模型半精度
- 独立验证FP32 SMPL重建，保留BODY25需要的脚趾、脚跟与脸部顶点 // 仅24关节FK会丢足部信息
- 根据实测选择小ONNX重建或JS重建，对照完整LBS // 稀疏顶点优化必须证明与原流程等价
- 保存初始化、下载、推理、重建、峰值内存和误差的独立检查结果 // 不以Python耗时或3图推断网页性能与通用准确率
- 不将WASM或INT8声明为必定可用的回退 // 分片只绕过文件格式限制，不能消除驻留内存或算子限制

### MMD-AR双方式

- 保留 MediaPipe 默认选择，增加 HMR2.0b实验选择 // 保留现有轻量33点路径
- 未选择HMR时不加载其GB级资产 // 不拖慢普通页面与默认识别
- 切换 engineId 时取消识别与相机拟合，递增epoch并清除旧参考 // 防止两方式和旧图片结果串用
- HMR选人允许复用MediaPipe检测，必要时给全图或人工框 // 检测头部附近box不是全身框，不运行其姿态估计拼接骨骼
- 将HMR原生BODY25与SMPL信息映射到明确语义，保留rawResult // 不补齐成伪33点、不静默交换人物左右
- 用几何可用性与缺失状态显示HMR质量，保留未知模型置信度 // 数值有效不代表坐姿、遮挡或脚掌正确
- 使用PMX真实骨长生成身体目标，并在用户确认应用后统一提交 // 不按SMPL体型拉伸角色，不绕过现有物理入口
- 将HMR相机用于原图投影或可选拟合初值，复用现有相机权限和恢复流程 // 不直接覆盖AR、编辑器或相机VMD视角
- HMR失败时明确提示，保留当前PMX姿态，只让用户显式切回MediaPipe重算 // 不用旧结果或另一方式冒充本次HMR成功

### 门禁与范围

- 在桌面导出、数值与资源验证通过后再接正式入口 // 避免先放一个实际不能推理的下拉选项
- 保留本机HMR参考与人物分割试验，不新增第三种骨骼计算方式 // 用户要求两方式而非恢复清掉的其他模型
- 在公开分发前核对HMR权重和SMPL模型授权 // 代码MIT不自动覆盖内嵌人体模型或浏览器权重下发
- 首阶段不承诺手机、连续视频、实时帧率或自动修复原始左右腿错误 // 模型格式迁移不改善识别能力
- 等待用户确认后才创建导出、网页模块与测试代码 // 本轮仅方案，现有MediaPipe与Offline状态不变

## 目录映射草案

- 将本方案落到现有 3rd/mmd-ar-test 的资源、Worker、预后处理、重定向与图片面板模块 // 复用现有工程而不是另建应用
- 将导出与Python数值参考落到本机HMR目录的独立浏览器验证子目录 // 不覆盖历史七结果或环境
- 将迁移验证映射到新增定向测试及已有MediaPipe回归测试 // 收到测试确认后先补齐测试伪代码再生成测试源码
- 本轮不创建任何目标平台hal目录 // 尚未获准生成目标代码
