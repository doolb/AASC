# 控制端服务器面板重选 Android SAF 目录

## 需求与交互

用户已确认在控制端服务器面板增加“重选 SAF 目录”。只有支持新能力且在线的Android 10/API29以上节点显示按钮，包含当前Offline主服务器与远程Android子服务器。点击后目标Android设备打开系统文件夹选择器；控制端显示等待、成功、取消或失败。用户在目标设备确认目录，控制端不上传或保存content URI。Android9旧共享存储行为保持。

重选期间保留旧目录；取消、授权失败不替换原授权。成功持久化完整读写权限后，既有SAF虚拟根/切到新目录，刷新受管媒体库和相关显示；不移动或删除目录内容。目标应用未在前台时明确提示先打开应用，不绕过系统后台限制。首次需更新APK，之后网页按钮和Node编排随服务代码包更新。

## 评审与实现边界

采用analyze-requirement-level enterprise：主L5/次L6，证据为“控制端服务器面板”“重选androidsaf目录”“按钮”；三项权重L5/L5/L6，一致性0.9，置信度0.60。清晰24/25、证据19/20、完备18/20、风险18/20、L4可落地14/15，总93，结论可开发。建议下放至L4，拆为能力声明、带type节点动作、原生单次选择及状态、终态刷新；中风险来自Android前台、异步结果与兼容旧APK。

复用/api/aasc/servers/:nodeId/request和AASC节点请求；type分别为android.saf.select与android.saf.status。当前主节点直接调用同一白名单处理器，远程沿既有WebSocket连接。该动作授予系统权限，非新增运行参数配置；URI只由APK SharedPreferences维护，不新增公开HTTP配置接口。Node到原生只复用带随机token的127.0.0.1 SAF网关，新增选择动作/状态，不向控制端暴露网关凭据。

新APK通过网关能力探测声明androidSafDirectorySelection；旧APK、Android9和普通Linux节点默认无能力。即使没有旧授权，Android10+仍将SAF网关连接传给Node，以便取消过首次选择后能补选。并发选择归并同一个待选requestId，状态轮询有限时；控制端等待超时允许继续查询，不伪造取消。成功后媒体库注册/连接与清理缓存，不重启Node/播放器。

源码范围：server-list.js；新android-saf-control.js及server-app.js薄接线；SafMediaServer、NodeServerService、SharedStorageAccess、MainActivity生命周期薄接线、新SafDirectorySelection/SafDirectoryPickerActivity及Manifest。不新增或运行测试，记录静态检查与未验边界。当前：源码实现完成，三个JS文件语法与Manifest XML静态解析通过；未新增/运行测试，未编译APK、实际出包/发布或Android10+真机验收。servicePackage/minApk已标true，其余原值保留。
