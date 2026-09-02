# 独立 Android RapidOCR HTTP 测试 APK 设计

## 功能目标

在 `3rd/tts-server` 下新增一个独立的 Android RapidOCR 测试 APK。APK 在本地加载 RapidOCR 的 ONNX 模型并启动 HTTP 服务，外部设备可以通过接口上传图片进行离线 OCR；访问 HTTP 根路径时，返回一个内置测试网页，用户可以手动选择图片并提交识别。

## 范围

- APK 独立运行，不连接 AASC 主服务器，不调用外部 OCR 服务。
- 首版只提供 HTTP 图片上传测试，不提供相册、相机和 Android 原生图片选择页面。
- HTTP 服务默认绑定 `0.0.0.0:18080`，由 APK 页面显式启动和停止。
- 根路径提供内置网页，支持选择 JPG、PNG、WebP 图片、预览图片、提交识别和显示文字框。
- `POST /api/ocr` 接收原始图片二进制，返回识别文本、置信度、文字框坐标和推理耗时。
- `GET /health` 返回模型和 HTTP 服务状态。
- 模型固定使用 RapidOCR v3.9.2 默认中文小模型组合：PP-OCRv6 检测、PP-OCRv4 mobile 方向分类、PP-OCRv6 识别及对应字典。
- 目标设备为 `arm64-v8a`、Android 8.0（API 26）及以上。
- HTTP 服务仅用于受信任局域网测试，无鉴权、无外网请求，不作为生产服务。

### 模型来源和校验值

模型与字典从 RapidAI RapidOCR v3.9.2 的默认模型配置获取，构建前固定校验 SHA-256：

| 文件 | 来源 | SHA-256 |
|------|------|---------|
| `PP-OCRv6_det_small.onnx` | `https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx` | `090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f` |
| `ch_ppocr_mobile_v2.0_cls_mobile.onnx` | `https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx` | `e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c` |
| `PP-OCRv6_rec_small.onnx` | `https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx` | `6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884` |
| `ppocrv6_dict.txt` | `https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/paddle/PP-OCRv6/rec/PP-OCRv6_rec_small/ppocrv6_dict.txt` | `b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d` |

## 技术方案

使用 Kotlin 编写独立 Android 工程，使用 ONNX Runtime Android 执行三个 OCR 模型，使用 OpenCV Android AAR 完成图片缩放、裁剪、透视变换、检测图后处理和文字框计算。图像上传由 APK 内置的极简 HTTP 服务读取，避免引入 Web 框架。

模型资源唯一源目录为 `res/models/rapidocr`。Gradle 在构建时把固定模型和字典复制到 `build/generated/assets/rapidocr`，APK 第一次启动时再以临时文件加改名的方式复制到 `filesDir/rapidocr`。模型目录完整后才初始化 ONNX Runtime session，避免中断复制留下的半文件被当作模型使用。

## CPU 核心选择

- APK 原生控制页提供“自动 / 大核 / 小核 / 单大核 / 单小核”五档，默认使用“自动”，选择结果保存在 `SharedPreferences`。
- 大核和小核通过 JNI 读取设备的 `cpu_capacity` 或 `cpuinfo_max_freq` 区分集群，再使用 `sched_setaffinity` 绑定当前线程；自动模式恢复为原始可调度 CPU 集合。
- “单大核”选择检测到的第一个大核，“单小核”选择检测到的第一个小核，两个单核模式均将当前推理线程限制为一个具体 CPU。
- RapidOCR 的模型加载线程、HTTP 接收线程和 UI 线程不绑定核心；只有 `OcrHttpServer` 的单线程推理执行器在调用 `RapidOcrEngine.recognize` 前应用所选模式，避免把 affinity 错误地应用到 Activity 线程。
- 单大核和单小核使用 ONNX Runtime `intraOp=1`、`interOp=1`；其余三档保持 `intraOp=2`、`interOp=1`。模式变化时在下一次请求前安全重建 session，使线程数配置真实生效。
- 设备无法识别集群、native 库加载失败或系统拒绝绑定时，返回明确的自动回退状态，OCR 继续使用 Android 默认调度，不把性能控制失败变成识别失败。
- 每次推理前重新应用当前模式；从大核/小核切换到自动时会解除此前的线程限制，服务重启后新的推理线程也使用当前选择。

## 组件职责

```text
MainActivity
    ├── 模型状态、CPU 模式、HTTP 端口、启动/停止按钮
    └── 后台线程调度模型加载和 HTTP 服务生命周期

CpuMode / CpuAffinity
    ├── 保存自动 / 大核 / 小核 / 单大核 / 单小核模式及 ORT 线程数
    └── 在 RapidOCR 推理线程调用 JNI affinity，失败时回退系统调度

RapidOcrModelFiles
    └── assets/rapidocr → filesDir/rapidocr 的安全复制和完整性检查

RapidOcrEngine
    ├── ONNX Runtime session 初始化和释放
    ├── PP-OCRv6 DB 文本检测
    ├── 文本框裁剪、方向分类和 180° 纠正
    ├── PP-OCRv6 CTC 文本识别和字典解码
    └── 返回排序后的 OCR 结果

OcrHttpServer
    ├── GET /：返回 OcrWebPage.HTML
    ├── GET /health：返回模型、服务和推理状态
    └── POST /api/ocr：校验图片、设置推理线程 affinity、按模式配置 ORT 并调用 RapidOcrEngine

OcrWebPage
    └── 图片选择、预览、上传、文字结果和文字框叠加显示
```

