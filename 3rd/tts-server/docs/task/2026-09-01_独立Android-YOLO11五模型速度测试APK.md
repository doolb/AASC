# 独立 Android YOLO11 五模型速度测试 APK

## 任务描述

使用 `/home/as` 下的 `yolo11n.pt`、`yolo11s.pt`、`yolo11m.pt`、`yolo11l.pt`、`yolo11x.pt`，参考现有 `android-rapidocr` 测试 APK，新增支持 HTTP 图片检测、网页上传和五模型速度对比的独立 Android APK。

## Design 需求

- 新增 `3rd/tts-server/android-yolo/` 独立 Kotlin/Gradle 工程。
- 构建时从 `/home/as` 读取五个 `.pt`，导出固定 640 输入的 ONNX；不把 `.pt` 或生成的 ONNX 作为源码资源提交。
- 只加载当前选中的模型，模型切换和测速时释放旧 ONNX Runtime session。
- 提供 `GET /`、`GET /health`、`GET /api/models`、`POST /api/yolo` 和 `POST /api/benchmark`。
- 内置网页支持手动上传图片、选择模型、检测框叠加和五模型速度表。
- 原生页面保留自动/大核/小核 CPU 模式选择和 HTTP 服务启停。
- 只支持 `arm64-v8a`、Android API 26+ 和受信任局域网测试。

## Spec 设计

- `YoloModelFiles` 管理五个 ONNX 资源的安全复制和完整性检查。
- `YoloPreprocessor` 负责 640x640 letterbox、RGB NCHW float 输入和坐标变换。
- `YoloPostprocessor` 负责两种 YOLO11 输出排列、置信度筛选、类别 NMS 和原图坐标映射。
- `YoloDetector` 负责按需 session 加载、释放、单模型检测和阶段耗时。
- `YoloBenchmark` 负责五模型串行预热、重复测量、P50/P95/FPS 统计。
- `YoloHttpServer` 负责图片 HTTP 协议、模型路由、测速路由、忙状态和错误返回。
- `YoloWebPage` 负责上传、检测结果绘制、模型切换和速度表。

## 受影响的功能模块和代码

### 新增代码

- `3rd/tts-server/android-yolo/` Android 工程、Kotlin 推理逻辑、HTTP 服务、网页、JNI CPU affinity 和测试。
- `3rd/tts-server/scripts/export-yolo11-onnx.py` 模型导出脚本。
- `3rd/tts-server/docs/design/android-yolo-apk.md`。
- `3rd/tts-server/docs/spec/android-yolo-apk.md`。

### 修改代码和文档

- `3rd/tts-server/package.json` 增加 YOLO 构建脚本。
- `3rd/tts-server/docs/design.md`、`docs/spec.md`、`docs/todo.md` 增加模块索引和任务状态。
- 根目录 `docs/design.md`、`docs/spec.md`、`docs/todo.md` 增加 Android YOLO 模块索引和任务状态。
- `changelog.md` 在完成后记录实现文件、构建结果和真机测速结果。

## 自测用例

1. 五个 `.pt` 权重路径存在时可以导出五个 ONNX 并完成 APK 构建。
2. 缺失任一权重或导出失败时，构建输出明确文件名和失败原因。
3. 模型文件完整复制后默认模型为 `yolo11n`，五个模型可以逐一加载和释放。
4. 640x640 letterbox 对横图和竖图输入的缩放、填充和框坐标还原正确。
5. `[1,84,8400]` 和 `[1,8400,84]` 输出可以解析，同类重叠框执行 NMS。
6. HTTP 单模型检测返回检测框、类别 ID、置信度和四阶段耗时。
7. HTTP benchmark 对 all 返回五行结果、P50、P95 和 FPS。
8. 网页可以上传图片、选择模型、显示检测框和速度表。
9. 自动/大核/小核切换和持久化有效，affinity 失败不阻断检测。
10. 非法模型、非法参数、错误 Content-Type、空图片、超大图片和并发请求返回预期错误。

## 兼容性测试

- Android 8.0+、arm64-v8a；优先验证现有 Android 9 arm64 设备。
- JPG、PNG、WebP 图片；横向、纵向和带填充区域的图片。
- Chrome、Edge 和 Android WebView 访问 APK 内置网页。
- CPU affinity 可用与不可用设备分别验证自动回退。

## 性能测试

- 固定同一张图片、置信度阈值、NMS 阈值和输入尺寸，对五个模型执行相同预热/正式轮数。
- 分别在自动、大核、小核模式记录五个模型的平均总耗时、P50、P95 和 FPS。
- 记录各模型首次加载时间和检测框数量；加载耗时不混入正式推理平均值。
- 检查切换模型后旧 session 已释放，连续 benchmark 后进程内存不持续增长。

## 风险评估

