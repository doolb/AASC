# HMR2 独立 Python GPU 服务使用

2026-10-21：本机源码与资源已准备，GPU/API自测及50连续真实HTTP请求通过；正式服务尚未启动。入口为[hmr2_gpu_service.py](<E:/ai/ai-depthmap/hmr2_gpu_service.py>)，配套模型与纯Python runtime已放在同一深度项目下，正常启动不再依赖原Web MediaCenter临时目录。

## 启动（用户手动执行）

PowerShell，可从任意工作目录执行：

```powershell
& 'E:\ai\ai-depthmap\python\python.exe' -X utf8 -B 'E:\ai\ai-depthmap\hmr2_gpu_service.py'
```

默认 `http://127.0.0.1:8768`，单次加载HMR2.0b，网络、SMPL和相机均CUDA FP32、禁止TF32/AMP，不提供FP16或CPU回退。启动资源缺失/没有可用CUDA会报错；GPU常驻约2.5～2.7GiB Torch分配，驱动/库开销和其他GPU程序另计。Ctrl-C退出；本轮AI不自动启动或接管正式服务。

只检查资源/CPU协议（不加载CUDA、不监听）：

```powershell
& 'E:\ai\ai-depthmap\python\python.exe' -X utf8 -B 'E:\ai\ai-depthmap\hmr2_gpu_service.py' --check
& 'E:\ai\ai-depthmap\python\python.exe' -X utf8 -B 'E:\ai\ai-depthmap\hmr2_gpu_service.py' --self-test
```

`--self-test`仅标准库资源/AST/bbox/base64自测，**不等于GPU或HTTP验收**；完整验收见[服务任务](../task/20261021_HMR2独立PythonGPU服务.md)。本次9hot引擎耗时中位198.805ms（188.278～227.880），含图像预处理但不含HTTP base64/JSON/传输；引擎热测峰allocated2.6259GiB，混合直接/HTTP验收最终health峰2721.931MiB、reserved2800MiB，纯HTTP50次峰2688.931MiB/reserved2768MiB。调用上下文/库与驱动可额外占用，不将单个Torch数字当进程全GPU显存。

## 网页测试

在**手动启动上述Python服务后**，浏览器打开 `http://127.0.0.1:8768/`；这是同源提供的[hmr2_test.html](<E:/ai/ai-depthmap/hmr2_test.html>)，不要直接双击以 `file://` 打开（没有服务nonce，且无法同源请求GPU接口）。页面不会额外启动服务或加载另一个模型。**若你此前已手动运行旧版Python进程**，请自行用Ctrl-C停止旧进程、执行上面的启动命令后刷新此页；未重启的旧进程还没有`GET /hmr2-three.js`，右侧只能使用明确标注的2D降级视图。AI没有停止、替换或接管用户进程。

页面显示“上传选择图片：”“未选择任何文件”“粘贴图片”“也可 Ctrl+V / ⌘V”。可选本机图片，也可点击粘贴按钮并授权浏览器读取剪贴板，或直接使用Ctrl+V/⌘V。选图/粘贴只在本地预览，**点击“运行推理”才会上传到当前这个Python服务**；仅接受PNG/JPEG/WebP/BMP、单图≤16MiB/4000万像素。拖拽预览图可选人物xyxy框，点“清除人物框”后整图fallback；服务不自动检测人物。结果显示原图BODY25线框、右侧原版样式3D关节骨骼、GPU/FP32/耗时与可展开的完整JSON。右侧暗底3D栏复用旧对照页的受光圆柱/球形关节（人物左侧蓝、右侧橙、中心浅色）：按住拖动旋转，双击复位；调整视角完全在浏览器本地进行，**不会再发送GPU请求**。窄屏上3D显示在图片下方；新图片或改人物框会清除旧骨骼，须重新运行推理。浏览器与后端EXIF定向尺寸不一致时警示，不错误叠加坐标。Three.js 0.160模块和MIT许可在服务文件同目录，`GET /hmr2-three.js`只提供这个固定模块，不依赖CDN；若WebGL/模块不可用，前端会提示并尝试降级为可拖动的2D线条/圆点，不会将它标为受光3D；**这一异常降级分支尚未做禁用WebGL的独立Chrome故障注入**，本次通过的是正常WebGL主路径。

默认loopback无需口令；如果手动设置了`HMR_API_TOKEN`，网页公开静态文件本身无隐私内容，但请求`/infer`/`/health`仍需Bearertoken，请在页面令牌框填写（仅当前页面内存，不保存在URL或localStorage）。本页直接同源调用，无需`--cors-origin`；从**其他**站点调用仍按显式CORS白名单。剪贴板按钮通常仅localhost或HTTPS安全上下文可用；普通HTTP局域网访问可能只能用快捷键粘贴。HTTP明文LAN令牌与图片可能被同网设备窃听，不要直连公网；代理TLS需自行配置。当前仅为本地独立服务测试页，不是AASC/MMD正式网页或ONNX浏览器推理。

