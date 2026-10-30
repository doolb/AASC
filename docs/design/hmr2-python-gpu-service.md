# HMR2 独立 Python GPU 服务

2026-10-21，独立服务已实现并通过本机GPU/API验收，随后同源网页版测试页也已通过本机Chrome/GPU验收。用户确认复制本机模型和必要依赖，正式服务未启动，由用户手动执行。入口：[hmr2_gpu_service.py](<E:/ai/ai-depthmap/hmr2_gpu_service.py>)，测试页：[hmr2_test.html](<E:/ai/ai-depthmap/hmr2_test.html>)。

## 需求、布局与边界

在用户深度项目下提供一个独立Python服务入口，使用该目录CUDA Python与选定FP32。主入口含模型生命周期、预处理、HTTP、CLI和CPU自测；模型/依赖单独存储，不把它称为无依赖单文件模型。

```text
E:\ai\ai-depthmap\hmr2_gpu_service.py
E:\ai\ai-depthmap\models\hmr2\hmr2.0b.ckpt
E:\ai\ai-depthmap\models\hmr2\model_config.yaml
E:\ai\ai-depthmap\models\hmr2\data\smpl_mean_params.npz
E:\ai\ai-depthmap\hmr2_runtime\{hmr2,einops,timm,yacs,smplx,omegaconf}
E:\ai\ai-depthmap\hmr2_runtime\licenses\
```

本机既有资源复制524文件、2,720,583,552字节；checkpoint 2,709,521,501字节/SHA c9ea09c834161468638c9de7a782c614e300c622709bf52967274c543ec72fcf，复制一致。未下载/安装/移动旧模型，纯包及许可证位于服务旁，不改目标Torch/vision或复制整CPU site-packages。正常运行不再依赖Web MediaCenter临时目录。

只做外部Python服务：不修改原深度CLI、AASC/MMD前端或正式API接线、ONNX、自动检测模型、AMP/FP16、Web/Offline产物、用户服务进程或Git发布。项目既有package scripts没有此Python服务任务，采用目标解释器完成。

## 生命周期与原生数值

HMR2Engine.load幂等，先验证本地资源/实际GPU Python包来源，缺CUDA拒绝而不回退CPU。采用mmap checkpoint/meta构造/strict assign，再一次转CUDA FP32，SMPL原8个shape与BODY25索引检查；constructor临时CPU linspace后恢复，backbone.train(False)不链式调用。网络/6D原生decode/SMPL LBS/相机投影均FP32，eval/inference、4线程、seed42、确定性、禁TF32/AMP。

只跳过训练/渲染package初始化，原backbone/head/dataset/utils/geometry/lbs保留不改；相机公式由renderer AST提取，不引入OpenGL/pyrender。cv2一次解码BGR三通道，Pillow仅验证尺寸；原Gaussian/affine/normalize，256方crop后仅左右各32得到256×192，配置256/原mean/std与[192,256] bbox shape。新API明确解码定向后的像素xyxy，不延续旧runner xywh校验歧义或重写旧缓存。

## HTTP与保护

标准库ThreadingHTTPServer；默认127.0.0.1:8768，单模型常驻、非阻塞GPU锁，忙503；GET /health、POST /infer，JSON image_base64（可data URI）和可选bbox_xyxy，未知字段/显式null框拒绝。无框整图fallback显式标记，不冒充人物检测；输出BODY25 XYZ米/XYpx、原24旋转/10betas、crop/full camera、深度、输入SHA、同步引擎耗时与分项Torch显存。

默认请求24MiB/图16MiB/40M像素；长度/类型/finite/框边界、重复字段、transfer encoding与预检验证，socket15s超时，错误JSON不泄漏图/token/本机路径。非loopback必须token，除公开静态测试页GET /外，实际GET /health与POST /infer均需Bearer，精确CORS来源且禁通配符；合法白名单OPTIONS免Bearer。非白名单授权GET可200但无ACAO，浏览器不能跨域读；非白名单预检403。无HTTP配置读写，只有启动CLI参数。

## 同源测试网页（2026-10-21 已实现并通过验收）

用户进一步要求选择上传图片、按钮粘贴图片、Ctrl+V/⌘V、测试结果可视化。新增目标同目录的 `hmr2_test.html`，在现有Python服务 `GET /` 原站点提供，不增加Node/Flask或第二个端口；页面同源调用现有 `/infer`（`/health` 原接口保持可用），只有点击运行才上传选定图像。预览上拖出原图像素xyxy人物框，没有框时明确显示整图fallback而非自动检测；BODY25原图XY与edges画可视骨架并显示FP32/GPU/耗时及只读原始JSON。浏览器/后端对EXIF方向解释尺寸不一致时警示且不错误叠加。

网页静态HTML无需Bearer即可取得（只含固定前端代码、不含密钥/用户图片）；原`/health`与`/infer`的Bearer、CORS和请求限额不变。HTML从程序自身同目录固定文件读取，不提供任意文件路由；随机脚本nonce/CSP/no-store/禁框架及外站资源限制脚本执行。令牌只存在当前浏览器页输入框内，不放在URL/localStorage或服务端日志；剪贴板按钮在非安全上下文可能不受支持，仍给键盘粘贴路径。文档中的“不实现Web产物”指Web MediaCenter/AASC/Offline生产页面，不排斥这个本机外部服务的独立测试页。正式服务仍由用户手动启动，AI仅在自有临时loopback服务上验收。