- `.pt` 导出依赖 Ultralytics/PyTorch/ONNX 环境，必须保留构建前依赖检查。
- `yolo11x` 单独加载可能触发低内存设备压力，测速按模型串行并在失败时返回模型级错误。
- 自定义训练类别数会改变输出 feature 数量，结果以类别 ID 为主，不能默认把类别 ID 映射为 COCO 名称。
- CPU 集群 sysfs 和 `sched_setaffinity` 在部分 Android 设备上不可用，只保证安全回退。
- HTTP 无鉴权并绑定所有网卡，仅用于受信任局域网。

## 预计工时

约 8 小时：模型导出和 Gradle 任务 1 小时，ONNX 推理/预处理/后处理 2.5 小时，测速统计 1 小时，HTTP/网页 1.5 小时，CPU affinity/UI 0.5 小时，测试/构建/真机验证和文档 1.5 小时。

## 执行结果

- ✅ 已完成 `3rd/tts-server/android-yolo/` 独立工程，构建脚本从 `/home/as` 读取五个 `.pt`，导出静态 640x640 ONNX，并将模型放入 APK assets；重复构建会复用未过期 ONNX。
- ✅ 已完成 HTTP 服务和内置网页：`/`、`/health`、`/api/models`、`/api/yolo`、`/api/benchmark`，网页支持手动选择图片、模型检测、框叠加和五模型测速表。
- ✅ 已完成 AUTO/大核/小核 CPU 模式和 JNI affinity；真机状态分别显示自动核心、大核和小核，检测线程能够按选择执行。
- ✅ 已验证脚本单测 2/2、Kotlin JVM 单测 16/16、debug APK 构建成功；APK 内含五个 ONNX，总体约 385 MB。
- ✅ Android 9 arm64 真机 `192.168.1.6:5555` 安装和 HTTP 验证通过；真实 `bus.jpg` 的 `yolo11n` 返回 5 个目标框。
- ✅ 准确性定性验证通过：`bus.jpg` 返回 1 辆公交车和 4 个人，置信度分别为公交车 `0.939`、人员 `0.902/0.849/0.833/0.396`；该结果只说明单图 smoke test 正常，未使用标注集计算正式准确率。
- ✅ 真机 AUTO 模式五模型测速（预热 1 次、正式 2 次）：n/s/m/l/x 平均总耗时约 `595.5/1668.5/5080.5/6556.0/13962.0 ms`，FPS 约 `1.679/0.599/0.197/0.153/0.072`。
- ✅ 2026-09-02 真机多核集合模式五模型测速（同一 `bus.jpg`，预热 1 次、正式 2 次）：大核集合 n/s/m/l/x 平均总耗时 `461.5/1306.0/4042.0/5277.5/11757.5 ms`，FPS `2.167/0.766/0.247/0.189/0.085`；小核集合平均总耗时 `1066.5/2992.0/8508.0/11086.5/23917.0 ms`，FPS `0.938/0.334/0.118/0.090/0.042`。
- ✅ 多核集合模式正式样本总推理耗时约为大核 `22.845 s`、小核 `47.570 s`；大核约为小核的 `2.03~2.31` 倍速度。模型加载时间另计，大核五模型合计约 `1.643 s`，小核约 `2.631 s`。
- ✅ 多核集合模式线程消耗核对通过：大核集合将 ORT 推理线程限制在 CPU `4-7`，小核集合限制在 CPU `0-3`；两种模式均配置 `intraOp=2`、`interOp=1`，实际最多使用 2 个同类推理线程，不会同时占满 4 个同类核心。
- ✅ 2026-09-02 真正单核心五模型测速（同一 `bus.jpg`，预热 1 次、正式 2 次）：单大核 n/s/m/l/x 平均总耗时 `1368.0/3997.0/12190.0/15533.0/34630.0 ms`，FPS `0.731/0.250/0.082/0.064/0.029`；单小核平均总耗时 `1945.0/5530.5/16874.0/21607.0/46533.5 ms`，FPS `0.514/0.181/0.059/0.046/0.021`。
- ✅ 单核心模式正式样本总推理耗时约为单大核 `67.718 s`、单小核 `92.490 s`；单大核约为单小核的 `1.34~1.42` 倍速度。模型加载时间另计，单大核五模型合计约 `1.453 s`，单小核约 `2.483 s`；两种模式均配置 `intraOp=1`、`interOp=1`，实际只使用 1 个推理核心。
- ✅ 真机 `yolo11n` 大核模式平均总耗时约 `556.0 ms`，小核模式约 `809.5 ms`；两种模式的 UI 状态和 HTTP 结果均正常。
- ✅ 修复 Android 9 的 `URLDecoder` API 兼容问题，以及类别分量误将负浮点误差当 logits 造成伪框的问题；修复后单元测试和真机检测均通过。
- ✅ 根据代码审查补充 benchmark 900 秒等待上限、执行器停止收尾和 detector 生命周期锁，避免测速超时或服务重启时旧推理交叉运行；图片先 bounds 解码检查像素上限，letterbox 缩放改用四舍五入。
