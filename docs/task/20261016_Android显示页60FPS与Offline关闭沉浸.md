# Android显示页60 FPS与Offline关闭沉浸

- 需求：Android显示文档JS动画上限60 FPS；APK请求60 Hz；Offline/full/min显示系统栏，普通APK保留沉浸。用户已确认方案。
- Design：[策略](../design/android-display-frame-policy.md)；Spec：[伪代码](../spec/android-display-frame-policy.md)，先于代码。
- 影响：display.html及新android-frame-scheduler.js；MainActivity和新AndroidDisplayWindowPolicy.kt；服务/min产物标记。
- 步骤：先帧调度/取消语义，再窗口profile/首次初始化和焦点恢复，最后文档、状态与Git同步。
- 用例清单：60/90/120/144Hz时钟、同批多回调/取消/回调内新增/异常、停止与可见性恢复、桌面不启用；Offline min/full首屏与重连系统栏、普通APK仍沉浸、API28/API30+、DeX分辨率保持。
- 兼容性：只调度当前Android显示文档的RAF，CSS/视频/跨源iframe仍受自身及系统控制；原生60Hz为系统偏好，不能冒充强制系统刷新率。
- 性能：同帧共享一次60FPS决定，回调保留原生句柄/微任务/异常边界，无待办无轮询；不重复执行物理/渲染，不合成时间戳。
- 风险：浮点间隔导致60Hz误降30、高刷相位抖动、取消和异常改变回调语义、系统栏布局变化；保留相位/微小时间容差和统一窗口策略。
- 预计工时：1–2小时；实际设备与性能验收另计。
- 自测约束：未要求测试，不新增/运行测试；记录静态检查与原生未编译/真机未验边界，不自动出包发布。
- 未明确项：无；范围已在确认问题中明确为Android显示页JS动画与APK系统栏。
- 状态：源码完成，node --check、HTML脚本顺序静态解析、git diff --check通过。未新增/运行测试，未编译原生/构建APK/发布/验收设备；service/min保持true。
- 实施：Android UA/NativeDisplay桥启用共享同帧放行决定与原生逐回调调度，保留相位、真实时间戳及取消/异常边界；MainActivity首屏直接读打包资源，统一启动/连接/焦点/配置恢复，Offline不装自动隐藏系统栏监听。
