# 图片姿态默认切回MediaPipe Pose

状态：按用户确认完成切回，Node/WEB构建/真实浏览器通过，未出包或发布。

需求：恢复最早的MediaPipe Pose识别及估计3D点，不继续以RTMPose/深度/刚体临时试验为默认。只在全身IK图片面板生效，保留粘贴、实际骨架叠图、相机估计、3D拖点和此前身体完整度选人修复。

需求分析：主L6模型输入输出契约，次L5按需推理/取消/应用流程；按默认enterprise评估，能力必须拆至L4。风险中：检测器可能漏人物，world也只是估计，不应承诺坐姿恢复准确。已有声明/新增默认资源/识别操作流已写入spec顶部；本次不再新增选型或模型切换器。

Design：见docs/design/mmd-human-interface.md顶部，用户已选最早MediaPipe并确认worker/assets/ui/自测与本地构建范围。历史RTMPose模块和缓存保留，默认只分发两MediaPipe模型；兼容数据仍可由现有分支读取，不回退粘贴等新交互。

Spec：见docs/spec/mmd-human-interface.md顶部伪代码；固定11990159/5557238字节与SHA，检测NCHW224/姿态NHWC256，至多3候选/33点world与来源、原图aspect，应用原骨长重定向分支。

受影响文件：3rd/mmd-ar-test/web-human-pose-worker.mjs、web-human-pose-assets.js、web-human-pose-ui.mjs、pose-onnx-NOTICES.md；tests/mmd-ar-human-image-pose.test.js、mmd-ar-human-image-pose-browser.test.js、mmd-ar-human-rtmpose.test.js的默认分发断言，以及对应design/spec/self-test/usage/changelog。保留RTMPose专用解码与FK测试；不修改人体阻尼/求解器、临时报表或公共正式显示端。

步骤：默认模型契约测试先确认失败、同步真实浏览器断言 → 按已保存的MediaPipe实现恢复worker/assets并核对来源/清单 → 更新UI说明 → 定向Node测试 → npm run build:web:mmd-ar-test → 串行Edge真实ONNX/PMX及粘贴/叠图/相机 → 文档与Git同步。package无对应细分测试script，使用node --test；构建必须使用已有npm脚本。

自测：默认清单恰为2个固定MediaPipe模型；真实参考图33点各带有限world，人物左右语义正确；首次识别才加载两个权重、请求无上传且不读取RTMPose权重；应用实际270子步骨骼有限；空图/取消不改变旧目标；保留真实相机回环、候选选女孩非猪和粘贴/候选切换不自动应用。

兼容：仅全身IK入口且PBD仍隐藏；UI390px、剪贴板取消和模型切换代次、失败旧目标保持；RTMPose函数作为兼容继续通过既有用例。手机真实性能/WebGPU及高遮挡质量后验。

性能：两模型合计17547397字节（约16.7MiB），同源按需缓存，WASM单线程；记录本机实际推理时间，不外推到手机。候选上限3保持，模型缓存复用无需新增依赖。

风险：检测器对示意/漫画可能漏人，3D深度仍可能错误，使用者继续手调。仅默认模型回切，未承诺人体重建质量；不引入自动左右翻转。build脚本会重建固定web-dist，运行前验证目标确为工作区生成目录；不构建/发布APK，不上传私图/模型/输出。

发布状态：网页源码变更保留servicePackage=true，其他产物只按实际影响判断；当前相关stage受webMode限制，不修改Android资源或原生，不因此标记minApk。当前已为true，无须清除任何其他发布需求。

预计工时：约20–40分钟，实际浏览器与模型资源就绪情况可能影响时长。

## 实施与验证结果

从2500434a中恢复既有MediaPipe worker与assets逻辑，保留检测器至多3个独立候选、身体质量选人和低分跳过。worker创建会话前校验两模型名与顺序，避免旧RTMPose清单进入不兼容张量流程；每候选附source=mediapipe-pose、dimensions=3与原图imageAspect。UI恢复MediaPipe/33点/约16.7MiB说明及候选身份，现有world重定向无需改动。只有上述4个源/模型说明文件改变，近期RTMPose函数、FK/限位、临时实验和PBD选项不改。模型缓存与新分发两文件大小/SHA均通过，web-dist不再含RTMPose权重；ORT为1.26.0、WASM单线程。

默认模型契约测试先红：旧清单只有rtmpose-m-body7-384x288.onnx，不符合两MediaPipe文件。恢复后Node27项全通过（默认分发、MediaPipe预后处理/选人/world重定向/取消及RTMPose兼容、FK/相机/投影）。npm run build:web:mmd-ar-test退出0，事前已校验重建目录解析为E:/ref/web-mediacenter/3rd/mmd-ar-test/web-dist，无符号链接；只生成独立WEB，未构建APK。两个源worker/ui与生成副本去指纹后逐字一致，模型清单SHA有效；用户56173服务实际返回200及相同MediaPipe清单。

真实Edge浏览器19项通过：主全流程1项及剪贴板/叠图/相机父项加17子项。公开参考图33/33可信点、身体12/12、11控制目标；270个实际物理子步后仍有限，取消/真实灰图均不改旧目标。识别后才请求两个MediaPipe权重，没有RTMPose ONNX请求，所有网页请求为GET。实际相机匹配11对应点/图片高度误差1.9%，已恢复并验证后续手动相机；已知Three投影回环也通过。动漫真实图三候选中默认女孩，鼻点约[208.1,110.8]、身体11/12、应用10目标，选人修复保持。补充390×844识别布局无横向溢出后主全流程复跑通过。两次公开图推理约1217/1454ms（不含模型加载），不外推手机性能或准确率。

浏览器只观察真实Worker，不替换推理；公开参考文件和本机动漫图复用原样输入，未上传私图。截图留tmp/mmd-pose/mediapipe-restored-*.png，不入Git。恢复模型仅证实流程回切，未宣称坐姿/腿部或遮挡三维准确，手机和更广图片集仍待验。

复测命令：

```powershell
node --test tests/mmd-ar-human-image-pose.test.js tests/mmd-ar-human-rtmpose.test.js tests/mmd-ar-human-pose-camera.test.js tests/mmd-ar-human-pose-projection.test.js tests/mmd-ar-human-pose-fk.test.js
npm run build:web:mmd-ar-test
$env:PUPPETEER_EXECUTABLE_PATH='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
# 可选AASC_MMD_POSE_ANIME_IMAGE指向本机原动漫图；截图路径父目录须存在。
node --test --test-concurrency=1 tests/mmd-ar-human-image-pose-browser.test.js tests/mmd-ar-human-image-pose-clipboard-browser.test.js
```

servicePackage原已为true且保持，minApk/dependenciesPackage/taskCodePackage/voiceDisplayNodePackage原值不变；默认恢复完成从todo移除，只保留设备与质量未验项。代码和文档归档Git，模型/私图/生成物不提交，未部署外网或出APK。
