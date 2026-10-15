# MMD-AR 图片姿态本地 ONNX 执行记录（已实现并本地验证）

## 任务与需求

全身IK暂时屏蔽PBD方式；静态图片识别人姿态并应用到现有VaM式人体物理。用户已选择浏览器/手机本地运行，可接受其他模型，追加询问是否可像ASR网页测试使用ONNX，并限定所有入口仅放在全身IK面板。已完成固定模型的桌面浏览器WASM实测，不将ONNX格式或单张图片通过等同所有设备/姿态准确。

design：`docs/design/mmd-human-interface.md`；spec：`docs/spec/mmd-human-interface.md`。主等级L6，涉及L5模型加载/识别/应用流程，建议先下放到L4资源与关键点数据流。输入为静态图片，输出为关键点预览及受约束的身体物理目标；首版单人，手指、表情与视频不包含。

## 影响文件与执行顺序

- 先验证固定OpenCV Zoo人物检测/Pose ONNX在当前ORT浏览器WASM上的创建与真实推理；确认输出、输入预处理、模型大小/指纹；WebGPU为后续兼容优化。
- 新增独立姿态Worker/客户端、模型资源准备、预后处理与骨骼重定向模块；复用同源按需加载组织方式，不使用Sherpa语音封装执行视觉模型。
- 修改`3rd/mmd-ar-test/web-human-ik-ui.mjs`、`web-human-ik.mjs`、`web-human-interface.mjs`、`web-human-build.js`，接入选择图片/识别/预览/应用，暂停PBD入口且确保Ammo初始化。
- 先更新spec再写代码；增加真实模型自测，构建优先`npm run build:web:mmd-ar-test`；完成后同步使用/自测/design/spec/changelog及实际产物状态，todo移除完成项。

## 自测、兼容性与性能

真实浏览器WASM推理，不仅校验会话创建；固定图片输出与官方参考对照；验证左右与镜像、不同模型身高、坐标映射、缺失点、无人和低置信度。人体骨长/PMX限位不改变，应用后目标稳定且可继续拖动，原有阻尼与Off流程回归。覆盖错误模型/算子失败/缓存缺失/重试、取消与切换模型过期结果、图片尺寸预算及资源释放。手机实测记录初始化/识别耗时和主线程响应，不预先承诺帧率或延迟；仅静态图片无需实时视频速度。

## 风险与待确认

- 单张图片的深度为估计，遮挡/扭转不唯一；低置信度保留原姿态并允许手工修正。
- ONNX转换产物已通过桌面ORT WASM算子与真图片验证，手机仍待验收；本版不启用WebGPU。
- 运行时/模型分开按需加载，同源及版本指纹固定；浏览器支持时缓存模型，同源本地站点可访问时无需外网推理服务，不宣称整个网页已安装离线Service Worker。不在Git提交模型二进制。
- 工作区已有其他对话修改，落地时只处理本任务相关文件与共享文档差异。
- 用户限定“只放在全身IK面板里”，按此约束确认实施：不新增独立网页或其他入口。先验证ONNX真推理再接UI，暂时保留底层PBD实现供恢复，仅屏蔽页面入口。
- 预计：模型兼容验证半天，UI/重定向及回归1～2天；实际以浏览器与模型兼容结果修订。

## 执行清单

- [x] 先写几何预处理/输出解码和重定向失败用例。
- [x] 固定模型来源/大小/SHA-256及ORT配套运行时，真实浏览器WASM验证。
- [x] 实现Worker与请求过期/取消/释放；客户端只在全身IK内按需创建。
- [x] 实现模型骨长重定向、原子应用和现有物理目标联动。
- [x] IK面板唯一入口、图片预览、识别/应用/取消与PBD屏蔽。
- [x] 网页构建、真实图片浏览器推理/应用和现有物理回归。
- [x] 只读代码审查、文档/自测/todo/changelog与实际产物状态同步。
- Git仅选择本任务源文件和文档，保留其他对话改动；提交/推送以版本历史及本次最终回复为准。

## 验证结果与问题闭环

- 模型固定revision：`47534e27c9851bb1128ccc0102f1145e27f23f98`；检测11,990,159 bytes/SHA `47fd5599d6fa17608f03e0eb0ae230baa6e597d7e8a2c8199fe00abea55a701f`；Pose5,557,238 bytes/SHA `9d89c599319a18fb7d2e28451a883476164543182bafca5f09eb2cf767ed2f3f`。JS/MJS/WASM来自同一已安装ORT1.26.0，附模型Apache-2.0及运行时MIT许可。
- 几何/解码/重定向先RED（模块尚未实现）后GREEN；真实Ammo批量应用先因缺入口失败，新增后通过；Worker传输失败先因未释放线程失败，修复后通过。
- 只读审查发现P2：应用等待Ammo期间取消/收起，迟到完成仍启用IK。抽出`ensureInteractivePhysics`保留旧逻辑，延迟加载用例出现Missing expected rejection；加await前/后请求有效性、token/mode守卫，且UI传递图片代次，回归通过。复查确认闭环，无新增阻断问题。
- 最终定向：`node --test --test-concurrency=1 tests/mmd-ar-human-image-pose.test.js tests/mmd-ar-human-physics.test.js tests/mmd-ar-human-damping.test.js tests/mmd-ar-human-ik-pbd.test.js tests/mmd-ar-ik-markers.test.js tests/mmd-ar-ik-camera-gestures.test.js tests/mmd-ar-human-actions.test.js`，53/53通过，无跳过。
- 真实Edge/SwiftShader：图片浏览器1/1、原身体物理浏览器1/1分别通过。公开参考图得到33/33可信点，左腕x>0.65、右腕x<0.35、右膝x<0.45及估计3D左右检查通过；应用11个目标，270子步持续运行无无效位姿；取消与空白图保留旧目标。实际源码无图片上传，测试HTTP全部GET。
- 图片流程初次运行约138ms，最终渲染负载下约1404ms（均不含首次模型下载/会话创建）；独立Worker轻载探针约128ms，不作为手机性能承诺。未与官方Python输出逐点数值比较，未测实际手机、更多照片/PMX，均保留todo。
- 模型缩放2倍/旋转/平移后的局部骨长验证通过。`npm run build:web:mmd-ar-test`完成；源/生成模块语法18项、内容9项、依赖指纹22项与两份模型大小/SHA-256通过，`git diff --check`通过。
- 中间验证异常已处理：构建重建web-dist时读取待机夹具发生ENOENT，改为构建完成后执行；软件GPU浏览器并行争用过慢，改为串行；旧浏览器仍选择已屏蔽PBD的测试改为断言页面仅physics、用内部API保留生命周期检查；取消用例的两次跨进程点击可能晚于推理结束，改为同一DOM任务内点击识别/取消，最终通过。
- 本次只改独立3rd网页；既有依赖集合及正式src/Android未改，Offline状态原值`minApk=false/servicePackage=true/dependenciesPackage=false/taskCodePackage=false`保持，不把他项待发布状态清零。生成目录含模型和ORT，仅本地保留；未APK/服务包构建、未发布。

## 参考

- [ORT Web](https://onnxruntime.ai/docs/tutorials/web/)
- [ORT 环境与会话配置](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)
- [OpenCV Zoo Pose ONNX](https://github.com/opencv/opencv_zoo/tree/main/models/pose_estimation_mediapipe)
- [OpenCV 参考预后处理与估计3D输出](https://github.com/opencv/opencv_zoo/blob/main/models/pose_estimation_mediapipe/mp_pose.py)
