# HMR2 Node ONNX独立服务

代码位于项目[独立子包](<../../3rd/hmr2-node-onnx/package.json>)，职责按core/framework/app划分。原Python服务、8768页面、原权重/runtime/NPZ/历史报告保留，生产MMD仍严格接受原CUDA协议，不会误接受本Node结果。

## 项目根两条命令

```powershell
npm run download:hmr2-model
npm run start:hmr2
```

模型准备首次会按独立lock安装子包依赖；已有依赖不重复安装。当前机器默认从已经导出的本机候选**校验导入**，不是网络下载；已有两个模型文件完整大小/SHA通过时复用缓存。默认目标在项目res/models/hmr2-node-onnx/fp32-op18-dml-static，约2.7GB，不在源码或Git。

用户自行执行第二条命令后，默认打开 <http://127.0.0.1:8769/>，提供选图/粘贴/框、二维叠图与本地Three三维预览。当前轮AI只做自有port0测试，未启动/接管这个正式端口或原8768。

Windows默认DirectML（`dml:0`），不是CUDA；其他平台默认CPU，Windows也可显式 `--provider cpu`。DML失败不会悄悄CPU fallback。FP32权重与输入/输出，DML内部精度/TF32未知；device标签是requested目标，不是逐节点profile证据。

## 模型来源与配置

没有经核验的公共下载URL：这个文件是完整HMR2.0b＋SMPL LBS自定义导出，不能下载另一款模型顶替或自行发布SMPL权重。当前本机源是此前导出目录；换机器需提供自己的合法同一候选目录或真实HTTPS目录URL：

```powershell
npm run download:hmr2-model -- --source-dir "D:\my-model\fp32-op18-dml-static"
# 由你填写真实已授权HTTPS目录地址，命令只取固定model.onnx/model.onnx.data
$env:HMR2_MODEL_BASE_URL = "https://<你的真实模型主机>/<实际目录>/"
npm run download:hmr2-model
```

环境变量：`HMR2_MODEL_DIR`（目标）、`HMR2_MODEL_SOURCE_DIR`（本机源）、`HMR2_MODEL_BASE_URL`（远程，显式优先）。只接受[固定catalog](<../../3rd/hmr2-node-onnx/core/model-catalog.json>)两个artifact的size/SHA；流式，不把2.7GB放Buffer；锁＋同目录自有temp＋hardlink原子无覆盖提交，最后installed metadata。已有partial/无效目标拒覆盖，源/目标junction或symlink拒绝；锁残留人工确认，不自动删除未知资源。NTFS支持所需hardlink；不支持时明确失败，不降为不安全覆盖。

普通HTTP模型源默认拒绝；仅内部测试fixture显式allowLoopbackHttp，生产CLI不给此绕过开关。远程fixture验证不等于已有公共2.7GB下载源。

## 启动与只检查

```powershell
npm run start:hmr2 -- --check
npm run start:hmr2 -- --port 8769 --provider dml --device-id 0
npm run start:hmr2 -- --provider cpu
```

`--check`只检查配置与完整模型SHA，不加载模型或监听。启动先绑定自己的端口，冲突先退出不重复分配大模型；加载期间health.ready=false，infer503/model_not_ready。完成后同session单请求忙503，不积压队列。DML ordinal为DXGI EnumAdapters1序，不把WMI/PCI排序当adapter索引；GPU名称未实查填null。

非loopback监听必须token；不要把token写进代码/Git：

```powershell
$env:HMR2_API_TOKEN = "<你自己的足够长随机令牌>"
npm run start:hmr2 -- --host 0.0.0.0 --cors-origin "http://你的明确Origin"
```

页面是固定同源/infer，没有可编辑APIURL或localStorage，没有借用生产MMD的配置key。原AASC远端配置流程未改，不新增HTTP配置保存/读取接口。

## HTTP合同与差异

