# 图片姿态模型与运行时

- 默认识别权重已按用户选择恢复OpenCV Zoo MediaPipe人物检测与Pose ONNX（固定revision见下文），输入检测224×224 NCHW、姿态256×256 NHWC，输出33点及模型估计world。两模型共17,547,397字节（约16.7MiB），Apache-2.0；world不是实测真实深度。
- 检测：`person_detection_mediapipe_2023mar.onnx`，11,990,159字节，SHA-256 `47fd5599d6fa17608f03e0eb0ae230baa6e597d7e8a2c8199fe00abea55a701f`；姿态：`pose_estimation_mediapipe_2023mar.onnx`，5,557,238字节，SHA-256 `9d89c599319a18fb7d2e28451a883476164543182bafca5f09eb2cf767ed2f3f`。
- 历史兼容/临时对照：OpenMMLab MMPose RTMPose-m Body7 `rtmpose-m_simcc-body7_pt-body7_420e-384x288-65e718c4_20230504`，Apache-2.0，输入384×288，输出COCO17点二维SimCC。默认构建清单和Worker不再分发/加载RTMPose权重。
- 官方模型库：https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose 。固定ONNX SDK归档：https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-384x288-65e718c4_20230504.zip 。分发改名为`rtmpose-m-body7-384x288.onnx`，模型54850856字节，SHA-256 `a4c4f6fd983c0be353042a7a6b3845b0894ada22b8c02964373554afcdcd6e8e`。
- RTMPose没有三维world输出；其历史二维投影初始化不构成真实深度识别。下列MediaPipe权重已恢复为默认；实验分割/深度/对应修正报告保留对照，不进入默认流程。

- 人物检测与Pose ONNX来源：OpenCV Zoo，revision `47534e27c9851bb1128ccc0102f1145e27f23f98`，目录`models/person_detection_mediapipe`与`models/pose_estimation_mediapipe`，Apache-2.0。
- 模型由MediaPipe TFLite转换，来源和模型卡见上述上游README。本项目按其预后处理契约重写浏览器实现，前33点为人体点，附加6点不用于骨骼映射。
- ONNX Runtime Web来源于已安装的`onnxruntime-web`，MIT；JS与WASM成套复制，不使用CDN。
- 分发目录附带Apache-2.0和MIT许可。模型下载后校验固定大小及SHA-256，不把模型二进制提交Git。
- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/pose_estimation_mediapipe
- https://github.com/microsoft/onnxruntime
