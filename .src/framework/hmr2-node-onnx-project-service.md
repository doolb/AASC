#skill: ai-code-translation
# framework/HMR2 Node项目服务与模型获取

## 已有声明
- 引用 用户确认“实现代码＋自测、本机校验导入＋远程URL” // 本轮授权已确定，保持原Python与模型不替换
- 引用 [原Python](<E:/ai/ai-depthmap/hmr2_gpu_service.py>)、完整ONNX四输入九输出和阶段A // 旧热Tensor约205ms不是新HTTP耗时
- 引用 用户指定3rd代码根与[根npm](<../../package.json>) // 覆盖通用nodejs根约定，无hal独立内容不建hal
- 引用 [core共享合同](<../../3rd/hmr2-node-onnx/core/benchmark-common.mjs>)和[core协议](<../../3rd/hmr2-node-onnx/core/protocol.mjs>) // HTTP不导入GPU，引擎统一错误和框语义

## 新增定义
- 定义 ModelCatalog { id, version, files, inputShapes, outputShapes, provenance, licenseNote } // 只取固定两文件完整size/SHA
- 定义 ServiceOptions { host, port, modelDir, provider, deviceId, apiToken, corsOrigins, limits } // CLI或环境，不新增HTTP配置接口
- 定义 Hmr2Engine { ready, busy, session, loadCount, modelLoadMs, startupMs, closing } // 单会话/单请求，失败不默默CPU fallback
- 定义 PreparedInput { inputs, metadata, stages } // 定向框与四FP32输入和摘要一致
- 定义 InstallResult { source, files, modelDir, version } // cache/local/remote分清真实来源

## 操作流程
### 模型准备
- 读取 [固定catalog](<../../3rd/hmr2-node-onnx/core/model-catalog.json>)两artifact // 图2468364B/data2701262848B，完整SHA不手工简写
- 校验 来源与目标所有祖先为普通目录并拒symlink/junction // 不跟随链接写用户文件
- 复用 两文件大小/SHA全部正确缓存，否则拒绝已有无效目标 // 不覆盖原文件
- 获取 自有锁与随机temp并选择本机源或显式HTTPS目录 // 无源明确失败，无公共URL不伪造/发布权重
- 流式 复制或下载并同时SHA/大小/截断/编码/重定向/超时核验 // 不创建2.7GB Buffer
- 验证 两个temp后无覆盖hardlink安装并再验证目标，最后installed // 单文件成功不冒称模型ready，失败仅清自有inode

### 服务装配
- 读取并规范化 CLI/环境；帮助早退出；IPv6去bracket // 默认127.0.0.1:8769，非loopback必须token
- 返回 createService未listen实例并只依赖注入engine与固定assets // import不load不监听，静态公开路径不泛目录
- 先绑定 用户正式启动端口再load完整模型 // 冲突先退出不多驻留模型，warming health false/infer503
- 验证 模型两SHA并创建WASM预处理及一次ORT session // sequential/memPattern false/intra4/inter1/all，固定batch1
- 保证 constructor threads为1–32正整数，否则400；closePromise复用且closing先置位，再等待loadPromise/active、detach session仅release一次；load创建session后若closing不置ready // 关闭后不复活
- 报告 requested dml:N或cpu与actualAssignment unknown // DXGI ordinal非CUDA/WMI序，内部精度/TF32/VRAM未知不伪填

