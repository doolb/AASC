# 控制端服务器面板重选 Android SAF 目录

- 日期：2026-10-16；用户已确认具体改动范围。
- Design：[功能与边界](../design/android-saf-reselect.md)；Spec：[伪代码](../spec/android-saf-reselect.md)，先于代码更新。
- 任务：Android服务器卡片增加重选按钮，目标设备完成系统目录授权，成功刷新，取消保留旧目录。
- 影响：网页服务器列表、Node独立SAF控制模块与server-app薄接线；原生SAF网关/服务环境/授权 helper/MainActivity前台标记、新PickerActivity与Manifest。
- 执行：补能力探测与节点动作、原生单次选择/状态、控制端轮询、媒体库刷新与文档状态同步；仅标service/min待出包，不真实出包/发布。
- 用例清单：当前主节点/远程子节点；成功/取消/读写不完整/后台/离线；无旧目录/旧APK/Android9；并发归并/轮询中断继续/旋转；原URI与token不出设备；旧文件不移动删除。
- 兼容性：旧APK无新能力不显示按钮；API28旧存储保持；API29+取消首授仍能补选；旧Node默认不接新命令。
- 性能：能力探测有短超时，控制端按秒有限轮询；不遍历/搬迁整个目录，不为重选重启Node。
- 风险：Android后台启动限制、系统选择耗时、结果与缓存异步、同时多个控制端；以前台检查、单次requestId、终态幂等刷新处理。
- 预计工时：实现及文档2–4小时，Android10+真机验收另计。
- 不明确项：无；沿用API29边界，只让目标设备操作系统选择器。
- 自测约束：未明确要求测试，不新增/运行测试；允许静态语法及命令帮助检查，不将其当真机或端到端通过。
- 状态：源码完成，三个JS文件node --check、Manifest XML解析和git diff --check返回0。未新增/运行测试，未编译APK/实际出包/发布/Android10+设备验收；minApk/servicePackage=true仅表示需出包。
- 补充：当前主节点使用本地白名单处理器，远程子节点沿AASC WebSocket；宿主前台弱引用、独立不导出Activity、完整读写授权后替换URI。Node有界后台观察终态，控制端关闭也可补注册媒体库；UI三分钟轮询后保留会话可继续查询。
