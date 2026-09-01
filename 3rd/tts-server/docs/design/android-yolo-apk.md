# 独立 Android YOLO11 五模型测速 APK 设计

## 功能目标

在 `3rd/tts-server` 下新增独立的 Android YOLO11 测试 APK。APK 使用 `/home/as` 下的五个 YOLO11 `.pt` 权重，在构建阶段转换为 ONNX，安装后通过 ONNX Runtime 在手机本地执行目标检测。HTTP 根路径提供内置网页，支持手动上传图片、选择模型、查看检测框，并对五个模型进行统一多轮速度测试。

## 范围

- APK 独立运行，不连接 AASC 主服务器，不调用外部推理服务。
- 支持 `yolo11n.pt`、`yolo11s.pt`、`yolo11m.pt`、`yolo11l.pt`、`yolo11x.pt`。
- 构建脚本从 `YOLO11_MODEL_DIR` 读取 `.pt`，默认读取 `/home/as`，导出到 Gradle 生成的 assets；`.pt` 和生成的 ONNX 不提交到 Git。
- 首版只提供 HTTP 图片上传测试，不提供相册、相机和原生图片选择页面。
- HTTP 服务默认绑定 `0.0.0.0:18081`，由 APK 原生页面显式启动和停止。
- 根路径提供单文件网页，支持 JPG、PNG、WebP 预览、模型选择、检测和五模型测速。
- `POST /api/yolo` 执行单模型目标检测，`POST /api/benchmark` 对指定模型或全部五个模型执行测速。
- 目标设备为 `arm64-v8a`、Android 8.0（API 26）及以上。
- HTTP 服务仅用于受信任局域网测试，无鉴权、无外网请求，不作为生产服务。

## 技术方案

使用 Kotlin 编写独立 Android 工程，使用 ONNX Runtime Android 执行 YOLO11 检测，使用 Android `Bitmap` 完成图片解码、letterbox 预处理和结果坐标映射，不引入 OpenCV。Gradle 的 `prepareBundledYoloModels` 任务调用仓库内的 Python 导出脚本，把五个 `.pt` 转换为固定输入尺寸 `640x640` 的 ONNX 文件并复制到 `build/generated/assets/yolo11`。

APK 第一次启动时将五个 ONNX 文件以临时文件加改名的方式复制到 `filesDir/yolo11`。应用一次只加载一个模型；模型切换和五模型测速在同一个单线程推理执行器中依次释放旧 session、加载新 session，避免同时持有五个模型导致手机内存峰值过高。

## 模型转换和资源边界

- 输入文件：`/home/as/yolo11n.pt`、`yolo11s.pt`、`yolo11m.pt`、`yolo11l.pt`、`yolo11x.pt`。
- 可通过 `YOLO11_MODEL_DIR` 覆盖输入目录，便于其他机器构建。
- 导出参数固定为 ONNX、`imgsz=640`、静态输入尺寸、CPU 导出、简化图；首版不默认 INT8 量化，避免量化误差影响速度和结果对比。
- 导出任务支持复用更新时间不早于 `.pt` 的非空 ONNX 文件，重复构建不重新加载 Ultralytics；源权重更新后自动重新导出。
- 资源复制任务校验五个 ONNX 文件均为普通文件且长度大于零；任一模型缺失时 APK 保持未就绪并显示明确错误。
- 模型任务限定为 YOLO11 目标检测权重；分割、姿态和 OBB 权重不在本次验收范围。

## 推理和测速

- `YoloModelFiles` 管理五个模型的资产名、显示名和私有目录复制。
- `YoloPreprocessor` 将图片等比例缩放到 `640x640` letterbox，填充灰色，转换为 RGB、NCHW、`0..1` 的 float 输入，并保存缩放比例和边距。
- `YoloPostprocessor` 兼容 YOLO11 ONNX 的 `[1,84,8400]` 和 `[1,8400,84]` 两类排列，读取四个框参数和类别分数，按置信度过滤、按类别执行 NMS，并把框映射回原图。
- 由于本项目导出脚本使用 Ultralytics 检测导出路径，类别分量已经完成 sigmoid；后处理只将类别分数限制在 `0..1`，不对负值逐项做 sigmoid，避免 Android 设备浮点误差造成伪框。
- 图片先通过 `BitmapFactory.Options.inJustDecodeBounds` 检查尺寸，再实际解码并复核像素上限，避免压缩图片在边界检查前分配超大 Bitmap。
- 单次检测返回模型名、检测数量、框列表和预处理/推理/后处理/总耗时。
- 速度测试先对每个模型执行指定次数预热，再执行指定次数正式测量；预热结果不计入平均值。
- 每个模型的结果分别统计模型加载耗时、平均预处理耗时、平均 ONNX 推理耗时、平均后处理耗时、平均总耗时、P50、P95 和 FPS。
- 五模型测速始终串行执行，单张图片和相同阈值用于所有模型；测速期间其他推理请求返回 HTTP 409。检测、测速和资源释放共享 detector 生命周期锁，服务停止或重启时不会让旧任务与新任务交叉操作 ORT session。

