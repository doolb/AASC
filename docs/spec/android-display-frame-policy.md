# Android帧调度与窗口策略伪代码

```text
已有声明 := display.html；window.requestAnimationFrame/cancelAnimationFrame；MainActivity.applyDisplayWindowPolicy；aasc_offline_mode打包资源
新增定义 := frameScheduler { pendingCallbacks, nextId, decidedFrameAt, frameAllowed, lastDispatchAt, interval=1000/60 }
检测Android := UA包含Android 或存在NativeDisplay桥；不满足则不替换浏览器RAF
网页脚本加载 := 必须先于显示页业务脚本安装，每个文档仅安装一次
请求帧 → 分配逻辑ID与原生RAF句柄；回调仍由浏览器逐个调度以保持微任务/异常边界
浏览器回调 → 先确认未取消；同一真实帧时间戳共享一个允许/跳过决定
本帧第一次决定 → 未到60FPS周期则跳过；到达则更新相位，不能追赶补执行历史帧
允许 → 删除本逻辑任务，调用原回调并传原生时间戳；浏览器负责微任务检查点与异常报告
跳过 → 仅为此未完成任务登记下一次原生RAF
取消帧 → 删除逻辑ID并取消对应原生句柄，支持本帧尚未执行的其他回调
回调内新增 → 经原生RAF进入下一真实帧，不能在本帧立即调用
无待办 → 没有额外定时器或常驻RAF；隐藏/恢复 → 重置时基，不补发历史帧

窗口策略读取 := resources.aasc_offline_mode，不依赖onCreate稍后赋值的offlineMode字段
Offline → 清FLAG_FULLSCREEN及旧隐藏/布局标志；API30+ show(systemBars)并setDecorFitsSystemWindows(true)
普通APK → 保留旧沉浸隐藏方式；不改变普通APK全屏意图
系统栏可见监听 := 只为普通APK安装重新隐藏监听；Offline首屏/连接/焦点恢复仍执行显示系统栏策略
窗口刷新 := 设置preferredRefreshRate=60；存在当前物理宽高且约60Hz模式 → 选择该modeId；否则只提交偏好
配置变化/窗口焦点恢复 → 重用相同窗口策略，不创建另一套状态
编排/网页输入改变 → servicePackage=true；原生改变 → minApk=true；其余状态保持
验证边界 := 静态检查与代码审查；未请求测试则不新增或运行测试，不构建/发布APK
```

当前状态 := 源码已实现；调度器语法/HTML脚本顺序解析/diff检查通过；未新增或运行测试，原生编译和真机帧率尚未验收。
