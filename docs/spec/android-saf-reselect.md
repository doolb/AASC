# Android SAF 远程重选伪代码

```text
已有声明 := AascServerRegistry.request；AascNodeConnector.onRequest；MainActivity；SafMediaServer；SharedStorageAccess；MediaLibraryManager
新增定义 := safSelection { requestId, state, supported, hasDirectory, message }
新增命令 := android.saf.select；android.saf.status；payload仅含可选requestId
APK能力 := Android API29以上且原生网关支持directory-selection；无能力/旧宿主默认false
Node启动 := 探测带token回环网关 → 主节点/子节点发布androidSafDirectorySelection能力
控制端卡片 := 在线且能力true → 渲染重选按钮和状态
点击 → 标记处理中 → 复用既有AASC节点请求接口，type=android.saf.select
目标为当前主节点 → 只对此白名单动作本地执行；其他目标 → Registry.request沿原节点WebSocket执行
Node控制模块 → 只访问带token的回环HTTP原生网关，不传入远程URL/URI/路径
原生已有pending → 返回相同requestId，避免并发打开系统选择器
原生无pending → 校验API29/主Activity在前台 → 建立pending状态 → 主线程打开不导出的PickerActivity
原生拉起后10秒未收到Activity创建确认 → failed并允许重试，不永远卡pending
PickerActivity → 确认requestId绑定原生请求 → ACTION_OPEN_DOCUMENT_TREE；配置变更不重复启动选择器
用户取消/Activity异常 → 记录cancelled/failed，原目录保持
用户选择 → 必须完整持久化读写授权且验证成功，才替换APK私有树URI → succeeded
Node状态查询 → 校验requestId，白名单投影结果，隐藏URI/token
Node接受pending → 同时按秒有限后台观察终态，控制端关闭后仍可刷新新授权媒体库；单次请求归并观察，不重启Node
succeeded → 幂等补注册或重连android-saf受管媒体库、清理缓存；保留原默认媒体库
控制端 → 有限轮询状态；成功刷新服务器/媒体来源和当前SAF根列表；取消保留原显示
控制端单次请求 := AbortController 12秒；finally清理计时器，兼容不提供AbortSignal.timeout的WebView
控制端等待超时/网络断开 → 保留requestId，可再次点击继续查询；不当作原生取消
后台/旧宿主/旧Android → 明确失败或不显示按钮，不强行拉起后台界面
NodeServerService → API29以上始终传已启动网关连接，不依赖目录已授权
源码完成 → 仅servicePackage/minApk=true；不修改依赖/任务/Node独立ZIP状态
```

当前状态 := 源码已实现；三个JS语法、Manifest XML解析和diff空白检查通过；未新增/运行测试或编译/出包/发布/真机验收。
