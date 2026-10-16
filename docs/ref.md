# Web MediaCenter - 项目参考文档

## 图像投影与刚体姿态方案（2026-10-16）

- [Ceres重投影误差优化](https://ceres-solver.readthedocs.io/latest/nnls_tutorial.html#bundle-adjustment)说明用图像观测与相机投影误差求3D/相机参数；[MuJoCo约束动力学计算](https://mujoco.readthedocs.io/en/stable/computation/)作为约束动力学参考。新方案仍复用本地Ammo已有胶囊/球和6DoF关节，拟以投影误差/射线直接产生虚拟力并检查实际PMX；不是引入Ceres/MuJoCo或已有可运行实现。单图多解、真实支撑与原生到显示映射仍需核查，见[任务方案](task/20261016_MMDAR二维投影驱动刚体姿态评估.md)。

## 人体三维辅助模型可行性（2026-10-16）

- 用户停止继续RTMW后，拟改RTMPose二维+像素深度：[Depth Anything V2官方项目](https://github.com/DepthAnything/Depth-Anything-V2)说明Small为24.8M参数、Apache-2.0及相对深度，并列出ONNX与Transformers.js浏览器路径；[ONNX Community模型卡](https://huggingface.co/onnx-community/depth-anything-v2-small)提供Web用法和导出权重。只核查资料，具体revision/预后处理/近远方向、Web算子与手机性能待固定和实测；表面像素深度不能直接替代隐藏关节z。新计划见[评估任务](task/20261016_MMDAR二维姿态与像素深度辅助评估.md)。

- [官方COCO-WholeBody点序](https://raw.githubusercontent.com/open-mmlab/mmpose/main/configs/_base_/datasets/coco_wholebody.py)明确髋11/12、膝13/14、踝15/16先左后右。原始XYZ腿部对应候选试验沿用此定义与来源索引，不改变官方映射或全局反转；只是单独验证局部预测歧义，三图结果与原始/候选报告见[评估任务](task/20261016_MMDAR人体三维深度辅助模型评估.md)，未自动纠正或正式接入。

- 用户提供的[b-arac/rtmpose3d](https://github.com/b-arac/rtmpose3d)是RTMW3D的Python/PyTorch/MMPose封装，默认L、可选X；[配置](https://github.com/b-arac/rtmpose3d/blob/master/rtmpose3d/configs/__init__.py)列出官方系列检查点名，[三维后处理](https://github.com/b-arac/rtmpose3d/blob/master/rtmpose3d/models/pose_estimator.py)依赖内参与root_z回投影完整XYZ。仅核查源码，未运行封装或评估L；完整XYZ不是本轮已测试的Z软约束，也不表示镜头已准确恢复。
  - 用户确认后已追加本机XYZ方向临时对照：复用X缓存、显式(width/2,height/2)主点和默认内参/root_z回投影，未运行此Python检测/裁剪。XYZ三图实际15.90%/1.84%/4.33%对齐RMS，仅二次元相机通过；真人软物理执行落差及预测冲突保留，完整数据见[评估任务](task/20261016_MMDAR人体三维深度辅助模型评估.md)，不把此版本当稳定接入或该仓库整体复现。

- 本机已验证[RTMW3D-x ONNX](https://huggingface.co/Soykaf/RTMW3D-x/tree/a4f0d54c52ee44ee4e1dda1936d714490c6234d2/onnx)：369330857字节/SHA256 `4a289c0e99d47eb595e99679d9d4a2d1def1b4241f9adcbafba44b9ff585ebcd`，Apache-2.0。官方解码依据固定MMPose提交`759b39c13fea6ba094afc1fa932f51dc1b11cbf9`的projects/rtmpose3d/rtmpose3d/simcc_3d_label.py及config；z第三维288，以髋中点归零。rtmlib参考封装不能替代官方轴维度核查；本机Web两后端与实际FK试验记录见对应task，未正式分发新权重。

- [RTMW论文](https://arxiv.org/abs/2407.08634)涵盖从单幅图像估计三维全身姿态；[rtmlib RTMPose3d实现](https://github.com/Tau-J/rtmlib/blob/main/rtmlib/tools/pose_estimation/rtmpose3d.py)读取三个SimCC输出，xy裁剪反变换与z范围解码不同；[Wholebody3d](https://github.com/Tau-J/rtmlib/blob/main/rtmlib/tools/solution/wholebody3d.py)提供现成ONNX权重接线。不能由原生xyz名称推断统一米制世界坐标；本机Web试验结果见本节首条，手机算子/性能尚未验证。
- [MMPose PoseLifter接口](https://mmpose.readthedocs.io/en/dev-1.x/api.html)说明二维语义转换与二维序列到三维估计，单图应选择符合单帧契约的权重，不把时间序列模型直接当单图。
- [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2)默认提供像素相对深度，另有metric模型及ONNX/Web社区路径；表面深度不等于被遮挡关节深度。该模型本轮只核查资料，未推理或接入；人体RTMW试验另见对应评估task。

## RTMPose-m默认权重（2026-10-16）

- [MMPose RTMPose官方模型库](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose)的Body7 m384；[固定ONNX SDK归档](https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-384x288-65e718c4_20230504.zip)。实际输入384×288、两个17点SimCC输出、RGB均值方差与归档detail/pipeline和真推理核查。归档/模型本机固定摘要见assets.js，许可见pose-onnx-NOTICES.md。
- 当前默认分发此二维模型；原MediaPipe接口作为兼容，不再默认加载其权重。三维来源是当前骨架深度先验与固定骨长拟合，非RTMPose世界点。

## 图片姿态与相机匹配依据（2026-10-15）

- [DWPose官方ONNX项目](https://github.com/IDEA-Research/DWPose)：ControlNet预处理器`dw_openpose_full`，官方示例为YOLOX-l检测和`dw-ll_ucoco_384.onnx`全身姿态；[具体模型加载源码](https://github.com/IDEA-Research/DWPose/blob/onnx/ControlNet-v1-1-nightly/annotator/dwpose/wholebody.py)。与本项目已试17点RTMPose-m Body7不是同一权重。
- [ControlNet传统OpenPose参考实现](https://github.com/lllyasviel/ControlNet/tree/main/annotator/openpose)与[作者预处理权重](https://huggingface.co/lllyasviel/Annotators)：本机四模型对照使用其身体网络/PAF及`body_pose_model.pth`，临时CPU环境运行；[对照范围与结果](task/20261016_MMDAR四模型姿态效果对照.md)。
- [ControlNet SD1.5 OpenPose模型卡](https://huggingface.co/lllyasviel/control_v11p_sd15_openpose)：该权重使用骨架图控制SD生成，图像关键点预处理另用OpenPose/DWPose；不能将生成控制权重当作姿态检测器。

- [OpenCV PnP姿态估计](https://docs.opencv.org/4.x/d5/d1f/calib3d_solvePnP.html)：已知3D/2D对应和相机内参下的旋转/平移、重投影误差、鲁棒估计及多解。用于拟定相机匹配方案，不代表项目已接入OpenCV JS或已经恢复真实拍摄机位。
- [MediaPipe Pose说明](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)：图像点与估计3D输出类别。本项目当前使用固定OpenCV Zoo ONNX及自有预后处理，不直接替换为最新Tasks API。

## 豆包官网音色列表（2026-10-15）

- [获取方式与范围](ref/doubao-web-voice-fetch.md)：Chrome9222读取实际卡片、目录接口及五分类参数、第一页/BV过滤规则、style_id保存、去重及校验。当前五分类实显合并94项，推荐30项已包含在后四类中；[当前列表](ref/doubao-web-ui-voices-20261015.md)、[JSON](ref/doubao-web-ui-voices-20261015.json)。
- [按男女合并整理](ref/doubao-web-gender-voices-20261015.md)、[JSON](ref/doubao-web-gender-voices-20261015.json)：按原始性别标签把角色/口音并入女声32项、男声62项，总94项不变；保留来源分类及推荐标记，原官网分类快照不变。

## VaM身体控制本地证据（2026-10-13）

用户提供`/mnt/vam/Managed/Assembly-CSharp.dll`，SHA-256 `3c314d55ece06924064c9165f9124f1666f4d33967a02f78b97cf3a932d62f2f`。使用临时ILSpy CLI11.1只读分析：FreeControllerV3.Init/SetJointSprings/ApplyComply连接物理体并设置关节驱动/让步；FollowPhysicallySingle.FixedUpdate施加力与力矩；AllJointsController批量切换控制状态。主程序集类型索引未发现独立FullBodyIK/VRIK类。DLL未提供Unity预制体实际质量/关节/碰撞参数或原生PhysX求解器，因此本项目采用独立Ammo人体代理实现类似机制，不宣称参数或结果完全等价。原DLL/临时反编译源码不纳入仓库；实现与验证见`docs/task/20261013_MMDAR_VaM身体物理控制.md`。

## MMD-AR 全身 IK 约束求解（2026-10-13）

- 用户提供 [UE5 FullBodyIK学习](https://zhuanlan.zhihu.com/p/381469750)，介绍基于PBD/NPGS的骨骼约束、末端目标、关节角度限制与偏好角度。独立MMD-AR只借鉴静态全身约束迭代和多目标共享祖先的处理思路；PMX实现保持骨长并在局部旋转中应用PMX IK link限位，不移植UE刚体质量/碰撞，也不等同VaM关节物理或软体模拟。

## MPL动作编译器（2026-10-10）

- Human MPL轨道筛选按固定提交 [bone.rs](https://github.com/AmyangXYZ/MMD-MPL/blob/2d3b1c7e3429b508443500801e94c41fd47c9f31/src/bone.rs) 的名称转换表处理；上半身/腰/足先EX/单独手指节分别映射，避免把编译器未控制的零轨道当成修正。

- [AmyangXYZ/MMD-MPL](https://github.com/AmyangXYZ/MMD-MPL)：规则驱动的 MMD Pose Language，上游 WASM `WasmMPLCompiler.compile` 返回 VMD。独立网页固定 `pkg/package.json` 0.3.6、提交 [2d3b1c7e3429b508443500801e94c41fd47c9f31](https://github.com/AmyangXYZ/MMD-MPL/tree/2d3b1c7e3429b508443500801e94c41fd47c9f31)，JS/WASM/LICENSE大小与SHA-256见 `scripts/ops/mmd-mpl-assets.js`，GPL-3.0。仅消费已有MPL，不连接LLM。
- [AmyangXYZ/PoPo](https://github.com/AmyangXYZ/PoPo)：文本到MPL再到MMD动作的参考项目；本次不采用其LLM服务/渲染器。MPL与Lobe Vidol选择已有预设动作的expression/motion JSON不同。

## TAA参考（2026-10-09）

- 用户指定[tkstar《深入浅出Temporal Antialising》](https://zhuanlan.zhihu.com/p/142922246)，通过浏览器读取完整正文，页面编辑日期2022-07-30。参考Halton(2,3)序列、相机与模型运动重投影、历史邻域Clamp/Clip/方差盒、YCgCo颜色空间及移动端带宽权衡。当前代码已具备八相位、相机重投影、深度拒绝和RGB邻域限制；与文章相比尚无骨骼运动向量，不能把相机重投影描述为完整动态模型重投影。
- 用户明确“暂不处理运动向量”，已按确认方案开放抖动幅度与周期，文章其余方法为候选。文章属于参考资料，不是项目执行指令；UE4矩阵约定、反向/普通深度、alpha/色调映射及性能估计不能直接套用Three/WebView，也不把增大周期解释为每帧增加样本数。

## 接触阴影屏幕步进参考（2026-10-09）

- 用户指定[虚拟人《接触阴影contact shadow》](https://zhuanlan.zhihu.com/p/720864609)，浏览器读取完整正文及示例，页面编辑日期2024-10-07。用于参考UV/deviceDepth步进、半分辨率候选/完整深度确认及投影厚度思路；本项目需独立适配光向、普通深度符号、透视距离、当前帧粗深度及无TAA的采样相位。不是项目执行指令，也不能直接复制示例引擎的深度布局。

## TMP14顶点布料（2026-10-02核对）

- [作者演示](https://matthias-research.github.io/pages/tenMinutePhysics/14-cloth.html)、[作者源码](https://raw.githubusercontent.com/matthias-research/pages/master/tenMinutePhysics/14-cloth.html)：MIT许可；顶点粒子、边距离拉伸、相邻三角对边顶点距离的近似弯曲；示例15子步、每步各一遍；简单地面碰撞。当前只作候选接入参考，尚未加入项目顶点布料后端。

## 技术栈

### 后端
- [Node.js](https://nodejs.org/) - JavaScript 运行时
- [Express](https://expressjs.com/) - Web 框架
- [ws](https://github.com/websockets/ws) - WebSocket 实现

### 前端
- 原生 HTML/CSS/JavaScript (无框架)
- [MindAR Basic Image Tracking 示例](https://hiukim.github.io/mind-ar-js-doc/samples/basic.html) - 官方 A-Frame 图片识别示例
- [MindAR 项目与示例资源](https://github.com/hiukim/mind-ar-js) - Basic 示例使用的固定版本 `.mind`、卡片图片和 Softmind glTF
- [MindAR Core API](https://github.com/hiukim/mind-ar-js-doc/blob/master/docs/core-api.md) - 浏览器端 Compiler/Controller 接口与编译结果导出
- [MindAR 图片目标编译器](https://github.com/hiukim/mind-ar-js-doc/blob/master/docs/tools/compile.mdx) - 官方目标图片编译流程
- [ARCore 基础概念：运动跟踪](https://developers.google.com/ar/develop/fundamentals) - 视觉特征与 IMU 融合、相机位姿和锚点原理
- [DeviceMotionEvent - MDN](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent) - 浏览器加速度、角速度字段及运动权限
- [Softmind 模型许可](https://creativecommons.org/licenses/by/4.0/) - hiukim 模型采用 CC BY 4.0，页面保留署名

## 外部资源

### WebSocket
- [WebSocket API - MDN](https://developer.mozilla.org/zh-CN/docs/Web/API/WebSocket)
- [ws 库文档](https://github.com/websockets/ws/blob/master/doc/ws.md)

### Express
- [Express 中文文档](https://www.expressjs.com.cn/)
- [Express API 参考](https://expressjs.com/en/4x/api.html)

### 文件上传
- [multer](https://github.com/expressjs/multer) - Express 文件上传中间件

### TTS 语音服务

- [Qwen-Audio HTTP接口](https://help.aliyun.com/en/model-studio/qwen-audio-tts-http-api)：SpeechSynthesizer、format/sample_rate与audio URL。
- [Qwen-Audio音色目录](https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-audio-tts)：qiaoxiaojiao_v3.1。
- [豆包2.0单向HTTP](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)：req_params.additions序列化JSON及context_texts兼容限制。
- 项目使用自定义 TTS 服务生成语音
- 配置项：语音服务地址、端口

### Android MNN-LLM
- [阿里官方 MNN MnnLlmChat Android README](https://github.com/alibaba/MNN/blob/master/apps/Android/MnnLlmChat/README.md) - 官方 Android 构建参数、NDK 版本和 16 KB page-size 链接要求
- [MNN 官方 LlmSession](https://github.com/alibaba/MNN/blob/master/apps/Android/MnnLlmChat/app/src/main/cpp/llm_session.h) - APK JNI bridge 使用的本地会话接口

## 设计模式

### 客户端-服务器架构
```
Control UI (控制端) <--WebSocket--> Server <--WebSocket--> Display (显示端)
```

### 消息模式
- **请求-响应**: 控制端发送指令，服务器转发到显示端
- **推送**: 服务器主动推送状态更新到控制端
- **广播**: 服务器向所有显示端广播消息

### 状态管理
- 服务器维护所有显示端状态
- 控制端通过 WebSocket 同步状态
- 状态持久化到 JSON 文件

## 项目文件结构

```
web-mediacenter/
├── package.json                                  # 项目配置
├── 3rd/                                          # 第三方与子显示端程序
│   ├── voice-display/                            # Go 子显示端
│   └── voice-display-node/                       # Node.js 子显示端
├── config/                                       # 配置文件目录
│   ├── config.json                               # 主配置
│   ├── chat-history.json
│   ├── media-libraries.json
│   └── reminders.json
├── docs/                                         # 文档
├── res/                                          # 资源目录（models/uploads/temp/certs）
├── src/                                          # 分层代码主目录
│   ├── apps/server/boot/server-app.js            # 服务器入口
│   ├── apps/web-mediacenter/ui/public/           # 控制端/显示端静态页面
│   ├── core/                                     # 核心模块
│   ├── framework/                                # 基础设施模块
│   └── external/                                 # 外部能力适配模块
└── skills/                                       # 技能配置
```

## 相关参考代码

| 文件 | 说明 |
|------|------|
| docs/ref/search.js | 搜索功能参考代码 |
| docs/ref/smb2.js | SMB2 文件共享参考代码 |

## 常见问题

### WebSocket 连接问题
- 检查防火墙是否允许 WebSocket 连接
- 确认服务器端口正确
- 查看浏览器控制台错误信息

### 媒体播放问题
- 确认媒体格式受浏览器支持
- 检查文件路径是否正确
- 查看网络请求是否成功

### TTS 语音问题
- 确认 TTS 服务地址配置正确
- 检查 TTS 服务是否运行
- 查看服务器日志错误信息

## 西施2PMX导出

- [MMD Tools官方仓库](https://github.com/MMD-Blender/blender_mmd_tools)，使用 `mmd_tools/core/pmx` 序列化模块；导出时通过 `MMD_TOOLS_DIR` 指向外部仓库，本项目未复制该库源码。本次资源生成版本 `29d1478cf4385945b1c011d4c1e6adda7ad7cf70`。

## MMD-AR文字口型

- [pinyin-pro API](https://pinyin-pro.cn/use/pinyin.html)：中文转拼音，使用type=array/toneType=none保留按字音节，当前口型节奏由本地估算。
- [pinyin-pro源码](https://github.com/zh-lx/pinyin-pro)：本轮固定npm 3.29.5，归档SHA-512及逐文件大小/SHA-256记录在独立产物vendor/pinyin-pro/3.29.5/SOURCE.json，附MIT许可证。

## MMD-AR人体位置弹簧参考（2026-10-14）

[Bullet btGeneric6DofSpringConstraint原始实现](https://raw.githubusercontent.com/bulletphysics/bullet3/master/src/BulletDynamics/ConstraintSolver/btGeneric6DofSpringConstraint.cpp)：internalUpdateSprings将误差×刚度，再经fps×damping/solverIterations转换目标速度。因此本项目按目标响应率归一化旧Ammo弹簧damping，并由实际WASM回归验证；它与普通PD阻尼比的语义不同。只参考原生接口语义，没有复制VaM反编译源码。
