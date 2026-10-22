# HMR流式模型校验

`RawSha256.mjs`与`constants.mjs`来自项目已安装的`@aws-crypto/sha256-js` 5.2.0（Apache-2.0，见LICENSE）。修改模块扩展名与相对import，另修正digest中消息长度高32位的小端写入为SHA-256要求的大端；该补丁由512MiB+1字节流式回归测试与Node crypto交叉验证。保留其余上游代码风格。用于浏览器流式计算2.7GB外置权重的完整SHA-256，避免WebCrypto一次性复制整份大权重。它们不包含HMR权重。

`ORT-LICENSE`来自 https://raw.githubusercontent.com/microsoft/onnxruntime/v1.26.0/LICENSE ，用于随网页部署的ORT运行时。
