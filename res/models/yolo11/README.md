# YOLO11 服务器模型目录

此目录由 `npm run prepare:vision-models` 生成 `yolo11n/s/m/l/x.onnx`。ONNX 文件是由 `/home/as/yolo11*.pt` 导出的部署产物，不提交 git；服务器清单只暴露实际存在且完整的文件。

新增或更新 YOLO 尺寸时，重新执行准备命令，重启服务器后清单会自动包含新文件，正式 APK 会按模型 ID 下载并校验。
