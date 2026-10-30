#skill: ai-code-translation

# framework：HMR2.0b独立API服务与MMD-AR双方式

当前状态：待确认；只生成本轮中文方案，不生成服务、客户端或自测代码。
目标：独立Python HMR服务＋现有浏览器JavaScript面板；API是新增候选路线，建议优先，前轮浏览器ONNX保持备选未实施。

## 已有声明

- 引用本机 run-hmr2 的模型加载、ViT/head、SMPL LBS与BODY25投影 // 复用已验证的原生推理路径，不先做ONNX迁移
- 引用 custom-report-server 的本机图片接口 // 现有接口每请求启动Python且依赖报告，不冒充常驻独立服务
- 引用 createImagePoseClient、installImagePose、installPoseOverlay // 保留MediaPipe本地图片识别和确认应用交互
- 引用 retargetImagePose、applyImagePose、fitImageCamera // 沿用PMX真实骨长、物理提交与相机所有者边界
- 引用当前浏览器本地配置与AASC远端配置规则 // 不为同一配置增加HTTP读取保存接口

## 新增定义

- 定义 HmrServiceConfig { modelRoot, device, host, port, allowedOrigins, apiToken, limits } // 模型与进程独立于MMD网页及tmp报告
- 定义 HmrRuntime { predictor, readyState, modelRevision, inferenceLock } // 模型常驻，限制并发和内存
- 定义 HmrApiConfig { baseUrl, engineId, apiVersion } // 界面填写服务根地址，不把服务启动与应用捆绑
- 定义 HmrPredictRequest { requestId, imageBytes, boxFormat, personBox } // 只接收上传图片，不接收服务端文件路径或任意下载URL
- 定义 HmrPredictResult { apiVersion, requestId, source, modelRevision, imageSize, personBox, jointSchema, jointNames, joints2d, joints3d, coordinateSystem, units, smpl, camera, timing } // 保留原生25点和坐标语义，不伪装MediaPipe置信度
- 定义 HmrApiTask { abortController, epoch, imageId, pmxToken, apiBaseUrl } // 隔离服务、算法、图片与模型变化

## 操作流程

### 独立服务

- 将HMR推理提取为可复用predictor，启动时加载一次模型 // 避免现有每请求spawn的冷启动
- 按部署环境选择CPU或CUDA，记录实际device // 当前CPU环境不能仅凭配置宣称获得GPU加速
- 从显式modelRoot读取经校验的本机模型，不把权重提交Git或APK // 服务发布与模型准备分离
- 提供 GET /health 返回ready、协议版本、模型版本、device与输入限制 // 测试连接不上传图片或触发骨架应用
- 提供 POST /v1/hmr2/predict 接收图片与可选人物框 // 首阶段只承诺单人静态图片
- 将人物框明确规范化为xyxy，缺框按全图单人裁框处理 // 不复用旧xywh混用缺陷，不宣称具有可靠无人检测
- 可按需复用现有MediaPipe选人检测，不新增其他人物模型 // 保持前轮清理边界且不混用骨骼输出
- 校验图片格式、字节数、解码后尺寸和框，再进入有界推理 // 防止畸形图片、无界排队及重复模型占满内存
- 返回原生BODY25、SMPL姿态与相机估计，明确单位和坐标原点 // 客户端才能正确重定向和投影
- 为并发超限、输入非法、协议不符与推理失败返回明确错误 // 失败不发送伪成功姿态
- 默认绑定localhost，LAN或远程部署显式配置监听地址、Origin和鉴权 // CORS不是身份认证，不默认开放公网
- 不持久保存上传图或在日志输出图片、token及用户文件路径 // API方式需保护发送到服务的图片

### 界面API地址与两方式

- 保留 MediaPipe 本地默认，增加 HMR2.0b API 选择 // 浏览器不需要下载HMR的GB级权重
- 仅在HMR方式显示API地址、测试连接和可选鉴权 // 不干扰现有默认识别
- 规范化HTTP或HTTPS服务根地址，支持部署路径前缀 // 不硬编码试验随机端口
- 将地址保存为当前浏览器偏好，token默认不持久保存 // 不将密钥放在URL或日志中
- 若未来由控制端远程配置显示端，复用AASC配置消息与权威广播 // 禁止额外建立HTTP配置读取保存接口
- 点击测试连接时读取health并验证协议和ready状态 // 不上传当前图片
- 明确提示图片将发往填写地址，仅在用户点击API识别时上传 // 与MediaPipe本地隐私语义区分
- 发送图片与同坐标空间人物框，接收并验证协议、来源、尺寸与原生关节 // 不接受另一模型结果冒充HMR
- 用AbortController停止等待，切算法、地址、图片或PMX时递增epoch并清旧参考 // 迟到响应不能应用到当前模型
- 不承诺HTTP断开立即中止PyTorch计算，服务可丢弃失效响应并受并发锁保护 // 不用强杀常驻服务实现取消
- 将BODY25及SMPL映射为独立语义目标，未知置信度保持未知 // 不补成伪33点，不静默交换人物左右
- 经用户确认后按当前PMX骨长与既有物理入口提交 // 超时或API失败不改变当前姿态
- 仅按已有权限匹配或恢复相机，将HMR相机视作估计 // 不覆盖AR、编辑器或相机VMD
- 远程部署优先HTTPS或固定同源反代，正确配置CORS和浏览器本地网络权限 // HTTPS页面访问HTTP远端可能被阻止，不新增任意URL后端代理

### 门禁与范围

- 先验证独立常驻服务，再接API客户端及MMD真实骨架回归 // 不以旧报告接口正常证明双方式已经可用
- 保留旧七份JSON与本机环境，另存同输入API验证结果 // 既有坐姿与脚掌质量错误不因服务化修复
- 服务程序不依赖tmp目录、报告静态服务或MMD渲染进程 // 满足独立部署而非给试验换个地址
- GPU、远程部署、并发容量和浏览器跨域分别按实际环境验收 // 可配置不等于已测试或已上线
- 等待用户明确确认后生成服务与前端代码；获准自测后先补测试伪代码 // 本轮没有运行服务或修改生产代码

## 目录映射草案

- 将独立服务规划为单独可部署的Python目录，具体项目路径在实施前对齐 // 不直接把忽略tmp目录当生产源码
- 将API客户端与双方式面板接入现有 3rd/mmd-ar-test // 不另建替代网页应用
- 将独立接口测试与现有MediaPipe、重定向、相机回归放入项目测试体系 // 实施后优先复用npm scripts