## HTTP 协议

### `GET /`

返回 `text/html; charset=utf-8`。网页不依赖外部 CSS、JavaScript 或网络资源，包含图片选择、预览、识别按钮、原图文字框叠加层、识别文本、置信度和耗时。

### `GET /health`

返回 JSON：

```json
{
  "modelReady": true,
  "httpRunning": true,
  "engine": "rapidocr",
  "busy": false
}
```

### `POST /api/ocr`

请求体是图片原始二进制，支持以下 Content-Type：

- `image/jpeg`
- `image/png`
- `image/webp`

单次请求体上限为 20 MiB，单次识别最多等待 60 秒。识别期间只允许一个请求进入模型，其他请求返回 HTTP 409。

成功返回：

```json
{
  "success": true,
  "text": "识别出的全部文字",
  "elapsedMs": 123,
    "imageWidth": 1280,
    "imageHeight": 720,
    "affinityStatus": "单大核（核心 4）",
    "boxes": [
    {
      "text": "识别出的文字",
      "score": 0.98,
      "points": [[10, 20], [200, 20], [200, 60], [10, 60]]
    }
  ]
}
```

错误返回统一使用 `{ "success": false, "error": "..." }`。模型未就绪返回 503，Content-Type 不支持返回 415，图片为空或无法解码返回 400，模型忙返回 409，推理超时返回 504。

## 线程和资源生命周期

- 模型加载、图片解码、OpenCV 处理和 ONNX 推理均不在主线程执行。
- CPU affinity 只作用于单线程推理执行器的当前线程，模式切换和 affinity 失败不改变 OCR 正确性。
- 单核模式将三个 ORT session 的 intra-op 线程设为 1；模式切换时由引擎在推理锁内重建 session，避免旧 session 继续使用多线程配置。
- HTTP 客户端使用固定大小线程池；模型推理使用单独的互斥状态，禁止并发使用同一组 session。
- 每次请求处理结束后释放 Bitmap、Mat、tensor buffer 和临时字节引用。
- Activity 销毁时先停止 HTTP 服务，再释放推理 session 和后台线程池。
- HTTP 服务停止后关闭 ServerSocket，并拒绝新的请求；已断开的客户端不再回写错误。

## 安全和兼容性边界

- Manifest 必须声明 `INTERNET`，该权限仅用于监听本地 HTTP 端口；APK 不主动访问外部网络。
- 服务绑定所有网卡且无鉴权，只允许在用户信任的局域网中使用。
- 只打包 `arm64-v8a`，非 arm64 设备不属于验收范围。
- 图片解码在进入 OCR 前限制像素总量为 12 MiB（`12 * 1024 * 1024`），防止超大图片造成内存异常；原图尺寸和缩放比例返回给网页用于坐标叠加。

## 验收标准

1. `npm --prefix 3rd/tts-server run build:android-rapidocr` 成功生成 `android-rapidocr/app/build/outputs/apk/debug/app-debug.apk`。
2. Android JVM 单元测试覆盖模型文件清单、Content-Type 校验、JSON 转义、图片大小限制、HTTP 根路径和 health 接口。
3. 安装 APK 后，模型加载成功，启动 HTTP 服务后可以从同一局域网访问根网页。
4. 网页选择图片后可以完成上传并显示 OCR 文本、耗时、置信度和文字框。
5. `curl` 直接向 `/api/ocr` 上传 JPG/PNG/WebP 可以得到结构化 JSON。
6. 无网络状态下，已安装 APK 仍可以加载模型并完成识别。
7. 原生页面可以在自动 / 大核 / 小核 / 单大核 / 单小核之间切换并保留选择；单核模式使用一个 ORT intra-op 线程，affinity 失败时仍能返回结果。
8. 空请求、错误 Content-Type、空图片、超大图片、模型未就绪、并发请求和超时均返回可理解的 HTTP 状态及 JSON 错误。

## 风险

- RapidOCR 官方 Android 示例和模型版本存在时间差，ONNX 输出形状、预处理均需要使用固定模型做真机验证。
- OpenCV 和 ONNX Runtime 会增加 APK 体积，首版优先保证识别链路正确，暂不做 native 库裁剪。
- DB 检测后处理、透视裁剪和 CTC 解码均是模型强相关逻辑，JVM 单测覆盖纯逻辑，arm64 真机已用 PNG 文字图和 APK 截图完成基础验收。
- CPU 核心名称依赖设备 sysfs 能力和 Linux affinity 权限；无法识别或绑定时只能保证自动调度，不能宣称目标核心一定生效。
- HTTP 无鉴权且绑定 `0.0.0.0`，仅适合受信任局域网测试。
