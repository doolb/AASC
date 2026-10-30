# HMR2.0b 网页ONNX与MMD-AR双骨骼方式

日期：2026-10-16。状态：可行性评估完成，实施待用户确认。

2026-10-19补充：用户提出独立HMR服务/API地址方案，建议优先考虑[API候选](20261019_HMR2独立API服务与MMDAR双骨骼方式.md)。本ONNX路线保留备选，两方案均未获准或开始实现；以下保留原评估，不表示当前要同时开发两条HMR部署路线。

## 需求

用户希望将HMR2.0b迁移为网页本地ONNX推理并接入MMD-AR，保留两种骨骼计算方式。本方案将两方式定义为现有MediaPipe（默认）与新增HMR2.0b（实验可选）；人物分割仍按前轮范围保留本机试验，不作为第三骨骼算法。本轮不导出、安装、推理、构建或改正式代码。

## 分阶段方案

1. 单人静态输入1×3×256×192，将ViT＋head导出为ONNX，输出SMPL24旋转、betas和相机；Python FP32→ONNX CPU验证先行。
2. 桌面WebGPU验证资源加载、数值与峰值内存，再试混合FP16。SMPL独立FP32重建，选择JS或第二小ONNX，保留BODY25足部蒙皮顶点；初版不把整个检测/重建/投影/应用打成巨图。
3. 验证通过后接MMD-AR两方式选择，MediaPipe保持默认。HMR按需加载、独立缓存/Worker与结果；切源取消旧任务、清旧参考；失败不改骨架，不静默切算法。
4. 保留骨长重定向、实际物理/PMX回读、图片叠加、明确的相机匹配/恢复与所有者边界。后续移动设备、量化和连续视频另作验收，不当首阶段保证。

## 受影响文件（计划，尚未修改）

- [本机Python参考](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/run-hmr2.py)：新增独立导出/张量基线工具，不改写七份历史结果。
- [图片UI](../../3rd/mmd-ar-test/web-human-pose-ui.mjs)、[客户端](../../3rd/mmd-ar-test/web-human-pose-client.mjs)：两方式、取消、来源/图片/PMX token隔离与加载提示。
- [默认Worker](../../3rd/mmd-ar-test/web-human-pose-worker.mjs)、[资源构建](../../3rd/mmd-ar-test/web-human-pose-assets.js)：保留MediaPipe两权重默认链，新增独立HMR资源/Worker/清单及WebGPU运行时。
- [质量规则](../../3rd/mmd-ar-test/web-human-pose-core.mjs)、[重定向](../../3rd/mmd-ar-test/web-human-pose-retarget.mjs)、[叠加](../../3rd/mmd-ar-test/web-human-pose-overlay.mjs)、[相机](../../3rd/mmd-ar-test/web-human-pose-camera.mjs)：新增原生HMR语义适配，不假造33点或逐点confidence，不直接覆盖Three相机。
- Human构建清单与定向测试：批准后将新模块纳入真实源码构建列表，并使用`npm run build:web:mmd-ar-test`，不手改web-dist；不启动接管用户服务器。

需求见[设计](../design/mmd-human-interface.md)，计划实现见[spec](../spec/mmd-human-interface.md)，中文迁移草案见[framework方案](../../.src/framework/mmd-ar-hmr2-web-inference.md)。目标为浏览器JavaScript＋ONNX，复用当前MMD-AR，不另建Unity或其他平台工程；目录映射尚为方案。

## 关键风险和未知项

- 按源码构造推算约670,459,037网络参数，FP32裸权重2,681,836,148字节、FP16理论1,340,918,074字节；这是估计而非导出文件实测。checkpoint2,709,521,501字节，去训练内容不会把网络缩成几十/几百MB。SMPL浮点数据另约19.35MB。
- 官方[大模型文档](https://onnxruntime.ai/docs/tutorials/web/large-models.html)说明protobuf2GB、Chrome单ArrayBuffer约2GB、WASM4GB等限制；externalData处理文件格式但不消除内存。实际导出算子、FP16/INT8精度、WebGPU adapter/limits、初始化/显存/缓存配额与手机兼容均待测。
- [部署文档](https://onnxruntime.ai/docs/tutorials/web/deploy.html)要求WebGPU专用bundle、JSEP及安全上下文；HTTP局域网IP不是localhost，不能承诺手机直接访问即能WebGPU推理。
- 本机Dataset实际用xyxy，但旧自选/镜像路径存在xywh混用疑点。冻结旧三图真实输入；新框显式转换并另建基线，不把裁框改变当ONNX误差，也不覆写历史候选。
- 当前JSON未保存精确输入与head参数，须新增独立数值基线。仅24关节FK不等于当前LBS BODY25，脚趾/脚跟必须保持等价。HMR没有逐点visibility/presence，必须使用独立几何可用性而非假填1。
- [代码MIT](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/vendor/4D-Humans/LICENSE.md)不能代替权重/SMPL模型许可；公开浏览器下发前须核对使用、再分发与商用范围，未默认授权发布。
- 原真人左右腿归属与动漫脚掌错误不会因ONNX迁移自动修复；不承诺遮挡关节真值、手指或视频追踪。

## 验收设计

- 同原图SHA/框/精确输入：Python→ONNX CPU→浏览器FP32→混合FP16逐级记录参数、旋转正交/det、BODY25 XYZ/XY、相机、足部方向的max/RMS；阈值在基准测量后固定，不能宣称3图量化无损。
- 按同一PMX/初始骨架检查骨长、关节限位、实际骨架回读与重投影；切方式/图/PMX及取消迟到结果不得污染目标；HMR失败不改当前骨架。
- MediaPipe默认原27项/浏览器相关回归保留；默认路径不请求HMR资产，模型缓存分源/version/hash，加载失败或显存不足显示明确原因。
- 本地GPU/缓存网络检查不上传用户图片；桌面390px交互、首轮/热推理/模型卸载、WebGPU不可用与缓存配额失败分别验收。
- 相机匹配继续验证token/revision/所有者/恢复，HMR相机只是估计与可选初值，AR/VMD/editor禁止抢占。

## 性能、工时与执行边界

仅选择HMR时加载GB级模型；模型切換时优先回收旧会话，防止HMR与渲染占满设备内存。按导出proof、SMPL数值、资源适配、UI/重定向、真实浏览器验收分里程碑；因大模型导出/算子/内存未知，初步估计1～3个工作日，不承诺当前会话一次完成或手机实时。

本轮只有只读审计及待确认文档，没有新导出模型、目标/自测代码、安装依赖、推理、测试、构建/发布、服务器控制或Offline状态修改。批准实施后按实际生产变更标记受影响产物；是否包含自测代码等待用户选择。