## CPU 核心选择

- 原生控制页提供“自动 / 大核 / 小核”三档，默认使用“自动”，选择结果保存到 `SharedPreferences`。
- JNI 读取 `cpu_capacity` 或 `cpuinfo_max_freq` 区分大小核，并用 `sched_setaffinity` 绑定当前 YOLO 推理线程。
- UI、HTTP 接收、模型复制和模型加载线程不绑定核心；只有单线程推理执行器在每次检测或测速模型轮次开始前应用所选模式。
- 无法识别集群、native 库加载失败或系统拒绝绑定时回退到系统调度，性能控制失败不影响检测结果。

## HTTP 和网页

### `GET /`

返回内置 HTML，包含模型选择、图片选择、检测按钮、五模型测速按钮、结果图片和检测框叠加层。网页不依赖外部脚本、样式或网络资源。

### `GET /health`

返回模型目录是否就绪、HTTP 是否运行、当前模型、服务是否忙和引擎名称。

### `GET /api/models`

返回五个模型的名称、显示名、文件名以及当前是否为活动模型。

### `POST /api/yolo?model=yolo11n`

请求体为图片原始二进制，支持 JPG、PNG、WebP。查询参数缺省时使用当前模型，首次使用默认 `yolo11n`。

### `POST /api/benchmark?models=all&warmup=2&runs=10`

请求体与单模型检测相同。`models` 支持 `all` 或逗号分隔的模型名；`warmup` 范围为 0..10，`runs` 范围为 1..50。返回所有模型的测速明细和测试参数。

所有图片请求限制为 20 MiB，解码后的像素数限制为 `12 * 1024 * 1024`；错误统一返回 `{ "success": false, "error": "..." }`。五模型默认 `warmup=2`、`runs=10`，HTTP 测速等待上限为 900 秒；停止服务时先中断执行器并等待短暂收尾，未结束的任务继续保持 busy 状态直到 finally 完成。

## 组件职责

```text
MainActivity
    ├── 模型资源状态、CPU 模式、HTTP 端口和服务生命周期
    └── 后台线程调度资源复制、模型引擎初始化和 HTTP 服务

CpuMode / CpuAffinity
    ├── 保存自动 / 大核 / 小核模式
    └── 在 YOLO 推理线程调用 JNI affinity，失败时自动回退

YoloModelFiles
    └── assets/yolo11 → filesDir/yolo11 的安全复制和完整性检查

YoloPreprocessor / YoloPostprocessor
    ├── 图片 letterbox、RGB NCHW float 输入
    ├── YOLO11 输出排列解析和类别分数读取
    └── NMS、坐标还原和检测结果限制

YoloDetector
    ├── ONNX Runtime session 按模型加载/释放
    ├── 单模型检测和阶段耗时
    └── 五模型串行 benchmark

YoloHttpServer
    ├── GET /、/health、/api/models
    ├── POST /api/yolo
    └── POST /api/benchmark

YoloWebPage
    └── 图片上传、模型切换、检测框绘制和速度表格
```

## 验收标准

1. `npm --prefix 3rd/tts-server run build:android-yolo` 能从五个 `.pt` 生成并构建 APK。
2. JVM 单元测试覆盖模型清单、letterbox、输出排列解析、NMS、测速统计、JSON 和 HTTP 路由。
3. 安装 APK 后五个模型资源均可校验，默认加载 `yolo11n`，模型切换不会同时保留多个 session。
4. 网页选择图片后可以选择任一模型检测并显示框、类别 ID、置信度和耗时。
5. `/api/benchmark?models=all` 对五个模型返回完整耗时和 FPS 对比。
6. 自动、大核、小核三种 CPU 模式可以切换并持久化，绑定失败时检测仍成功。
7. 空请求、错误 Content-Type、超大图片、非法模型名、非法测速参数和并发请求均返回明确错误。

## 实现状态

- 已完成独立 `android-yolo` 工程、五模型 ONNX 构建资源、ONNX Runtime 推理、HTTP API、内置网页、CPU 大核/小核选择和对应 JVM 单元测试。
- 已在 Android 9 arm64 真机完成 APK 安装、网页根路径、模型列表、健康检查、真实图片检测和五模型测速；查询参数解码使用 Android 低版本兼容的 charset 名称重载。

## 风险

- `.pt` 转 ONNX 依赖构建机的 Ultralytics、PyTorch 和 ONNX 导出环境；构建脚本必须提前检查依赖并输出可读错误。
- 五个 ONNX 模型虽然不同时加载，但 X 模型单独加载可能超过低内存设备可用内存；HTTP 层需在 session 加载失败时返回明确错误。
- YOLO11 输出张量和自定义类别数量强相关；首版只处理标准检测输出，并以类别 ID 为主，未知类别不阻断检测。
- Android CPU affinity 受厂商内核权限和 sysfs 文件影响，只能报告实际回退状态，不能保证所有设备都能绑定目标集群。
- HTTP 无鉴权且绑定 `0.0.0.0`，仅适合受信任局域网测试。
