# HMR2 Node ONNX

独立ESM子包，Node≥22；代码按core/framework/app划分，用户指定位置覆盖通用nodejs根约定。正常图片推理仅Node＋ONNX，不调用Python。原Python/8768/页面/生产MMD不替换。

项目根：

```powershell
npm run download:hmr2-model
npm run start:hmr2
npm run test:hmr2
```

正式服务由你执行，默认 <http://127.0.0.1:8769/>，Windows DirectML（不是CUDA），非Windows默认CPU。`--check`无模型加载/无监听，仅配置＋模型SHA验证。

首条命令当前本机从已有自定义完整ONNX候选校验导入，**不是网络下载**；两文件正确则cache复用。没有已核验公共URL。配置合法同一模型的本机源或真实HTTPS目录；catalog固定SHA/大小，源/目标ordinary/no-symlink，流式双验证＋无覆盖原子安装。模型目标在项目res，node_modules和多GB权重不提交Git。

独立选图/粘贴/框/2D/Three同源页与严格/infer；单session单忙锁503。FP32权重/I/O，DML内部精度/TF32/VRAM allocator未知；hostRSS非显存，device仅requested标签。BMI/人体检测/置信度不增加；BODY25原序/24rot/10betas/全图相机含SMPL LBS仍完整。

子包命令 `bench:node`/`compare`为冻结Tensor工具，默认历史fixtures只读，输出新tmp；不能把旧热run时间当图片HTTP。诊断前缀工具需显式历史资产目录；默认check只静态编译，绝不自动GPU诊断。

可选原CPU预处理参考仅继承原prepare_image并覆盖load，`-B`禁写原runtime。29例四输入SHA与当前Python一致；完整CPU模型自有port0四图真实HTTP/loadCount1已通过，不是新DML速度或真值准度。浏览器真实视觉/新增DMLHTTP窗口待用户安排。

详见[完整使用/合同/限制说明](<../../docs/usage/hmr2-node-onnx-service.md>)与[设计](<../../docs/design/hmr2-node-onnx-project-service.md>)。图片接纳比原Python窄：支持4格式，BMP仅40-byte未压缩标准布局，边长<32767，默认blur12M像素/r64；特殊色彩/解码版本不能从29例宣称普遍逐位一致。