### 图片与批次
- 验证 inline原图/严格UTF8与JSON重复key/base64/byte/header预算 // 保留原错误优先级，Node parser提前400差异说明
- 验证 Bearer精确格式/固定routes/CORS // 非白名单实际请求仅缺ACAO，预检才403，不作身份认证
- 锁定 busy后一次解码/预处理/run/输出校验 // 第二请求立即503，不积压6GB GPU
- 解码 PNG/JPEG/WebP与40-byte DIB标准BMP // BMP palette/offset/stride安全限定，不静默解V4/V5/gap
- 保留 CMYK工作/输出空间并按OpenCV整数256移位转换 // 不经Vips sRGB往返色彩管理；K变化/EXIF逐图验证
- 生成 定向W,H、原float32框中心/scale/aspect/factor/sigma // BBOX逐步除200乘200，不代数简化
- 执行 nearest Gaussian double axis0再1/对称核原累加/半径0仍double // 12M blurPixels/r64/边长<32767新资源限制披露
- 仿射 原CV32FC2控制点和M64/INTER_LINEAR/BORDER_CONSTANT的256方crop // 无bluruint8与有blurdouble保持原舍入
- 生成 RGB后Fpixel/double mean,std/最终FP32/CHW中心192宽与四输入SHA // 不以sharp.resize替代
- 验证 本机prepared尺寸/像素/框/source/fallback全框/输入SHA后run // local无效meta先400而不是到JSON500
- 验证 九输出shape/finite/cameraZ>0/depth>0/focal>0/主点W/2,H/2 // 不修复预测、不clamp XY、不交换左右
- 生成 原BODY25/24rot/10betas/相机aliases与诚实Node来源 // allocator四键和deviceFree/Total为null，RSS非显存
- 报告 preprocess/whole modelRun/total与session.create模型load边界 // 旧network+LBS和完整ORT不能同名直接比

### Node页面
- 服务 固定nonce HTML/同源Three/CSP与no-store // 不引入CDN、外站APIURL或生产MMD storage key
- 保留 选图/粘贴/框/abort generation/ObjectURL释放/2D/3D // 仅新页，不改Python页或生产MMD
- 验证 Node来源/schema1/model/fp32IO/requestedEP-device/BODY25原名字边在任何绘制前 // 旧CUDA/错来源不能先叠2D后才3D拒绝
- 追加 3D有限xyz与浏览器自然/服务尺寸一致 // 错误清旧数据，不能display stale

## 测试映射
- 映射 [model-files.test](<../../3rd/hmr2-node-onnx/core/model-files.test.mjs>)至tiny本机/HTTP/cache/竞争/锁/SHA/截断/路径流程 // 不冒充公共2.7GB源
- 映射 [preprocess.test](<../../3rd/hmr2-node-onnx/core/preprocess.test.mjs>)至float32/r0/核/WASM双dtype/PNGalpha/gray/BMP安全 // 真实CPU/WASM，非模型
- 映射 [benchmark.test](<../../3rd/hmr2-node-onnx/framework/benchmark.test.mjs>)至原8项合同/路径/稳定角/真实CPU Add // 保留历史frozenTensor回归
- 校验 [compare](<../../3rd/hmr2-node-onnx/framework/compare-results.mjs>)须显式--node或HMR2_NODE_RESULTS指明Node报告，默认原E fixtures只读，输出唯一带时间戳tmp且JSON/MD用wx新建；原8项CLI测试需显式--node，验证md→json及空--node拒绝 // 不猜历史results目录或覆盖已有报告
- 映射 [http-service.test](<../../3rd/hmr2-node-onnx/framework/http-service.test.mjs>)至未listen factory/raw-socket/严格协议/CORS/auth/nonce/慢读 // 自有port0/fake不当GPU
- 映射 [engine.test](<../../3rd/hmr2-node-onnx/framework/engine.test.mjs>)至fake单飞/释放/有效相机/批次元数据/CLI helpIPv6 // 不用坏相机fake掩盖原合同
- 映射 [page.test](<../../3rd/hmr2-node-onnx/framework/page.test.mjs>)至VM纯builtin来源/schema/EP/BODY25/稀疏/尺寸/绘制顺序 // 不称DOM/Three渲染验收
- 使用 app/preprocess-reference.py只覆盖原load初始化CPU依赖并加runtime sys.path，继承原prepare_image // 禁CUDA/bytecode/模型checkpoint，观测wrapper不改原返回
- 比较 app/test-preprocess.mjs同bytes/框四输入与decoded/warp/M max/RMS/SHA // 29例全0是这些样本证据，不泛化所有编码
- 使用 app/test-service-integration.mjs默认CPU完整ONNX和自有port0四图/HTML/Three/loadCount1 // 非正式8769或新增DMLHTTP速度
- 仅在 用户再次提供显存窗口后顺序补DML/原PythonHTTP窗口 // 不控制用户PID或同时驻留两大模型
- 保持 原权重/runtime/页/NPZ/历史结果/75包不写，新结果tmp不提交 // 保护实测摘要，模型与依赖不进Git
