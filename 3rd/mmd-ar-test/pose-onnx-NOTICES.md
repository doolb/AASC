# 图片姿态模型与运行时

- 人物检测与Pose ONNX来源：OpenCV Zoo，revision `47534e27c9851bb1128ccc0102f1145e27f23f98`，目录`models/person_detection_mediapipe`与`models/pose_estimation_mediapipe`，Apache-2.0。
- 模型由MediaPipe TFLite转换，来源和模型卡见上述上游README。本项目按其预后处理契约重写浏览器实现，前33点为人体点，附加6点不用于骨骼映射。
- ONNX Runtime Web来源于已安装的`onnxruntime-web`，MIT；JS与WASM成套复制，不使用CDN。
- 分发目录附带Apache-2.0和MIT许可。模型下载后校验固定大小及SHA-256，不把模型二进制提交Git。
- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/pose_estimation_mediapipe
- https://github.com/microsoft/onnxruntime
