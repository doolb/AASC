# 图片姿态模型与运行时

- 默认识别权重：OpenMMLab MMPose RTMPose-m Body7 `rtmpose-m_simcc-body7_pt-body7_420e-384x288-65e718c4_20230504`，Apache-2.0，输入384×288，输出COCO17点二维SimCC。
- 官方模型库：https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose 。固定ONNX SDK归档：https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-384x288-65e718c4_20230504.zip 。分发改名为`rtmpose-m-body7-384x288.onnx`，模型54850856字节，SHA-256 `a4c4f6fd983c0be353042a7a6b3845b0894ada22b8c02964373554afcdcd6e8e`。
- RTMPose没有三维world输出；本项目使用当前角色姿态作为深度先验，二维投影初始化不构成真实深度识别。旧MediaPipe函数保留兼容，默认不分发或加载下列旧权重。

- 人物检测与Pose ONNX来源：OpenCV Zoo，revision `47534e27c9851bb1128ccc0102f1145e27f23f98`，目录`models/person_detection_mediapipe`与`models/pose_estimation_mediapipe`，Apache-2.0。
- 模型由MediaPipe TFLite转换，来源和模型卡见上述上游README。本项目按其预后处理契约重写浏览器实现，前33点为人体点，附加6点不用于骨骼映射。
- ONNX Runtime Web来源于已安装的`onnxruntime-web`，MIT；JS与WASM成套复制，不使用CDN。
- 分发目录附带Apache-2.0和MIT许可。模型下载后校验固定大小及SHA-256，不把模型二进制提交Git。
- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/pose_estimation_mediapipe
- https://github.com/microsoft/onnxruntime