## 接口

- `GET /health`：ready/model/device/precision/loadCount/busy/modelLoadMs与Torch显存信息。
- `POST /infer`：JSON，Content-Type为application/json或application/json;charset=utf-8，必须Content-Length；键只允许image_base64、bbox_xyxy。

```json
{"image_base64":"<图片base64或data:image/png;base64,...>","bbox_xyxy":[10,15,226,299]}
```

框是**定向后的原图像素xyxy** `[左,上,右,下]`，不是xywh、不加1；必须在图内且宽高非零。OpenCV一次解码三通道BGR并应用其EXIF策略，原生ViTDetDataset256方图只裁左右32得到256×192。省略框会使用整张图并返回 `bboxSource=full_image_fallback`，**不是自动检测人物**；背景多/多人图建议调用方传正确人物框。不支持bbox null、服务器image_path、URL下载、请求改dtype/model路径。

Python标准库调用示例（在服务已手动启动后）：

```python
import base64, json, urllib.request
from pathlib import Path
payload = {"image_base64": base64.b64encode(Path(r"E:\ai\ai-depthmap\xiaotan_1.png").read_bytes()).decode("ascii")}
# 若已知人物框：payload["bbox_xyxy"] = [left, top, right, bottom]
request = urllib.request.Request("http://127.0.0.1:8768/infer",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(request, timeout=60) as response:
    result = json.load(response)
print(result["device"], result["precision"], result["xyz"])
```

结果type为hmr2.result/schemaVersion1，主要字段：

|字段|含义|
|---|---|
|xyz / xy|BODY25顺序25×3本地SMPL XYZ米 / 25×2原图XY像素|
|names / edges|左右明确的BODY25标签与连线；原生不交换左右|
|rotations24 / betas10|原24×3×3旋转矩阵 / 10个体型参数，不修正正交性|
|predCam / cameraTranslation|网络crop相机 / 转换后相机平移米|
|camera / projection / cameraDepth|平移、focalLengthPx、主点、25点相机深度|
|imageSize / boxXYXY / bboxSource|[W,H]、实际框、supplied或full_image_fallback|
|inputTensorSha256|最终256×192 CPU FP32输入的字节SHA，便于确认同输入|
|timingMs|预处理、上传、网络、LBS、投影、下载、total、modelLoad；同步墙时不是CUDA事件时间|
|memory|Torch allocated/reserved/峰值与动态全局deviceFreeMiB；不是进程全GPU总占用|

原生XYZ与cameraTranslation分开；如需相机系坐标，用xyz+cameraTranslation，不把相机平移当骨架局部改变。结果不是姿态真值或已修复脚掌问题。

错误均结构化JSON：400坏JSON/base64/bbox/未知字段；411缺Content-Length；413请求/图片/像素超限；415非JSON；503GPU忙/资源或GPU不可用；500推理无效或内部错误。GPU只串行推理，忙时直接503，调用方可适当退避重试，不能以并发换速度。

## 限额与LAN/浏览器

默认请求24MiB、解码图片16MiB、40M像素；CLI可显式调整 `--max-request-mib`、`--max-image-mib`、`--max-pixels`。GPU序号默认0，线程4，端口8768；可 `--gpu-index`、`--threads`、`--port`。

默认仅loopback。非loopback绑定必须token；如确需LAN，用强随机令牌环境变量而不是硬编码：

```powershell
$env:HMR_API_TOKEN = '<自行生成并保密的强随机令牌>'
& 'E:\ai\ai-depthmap\python\python.exe' -X utf8 -B 'E:\ai\ai-depthmap\hmr2_gpu_service.py' --host 0.0.0.0
```

除公开且无私有数据的 `GET /` 测试页外，实际GET /health与POST /infer带`Authorization: Bearer <token>`；默认无跨域允许。浏览器调用可显式 `--cors-origin http://127.0.0.1:3000`，禁止通配符；允许来源的合法OPTIONS预检不需token，实际请求仍需。非白名单Origin不授予Access-Control-Allow-Origin；持正确token的直接GET可能200但浏览器不能跨域读，非白名单OPTIONS为403。HTTP无TLS，仅受信本机/LAN或置于合适认证/TLS代理之后；不建议公网直接暴露。不新增HTTP配置读取/写入、自动检测模型、Web MediaCenter/AASC/MMD前端接线或发布产物。

资源复制包含现有HMR代码/五纯包许可证，模型仅本机已许可使用，不把CPU Torch/site-packages复制过来、不变更安装包。原深度脚本/旧CPU和GPU对照保持，后续不用GPU服务时只退出该服务，不影响原深度脚本。
