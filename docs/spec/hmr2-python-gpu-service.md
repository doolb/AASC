# HMR2 独立 Python GPU 服务伪代码

2026-10-21，代码已实现，本机GPU/API/持续请求检查通过。入口：[hmr2_gpu_service.py](<E:/ai/ai-depthmap/hmr2_gpu_service.py>)。见[设计](../design/hmr2-python-gpu-service.md)。

```text
资源 := 用户确认复制本地checkpoint/config/mean + hmr2和einops/timm/yacs/smplx/omegaconf及许可证；524文件2.7206GB；不下载/安装/改CPU或GPU包
入口 := 单文件CLI/Engine/HTTP；__file__旁models/hmr2、hmr2_runtime；正常运行不依赖旧tmp资源
CPU模式 := --help/--check/--self-test只标准库，不导入Torch/加载CUDA/开端口；self-test不是完整GPU验收
load幂等 := load_lock -> 若loaded返回 -> check资源 -> CUBLAS_WORKSPACE=:4096:8 -> 导入目标Torch/vision并检查来源 -> 仅runtime六纯包路径
初始化 := namespace hmr2 models/utils/datasets避训练/渲染initializer；导入原leaf；缺CUDA或GPU索引报503不CPUfallback
配置 := 原model_config与本地cache root，256/mean/std校验，[192,256] bbox；4线程/seed42/确定性/禁TF32/AMP/defaultFP32
权重 := CPU mmap trusted本地ckpt -> 8 SMPL shape/map验证 -> meta backbone/head（临时CPU linspace finally恢复）-> strict assign -> eval和CUDAFP32
SMPL := checkpoint原float buffers CUDAFP32、index long；不加载外部SMPL pickle，不改左右/脚/旋转/根坐标
装载完 := _loaded=true、load_count+=1；load再次返回；main只有load成功后用户手动serve
prepare := 验bytes上限16MiB/Pillow尺寸40Mpx -> cv2 BGR3解码 -> 定向后xyxy边界/finite/非bool；缺框整图fallback
crop := 原ViTDetDataset256² Gaussian/affine/normalize -> 宽度32:-32一次 -> CPUtensor [1,3,256,192]FP32，center[1,2]/size[1]/W,H[1,2]
predict_bytes := 先try GPU锁（忙503）-> 原prepare -> _run_prepared -> finally释放
_predict_prepared := 测试用CPUtensor/meta重放，非HTTP入口 -> 同GPU锁 -> 完整验证shape/finite/meta -> _run_prepared
_run_prepared := tensor上传 -> 原backbone -> head原24rot/betas/predCam -> raw pose FP32 LBS -> vertex extra21+map BODY25
camera := AST仅提取原cam_crop_to_full；focal=5000/256*max(W,H) -> cameraTranslation -> q=XYZ+camera -> q.z>0/finite -> 投影
输出 := type/schemaVersion/model/device/precision=fp32，xyz25x3/xy25x2/names/edges，rotations24/betas10/predCam/cameraTranslation/camera/projection/cameraDepth
诊断 := 最终CPU256x192tensor SHA、CPU预处理/上传/同步network/LBS/project/下载/total/modelLoad墙时，Torch allocated/reserved/peak/free/total分开
HTTP := ThreadingHTTPServer daemon_threads、socket15s、Connection close；GET /health、POST /infer、OPTIONS、其他常见方法405
本地测试网页（已实现） := GET / 从 __file__ 同目录固定 hmr2_test.html 读取页面；新增GET /hmr2-three.js仅从同目录固定hmr2_three.module.min.js读取，正确JS MIME/no-store/nosniff/CORP same-origin；无路径参数、外网资源或目录浏览，模块缺失503不影响/health与/infer
网页安全 := GET /与固定MIT模块公开（无密钥/私有数据），/health与/infer原Bearer鉴权不变；仅每次GET / HTML发随机脚本nonce/CSP script-src nonce + self允许同源module加载，JS响应no-store/nosniff/CORP，禁frame及外站脚本，LAN令牌仅存在当前页内存
3D右侧骨骼（已实现） := 左列保留原图预览/xyxy框，右列复用旧report.mjs的本机Three r160 Mesh圆柱/球、3盏无阴影灯、左蓝右橙中白，最多420px；窄屏上下排列，不调用新模型
3D数值 := 仅在本次/infer成功且原图imageSize一致、xyz为25个有限三元组、edges与names通过验证时，用原BODY25 xyz局部米坐标映射(x,-y,-z)，按Box3居中+最大外延归一化2.75，不改变xyz/xy/左右/相机数值；旧拓扑逐骨段与关节渲染
3D生命周期 := 初始空态、换图/改框/重跑/失败清旧骨骼；拖动右侧画布改yaw/pitch、双击归零，不影响左侧拖框，也不产生POST；WebGL/模块不可用时优先Canvas 2D降级并标注状态，关闭页面释放WebGL几何/材质/Renderer
3D验收 := 原API/CSP/固定模块MIME/失件503/外源不准/许可与其它路径拒绝共22项CPU全部通过；真实Chrome按当前CUDA FP32两个POST的xyz渲25球24受光圆柱、拖转Canvas像素变化且POST计数不变、双击角度归零、失效状态清旧、390px单列不溢出；原精确冻结输入6字段差0、570原资源SHA及75包版本未改，模块和许可SHA与本地three@0.160.0相同，测试自有临时端口关闭
网页交互 := 上传选择图片显示文件名/预览；按钮读取剪贴板图片，window paste响应Ctrl+V/⌘V；图片限制16MiB/40M像素与PNG/JPEG/WebP/BMP；只在点击测试后同源POST /infer
人物框与结果 := 预览拖框转换原图xyxy，无框明确整图fallback；xy/names/edges叠加BODY25骨架，GPU/耗时与原始JSON通过textContent展示；定向尺寸不一致时警示并暂停叠加
网页验收 := 原API鉴权/坏请求回归；临时loopback GET HTML/nonce/CSP共15项，真实Chrome选图/模拟paste/按钮替身剪贴板、画框+清框2次真实CUDA POST及2次仅浏览器模拟错误/定向失配、390px无横向溢出；另1次冻结输入6字段差全0；570原资源SHA/75包版本保持；端口与Chrome关闭
POST校验 := Bearer -> route -> application/json(+utf8) -> 非chunked/单ASCII ContentLength/24MiB限额 -> JSON对象/唯一键/finite -> 仅image_base64/bbox_xyxy
图片 := strict base64/data:image前缀，decode cap；显式null bbox400、无框fallback；不接受image_path/URL/modelpath/precision
错误 := 400参数/JSON/base64/bbox/未知字段、411缺length、413超限、415media、503busy/resources/CUDA，500内部/非有限；安全JSON/no-store/不暴露图token路径
CORS := 明确HTTP(S) origin非wildcard；非loopback空token拒绝；除固定GET /页面和GET /hmr2-three.js模块外GET /health与POST /infer仍须Bearer；OPTIONS准确origin/path/method/headers免token
外源 := 授权GET可200但不发ACAO（浏览器无跨域读）；外源OPTIONS403；不是HTTP远端配置接口
自测 := AST/--check/--self-test + 三图各2冻结预热/冻结校准/原图+3hot + 2真实HTTP（最终23GPU）+33协议/预处理/生命周期 + 缺资源/禁CUDA负例 + 50连续HTTP
结果 := 精确冻结6字段差全0；native输入2.384e-7差/XYZ<=0.000298mm/XY<=0.000061px；hot中位198.805ms；50次全部200/相同/加载一次/显存增长0
保护 := 11深度/35HMR/524复制SHA与75包版本、旧GPU双输出保持；所有自有临时loopback server finally关闭，未启动正式服务
边界 := 用户手动启动/Ctrl-C；无AASC/PMX/ONNX/检测/AMP/FP16/Offline/Git发布或用户服务器进程控制
```