- GET `/`和`/hmr2-three.js`固定公开资源；`GET /health`、`POST /infer`按token鉴权。路径精确，query/trailing slash不作别名。
- infer JSON只允许 `image_base64`、可省 `bbox_xyxy`（原图定向坐标[x1,y1,x2,y2]，小数允许，null拒绝）。无框full_image_fallback，不自动检测人物。
- 严格UTF8/全部层重复JSON字段、传输CL/TE、标准base64和原Python3.10非canonical末尾padding、byte/pixel预算、finite输出。未知错误脱敏。
- 实际非白名单Origin只不发ACAO，不代替鉴权返回403；预检才拒绝。Node原生parser重复CL/TE+CL在应用Bearer前400，这不是Pythonhandler完全同一时序。
- 输出保持BODY25名字/24边、25×3 XYZ/25×2 XY、24×3×3rot/10betas/弱相机/全图相机/depth/projection aliases。相机z/depth必须正，主点须W/2,H/2。XYZ仍模型空间，XY不clamp、不交换左右/修复矩阵/编造confidence。
- Node source为完整ONNX图含embedded SMPL LBS，device为dml:N/cpu；不填cuda或Torch source。health.gpu为GPU对象/CPU null（与旧ordinal整数字段不同），cold device是请求配置值，不证明EP执行。
- 原GPU allocator四键和deviceFreeMiB/deviceTotalMiB均null，`allocator/gpuAllocator:'unknown'`；hostRssBytes只是宿主RSS，不是显存。
- `timingMs.modelRun/inferenceMs`完整ORT run至九CPU输出拷贝校验；旧network+LBS语义不同，旧H2D/network/LBS/projection/D2H阶段null。modelLoadMs只session.create，startupMs含模型SHA＋预处理初始化，但不含进程全启动或依赖安装。不能把同名旧计时直接相除。

## 图像兼容与资源边界

预处理不使用sharp.resize：Sharp只解码/定向，float32框/scale/aspect/factor，whole-image nearest Gaussian axis0→1/double（r0仍double），OpenCV WASM CV32源点→double仿射，uint8无blur/float64有blur，RGB和double mean/std最终FP32＋32:-32切宽。

支持PNG/JPEG/WebP/标准未压缩BMP。CMYK内部工作/输出空间保留并按原OpenCV整数公式转换，不经过Vips CMYK/sRGB色彩管理；29个当前测试输入一致不是所有色彩空间/版本的通用逐位保证。

默认原图16MiB/40M像素、请求24MiB；OpenCV边长<32767；Gaussian整图预算12M像素/radius≤64。BMP仅40-byte DIB、标准palette/offset布局，V4/V5/gap/压缩拒绝而不静默读错。大图、特殊ICC/YCCK/gAMA/EXIF或未来解码版本仍须逐图评估；预算/部分编码接纳比原Python窄。取消浏览器请求不取消正在运行的推理。

## 自测与数值证据

```powershell
npm run test:hmr2
```

包含静态检查、原8项CPU回归、严格协议/raw-socket/nonce/CSP、下载tiny/cache/竞争/路径、真实WASM双dtype/安全BMP、假session合同与Node页面门禁。当前Windows无法创建普通file symlink的两项明确skip；junction拒绝实测通过。mock或CPU Add不当完整GPU。

本轮还完成：真实2.7GB本机导入/cache/启动check；29同bytes/框当前原Python继承prepare_image的CPU对照（原3图、Gaussian/threshold/r0/fraction/border、EXIF1–8、gray/palette/RGBA/CMYK/变K定向/BMP/WebP/JPEG/gray16/sRGB ICC），四输入SHA一致、maxAbs0。CMYK首次input maxAbs2.10893/解码134差被修正，旧错误报告保留不覆盖。新证据：[26图修正结果](<../../tmp/hmr2-node-onnx/preprocess-20261022-1/comparison-corrected.json>)、[CMYK变K结果](<../../tmp/hmr2-node-onnx/preprocess-20261022-1/comparison-cmyk-k.json>)。

真实完整CPU ONNX模型与自有port0完成4次HTTP推理（原3图＋Gaussian），只load一次、实际HTML/Three/nonce与健康状态通过：[整图CPU集成](<../../tmp/hmr2-node-onnx/service-cpu-integration-20261022.json>)。这是完整CPU模型证据，不是新增DML HTTP测速或真值准度。

DML Tensor速度/精度沿用已完成[阶段A](<E:/ai/ai-depthmap/hmr2_node_onnx/results/phase-a-report.md>)；代码复制和raw输入一致不新造更快结论。新增DML HTTP原图和浏览器真实视觉验收需用户显存窗口；不让两大模型同时占6GB，不控制用户原服务。
