# Android 显示页60 FPS与APK系统栏策略

## 已确认需求

用户确认Android显示网页JS动画上限60 FPS；APK向系统请求60 Hz。Offline完整/min APK关闭沉浸模式，显示状态栏与导航栏；普通noserver/withserver APK保留沉浸模式。网页按Android UA或APK NativeDisplay桥识别Android，桌面网页保持原调度。60为固定上限，不新增远端配置项；设备性能不足时不承诺达到60。

## 设计

在display.html头部、业务脚本前加载独立android-frame-scheduler.js，Android平台按浏览器同帧时间戳共享60FPS放行决定。每个逻辑回调保留自己的原生RAF句柄，浏览器继续管理回调之间的微任务检查点和异常；未到周期则重排该回调到下一原生帧。跳帧只减少业务回调频率，不更改浏览器真实时间戳。取消映射到对应原生句柄，支持取消本帧后续回调；回调内新任务由原生安排下一帧。没有额外常驻RAF或轮询，可见性恢复重置时基，不补历史帧。只控制当前显示文档的RAF动画，不宣称改变CSS动画、视频解码或跨源iframe自己的时钟。

独立AndroidDisplayWindowPolicy.kt管理系统栏和刷新率。Offline策略直接读取打包资源aasc_offline_mode，避免MainActivity字段尚未初始化时先进入沉浸。API30+使用WindowInsets显示系统栏并恢复内容适配；旧API清理隐藏/布局全屏标志。普通APK继续原沉浸行为。启动、连接、焦点与配置变化使用同一策略，Offline不注册反复隐藏系统栏的监听。刷新率优先当前分辨率的60 Hz模式，否则只设60 Hz偏好，不切换分辨率或声称系统必然采用。系统栏显示后布局由WebView视口自然重排。

评审采用analyze-requirement-level enterprise：主L5/次L6，证据为“限到60”“offline不使用沉浸”“普通apk上开”；权重L5两项/L6一项，一致性0.9，置信度0.60。评分24/25、19/20、18/20、18/20、14/15，共93，可开发；建议下放L4至帧批处理/取消语义、窗口profile分支和旧API兼容。主要风险为高刷新率时钟抖动、首屏/焦点恢复及系统刷新偏好可能不被采用。

涉及display.html、新网页调度模块、MainActivity薄接线、新原生窗口策略及文档。先spec后代码，不新增/运行测试，不自动出包发布；servicePackage/minApk保持待出包。当前：源码完成。JS静态语法、HTML解析确认首个脚本为调度器、diff空白检查通过；未新增/运行测试，未编译APK/出包/发布/真机帧率验收。service/min待出包保持true。