实际HTML按图像头检查PNG/JPEG/WebP/BMP、16MiB/40M像素，按请求替换唯一脚本nonce，浏览器结果文本采用textContent以阻止XSS；截图中的Canvas绘25点，只标七个关键点降低遮挡。固定GET /无Bearer可取公共页面，POST /infer或GET /health按原token校验，网页按钮不需要额外CORS白名单。CPU15项协议/安全通过，Puppeteer真实Chrome两次GPU POST（供人物框与整图回退）、合成paste和替身clipboard.read按钮、两个仅浏览器异常模拟及390px横向布局通过；系统级剪贴板授权与LAN TLS仍须用户实际环境确认。旧精确冻结输入重放6字段差0，受保护570文件与75包版本保持，单模型loadCount1。实际结果与[完整截图](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-hmr2-web-ui/hmr2-browser-desktop.png)见[网页任务](../task/20261021_HMR2网页版图片上传与粘贴测试.md)。

## 追加：右侧可旋转3D骨骼（2026-10-21 已实现，Chrome/GPU已验收）

原[本机图片骨骼对照](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/report.html)由[report.mjs](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/report.mjs)用本地Three r160画受光圆柱骨段、球形关节、蓝色人物左侧/橙色右侧/白色中心，三盏灯不投影阴影，鼠标拖动yaw/pitch和双击复位。用户明确要将同样的**3D效果**放在本页左侧预览/人物框右边；不把旧三图缓存、深度预测/AASC/MMD正式功能接进本测试页。手机改为上下单列，不挤压原框与输入。只从当前真实`/infer`响应的`xyz25x3`、`names`与`edges`创建局部骨架，正面按旧坐标映射(x,-y,-z)居中/等比缩放，绝不改原始GPU数值或相机坐标；新图/新框/运行中/失败/EXIF失配必须清空旧3D。

目标目录独立运行，复制本机three@0.160.0压缩模块和MIT许可到服务同目录；Python只增加固定公开GET /hmr2-three.js（禁止任意路径、目录列表），浏览器CSP的script-src保留nonce并只额外允许'self'，其余原鉴权/限额/HTML防护不变；模块/WebGL不可用时显式降级2D或提示。无联网CDN、Node后台或独立服务。见[新任务](../task/20261021_HMR2同源网页右侧3D可旋转骨骼.md)。

实际WebGL呈现复用原版正交相机、3盏灯、左蓝/右橙/中浅色的圆柱24骨段与球形25关节；桌面在原图右侧、390px手机单列。旋转后Canvas像素变化且未再POST，双击复位；改框/请求失败/尺寸不匹配/换图及时清旧骨骼，右侧数据只由合法CUDA FP32当前结果派生。新增固定模块路由限同目录压缩JS，公开但不返回许可/其它路径，CSP保留随机nonce并只增加同源模块许可、module响应CORP same-origin；[22项CPU路由/安全](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-hmr2-3d/route-test.json)和[Chrome与真实GPU](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-hmr2-3d/gpu-web-result.json)通过，含2次真GPU POST与原精确冻结6字段全0。截图：[桌面并排](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-hmr2-3d/hmr2-browser-desktop.png)、[手机骨骼](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-hmr2-3d/hmr2-browser-mobile.png)。正式8768未启动。可选异常回退（禁用WebGL或浏览器模拟模块503）仅做源码路径检查；这两条Chrome故障注入未执行，不视为实测通过。

## 验收与限制

目标Python3.10.10/Torch2.10.0+cu126/GTX1660，最终23完整GPU推理+33协议/预处理/生命周期检查通过；三图精确冻结输入的XYZ/XY/24rot/betas/predCam/full camera与旧GPUFP32逐值完全相同。目标NumPy2.2.6/OpenCV4.13对旧原生缓存input最大差2.384e-7，实际XYZ最大0.000298mm、XY最大0.000061px，不改vendor追逐旧hash。

9热样本同步引擎total中位198.805ms、188.278～227.880ms，含图片预处理但不含HTTP base64/JSON/传输；network中位183.630ms，不把与旧10-19耗时差当已证明优化。引擎峰allocated/reserved2.6259/2.7031GiB；额外50个连续真实HTTP请求全部200/结果一致，单次加载、1/2/5/10/25/50次allocated均2678.055MiB，warm后增长0。并非无限时长/所有负载显存保证；驱动、库与其他GPU应用另计。

缺资源/禁CUDA负例通过，0模型加载/无CPU fallback/无监听。原11深度文件、35HMR原资源、75包版本、旧GPUFP32/Half输出与524复制文件SHA保持；所有自测临时loopback服务器关闭，无正式服务驻留。上游timm/cross弃用警告保留，不修改源包。

见[spec](../spec/hmr2-python-gpu-service.md)、[使用](../usage/hmr2-python-gpu-service.md)、[任务](../task/20261021_HMR2独立PythonGPU服务.md)、[验收统计](../../tmp/mmd-pose/depth-eval/hmr2-sam3d/service-eval/20261021-251d3b2f/summary.json)。
