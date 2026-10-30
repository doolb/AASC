# HMR2.0b独立API服务与MMD-AR双骨骼方式

日期：2026-10-19。状态：方案待用户确认，未实现。

## 需求与路线

用户询问HMR2.0b能否作为独立服务，通过API调用，并在界面填写API地址。建议优先采用原生Python常驻HMR推理服务，MMD-AR保留MediaPipe浏览器本地与HMR2.0b API两方式。前轮[浏览器ONNX方案](20261016_HMR2网页版ONNX与MMDAR双骨骼方式.md)保留为备选，未获准或开始实施；不是将API接口冒充本地ONNX。

需求见[Human设计](../design/mmd-human-interface.md)，协议与操作门禁见[Human spec](../spec/mmd-human-interface.md)，中文方案见[API伪代码](../../.src/framework/mmd-ar-hmr2-api-service.md)。

## 现有接口与差距

[本机试验接口](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/custom-report-server.cjs)仅监听127.0.0.1随机端口，依赖报告静态服务；`POST /api/hmr2-custom`接浏览器PNG和`x-person-box`，每请求spawn Python、重新加载模型、写临时图/输出再清理，不是独立可配置地址的常驻服务。当前没有通用CORS/OPTIONS、协议版本/health及生产MMD-AR接入。

[Python参考](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/run-hmr2.py)已有模型/LBS/BODY25/相机流程，但模型加载和单次CLI合在main，需提取可复用predictor。现有Dataset的xyxy与自选/镜像xywh混用问题应在新接口明确规范化，不覆写旧七份结果冒充一致。

## 推荐实现范围

1. 独立Python服务，模型启动时加载一次，串行或有界排队；CPU可运行，CUDA须相应部署环境。源码/锁定依赖/启动说明独立，生产服务不依赖tmp、报告或MMD网页进程；模型路径外部配置，不提交权重，不打入APK。
2. 拟定`GET /health`：返回协议、模型版本、ready/device/输入限制；拟定`POST /v1/hmr2/predict`：上传图片与可选人物框，返回原生BODY25二维/三维、SMPL24姿态、相机及耗时。明确requestId、坐标系、单位、图尺寸和框格式，不输出伪造confidence。
3. MMD-AR图片面板增加“MediaPipe（本地）/HMR2.0b（API）”、API服务根地址、测试连接、可选API Key。地址作为当前浏览器偏好保存，密钥默认不持久化；若控制端远程配置显示端，复用AASC配置消息/持久化/广播，不新增HTTP配置读写接口。
4. MediaPipe默认、本地33点链和缓存不变；HMR分支只发往配置服务，不加载浏览器GB级HMR。切源/地址/图片/PMX时取消等待、清旧参考并隔离迟到结果；服务超时/失败/畸形响应不改当前骨架。
5. 原生BODY25/SMPL独立语义适配，按PMX真实骨长应用，经既有物理入口提交；相机保留所有者/token/revision/恢复。人物分割仍只保留原本试验，不作为第三骨骼模式。

## API及安全约束（拟定）

- 只接上传图，不接服务端文件路径或任意图像URL；PNG/JPEG等支持范围由部署契约确定。限制编码字节、实际解码尺寸、人物框、排队和超时，错误响应结构化；首次只承诺单人图片。无框按全图人物裁框，不等于具有可靠无人检测；多人可复用原有MediaPipe选人或人工框，不新加已清理的人物模型。
- 默认localhost；LAN/远程监听、允许Origin与token需显式配置。支持跨域预检，CORS不能代替认证；公网推荐HTTPS及鉴权，不做任意URL后端代理。
- 图片会上传到用户填写的服务，不再是纯本地识别；界面须明确目标地址/隐私提示，测试连接不上传图片，默认不留存上传图，不将图片/token写日志。
- 手机的127.0.0.1指手机本身，访问电脑服务应填电脑LAN域名/IP；HTTPS页面访问HTTP远端、CORS/本地网络权限等可能阻拦，需按实际部署验证，不能靠前端绕过。
- AbortController停止客户端等待不保证即时中断PyTorch；服务可继续当前计算再丢弃断开的结果，不强杀模型进程，队列有界防重复占用。
- 程序开源许可、HMR/SMPL使用许可与模型准备仍需核对。服务端计算不向浏览器分发权重，但不因此默认获得公开/商用服务授权。原始左右腿/脚掌质量偏差继续披露。

## 预计受影响模块（尚未改代码）

- 新增独立服务、predictor封装、依赖锁/示例配置/部署说明；具体生产目录确认时按现有工程对齐，旧tmp报告保留不作为生产唯一源码。
- [图片UI](../../3rd/mmd-ar-test/web-human-pose-ui.mjs)、[现有客户端](../../3rd/mmd-ar-test/web-human-pose-client.mjs)：服务地址、测试连接、网络请求/取消、两方式及来源隔离；新增专用API客户端，不改默认MediaPipe Worker张量契约。
- [重定向](../../3rd/mmd-ar-test/web-human-pose-retarget.mjs)、[叠加](../../3rd/mmd-ar-test/web-human-pose-overlay.mjs)、[相机](../../3rd/mmd-ar-test/web-human-pose-camera.mjs)和质量适配：BODY25与模型置信度分开，不用33点补位骗旧校验。
- Human真实构建列表、必要npm启动/测试入口与定向测试；批准后优先现有`npm run build:web:mmd-ar-test`/测试脚本，不手改web-dist。

## 验收设计

- Python同图/同框常驻API的BODY25/投影/相机与独立参考对照，模型加载次数为1，多次请求有限值；另存结果，不覆盖七份JSON。
- health不推理或上传、版本/模型/ready检查；无效图/框/超限/授权/Origin/OPTIONS/并发/超时与断开分别检查。
- 浏览器实际输入/保存API地址、无密钥泄漏、测试连接、PNG请求与响应校验；跨域服务与固定同源部署分别验证。
- 取消/切源/切API/图/PMX时迟到结果不污染参考和实际目标；API失败保持当前骨架，MediaPipe仍可独立识别，默认不联系API。
- 同PMX/真实骨长/物理回读/图片叠加/相机所有者与恢复回归；桌面窄屏和手机连通另验，不宣称服务化改善姿态质量。
- 分开记录模型加载、排队、上传、推理、总延时、常驻/峰值RAM及GPU内存。既有CPU耗时不能直接当服务吞吐；有界并发与实际内存预算再定容量。

## 工时与确认项

按服务封装与数值、协议/安全、界面/语义、真实浏览器回归分里程碑，初估1～3个工作日，依赖CPU/CUDA环境、跨域部署与现有骨架适配，不作固定完工保证。确认API路线后再细化生产目录与依赖；服务目标先以本机CPU可运行为基线，远程/GPU部署不擅自执行；是否生成新增自测代码待用户选择。

本轮只读核对和文档，没有服务源码、依赖安装、推理、测试、构建/部署、服务器启动或进程操作；Offline发布状态未变。没有新目标代码提交/推送，已有用户/远端同步改动保持。
