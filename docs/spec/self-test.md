# 自测功能实现文档

## Node常驻mpv与系统TTS自测（2026-10-22）

```text
自动入口 := npm run test:node-display-mpv → 15/15，零跳过
IPC夹具 := 独立Node子进程和真实socket，Linux/Windows命令/管道参数、回执/超时/失败、快速切换/清空取消、崩溃重建、初始化退出和临时资源回收
几何对照 := 从现有display.html提取真实applyCrop → 两种媒体尺寸×两种窗口尺寸×四方向×六模式=96组 → 矩形尺寸和裁剪偏移数值一致
AASC接入 := 提取真实VoiceDisplay类，执行url/base64/control/restoreState/capabilitiesUpdated分支 → 状态/暂停断点/回执/权威能力；新媒体和清空不被旧恢复覆盖
TTS兼容 := 原AudioPlayer实际分支 → Windows PowerShell SoundPlayer/Linux aplay；TTS开始/停止不调用mpv，清空媒体不停止TTS，mpv关闭独占音频
实机入口 := npm run test:node-display-mpv:real → 1/1，真实mpv+ffmpeg生成媒体+本机HTTP，以null输出验证三类媒体、PID保持、暂停断点、旋转和清理
既有回归 := 语音/重连28/28、独立包22/22，零跳过；语法与差异检查通过
边界 := 未打开真实屏幕/发声，Windows实机与X11现场权限、实际混音仍待验收；未构建/发布本轮包
```

## 豆包共享JS、单页签与请求类型自测（2026-10-22）

```text
共享运行时 := 桌面直接执行函数与Android序列化执行同一JS；SDK准备不联网、签名身份/来源验证、UTF8流容量/事件、取消及旧APK升级错误均覆盖
平台资源 := rootDir端口租约/末租约关闭、关闭中再次借用、开页中停止不迟到创建、同账号页复用；专用Vivaldi现场确认1个受管页
协议修复 := JSON.parse后的related_deleted_message_ids必须非Array且深等于{}；原先比较空数组/空对象未区分导致漏报，旧“正文一致”结论已修正
缓存 := 内存携带当前平台Cookie，私有文件不存Cookie；Referer不分大小写替换，避免重复头破坏持久化恢复；恢复/失败单次补发定向26/26
回归 := npm run check:chat2api最终358/358、零失败零跳过；Kotlin compileDebugKotlin/testDebugUnitTest账号2+页缓存1全部通过
桌面Responses := 直连首轮14字/23994ms、续聊27字/4675ms；网页首轮14字/7234ms、续聊90字/5356ms；两轮直连只prepare一次
AndroidResponses := 直连首轮13字/7311ms、续聊25字/3755ms；网页首轮5字/4244ms、续聊136字/5397ms；min73隔离最新版JS，各模式权威ready/2轮
断言 := 所有8次均HTTP200+非空正文+response.completed，不用仅HTTP200判断成功；无system测试提示、不向当前AASC对话写入
产物 := npm run build:apk:offline:min成功，73/0.2.73-offline-min，v2签名通过，SHA256=83f20e35cc47ec0d5936efe9c96512a3bb67e59fe38d9abb6ccbd4f77714aa3d；未发布
清理 := 8个仅测试上游会话单独删除均status_code0；隔离运行时/新增转发/设备测试目录/原始敏感抓取清理；手机恢复原min72，正式code148与39进程未更新
后续 := 新min73与服务包配套部署后验证正式入口；签名长期有效性、手机重启及关闭页面观感继续设备验收
```

## 专用profile官网UI对照自测（2026-10-21）

```text
用户动作模拟 := 当前独立profile、DISPLAY=:1 Vivaldi/CDP9224、新官网页、输入早、点击发送；不以fetch模拟点击
结果 := HTTP200、SSE_ACK/CHUNK_DELTA/SSE_REPLY_END、无非零业务错误，10831字节；DOM显示早呀☀️，今天打算做点什么？
差分修正 := 2026-10-22发现旧比较忽略空[]/{}类型，related_deleted_message_ids默认类型错误已修复；网页版本3.42.1对保存3.41.0，签名/tab/token及请求头不同；Cookie名称集合相同但6值更新
边界 := 不把UI成功外推成现有Chat2API兼容成功，不把某字段差异直接判为根因，不以当前源码推断旧进程全部实参
清理断言 := 仅本轮1个官网会话删除HTTP200/status_code0；私有临时抓取文件删除；本轮9224关闭，原9223/8083保留
```
## MMD-AR HMR2 API 与整图深度集成（2026-10-21，完成）

```text
调度 := npm run build:web:mmd-ar-test结束并确认真实PMX/VMD存在 → 再运行读产物的数值/浏览器测试；不与构建清理并行
协议 := 独立实际wire fixture + 注入fetch，不开GPU服务 → health不编码/不POST、PNG/xyxy/16MiB、实际BODY25/相机/24旋转校验
隔离 := 编码/fetch/JSON/进度/超时/取消/新请求单飞/dispose → 迟到不上传、不提交；token不保存
纯UI := 无Three importmap的旧图片/Clipboard壳仍可导入；共享肢段/过滤只依赖纯语义模块
深度纯函数 := 固定预处理/SHA + RGBminimal抗混叠双三次/14倍数 + 有限[1,H,W]/P5P95/黄近蓝远/共享1e-5退化灰
预算 := 1600x900→924x518、1000x600→868x518；最长1024且最多518*1024像素，minimal超预算提前拒绝
资源 := 构建必检真实SHA与许可；有SubtleCrypto时Worker检SHA；gzip/br不把传输长度误当解码长度，仍有界读取；LAN缺Crypto不承诺传输完整性
弱线索 := 5x5稳健采样 + 八段白名单/正权重0.25上限/端点可用/去重/原生冲突；只提供可见表面符号，不当人体归属或米制z
真实PMX合成回环 := 从真实骨架投影构造BODY25（非HMR识图真值）→ 同一FK固定骨长/限位/变换/原数据保持
真实提交 := BODY25合成姿态 → createHumanIK异步真实FK/Ammo提交十个身体目标 → 物理推进有限；isCurrent=false不改已有控制目标
关闭/空辅助等价 := depthEnabled=false逐值相同；MP零线索/全冲突沿原同步入口且head保持；有效MP辅助head仍来自合法FK
尺度 := 固定同view身体跨度归一化；模型均匀scale1/2/10及等价PMX单位变换下非零排序loss不漂移
相机 := 只匹配十二实际身体语义，不把nose当头骨；恢复/所有者/PMXtoken保留
浏览器 := 专用UI壳/Human提交记录 + 同源HTTP mock（不是GPU）→ API配置/PNG/预览/503/Token会话；八类取消都观测原生AbortError及HTTP关闭
真实DA := 专用Worker实际加载ONNX+ORT，不替换输出 → 当前图浮点/热图/计算阶段取消/终止/迟到隔离
原入口回归 := 原真实MediaPipe图片及实际PMX/物理 + 剪贴板浏览器 + 原真实FK/相机/物理自测
边界 := HTTP mock不等于真实GPU联网，UI stub不等于VaM实际效果，合成PMX回环不等于识图精度；深度计算进度不是细粒度WASM栈观测
```

参见[接入结果](<../task/20261021_1536_MMDAR接入HMR2GPU与整图相对深度.md>)。

## 192.168.1.39当前豆包双传输复测（2026-10-21）

```text
方式 := 现有8083 Responses流式接口，正式已保存账号；自然输入早，无system提示；临时API Key及临时WS任务实例
直连 := 首轮HTTP200、0字、response.failed/doubao_upstream_failed，848毫秒
兼容 := 主8083入口在doubao.web运行后首轮HTTP200、0字、同错误，19532毫秒
网页诊断 := 追加一次只读CDP观测，上游HTTP200、SSE_HEARTBEAT → STREAM_ERROR/error_code710020202，无会话创建ACK，5720毫秒
判定 := 首轮均未通过；不发送previous_response_id续聊，不能将HTTP200记为成功
恢复断言 := 临时Key0、临时实例已删除、9091/9224关闭、8083保留、Responses会话前后176
局限 := 未确定业务码具体原因；账号缺requestProfile但有30/24项快照；不把早前Note8隔离实验当当前桌面部署验收
```

## 豆包账号签名跨会话复用自测（2026-10-21）

```text
真实策略实验 := Note8/min72隔离Responses，一次prepare、两个新官网会话、第二会话续聊；三次同签名URL且HTTP200完成，14/15/28字，两个local ID/三条消息ID不同，权威ready轮数1/2，签名最大年龄35511毫秒，无自动补发
实际模块 := accountId+mode0规范键、凭据摘要隔离、无AASC ID普通请求共享；新会话/snapshot/上游变化只改变本轮正文参数，不触发重签；128项LRU按账号计
私有文件 := 旧会话签名查最近匹配项，成功归并为规范键；重建Responses服务后直接新建聊天可读旧文件且不签名；凭据变化重新准备，失效删除全部同签名别名
并发 := 迟到旧错误/失败补发不删另一会话更新的新URL；并发从文件读出的不同对象若签名值相同须一起失效，后续不能重新载入坏签名
结果 := 三文件定向37/37；npm run check:chat2api 348/348，零跳过；语法/差异检查通过
清理 := 登录样本自动删除，两测试官网会话逐个status_code0，临时Key为0，测试目录/新增ADB转发移除，原9222保留；无正式账号及AASC聊天测试污染
发布 := 本次只改Node模块，servicePackage=true；既有关闭页面min APK待办不改变，服务部署及正式入口重启/新会话验收待进行
```

## 豆包签名持久化与成功后关闭自测（2026-10-21）

```text
配置 := settings测试验证WS布尔校验、config.set成功后广播、保存失败权威回退、非控制端拒绝；实际UI脚本验证等待权威回执、失败回显、断线默认false及重连/晚加载面板补拉
私有文件 := 0600、固定官网和头白名单、禁止Cookie/消息、损坏/超大/符号链接不加载、原子替换不修改链接目标、同目录多实例写入无丢失、128项淘汰、带旧版本条件删除不误删新签名
Responses := 首轮签名落盘 → 重建服务/适配器/存储后同一previous_response_id续聊不再准备 → 拒绝旧签名后重签补发一次并覆盖文件 → 新会话和凭据版本变化重新签名；写盘失败不改变成功回复，失败流不保存
原生桥 := closeAfterPrepare只发送至prepare；开启时要求end.webViewClosed=true，旧APK报明确更新错误；fetch忽略关闭标记
Kotlin := DoubaoWebViewPageCacheTest + DoubaoWebViewAccountTest共3/3；同页复用、关闭后按需重建、迟到旧实例关闭不伤新页、账号资料及登录租约；compileDebugKotlin通过
验证结果 := 五文件定向40/40，npm run check:chat2api 345/345，零跳过；UI晚加载修正定向2/2；服务/网页语法及差异检查通过
产物 := servicePackage=true/minApk=true，尚未构建或安装新版APK，本轮未对真实账号制造风控；原生销毁后的官网重签和正式APK重启待真机验收
```

## Android豆包失败重签补发自测（2026-10-21）

```text
协议栈 := createChat2ApiResponsesService + core + store + 真实豆包适配器，底层HTTP2/SDK以故障注入替代联网；不故意触发真实账号风控
恢复 := 流式/非流式HTTP403、SSE风控、socket hang up均在无内容时重新准备并发送一次；保持原消息正文/ID/unique_key/权威上游ID，第二次成功后缓存新签名，历史只追加一轮且无签名
次数 := HTTP失败后SSE仍失败共用一次额度，最多两次HTTP2调用，Responses只抛最终错误，原生会话保留uncertain保护
边界 := 已收到正文或思考即禁止重放（含非流式），取消/return在第二次签名等待时停止；本地参数及网页兼容不补发，失败首轮不提交缓存
总时限 := 首次120毫秒预算包含首次发送和第二次准备，第二次只拿剩余预算，超时不发送第二次网络请求
结果 := 两文件定向29/29；npm run check:chat2api 337/337，零跳过；差异检查通过
发布 := servicePackage=true保持，本次Node服务代码需要重新出包部署；minApk=false，无原生改动；真机故障恢复未实发验收
```

## Android豆包按会话签名自测（2026-10-21）

```text
真实短时实验 := Note8/min72 + 隔离Node源码/账号 + Responses流三轮 → prepare调用1次、复用2次 → 正文14/26/10字，HTTP200且完成；第三轮签名年龄83843毫秒，权威上游ready/3轮
协议测试 := chat2api-doubao-responses.test.js真实Responses service/core/store/适配器，三轮prepare仅一次；正文、unique_key及消息ID更新；同AASC snapshot新签名；取消不发网；风控不重发且uncertain
缓存边界 := chat2api-doubao-android-prepare.test.js验证账号/凭据修订及原值/AASC/上游/重建/新实例隔离，HTTP401/403和SSE风控清缓存，429/取消保留，失败首轮不提交、无内部身份/非原生模式逐次签名，128项LRU
回归 := 定向23/23；npm run check:chat2api 331/331，零跳过；git diff --check通过
清理 := 登录样本自动删除；仅删除隔离Responses确认的一个三轮测试官网会话，status_code0；测试Key剩余0；隔离目录及新增ADB转发已删除，原9222保留
部署 := 新正式缓存逻辑已通过协议/边界回归；上述真机实验为缓存策略验证，未宣称正式服务已更新；servicePackage=true，minApk=false，本次无需构建APK；更长有效期仍待观察
```

## Android豆包直连与兼容联合自测（2026-10-21）

```text
实际APK脚本 := Node VM执行Chat2ApiDoubaoRequestCapture.script及DoubaoWebViewNodePrepare.script；真实Request/Response立即消费、单ID清理、业务失败重试、授权/账号边界、SDK参数匹配与准备不联网
JVM := Chat2ApiDoubaoRequestCaptureTest + DoubaoWebViewAccountTest → 4/4；来源/身份/设备字段及登录运行互斥
Node回归 := npm run check:chat2api → 325/325；补充签名脚本与签名后Node HTTP2顺序定向 → 2/2
产物 := min72成功构建并覆盖安装Note8，SHA256 ecbefb237eb4a79ced3c79b733d5aac6cf628cfbbb6bb9d13b882a4dba0d789c；尚未发布
官网捕获 := min71本次成功SSE样本经原生规范化后自动删除，HTTP200/status_code0 → 完成按钮成功保存 → UA改为Note8/WebView132
直连 := min72 + 隔离最新Node源码 → WebView仅生成当次签名 → Node HTTP2联网 → Responses流首轮14字、同会话续聊20字，均HTTP200并完成；nativeState=node-http/ready/2轮
兼容 := 真实TaskManager创建并运行doubao.web/ad183ee1 → 关闭登录页后Responses首轮5字、续聊135字，均HTTP200并完成；nativeState=browser-fetch/ready/2轮
清理 := 停止测试实例；临时API Key剩余0；仅删除隔离Responses记录确认的4个测试官网会话，逐个单ID且status_code0；当前AASC聊天与正式账号未写入测试数据
部署边界 := 手机正常服务仍code148；上述Node修复在独立临时源码/账号/任务目录验收，需构建并更新服务代码包后在正式入口使用
```

## Android豆包JS启动端点自测（2026-10-21）

```text
Kotlin定向 := NodeServerServiceTest验证正常端点成对传递、缺失端点省略、非法端口/令牌拒绝；18/18通过
启动器回归 := npm run test:offline-launcher → 41/42；候选目录清理ENOTEMPTY失败项单独重跑1/1通过
真机 := Note8/API28/WebView132，min70/code148；端点环境、运行实例、9091健康与未授权IPC401通过
官网 := 两个新会话UI请求完整非空SSE与会话列表验证通过；完整登录样本保存未通过
Responses := 独立临时API Key发流式首轮，502/doubao_upstream_failed，无正文/完成事件；不继续续聊；结束删除API Key并停止测试实例
待修复 := 登录样本观察器克隆时序、外部登录销毁清理共享登录态，以及完整Responses链路
```

## 控制端音色试听入口只读自检（2026-10-20）

```text
control_tts_voice_picker → 查询已渲染列表的每个选择按钮
选择按钮 → 保留原 aria-selected 对应的主题皮肤、文字和勾选状态
试听按钮 → 与选择按钮同属一行且为独立 button，不能嵌入选择按钮
自测 → 不点击试听、不请求合成、不下载 WAV、不保存配置
真实播放、30项缓存及双端行为 → 由音色浏览器与 WebSocket 定向测试验证
```

## 显示端主题面板光晕自检（2026-10-19）

```text
控制端自测入口 → 检查三个光晕输入、预览节点和共享光晕管理器存在
共享管理器 → 检查权威配置、配置错误回退、断线回退方法可调用
配置参数 → 颜色为六位十六进制，中心亮度范围为0～20，扩散范围为25～90
显示端真实面板 → 由浏览器定向测试检查三个输入、实时预览、配置消息、错误回退与小视口滚动
```

控制端自测只验证当前页面的控件和共享管理器接口；显示端页面行为由 `tests/display-background-glow.test.js` 和 `tests/display-appearance-controls.test.js` 验证。

## HMR与人物分割清理后自检（2026-10-16，已完成）

```text
清理前 := 精确文件清单与无链接校验 → 保存HMR模型/原始结果、分割模型/输入/物理结果、共享深度/控制数据和原图SHA
清理后 := 所有计划删除文件不存在；保留摘要逐项不变；共享模块的相对import/require目标仍存在
隔离服务 := 只在测试进程内启动并finally关闭自己的临时HTTP服务，不接管用户运行服务
静态资源 := HMR页面/三图/人物分割现行与leg报告/Depth PNG/ONNX/ORT/Three返回200；被清理报告返回404
RTMPose := 试验固定URL响应与既有model-cache权重SHA一致，正式MediaPipe构建保持原样
可选--worker := 真实PPHumanSeg+RTMPose Worker重跑三图九输入，仅回传检查摘要不写原始结果；原图二维与缓存一致、两session释放及取消语义正确
自选图 := 自选HMR接口保留，非法人物框400；既有check-custom-report使用注入测试结果验证交互并真实运行浏览器Depth
回归 := 既有HMR报告三图/四候选与人物分割unit/leg-unit/results/leg-results/report/leg-report
边界 := 不重写HMR和分割推理结果，不以静态完整性/模拟HMR接口宣称重新推理或姿态质量改善
```

执行结果：保留检查默认124项、真实`--worker`138项通过；分割unit21/leg24/results89/leg-results58、分割浏览器25/leg36项及HMR三图/四候选/自选UI＋真实Depth通过；102项保护摘要不变。HMR Python与Ammo物理本轮未重新运行，qualityPasses=0仍按原结果展示。旧试验移除与历史记录状态详见[本轮实际自测](../self-test.md)。

## HMR2.0b 整图相对深度显示（2026-10-16，已完成）

```text
三图同源SHA → 本机既有Depth Anything V2 Small PNG → Edge解码并与所选图一一对应
深度清单SHA不匹配 → 不显示可能过期的深度图，HMR原结果保留
HMR动漫原版/四候选切换 → 深度仍为同一动漫原图，原始模型结果保持
WebGL失效 → 线条骨架与深度均保留
深度PNG返回404 → 明确提示缺失，原图叠点/3D骨架继续显示
桌面三列与390px单列 → 无横向溢出；页面错误0，本机GET
```

`check-report.cjs`在增加图之前因缺少深度而失败；完成后上述三图、候选、缺失、SHA不匹配及回退用例通过。这里只验证显示与来源对应，不代表深度能恢复被遮挡脚掌或米制关节位置。

## HMR2.0b 动漫脚掌候选（2026-10-16，工具通过、姿态质量未改善）

```text
固定原版动漫JSON不覆盖 → 同权重四候选真实CPU重推理并分别保存
各候选25点有限、镜像左右语义恢复 → XYZ/相机投影回原图与保存XY差小于0.001px
Edge报告切四候选 → 模型来源、实验标签、原图叠点与24骨段/25关节正常
切回原版 → 原始JSON字节不变；切真人/示意图 → 实验选项隐藏
三图/WebGL回退/390px/本机GET回归继续通过
质量检查 → 四候选脚趾仍偏离可见鞋面，因此没有一个被采纳
```

`run-hmr2.py --anime-foot-trials`完成四次本机CPU推理；`check-report.cjs`验证数据、投影与页面切换通过。质量结论为失败，不能用工具测试通过代替识别正确。

## HMR2.0b 报告立体骨架（2026-10-16，已完成）

```text
真实三图JSON与原图 → Edge本地页面 → 每图24圆柱、25球、三盏灯且无投影阴影
受光网格绘制 → 真实WebGL上下文与画布像素 → 拖动视角变化、双击归零
390像素视口 → 原图/立体画布不横向溢出
模拟WebGL上下文不可用 → 原二维线条骨架仍显示，识别结果与原图叠点保留
浏览器请求 := 只允许本机GET；页面脚本错误 := 0
```

`tmp/mmd-pose/depth-eval/hmr2-sam3d/check-report.cjs`先对原线条实现断言WebGL而失败，立体网格实现后真实三图、交互、回退与移动宽度均通过。测试只验证渲染正确；坐姿膝部左右归属仍错误，不能把受光球柱当识别质量通过。

## HMR2.0b 独立三图对照（2026-10-16，工具通过、姿态质量未达标）

```text
固定三张原图SHA/尺寸/人工框 → 审计官方源码commit、checkpoint、配置和姿态均值
严格加载backbone/SMPL head全部权重 → 校验checkpoint SMPL缓冲区形状和BODY25顺序
官方裁剪/网络前向 → 官方smplx.lbs和BODY25 → 原始关节/相机/原图坐标保存JSON
各关节有限、深度为正 → Edge真实三图切换/叠图/3D、无脚本错误、本机GET、390px无溢出
记录模型加载/单图推理/峰值工作集；人工检查真人抬高左腿、动漫和示意图的遮挡/末端
工具通过不等于姿态准确；真人膝左右对应错误则不接VAM
```

本机`tmp/mmd-pose/depth-eval/hmr2-sam3d/`已用官方checkpoint内的SMPL层张量完成三图真实推理，无需单独SMPL文件。Python3.10 CPU严格权重加载、SMPL张量/BODY25顺序、有限坐标检查通过；Edge三图真实JSON与绘图、390px、本机GET检查通过。峰值工作集约5.9GiB；真人坐姿抬高膝更接近模型右膝而用户确认属于左腿，姿态质量未通过。详细复现见[模型测试方法](../usage/mmd-pose-model-testing.md)。

## 二维投影刚体与深度辅助（2026-10-16，本机评估完成，质量未达标）

```text
合成 := 102项力方向/横向射线自由/非法输入/力限幅/合成下降/偏心力矩通过
实际 := 18支同321骨初值、720子步、72正侧图 → 145项数据/哈希/同相机/原始二维/显示骨长限位/释放通过；原生框架与显示落差不隐去
报告 := 22项三图三种子/八视图/原生与PMX叠加/390px/切图代次/无线索/异常通过
质量 := 当前初值8.29到8.42、7.36到7.36、7.67到7.67百分比；18支全部未达本轮3%诊断线，质量通过0；不把工具通过当姿态通过
深度 := 固定27MB量化Small、本地WASM三图1.44/2.61/2.88秒 → 3/1/0条表面候选未经归属确认；只作显式弱排序对照，不自动采用/不填隐藏z
映射 := 原父限位后子基准复现27.67度 → 临时副本约0.00038度；原生/共享框架仍最高53.46度，人物/代理最高约38cm
生命周期 := 每支finally原生分配归零；报告只读切图，运行中推理取消/手机/WebGPU/联合相机未验；生产未改
```

完整身份、参数、失败与命令见[执行记录](../task/20261016_MMDAR二维投影驱动刚体姿态评估.md)和[测试方法](../usage/mmd-pose-model-testing.md)。本机可运行工具在忽略目录，不作为正式可分发自测模块。

## XYZ左右腿对应候选（2026-10-16，本机完成）

```text
输入 := 原始固定X缓存/原RTMPose参考/三候选，同模型xy/z/score/峰位同行交换，保留目标与来源号，固定髋及上身
初始 := 首轮头臂2.303mm差导致选解变化，保留不用来排名 → 临时服务器恢复统一321骨快照 → 九分支rig.initial/拟合前实际点/相机逐项完全一致
数学 := 同6点/同权重对应RMS + 全字段/来源号/髋不动/原始不变/另外两图反例 → 146检查通过
实际 := 3图×3候选×参考/相机阶段 → 18记录/11实际回读/22正侧图/7相机失败；至少270子步/有限性/骨长/同初值/相机/历史哈希 → 150检查通过；7份实际相对限位失败单列
建议 := 真人对应更贴近交换但肩臂45～47°实际超限 → uncertain；另两图原始对应更好 → keep-original；不自动换腿，不以匹配相机成功当标签正确
报告 := 同色L/R/COCO编号/目标←来源/原始默认 + 三候选正侧/相机/原图叠加/旋转重置/移动宽度/放大/历史预览/页面异常 → 99检查通过
边界 := 辅助395检查通过不代替姿态质量；历史XYZ/推理缓存哈希不变，旧报告另存；仅临时工具，不改生产或验手机，初值敏感性与真实执行待定位
```

## 完整XYZ方向/相机试验（2026-10-16，本机完成）

```text
输入 := 固定X三图133点缓存/原RTMPose二维/同PMX；不重复ONNX，不运行Python检测裁剪
数学 := 宽高显式主点/默认内参/rootZ回投影 → Three[x,-y,-z]/髋中点归零 → 自身可信在画内点/单位段 → 65断言
运行 := 当前/Z/XYZ同参数新浏览器拟合 → 不写源骨 → ≥270物理子步/实际骨架/正侧图 → 原相机匹配门槛 → 12记录/10回读/20视图/2相机失败
验证 := 94记录/有限性/骨长/三份生产基线差0/方向初值/相机边界 + 36报告切图/正侧/叠加/旋转/放大/手机宽度/页面异常
结果 := XYZ三图对齐RMS15.90%/1.84%/4.33%；仅二次元相机通过，直接1.73%；原方案二次元胸肩实际限位失败保留
诊断 := 真人目标1.40%/实际15.90% → 独立270/540/810/1080子步仍15.68%左右/最大控制偏差.626m → 保留旋转/目标状态/实际点，根因待定位，不修改物理规则
原始腿部补核 := 官方COCO左右索引/本地语义/连线一致；三图原始/交换髋膝踝对应距离 → 真人踝更接近交换对应，但髋及另两图反例拒绝全局交换 → 不把2D参考当真值；后续候选/原始保留/编号回归见上节
边界 := 真人初始头颈/双臂2.274mm微差，其他身体/相机一致；只有辅助检查通过，未还原完整3D/真实相机，未接入生产或验证手机
```

## 人体三维先验试验（2026-10-16，本机完成）

```text
资料核查 := 官方RTMW论文 + rtmlib三轴解码/ONNX接线 + 旧MediaPipeworld + Depth Anything像素深度 → 记录输出坐标风险，不作运行成功证据
补充核查 := b-arac/rtmpose3d配置/推理/估计器源码 → 默认L/可选X + 133点 + 内参/root_z回投影；未运行该封装或L，完整XYZ须另测裁剪/轴向/根/内参与实际PMX，不沿用Z软约束通过结论
实际验证 := 同图/同人/原生维度与单位/左右/根相对基准 → 当前FK与两种三维先验对照 → 至少270子步/骨长限位/正侧面/目标差值
性能 := 首次下载/初始化/预后处理/推理/FK分别记录 → WASM与WebGPU分列 → 手机独立实测
结果 := 两后端/每图重复两次133点峰差0 + 坐标9/髋根8/预览28检查通过；9分支8实际回读/16视图/MP示意图失败；3无深度分支与生产目标差0
失败保留 := 初版hips骨点误当髋中点导致根断言失败 → 两侧髋中点修正 → 8断言通过；实际二次元baseline胸肩及MP辅助右肘相对限位未过，报告明确标记
边界 := 仅忽略目录原型及文档，不改生产；真人初始头颈/双臂最多2.1mm微差，不以小差距排名；仅JS堆观测非总内存，无真实3D标注/手机结论，既有77项未重跑
```

## 三维回环与实际牵引回归（2026-10-16）

```text
诊断基线 := 真实PMX已知姿态 → 精确投影12点 → 旧lift → 对比原3D骨骼与新目标，不让低2D误差代替3D真值
已复现 := upperBody Z=.35/.6/.75均出现额外手脚深度/位置漂移；Z=.35右脚.256631米，二维误差.00091876仍通过旧门槛
回环 := 真实PMX先规范合法角 → 倾斜躯干/屈肘屈膝/模型变换 → 弱透视或透视精确投影 → FKfit → 原姿态保姿<=1mm/旋转<=.1°
运动学 := 快照不写原模型 → 中间骨/实际父链求值 → 越界参数截断 → 对比rig.write同一限位；显式骨盆不能跳过，参考种子不沿用前图根朝向
原子 := 异步拟合让出后取消/改相机/改目标 → AbortError且旧控制完整保留；公开旧world接口保持同步兼容
根牵引 := 同时给骨盆位置(.2,.15,0)增量和旋转(.25rad)目标 → 600帧实际根位置误差<.03场景单位 → 不能被零链长包络抵消
浏览器 := 构建必须先结束 → Edge真实ONNX/PMX → 三图应用270子步 → 实际骨架/骨长/目标差值 → 正侧面截图；额外JSON保存在忽略目录，数值单位明确
边界 := 膝最小0.5°造成非法直膝的必要纠正单列；弱透视残差是实际投影诊断，生产用真实透视，不能当真实深度或人工标注精度；手机未验
```


## 姿态模型测试方法归档（2026-10-16）

```text
资料 := 实际探针/历史JSON/当前核心与资源配置 → 核对MP/RTM/DW/OP预后处理、权重SHA、输出和人体左右映射
隔离 := 历史MediaPipe探针依赖旧Worker检测结果 → 当前RTMPose构建不直接复用；未纳入Git的临时工具明确列为本机历史方法
文档 := docs/usage/mmd-pose-model-testing.md → 原始推理/四模型展示/当前IK集成三层 + 全图/同框/色序/尺度变体 + 缺点和计时边界
验证 := 核对引用文件、临时工具参数/输出文件名、固定模型摘要、Markdown链接与差异检查；本轮不重新运行模型推理
```

## RTMPose-m二维到实际骨架（2026-10-16）

```text
单元 := 固定384×288归一化与1.25取景 → 已知SimCC峰逆仿射/17语义/无world → 低分/尺寸/NaN/退化拒绝
三维 := 真实PMX固定骨长+已知相机弱透视 → 原姿态与非平面腿链 → 有界误差/精确骨长 → 模型缩放旋转平移仍正确；缺关节不生成目标
原子 := 二维结果应用10目标 → 无效肩髋输入抛错 → 全部旧控制点不变 → 270帧回读有限/膝限位/骨长
浏览器 := 真ONNX默认清单1模型/延迟加载 → 17点二维 → 10个物理目标/270子步 → 实际相机匹配恢复 → 取消与空图不改启用目标
用户图 := 二次元身体11点/跳过低分腕 → 9目标；另两张本机坐姿样本 → 270子步实际骨架/骨长 → 独立弱透视残差改善断言，非标注精度
生命周期 := 复用18项真实DOM粘贴/过期读取/实际骨架叠加/相机取消与所有权保护
边界 := 不依赖用户图片入库；缺环境变量跳过可选样本而非假造；手机/系统粘贴未验，不以桌面软件GPU计时作为设备基准
```

## 四模型独立预览验证（2026-10-16）

```text
原始证据 := 四模型各自真实推理输出 + 统一身体语义映射 + 236×314真人与450×407二次元各自同图
构建原型 := 有限坐标/点数检查 → 内嵌图片与各档结果 → 生成独立HTML/JSON；不修改生产模块
浏览器检查 := 四画布 → OpenPose档位变化应改变图像 → 腿部放大画布高度对应裁剪 → 取景变化应改变RTM图像 → 热图/名称/骨架开关 → 390px不溢出 → 页面异常为空
人工核查 := 查看全身与腿部截图，原生缺失点不补画、左右颜色/相同连线与图片比例一致
范围 := 模型本机试验/原型UI验证；非正式集成测试/非手机推理/非3D精度验收
双图追加 := anime真实client默认选女孩/热图相同候选 → 无人物框应显示回退 → OpenPose空骨架不能补点 → 368档变化/手臂腿部裁剪/双图来回切换无混用 → 低分/名称/骨架开关与390px检查通过
第三图 := MP返回可靠姿态失败 → 保存失败记录/禁用热图/不画伪造点；OP两档无人物 → 明确缺失；RTM/DW同一有效人物框/全图 → 两者12点但仍按实际位置判断；三图与同尺寸图切换、裁剪、失败提示/390px/页面异常检查通过
```

## ADB v102实际Qwen配置与目录（2026-10-15）

```text
设备 := SM-N9500，min58/code102/deps10/task1，pendingHealth=false
根因 := 新页面已加载，但权威模型仍为旧qwen3-tts-flash、默认与AI显式voice为Cherry
操作 := 既有WS窄补丁改模型3.1、默认与AI音色乔小娇；保存权威成功
验收 := 控制端/显示端均68项、女47/男21、当前乔小娇且选中ID一致、保留大写Emily_v3.1
持久化 := 设备userconfig模型/默认音色与config内AI选择匹配
保留 := 其它Provider/语速/共享音量不变，面板原状态恢复，临时forward移除
边界 := 无代码修改/新合成请求/出包发布，不作为设备实际合成或播放验收
```


## Qwen Audio 3.1、常开方式与豆包多流（2026-10-15）

```text
目录与常开 := Chat2API266/266、Provider定向84/84、双端快选21/21、声纹页浏览器1/1、手动/并发22/22（部分用例重叠）
目录 := 68项/47女21男/四组4+22+15+27；ID大小写、元数据、复制隔离、实际模型/映射目录和WS接线
界面 := 无Provider启用checkbox，保存不带enabled；旧false读入/提交变权威true，快照/广播相同；账号停用仍拒绝
双端 := 68项与女47项筛选、Emily_v3.1保存和同步；既有按钮皮肤/语速/四尺寸布局保持
音频 := tts-ogg + tts-opus-decoder + 豆包adapter定向35/35；单/双流、损坏/截断/交错/缺边界、总页/包/字节/时长/64流上限
实网 := 单长句真实两流独立校验/解码成功，合并WAV1051832字节；整段真实手动服务8段非静音，queued=8、末句喵～、无错误
SelfTest := tts_provider_config只读校验四个非原生enabled=true和页面无开关；不触发合成或配置保存
边界 := 实网使用本机已有账号，只读凭据、不保存账号或配置；未把队列输出验证宣称为实机播放
```


## 豆包Chat表情分句中断回归（2026-10-15）

```text
先失败 := Provider/动作新增3项断言在旧实现失败；手动原句新增1项失败，错误incomplete
手动/并发 := npm run test:mmd-production:tts → 22/22
面板回归 := npm run test:tts-voice-picker → 20/20
Provider/动作 := 无独立npm定向入口，node --test tests/tts-provider-doubao-chat.test.js tests/tts-provider-qwen-chat.test.js tests/tts-provider-qwen-business.test.js tests/display-mmd-tts-actions.test.js → 28/28
链路 := 正式Markdown清理 + 真实分句 + 手动服务 + Registry + ProviderService + 本地假WAV上游
原文 := 两段示例生成3段正文；日志完整回复生成8段正文、跳过4段emoji，按序下发、queued带正确audioCount
边界 := 混合正文合成输入过滤/播放文本保持；纯emoji零请求零缓存；ZWJ/肤色/国旗/键帽完整移除
自动 := 公共动作解析仍保留原回复与✨/🐱事件，未知💻/⚡在最终Provider边界清除
错误 := incomplete/timeout/cancelled原错误和provider标记保留；千问旧接口及原生/其它API不受影响
边界说明 := 本地假上游模拟纯表情被拒；未对真实账号做前后对照，不宣称上游诱因已实证
部署 := servicePackage=true，尚未出包发布/重启或ADB验收本次修复
```


## 音色列表按钮状态验收（2026-10-15）

```text
入口 := npm run test:tts-voice-picker → 20/20；新增断言在旧样式上失败2项，实施后全部通过
主题 := 控制端与显示端分别覆盖light、mint、深色，真实theme.css重要规则同时加载
皮肤 := 选中项渐变/白字/强调边框/勾选；普通项无渐变/普通文字/中性边框/隐藏勾选；副标题继承文字
交互 := 悬停不误选、键盘焦点可见、禁用保持选择关系；既有保存等待/失败/成功回显保持
只读自测 := control_tts_voice_picker扫描现有列表皮肤；注入普通项错误渐变后能检出；不发送额外WS请求
边界 := 当前仅浏览器验收，不代表本次样式已部署至ADB设备；servicePackage=true，尚未出包发布
```



## 两端音色面板与语速验收（2026-10-15）

```text
新增入口 := npm run test:tts-voice-picker → 20/20；关联test:mmd-production:tts → 21/21
传输回归 := 执行生产WS入口displayId覆盖及真实ViewBind转交分支，合法方式/音色成功、未知字段仍拒绝
权限 := 非登记连接及显示端完整配置写入保持拒绝；speed有限数值/能力/范围/禁止混带voice
偏好隔离 := speed只改目标Provider.defaultSpeed，不改变AI默认或其它方式；过期操作不重选方式
批次 := 真实生成服务fixture保存3后，旧快照speed0、新批次speed3
真实浏览器 := 生产WebSocketManager+共享组件+WS服务，双向方式/音色/滑条同步；input不发送/change保存；失败/断线恢复
UI := 三下拉/搜索/定位/未知音色/目录记忆；四尺寸安全区、短屏滚动、工具组避让；重复init只有一面板
只读SelfTest := control_tts_voice_picker已加入并在实际Android控制端运行成功，不写配置或合成
ADB := min58/code99→本地100/deps10/task1健康；显示端切豆包并从94项改选成功
ADB实体操作 := 点击控制端浮钮；滑条0→3，配置及两端DOM均为3；面板933x455 viewport内
恢复 := 测试前后AI默认/全部方式voice/speed/enabled/model一致，pending=false/previous=null
网络 := 仅code-v100.zip=17808097bytes，无APK/依赖/任务ZIP；正式99源CURRENT/0字节/无失败
边界 := 未调用官方合成接口或验证逐音色听感；本地签名候选未发布LAN/WAN
```

## 全身IK实际骨架与相机匹配（2026-10-15）

```text
纯投影 := 读取真实PMX骨骼世界坐标 → 改动实际骨骼 → 固定参考相机投影应变化；透视/正交宽高比和舞台旋转不拉伸
拟合 := Three已知前/背侧相机及竖图生成2D → 恢复朝向/取景；离群点鲁棒，缺点/共线/严重冲突/取消拒绝写回
桥接 := 同步普通视角状态 → 连续渲染不弹回 → 手动旋转接续 → 恢复首个基线；模型/代次/AR/编辑器接管阻止
所有权 := 加载零时长单帧相机VMD → progress为空但enabled且hasClip仍拥有相机 → 暂停/清除释放
UI := 原图片粘贴真实浏览器回归 + 无IK/ONNX显示实际骨架 + 固定视角/独立对齐 + 隐藏暂停 + 取消/骨骼变化使拟合失效
完整链路 := 粘贴照片 → 真ONNX → PMX十一目标/270子步 → 实际叠加/相机估计 → 连续帧/手动接续/恢复且骨骼目标保持
边界 := 桌面Edge验证；手机性能/触控与更多二次元图另验；视频动作和运镜未实现
```

## 音色快选ADB缺陷复现（2026-10-15，修复前）

```text
设备 := SM-N9500 Android9/min58/code96/deps10/task1
方式操作 := 显示端qwen-chat切doubao-chat → TTS快选参数不合法/success=false
音色操作 := 控制连接预置doubao-chat → 真实94项目录改选其它音色 → 同错误
对照 := 同设备控制连接同类型合法选择可成功；当前小爱模板无TTS覆盖
原因 := 真实显示端入口补displayId，业务白名单不接受该传输字段；组件隔离夹具未覆盖
恢复 := qwen-chat/voice=null、豆包原默认音色恢复成功；未生成聊天或调用合成
证据 := .cache/adb-tts-panel-20261015/inspection.json + provider-and-voice.json
结论 := 已复现缺陷；未修改生产代码，未运行修复回归
```


## 显示端音色下拉筛选资源自测（2026-10-15）

```text
display_voice_filters := GET /display.html（no-store） → DOMParser解析，不运行页面脚本
结构 := 音色面板内三原生select{Gender,Age,Accent} + 当前音色名称 + 清除 + 列表
判定 := HTTP成功且全部节点存在/三select具有同一筛选父容器；旧版本缺任何节点失败
副作用 := 不初始化显示页、不发WS、不改配置、不播放音频；仅检查部署资源结构
行为验证 := 独立真实Chromium用例覆盖交集、权威CSS、保存失败、异步与缓存定位、手机边界
短屏验证 := 740×390及390×400 → 列表>=100px + 当前项处于列表/面板交集 + window.scrollY=0
横屏两列 := 740×390 → 左设置right<=右列表left + 同顶 + 面板在视口内；切回竖屏继续定位
```

## 全身IK图片粘贴（2026-10-15）

```text
测试环境 := 独立无头浏览器 + 同源UI源码 + 真实DOM/图片解码；Human边界只记录是否被调用
真实剪贴板 := 测试生成PNG → 本浏览器ClipboardItem.write → 原生Ctrl+V/按钮read → 验证预览像素；不读取原有私人剪贴板
事件作用域 := 面板隐藏/图片区折叠/可编辑目标/普通文本 → 不拦截；多个图片 → 首张支持图片
输入失败 := 损坏/超20MiB/拒权/无图片/缺API → 原图与目标保持，显示提示
异步边界 := 延迟read后换图/关闭/折叠/销毁 → 重新展开后晚到仍不能覆盖；销毁移除监听
解码边界 := 旧Bitmap晚到 → 保留新图片并close旧Bitmap
集成 := 完整IK面板粘贴参考图片 → 真ONNX → 原左右/膝/33点断言 → 显式应用11目标与270子步 → 原无人/取消/二次元候选回归
限制 := 系统Snipaste及真实手机剪贴板权限/触控另验
```

## 全身IK图片姿态本地ONNX（2026-10-15）

```text
纯模块 := 224NCHW/归一化/边框 → 2254锚点 → 保留0.479独立候选/去重重复锚点/最多3候选/拒绝退化 → 256NHWC旋转ROI → 195/117输出取前33点
候选排序 := 真实诊断身体质量值 → 女孩优于高检测/Pose分小猪；出画/无效world不计质量，缺肩髋不能应用
重定向 := 真实PMX左右语义与骨长 → 模型缩放2倍/旋转/平移仍保持局部骨长 → 缺点/出画点跳过 → 非法髋点拒绝
客户端 := 取消旧Worker → 晚到id丢弃 → 原图副本保持 → 传输失败立即终止/清理计时器
首次应用 := 延迟Ammo → 用户取消/收起使isCurrent=false → 加载完成前检查 → AbortError且不启用IK
物理接口 := 所有目标先构造/验证 → 一次应用 → 无效输入不部分覆盖 → 手动编辑仍可用
浏览器 := IK唯一图片区/PBD仅physics选项 → 首屏不加载姿态资源 → 真图片推理 → 真实腕/膝方向对照 → 应用11目标 → 270子步有限
异常 := 取消与空白图 → 原控制目标不变；所有HTTP请求GET，无图片上传
二次元回归 := 环境变量指定本机图片 → 真Worker至少2/至多3候选 → 默认鼻点回到女孩脸、肩点上半身 → 切换预览而目标不变 → 低可信提示 → 显式应用有限目标
执行约束 := 构建先完成；定向测试/软件GPU浏览器串行，避免生成夹具被重建及资源竞争
边界 := 公开全身图/用户坐姿图/无人图与桌面Edge/WASM；估计3D非真实深度；手机、更多照片/模型、官方逐点数值对照未完成
```

## 豆包音色目录与重播自测（2026-10-15）

```text
只读面板 := getTtsProviderVoices(provider=doubao-chat, requestId) → 匹配响应/5秒超时清理
目录断言 := 总94 + 女32 + 男62 + 唯一style_id + id=style_id；不写配置、不合成
自动用例 := 代理鉴权/未知音色/动态speaker/配置窄权限/模板优先级/方式记忆/批次快照
浏览器 := 94卡片/搜索/迟到目录/保存失败/本端输入/顶层speech/完成按钮/远程停止清状态
停止 := 在途token按目标和会话取消；原生全停/会话停派发cancelled；迟到结果不得入队
结果 := 定向201/201；既有手动与并发21/21；Chat2API259/262（3项既有Windows权限）
```

## 独立任务ZIP出包与ADB验证补充（2026-10-15）

```text
最终原生 := 同allserver-min/58 profile顺序执行testDebugUnitTest → 287项0失败/0错误/1既有环境跳过
修复回归 := 旧code95或deps9且无taskCode → CURRENT；同版/新版移除taskCode仍拒绝
产物 := min58/code96/task1签名/profile/大小/SHA/CRC通过；deps10复用；四项需求false但未发布
实际迁移 := SM-N9500/Android9，min56/C95 → min58/C96/D10/T1，Node健康提交pending=false
下载 := 联合只code96+task1共17799178bytes；设备隔离task1→测试2只task ZIP13149bytes
数据 := 停服期间73文件摘要相同；隔离原生回滚96/10/1，测试结果文件摘要保持
有效源码 := 实际HTTP render.js等于res/tasks发布源，no-store
实际WebView := 同实例20次重载，旧800ms计时器下一回调退出，1.4秒后1计时器/1覆盖层/1回调
旧正式源 := CURRENT/hasUpdate=false/failed=false/downloadBytes=0，截图无失败面板
测试边界 := 隔离任务回滚未启动第二套Node；实际Node健康验证在T1；测试v2非正式产物
仍待 := 干净首装、任务单更受管重启耗时、启动校验耗时、LAN/WAN正式发布
```


## 独立任务代码ZIP验证（2026-10-15）

```text
命令 := npm run test:task-code-sync → 66/66
关联 := npm run test:task-dependencies → 106/106
原生 := JAVA_HOME=java-26-openjdk ./gradlew :app:testDebugUnitTest -PaascVersionCode=58 --offline → 285项0失败/1既有归档环境跳过；新任务11项全通过
构建 := 隔离白名单暂存、签名任务ZIP、版本/API/锁冲突、配置/results排除
发布 := 仅任务上传与清单最后切换、目标基线变化拒绝、分组联合发布、任务镜像选择、精确数字清理
读取 := catalog逐文件摘要/链接/额外文件验证；元数据/HTTP/入口/重发同源；缺失404无旧种子回退
执行 := Node相对require来自代码目录，cwd/workDir来自数据目录；Puppeteer evaluate VM夹具验证原始源码与数据workDir
保护 := submit/update/delete前置拒绝官方代码操作，实例/config/results保持
原生 := 可选签名组件、任务专用预算/代码与依赖联更、旧指针、固定快照、真实组合健康、pending完整回滚、健康后精确清理
显示 := VM同实例连续恢复20次 → 1计时器/1监听/2DOM节点；停止 → 全部为0
样包 := 4任务6源码31019字节，zip -X暂存样包13119字节，已清理；不是正式制品
状态 := minApk/servicePackage/taskCodePackage=true，dependenciesPackage=false
边界 := 未正式签名出包/发布/设备迁移；真实Chromium、真机首装/升级/流量/视觉/重连耗时待验收
```

## MMD-AR 分部位阻尼（2026-10-15）

```text
设置契约 := 默认10组非统一值 → 拒绝字符串/NaN/Infinity → 逐项回退/夹限 → 返回独立字典
连续更新 := wrist0.6 → head1.6 → gravity变更 → 保留wrist/head/其余预设 → 修改返回副本不污染内部 → PBD来回保留
真实Ammo := 单一自由头部刚体角速度1rad/s；全局0.2、部位0.4或1.8 → 大系数耗散更多；分配不增长
真实PMX := 十部位各3秒On+7秒Off → 保持误差<80mm、释放末秒全身漂移<5mm/角速度<0.1rad/s → 全部分配销毁
端点 := 全局0.2或2.5×部位0.2或2.5 → 真实PMX手/脚/头On/Hold/Comply+旋转 → 120帧后显式Off → 位姿有限、线/角速度有界、分配恒定；不以此宣称快速收敛
回归 := 45/45；包括重力开关释放、自由骨盆、30/60/120fps、骨长/限位/状态和PBD/标记/镜头/动作
浏览器 := 十滑条展示与权威状态相同 → 依次input腕/头 → 实时回显/保留其他值 → 恢复默认 → 实际拖点/Off/重力/模式/窄屏
浏览器结果 := 1/1，无跳过；900子步每阶段；Off/开重力末秒摆幅占身高0.00030/0.00226
边界 := 模块类型与构建chunk大小既有提示；不改package类型；手机及其他PMX尚待验收
```

## min55首次语音提示与下载入口分组（2026-10-14）

```text
分组 := TTS + ASR/声纹{sensevoice,voiceprint} + 各LLM；模型ID/文件路径/独立缓存不变
原生 := 265项0失败/1既有环境跳过；新增分组/取消/字节进度/健康与页面顺序/首次持久化9项全通过
打包 := test:offline-bootstrap63/63；min55签名/profile/CRC通过
实际 := SM-N9500 min54覆盖55保留TTS/ASR缓存 → 首次两组默认checked=true → 提示只需补40MiB声纹
取消 := 两组取消勾选 → 按钮禁用；稍后 → 声纹仍缺失/无下载 → 冷启动不重复提示
手动 := ASR/声纹组 → 补声纹41134267bytes → ASR大小/mtime保持 → 三模型filesReady=true/TTS与ASR引擎ready
发布 := LAN/WAN min55完整HTTP校验/精确清理完成；89928481bytes/SHA4b6f6c13…；code87/deps10保持
边界 := 未清空应用重做55干净首装；声纹仅准备文件、不改变启用开关；真实MNN推理未测
```

## 豆包分句临时串行自测（2026-10-15）

```text
实际server-app调度入口 + 权威Provider resolver + OrderedScheduler → 豆包同批次maxActive=1
模板改qwen-chat/system且显示槽位2 → maxActive=2；每组三句按原句序交付
手动回复/AI/Agent/修复路径传递对应business/template；原句子上下文/取消/播放目标回归
test:mmd-production:tts 20/20；Agent/有序调度/Provider定向15/15；server-app语法通过
边界 := 没有新增跨批次队列；不同请求仍保留同账号busy；主服务与Android正式三句WAV均48kHz/非静音/有序，6009ms/3743ms
```

## 豆包纯Node/语音自动账号自测（2026-10-15）

```text
Chat2API := 246/246；纯Node请求/SSE/Responses/HTTP断连/账号保存与摘要脱敏全部通过
新自测 := Cookie-only无论旧网页开关值都422且不发上游；runtime不读取旧桥选项；固定别名不能错Provider
自动语音 := 无映射单/多账号轮询、排除停用/配额、权威凭据更新、删除后提示登录、失败仅发一次
显式语音 := 指定账号停用则报错，不退选其他账号；Cookie即可、不强制文字profile
配额 := dailyLimit及旧todayLimit均有效；旧脚本/设置/广播/消息路由全部移除，JS语法检查通过
正式验收 := 最终code90/min56/deps10发布；主服务重启与APK当前账号无映射三句实际WAV均通过
```

## Offline豆包网页账号真实测试（2026-10-14）

```text
修复回归 := check:chat2api 254/254；音频/Ogg/Worker/TTS 34/34；Android271项0失败/1既有跳过
登录新增 := 六项JVM测试覆盖嵌套JSON、Cookie-only不完成、缺失/非法资料、整数精确、固定来源与旧Provider兼容
保存链路 := 正式OAuth+凭据校验+账号Store→有效profile保存→公共列表脱敏；JSON串形式拒绝且state仍可重试
Offline解码回归 := 临时代码目录没有node_modules、NODE_PATH指向独立依赖→旧实现失败TTS_OPUS_INVALID→绝对入口导入通过真实WASM
Android短句 := 同真实账号 + 修改后适配器/Worker临时内存加载 → Task到TTSEnded完整 → WAV163652bytes/48000Hz/1704.25ms/非静音
正式验收 := 新包正式SpeechService三句WAV通过；当前账号缺profile，用户稍后补资料，LLM未宣称通过
```

```text
授权 := 用户明确要求当前Offline账号的LLM/TTS真实测试；账号只在APK UID内读取/不导出凭据
环境 := min55/code87/deps10/Android Node26.4.0；启用账号1个，Cookie-only/nodeProfile缺失
LLM := 正式CoreAdapter+显式同账号 → 503/doubao_browser_disabled/25ms → 无官方推理请求
Node直连 := 用户要求无需网页聊天 → 实际code87适配器不注入browserTransport → HTTP200/SSE/448ms
直连业务 := doubao_risk_control映射403 → 无有效文字；不等同HTTP403，风险后未重试/未打开官网网页
TTS := 正式SpeechService+仅内存显式绑定 → 502/doubao_speech_upstream/334ms → 无音频
诊断 := 原WebSocket适配器监听 → open + TaskStarted/status=20000000 → 当前if(status_code)当错误 → 未发StartSession
边界 := 没有证明LLM/TTS成功；未改账号/长期业务配置；未读无关会话/日志凭据；待具体方案确认后修复
```


## TTS Provider 原生语速配置自测（2026-10-14）

```text
读取 TtsProviderSettings 权威快照 -> 校验业务Provider/全局音量/Provider字段脱敏
遍历 Provider -> supportsNativeSpeed(provider, model) 判断当前上游/模型能力
原生支持 -> defaultSpeed为整数且范围-10..10；不支持 -> 不存在defaultSpeed
遍历 Provider -> 不存在独立defaultVolume；系统原生不暴露enabled/defaultVoice
qwen-chat/doubao-chat -> 不包含账号ID/凭证状态，固定模型契约有效
输出只读结果 -> 不请求语音服务、不连接上游、不更改配置
```

Qwen API按模型而非仅按Provider判断语速能力：Qwen-Audio 3.0/3.1 TTS保留speed设置，Qwen3-TTS HTTP与未知映射别名不得暴露未确认的原生字段。此检查与声纹面板同用`supportsNativeSpeed`规则。

## Pi 可选依赖与 min54 干净首装自测（2026-10-14）

```text
ADB实际 := SM-N9500 full50私有备份 → 卸载 → min51/52/53失败定位 → 再次卸载 → 空目录单装min54
历史故障 := min51遗漏空实例 → min52缺Node配套C++ → min53安装器旧白名单拒绝
最终APK := 89914041bytes/SHAed8075e6…/同签名/CRC通过/allserver-min/updateOnly
首装 := LAN原生确认约60MiB → code87/common10/android9/seeds86 → HTTPS status=ok
实例 := llm-server/40f3b6b1与time.announce/728486a7目录存在 → latest有效相对链接
健康 := active-release code87/deps10/实际版本目录 → pendingHealth=false/previous=null
Pi源码 := test:pi-optional30/30 → 保存确认/取消表单/失败不写/并发冲突/仅选中Pi启动准备
SDK实际 := /var/tmp隔离完整闭包 → 真实SDK/readonly-tools/provider资源/model注册成功
源码回归 := test:task-dependencies106/106 + test:offline-bootstrap63/63
原生回归 := Android254项/0失败/1既有环境跳过 → 空实例重试/链接拒绝/CPP解析与安装白名单
正式制品 := code87/deps10/ORT10/Pi三平台10/min54；common展开402MiB降至130MiB
Pi真机 := WS缺包预检downloadRequired → 取消保持revision/default → 确认PiAndroid10校验ready/提交qwen3.5 → 恢复default
Android真实SDK := Node26.4.0/platform=android → 独立缓存导入两SDK/createAgentSession/ModelRuntime/只读工具入口均成功
冷启动 := 默认LLM启动status=ok/code87/deps10/pendingHealth=false/原缓存保留
发布 := LAN/WAN全部组件HTTP大小/SHA/签名一致 → 精确清理无错误
C++隔离 := Node独立子进程映射runtime/libc++ → APK/MNN主进程使用NDK库
边界 := 不恢复私人备份、不借旧环境；未执行真实LLM/MNN/LFM-VL模型推理；后续其他TTS源码仍需出包
```

## Chat2API 默认映射与账号复用（2026-10-14）

```text
check:chat2api → 249/249 → 十条规则/自定义优先/大小写覆盖/有效列表不写文件
虚构旧账号 → 同根并发恢复一次 → 删除后重建不复活 → 禁用/隔离自定义根保持
虚构Provider适配器 → 无账号指定/无映射完成调度 → 无资料503登录提示
test:offline-data-repair → 47/47 → 累计0/1/2迁移/真实物理十条映射/种子无账号/四组HTTP篡改拒绝
test:offline-bootstrap → 62/62 → min/full种子与模型分离、签名APK和平台依赖契约
独立Chromium → 映射编辑和账号界面2/2 → 虚构接口，无用户profile/官网请求
发布核验 → LAN/WAN最终同清单85/9/47/3/85 → 签名 + 每个组件全部HTTP字节/大小/SHA → 旧修复归档保持
清理白名单回归 → 仅四类版本文件 → seed/data历史不删 → 已删seed69/79从原件校验恢复
现场边界 → 未操作手机升级/数据修复确认，真实账号能力与Android/Linux/Windows另验
```

## 独立 min / LLM 外置源码验收（2026-10-14）

```text
模型测试 := npm run test:ai-models → 36/36通过；含控制端NativeOfflineModels只读自测
首装打包 := npm run test:offline-bootstrap → 60/60通过；独立HTTPS资产/空LLM/full无权重/旧指纹保留
Android := testDebugUnitTest编译与218/218单元通过；首装版本目录/种子/latest/ZIP/LAN/空集合/WebSocket/中断恢复
扩展回归 := Android静态+LLM/能力释放/更新镜像46项43通过3失败；同名失败在HEAD已存在
HEAD基线 := Android静态27项23通过4失败；本次受影响Qwen绑定断言已同步，多余3项保留待维护
执行环境 := /tmp配额与沙箱子进程限制 → 项目tmp并按授权重试 → 核心测试全通过
边界 := 未签名出包/未部署/未实物模型上传/未在干净设备安装；无网推理和真实cohort另验
```

## 独立 min 本机模型只读自测（2026-10-14，源码完成）

```text
控制端 NativeOfflineModels.status → 只读小型定义/文件属性/验证标记
自测 offline_native_models → 检查模型ID唯一、总量整数及文件/引擎状态边界
无原生桥或在线APK空列表 → 明确跳过说明；不执行下载、加载、推理或配置修改
首装页面/WebSocket → 原生健康提交前检查HTTPS页面与Upgrade握手
```

## 全身IK独立面板与牵引调硬自测（2026-10-13）

~~~text
相机近远/zoom/正交 + 标记世界缩放 → 投影屏幕直径仍32px
尺寸非法/越界 → 规范化20–48px；舞台四方向/非方形画布 → 屏幕中心对应旋转
可见标记外缘21px → 命中；空白/背后点 → 不命中；重叠候选 → 最近中心优先
真Ammo同目标 + 默认/软档 → 0.5/1秒实际误差与峰值位移断言
强档Hold四目标 + 重力600帧 → 有限骨骼/PMX限位/原生分配不增长
真实米娅 → 新按钮展开 → 旧Human无IK重复设置 → UI启用physics → 调节像素尺寸 → 收起保留目标 → 真实鼠标拖动
重新展开 → 重置/切PBD/关闭 → Escape → 横竖屏面板边界与动作互斥
原镜头浏览器 → 回归环绕/平移/缩放，不把空白手势截成拖点
~~~

定向31/31、身体/面板真实浏览器1/1；原镜头浏览器1/1通过。本地独立WEB已构建，不出APK或部署；手机手感/其他模型尚待验收。

## 独立MMD-AR身体物理自测（2026-10-13）

~~~text
创建真实Ammo模块 + 合成PMX语义骨架 → 注入HumanIK → 选择physics并启用
手/脚/膝/骨盆目标 + 位置/旋转状态 → 按固定时长步进 → 验证误差缩小、躯干参与、深屈膝及模型局部限位
记录初始骨位置与原生分配 → 多帧施力 → 骨长不变、分配不增长 → dispose后分配归零
Off + 自由骨盆 + 重力 → 继续步进 → 骨盆下降且地面约束脚部
PMX同级上下半身 + 骨盆旋转 → 验证躯干随动；显式骨盆范围 → 验证局部限位
30/60/120fps同物理时长 → 比较末端差异；重置/关闭/模式切换 → 恢复原增量
延迟Ammo加载 + 关闭/模型变化 → 迟到结果不可接管；加载失败 → 保留PBD
独立网页真实米娅 → UI切physics → 鼠标拖可见控制点 → 添加脚/旋转目标 → 有限姿态/零页面异常 → 重置/切PBD/关闭
原镜头浏览器用例 → 回归反向环绕、双指平移/缩放及膝点
~~~

定向18/18、身体物理与原镜头浏览器各1/1；本地构建通过。其他PMX/服饰后端/VMD/AR/手机帧时与观感仍为人工验收。

## 独立 min / LLM 外置实施设计验证（2026-10-13）

```text
本轮已验证 := npm run test:ai-models → 30/30通过；现行分类无变化
聚焦打包基线 := 四个build-profile/min-package/signing文件 → 23项22通过1失败
失败证据 := apk-build-profile.test.js:83期望min31，实际37；旧versionName断言同样待维护
后续维护 := 隔离fixture验证版本字段 + 当前full/min/发布索引递增契约；不退回旧profile
设计产物 := 原生首装事务/签名快照/种子与HTTPS + 模型确认/归并/取消 + 旧cohort过渡
计划测试 := 空models环境复用 + active-release版本目录 + 无previous失败 + 进程中断
计划集成 := HTTPS状态/控制页/WebSocket + 本机原生模式 + files/models单份Qwen
计划模型 := 可信摘要映射/LAN专用策略 + 查询无网 + ASR/TTS回退 + 过时请求不重播
计划兼容 := full23/full38/min36/min37指纹cohort + 新无LLM full + 干净min首装/后续更新
计划性能 := 单模型并发只下载一次 + 二次无网无复制 + 流式峰值空间/RSS + 启动健康120秒
自测界面目标 := 只读展示环境/模型分别就绪；不得在自测查询中开始模型下载
验证边界 := 新功能尚未实现；未改测试源码/构建APK/操作设备/上传模型
```

## 完整 Offline APK 同步与发布自测（2026-10-13）

```text
现有同步fixture := 无full索引404 → 继续同步服务且保留full；service中的未使用full字段不作为来源
独立索引集成 := RSA签名full → 默认下载/进度/结果apkFull → 第二次哈希复用
清理兼容 := 只移除严格数字版本旧full普通文件；min、非版本文件、链接及外部目标保留
失败集成 := 坏签名、签名正确但越界路径、坏APK长度/哈希、本地索引链接 → 不提交索引或清理旧full
full发布 := APK哈希/实际包名版本/签名校验 → 版本文件上传 → 独立索引原子替换；服务清单保持
远端顺序 := scp APK先于full索引；命令经/bin/sh -c；清理只用受限规则
已运行 := npm run test:offline-sync 36/36；offline-update-publish.test.js 17/17；差异检查通过
已验证 := full v38 ZIP/签名/实际版本、MNN复用、内置代码69/依赖8及最新备份源码；LAN/WAN独立索引一致，APK大小及文件SHA-256通过，旧23返回404
实际镜像 := 6项哈希复用，apkFull为第6项；服务清单SHA-256未改
构建恢复 := /tmp配额和Java堆错误 → Java临时目录/var/tmp + 4GiB堆 + 2 workers + 复用已准备输入 → 构建成功
边界 := 整包传输由SCP文件哈希与HTTP长度校验；未重复从WAN下载1GiB或安装真机
```

## 全量配置 ZIP 与自动重启自测（2026-10-13）

```text
控制端只读自测 full_config_zip_backup := 检查ZIP控件、合并/替换与状态查询；不执行导出/导入或重启
后端独立临时夹具 := 全局/用户/聊天往返、合并/替换、预览取消/过期、非法归档与链接、篡改哈希、失败回滚
HTTP集成 := 上传预览、确认后仅一次托管重启回调、非托管拒绝；取消不重启
进程集成 := 写入后强制退出 → 下次启动回滚；恢复成功 → 新进程配置模块读取新值
真实Chromium := 预览/取消、确认/轮询/刷新、失败消息、APK保存回调
运行命令 := npm run test:config-backup；后端11项+浏览器父/子5项均通过
Android := :app:testDebugUnitTest成功，保存来源/请求标识/文件头/大小策略4项通过
兼容回归 := 启动器/历史隔离/历史profile/发布器29/29通过；共用重启重复调用仅一次通知和退出
性能夹具 := 24 MiB聊天ZIP往返1802 ms；峰值RSS259 MiB，含测试夹具
边界 := 未导入真实数据，未自动重启主服务；系统文档保存真机交互待设备验收
```

## Offline min 独立安装与模型外置评审验证（2026-10-13）

```text
本轮已运行 := npm run test:ai-models → 30/30通过；无跳过
已探测 := 当前TTS/LLM路径被白名单拒绝；仅选择sensevoice/tts/voiceprint → 29项，无llm定义/权重
结论边界 := 现有同步正常；不代表TTS/LLM新增同步或min首装已经实现
计划自测 := 环境/模型独立就绪 + 合法空bundled集合 + 损坏元数据拒绝
计划兼容 := 旧full/旧min过渡升级 + 新full无Qwen升级 + 干净min首装及后续升级
计划异常 := lock/ABI/哈希不匹配 + 截断/空间不足/中断/取消 + 并发归并 + 坏缓存恢复
计划真测 := LAN/WAN模型下载 + 已下载模型无网加载 + 配置/任务/旧Qwen缓存保留
计划性能 := 环境下载/校验/解包/健康就绪与模型下载/校验/加载分别记录
状态 := 仅完成评审验证；后续新增测试模块随已确认的源码设计落地
```

## Offline APK 高 DPI TTS 位置浏览器自测（2026-10-13）

```text
Chromium加载实际display.html与display.css，模拟同一物理视口的100%/112%/150%/300%初始缩放
显示 WebView 原生桥模拟 -> 0°/180°TTS物理边距均为160px；90°/270°旋转后物理边缘间距约24px
原生桥不含缩放getter/调用getter抛错 -> 两种情况都回退100%，0°TTS边距160px
定向浏览器回归 -> TTS|旋转|媒体名|天气共12项通过；单独新增DPI用例通过
Android -> ./gradlew :app:testDebugUnitTest 成功，包含原生缩放策略和桥接代码编译
边界 -> 完整回归中的既有1200×800、DPR3弹窗边距用例等待handleVoiceCommand超时；单独旋转锚点用例通过。未构建/安装APK，真机验收待出包
```

## Android ASR 测试网页自测（2026-10-12）

```text
npm run build:web:android-asr -> 16个静态文件，约13.5 MB；输出不含模型
npm run test:android-asr-web -> 4/4通过：Apache模型路径/正式API隔离、16 kHz PCM/WAV、多人片段合并/回查、WASM构建资产/许可
真实Chromium + HTTP同源模型映射 -> Worker/WASM正常初始化，四个Apache模型路径可用
实际测试WAV -> SenseVoice识别“你好啊你好啊你好啊。”
声纹 -> ZH注册成功，512维；单段匹配ZH/1.000
Pyannote多人与快速多人 -> 分段均返回1.01–3.63秒cluster 1/ZH；相似度0.943，分段耗时分别684/323 ms
实际浏览器运行耗时 -> ASR 2384 ms；注册1706 ms；单段3832 ms；多人4107 ms；快速多人3658 ms
zh.wav / en.wav自动语言实测 -> “开放时间早上9点至下午5点。”/“The tribal chieftain called for the boy and presented him with 50 pieces of gold.”
网页耗时 -> 解码2831/3824 ms；按钮到结果7537/3981 ms，前者含本机首次模型装载，后者模型已热
模型校验 -> Apache sidecar与本地ONNX SHA-256一致，tokens.txt两端SHA-256一致；本机同源HTTP映射使用相同文件
冷下载边界 -> Apache 239,233,841字节模型约0.66 MiB/s；直接浏览器冷载180秒未完成，故点击到结果不代表公网冷下载时间
节点和差异检查 -> 页面/Worker/工具语法检查、git diff --check通过
边界（初始网页验收） -> Chromium使用本地已同步模型目录经同源HTTP映射；未部署Apache、未测手机/Firefox/Safari及真实麦克风硬件。Android真机网页性能与原生识别对比见下节
```

## Android ASR 原生/网页真机对比（2026-10-12）

~~~text
设备 -> SM-N9500，Android 9，arm64-v8a；原生测试 APK 0.1.0/1；Samsung Internet 26.1（UA Chromium 122），设备系统 WebView 132 已安装但本轮网页测试走 Samsung Internet
运行配置 -> 原生 ASR numThreads=1、language=auto、ASR降噪关闭；网页 Worker numThreads=1、language=auto；原生 CPU 模式为 AUTO（0–7 全核可调度），浏览器不绑核
模型一致 -> SenseVoice INT8 SHA-256 c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51；tokens SHA-256 f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc
输入一致 -> 网页 AudioContext 解码目录中全部 7 个文件并转 16 kHz 单声道；同一份 PCM 送 Web Worker 与原生本机 HTTPS API；原生 elapsedMs 与 Web Worker elapsedMs 分别统计推理，不含 Web 冷下载
每文件两轮 -> 14 对推理输出逐条完全一致，均无两端文本差异；没有人工真值，未计算 CER/WER
平均热态推理 -> Web 6354.6 ms/文件，原生 4094.1 ms/文件；本组原生约快 1.55 倍（原生平均延迟少约 35.6%）
网页冷启动 -> 首个 Web 请求 wall 20192 ms，其中模型下载/初始化与推理混合；其单独 worker elapsedMs 为 4794 ms。该 229 MiB 模型从本机 HTTP 映射加载，不代表公网 Apache 冷下载
原生冷启动 -> 测量前 APK 模型已就绪，故本轮未测原生首次启动/模型载入耗时；首个预热识别 wall 3915 ms、推理 3678 ms，不与 Web 冷启动作等条件比较
全部文件时延 -> a.wav Web 7413/7106 ms、原生 5247/5224 ms，文本“123321。”；a.wav.converted.wav 7118/7485、5174/5254，文本“123321。”；dajimama.wav 4624/5009、3127/3195，文本“打字妈妈。”
全部文件时延续 -> dajimama2.wav 6519/6968、4075/4158，文本“打字妈妈。”；你好啊你好啊你好啊.wav 8723/8768、5258/5264，文本“你好啊你好啊你好啊。”；你好，小爱.wav 5082/5076、2943/2976，文本“你好，小爱。”；妲已妈妈.wav 4547/4527、2763/2659，文本“打住妈妈。”
大/小核对比 -> 你好，小爱.wav 同一 APK、模型与语言模式，大核4–7为1400/1406/1422 ms，平均1409 ms；小核0–3为2960/3040/2910 ms，平均2970 ms。小核约为大核2.11倍耗时，大核平均少约52.5%；两组输出均为“你好，小爱。”
AUTO观察 -> 全量对比中该文件原生为2943/2976 ms、平均2960 ms，接近固定小核的2970 ms；因未采样每次推理的 sched_getcpu，不能据此断定 AUTO 当时实际运行在哪个核心
核心来源 -> APK 运行时确认 BIG=核心4,5,6,7、LITTLE=核心0,1,2,3；设备频率上限分别为2361600与1900800 kHz；原生设回AUTO并确认健康接口状态为AUTO
格式边界 -> a.wav 实际为48 kHz mono WebM/Opus，虽有.wav扩展名；网页解码后同份PCM送两端，因此该测试比较推理引擎，不比较原生MediaExtractor与浏览器解码器兼容性
性能边界 -> 测试时设备有其他显示端/WebView活动，所有结果是此设备和当前负载下的单机基准；两轮全文件结果足以对照但不是P95/长稳报告
清理 -> 关闭原生 HTTPS 测试服务，删除本轮 ADB forward/reverse 映射；不修改仓库源代码、APK、模型或正式服务
用户标注样本补测 -> 妲已妈妈.wav（16 kHz/mono/2.304 s），参考文本“妲已妈妈”；Samsung Internet Web 热态 3 次 4588/4645/4531 ms，均值4588 ms；原生大核4–7为1276/1263/1259 ms，均值1266 ms；小核0–3为2677/2712/2620 ms，均值2669.7 ms
补测输出 -> Web/原生大核/原生小核均为“打住妈妈。”；忽略句末标点后参考与输出的字符编辑距离为2/4，CER=50%；所有模式输出一致但均与该样本标注有两字差异
补测加载与核心 -> Web首轮模型加载 wall 20275 ms、其中推理4947 ms；Web不绑核；原生健康接口确认 BIG/LITTLE 核心组，线程数1、language=auto、降噪关闭；网页与原生分开运行以避免内存竞争
补测清理 -> 原生 CPU 模式恢复 AUTO 并由健康接口核实；停止 HTTPS 服务，清除 ADB forward/reverse；未改产品代码、APK、模型或服务器
~~~

## Git 构建产物忽略检查（2026-10-12）

```text
git check-ignore -v --no-index -> profile 的 gradle/output/runtime/package、offline-update output*/编译缓存、第三方构建缓存与临时目录均命中
git check-ignore -v --no-index -> release/apkbuild/<profile>/app.json、release/task/*/results、模型、普通 .cache 文件均不命中
git ls-files --error-unmatch -> .cxx 与 Puppeteer profile 在解除跟踪后不再由索引跟踪
文件系统检查 -> .cxx/Puppeteer 本地目录仍存在；仅列出其已跟踪项的待提交索引删除，不列出缓存文件为未跟踪项
其他工作区修改保持原样；不运行 APK、服务包或模型同步脚本
```

## 正式面板分类标题透明度自测（2026-10-12）

```text
读取真实正式HTML → 按link顺序内嵌全部正式CSS，移除业务脚本，不启动HTTP服务器
注入可控localStorage → 加载分类/正式用户控制脚本，保留真实DOM与原生summary
主题dark/light/warm → 各调整0/50/100，共27个新组+1旧组标题及8个summary
计算样式 → 各表面alpha匹配滑条，展开按钮透明且background-image为none，文字主题色
标题/可用控件/所有祖先 → opacity均1；禁用控件保留原弱化，普通浅色按钮仍有渐变
普通动作/危险与禁用按钮、select/color输入 → 各0/50/100自身alpha/image/color/opacity相同
禁用口型按钮 → disabled仍true且自身opacity保留0.45
验证 → 面板6/6（补强后复验通过）、性能100/100、主题28/28，总134项零失败/跳过
Canvas → 调节前后身份/尺寸不变
定位面板滑条input → 三滑条/output/舞台变量同步；change才存储；新文档恢复37
非法/存储不可用 → 默认50；存储写入异常不阻止本页面25回显
嵌套SSGI/旧本地资源 → 标题开合、不误切开关；嘴型summary键盘Enter切换
390×740及844×390 → 面板不越界、overflow-y:auto、内容可滚动
环境 → 单进程Node定向回归；浏览器调试管道被沙箱拒绝时需用户允许更宽权限
边界 → 不按最终像素断言整体50，背景堆叠依原规则；不声明Android真机通过
```

## MMD CPU/GPU渲染耗时自测（2026-10-12）

```text
构造WebGL1/2纯mock → 仅提供各自query接口，记录全部调用，未就绪读取/外部delete主动报错
查询异步与多结果 → 纳秒转毫秒，每项一次收集/删除，合法0保留，非法值不成为样本
活动/待收容量4 → 饱和跳过，回收再采；外部活动query → 不嵌套/结束/删除
驱动异常/disjoint/上下文失效 → 不抛回绘制，清自身资源和代次，restore重新检查能力
性能输入多个延后样本 → 有效样本单独均值，未收到不记0，窗口无值显示占位
代次改变/隐藏/后台/换模型 → 清窗口，迟到结果不入新窗口，销毁移除监听
从真实PMX/VRM提取绘制片段 → begin在物理后，CPU测量不含query，异常finally仍end且原异常不变
构建临时共享模块 → GPU叶子先指纹，性能模块后指纹，重复import去重，二次处理幂等
已安装Chrome + 实际HTML/CSS/回显 → CPU/GPU分别显示，失效带旧值仍占位，390px无溢出
真实WebGL2 + dataURL导入 → 异步查询有效且GL错误0，模拟失去/延后恢复递增代次，不启动HTTP
验证结果 → 性能100/100；WEB构建成功，164语法/147指纹；软件GPU不代表设备性能
生产回归 → 218项211通过/6失败/1跳过；HEAD旧物理fixture同6个路径失败，另列todo
```

## 正式端面板顶层与聊天首次展开（2026-10-10）

```text
正式HTML/CSS + DisplayChat/DisplayStage -> 新文档首次恢复私聊，保持关闭
权威会话到达 -> 请求对应范围；点击展开 -> 最新范围历史显示
群聊/角色和旧端无标识响应兼容；迟到标识响应不能清空当前内容
历史刷新中继续生成 -> 原流式节点保留、用户输入去重、完成后旧快照丢弃
断线重连 -> 权威快照重新请求，关闭状态不改变
两种视口和四向旋转 -> 右下入口不碰圆钮，三个面板底边与入口对齐、位于入口左侧且不越界
设置安全区和100px键盘 -> 对应底边/右边避让
模型正常状态隐藏、错误仅在上方显示；独立进度条存在
模拟10000层弹窗 -> 面板命中点在最上层；关闭舞台恢复3000
真实服务器历史分支和角色注册适配层 -> 回传显示端请求标识，控制端旧协议保持
```

9文件32项通过、零跳过；新增文件9项。静态MMD回归50项38通过12失败；从HEAD读取原始源码与原始测试单独执行，同样12项失败，失败名称完全一致，本轮无新增失败。服务包code57已发布LAN/WAN并完成全部组件校验，设备验收待现场。

## 状态圆钮和共享文字布局自测（2026-10-10）

```text
真实控件模块输入快照RMS=0.5、阈值=0.1 -> CSS变量50%/10%
输入0.0261 -> 填充2.61%，文字0.03；满格限幅、停录暂停/NaN清零
真实顶部布局函数和ASR测量 -> 手机短句22px/长句16px，旋转宽高互换
Chromium实际显示48px内圆、红线和填色，验证短句字号大于14px
长ASR换行滚动且不越过舞台边缘，内容及圆钮原交互保持
四文件25通过，最终21文件93通过、零跳过；构建发布另记
```

## 控制端模式按钮运行与浏览器自测（2026-10-10）

```text
加载真实 DeviceList 和 WebSocketManager，模拟传输和计时
控制端点击 -> 真实createDisplayVoiceListeningConfig保存及广播 -> 权威回执更新
验证双向模式、保存失败旧值、发送异常/超时、断线清理、多设备与迟到回执
实际Chromium加载正式VAD卡片和CSS，点击模式按钮并注入服务端回包
    回包前旧模式和disabled；回包后选中/中性；设备列表不出现模式按钮
    深浅主题正常；聚焦VAD输入时刷新及回包不替换节点、不改变编辑值
最终20文件78通过、零跳过；无关旧声纹配置夹具失败另记
```

## 原生音量柱运行自测（2026-10-10）

```text
加载真实 NativePcmAudioCapture 和 display.html 绘图函数
输入 PCM16 正弦波：静音、轻声、大音量 -> 直接比较画布柱高
推进采集时间超过500ms -> 旧柱衰减
暂停、恢复未收分块、停止 -> RMS/更新时间归零，旧柱不残留
设置全局/TTS暂停 -> 待机绘图
换回浏览器采集和 AnalyserNode -> 实际读取频谱、两帧复用同一数组
计数 requestAnimationFrame -> 初始化和每帧只请求一次
执行结果：四文件16通过；扩大回归64项63通过1既有声纹配置定位失败
```

## Offline固定声纹路径与界面回归（2026-10-10）

```text
正式store复制到独立code-vA/B/C -> 以同一AASC_PROJECT_ROOT启动真实Node进程
    A注册、B加载/删除、C仍空；旧版本未恢复且未修改
    无显式根保留桌面默认库、显式根优先
正式upload DOM/CSS -> 360/480竖屏三个按钮bottom < sidebar.top
    800横屏bottom保持20/80/140，按钮间距60
正式聊天模块 -> 配置前/空配置仅群聊；收到配置后真实助手列表
    小爱私聊 -> 群聊，隐藏面板状态名同步
```

## VAD数字同一状态容器（2026-10-09）

```text
真实RMS 0.026 -> 同一状态容器textContent = "小爱 · 空闲 0.03"
    数字父节点为状态容器，背景透明，不包含VAD前缀
暂停/停止 -> 清空数字，保留助手名/状态
状态文字安全文本 -> 状态文字子节点不产生HTML元素
保留实际点击识别/取消、旋转与角色恢复回归
code52 -> 931源文件字节/CRC/签名与全部组件HTTP大小/哈希、精确清理通过
```

## ASR/VAD反馈与手动结束回归（2026-10-09）

```text
真实RMS回调 -> .012/.014保持同一显示值，.017刷新到.02；不改变hasSpeech阈值
    非有限/负数/停止采集不发布；暂停采集隐藏VAD
本端公共ASR -> 成功/忽略/空结果 -> 独立底部节点，新结果替换旧结果
    未匹配声纹可以回显，聊天仍只发送匹配文本；迟到结果不覆盖
真实浏览器 -> 结果在助手名/状态上方，长文本受限高度且换行，文本不执行HTML
    VAD两位小数、停止隐藏，聊天层真实CSS隐藏，旋转与角色恢复兼容
旧监听夹具 -> 执行真实格式化函数，验证新底部路由
再次点击未合格 -> 立即停止且无提取/无ASR，不继续静音等待
    未过阈值、静音起点为空、静音未满、时长不足、仍在讲话
再次点击合格 -> WAV提取后释放，ASR/聊天只一次
共用判断 -> 静音严格大于、最短语音大于等于边界
真实RMS -> 首次低音量不结束，静音超时后自动完成
60秒到期仍未合格 -> 停止并丢弃，不绕过静音
浏览器实际点击 -> 讲话中取消，预先合格则识别一次
发布code51 -> CRC/931源文件字节一致/签名/组件约束
    LAN/WAN清单一致、所有组件HTTP大小与SHA-256、精确清理均通过
```

## 显示端语音状态按钮、助手名及Offline选择恢复（2026-10-09）

```text
从正式display.html提取activateVoiceInteraction及handleTTS
    模拟设备采集与实际播放资源，不替换整个点击业务
持续模式 + 正在播放 -> 实际点击 -> 停止本端播放 -> WebSocket stop -> 空闲
手动模式 + 正在播放 -> 实际点击 -> 停止本端播放 -> WebSocket stop -> 开始单次采集 -> 监听中
手动再次点击 -> 结束采集 -> 已停止
四方向旋转 -> 圆钮实际点击命中；状态文字仍位于圆钮上方
回归能力关闭/暂停/断线/迟到识别/启动去重，不触碰真实用户配置
隔离release目录 -> 真实会话写入 -> 新服务进程读取 -> 私聊/会话ID/角色正确
Offline真实连接调用 -> waitingWake且有效私聊 -> activePrivate并调用既有计时器
    非Offline/能力关闭/默认群聊/角色/临时/无效目标/已有活跃会话 -> 不额外激活
浏览器导航新文档 -> 注入权威快照 -> 面板仍关闭、对象/名字恢复、语音发送正确目标
    缺roleTarget兼容已有选择，明确null接受清空；标签textContent不执行HTML
    名字事件更新标签与aria-label，不增加轮询
```

## FSR2覆盖率与空间轮廓回归（2026-10-09）

```text
生产resolve/present GLSL → 真实WebGL2执行，历史关闭以隔离空间重建
解析半平面 → 每输出像素16×16参考覆盖，独立于生产采样算法
输入 := 比例0.5/1 × 12个正负角度 × 偏移0/0.37 × 透明/不透明双色，共96组
重建/最终输出 → 覆盖绝对误差、面积偏差、覆盖重心位移
比例1 → 四通道像素中心最大误差不超过1；零权重前景不能替代中心
面积偏差绝对值不超过32个输出像素；重心位移不超过半个输入像素
最终滤波 → 空间覆盖平均绝对误差不得比重建增加超过0.003
原jitter夹具 → 低比例重建/最终输出存在中间覆盖，六组跨帧RMS降低、中心色不变
共享构建副本 → FSR2真实场景160×200/画布320×400，PNG期间保持请求尺寸
普通TAA/透明/RGBA8回退/背景揭露/模式切换/后台/相机 → 保留既有独立断言
```

原“部分覆盖必须增加10个像素”不再作为质量充分条件：修正后的重建本身即产生覆盖率，空间形状由上述独立参考验收。

## FSR2轮廓滤波回归（2026-10-09）

```text
真实静态斜边 + 32/64与64/64输入输出 -> FSR2 present开/关滤波对照
    部分覆盖alpha像素增加；跨jitter静态轮廓alpha RMS变化下降
    中心RGBA逐值一致、gl.getError()==0；检查透明边界无重复预乘
普通TAA -> edgeAaEnabled=false，真实颜色/alpha/背景揭露fixture仍同值
真实米娅 -> FSR2输入160×200/输出320×400；AO/接触/SSGI/PNG旁路与恢复
性能 -> 同一SwiftShader场景分别记录TAA/FSR2全帧GPU完成时间和历史目标估算
```

## TAA / FSR2模式回归（2026-10-09）

```text
旧localStorage(taaEnabled) + 缺aaMode -> 加载为TAA；新选择与fsr2Scale保存/刷新/复位
总开关关闭 -> 两种方式旁路；aaMode='taa'|'fsr2'互斥，不双重resolve
TAA路径 -> 原投影抖动、1:1目标、历史拒绝、预乘alpha与PNG尺寸不变
FSR2路径 -> 输出尺寸×比例的AO/场景颜色/深度；当前TAA颜色输入按内部尺寸
    jitter按内部像素；全分辨率历史颜色/深度；depth-guided当前颜色重建并present到输出
    验证相机/深度重投影、覆盖/颜色拒绝、模式/比例改变失效、异常释放与无纹理反馈
实际WebGL2 -> 32×32输入升采样到64×64；真实模型160×200输入到320×400输出
    WebGL2能力旁路/诊断/PNG不降内部分辨率；不生成/读取物体或骨骼运动矢量
性能 -> 固定模型和Canvas倍率比较TAA/FSR2；拆分内部输入与输出历史显存估算
    SwiftShader只做正确性和软件GPU计时，不代表移动设备帧时
```


## TAA抖动参数回归（2026-10-09）

```text
规范化输入 -> 旧存储1/8默认、强度有限值夹取0..2、周期离散集合
真实透视/正交矩阵与AR裁切 -> 4/8/16/32循环、八相位手工基线逐值兼容
    强度0无偏移/1原值/2双倍，65×97像素换算，改值首帧历史拒绝
真实网页控件 -> GPU场景投影与接触相位确实随周期循环，场景绘制次数不增加
    保存0.35/32 -> 刷新读回 -> 灯光复位1/8
    WebGL2能力禁用input和select；Canvas倍率仍可用
既有GPU/角色/后台/相机/PNG -> 保持可见、透明alpha和原矩阵恢复
```

## TAA与Canvas倍率回归（2026-10-09）

```text
真实THREE矩阵/模拟提交 -> 基础投影与AR裁切抖动后恢复、前帧读写隔离
    首帧/异常/context失效、关闭释放、WebGL2旁路；异步动作重播提交后清历史
Canvas规范化 -> 默认1/上下限/步长、DPR1/2与.25/.5/1/1.5/2、设备上限等比限制
真实Shader -> 静态轮廓覆盖收敛、内部颜色保持、颜色突变/背景揭露拒绝
    预乘alpha不重复乘，真实AO合成TAA开关半透明颜色一致
真实米娅 -> 倍率/DPR实际尺寸、四种接触/SSGI组合像素、页面后台投影/角色保留
    骨骼确实动画、seek失效、PNG尺寸/预览恢复、保存刷新/复位、正式分类展开
真实静态GLB -> 同一TAA链有效像素与历史，模型切换
性能 -> 固定姿态/效果，DPR2下.5/1/2倍率、TAA开/关
    两次预热三次测量，readPixels+finish等待GPU完成，中位数/额外5目标显存
既有回归 -> 接触198组真实GLSL/滤波/范围、真实刷新阴影内部与无遮挡、后台与模拟AR
合并PMX导出 -> 每次下载配置独立CDP目录，避免同名覆盖使新文件检测误超时
    保留原始/编辑/复制/工程恢复样本，独立回读参数，配贴图重新加载
```

## 接触优化与alpha保边模糊回归（2026-10-09）

```text
生产GLSL追踪 -> GI旧入口60组 + 新正交54组 + 新透视84组
    正/反向、薄交点、晚段、轮廓、自遮挡、背景、朝相机/跨近平面，4/12/20/30/32/64步
生产滤波 -> 平面alpha尖峰平滑、深度阶跃/法线折面/背景拒绝
    接触模式RGB不变；GI模式alpha不变
生产范围归约 -> 奇数5×3、单像素薄片、背景混合、向外16位量化覆盖全部2×2像素
    float32整数码边界 -> near/far额外向外扩一码并夹紧，严格包含全部原深度
运行时 -> 每帧先范围再追踪、奇数/DPR尺寸、关闭释放、异常恢复、另一通道与无反馈
面板 -> 两套0..3轮及半径1..5，旧值/存储/显隐/复位独立
真实米娅 -> 正式分类与64步/3轮/半径存储，刷新/DPR角色像素、完整viewport
    冻结动作/物理、固定近景、强度1/距离3/30步，0/1/3轮内部与无遮挡胸部、静态重复
可选耗时 -> MMD_AR_COMPARE_BASELINE=1，读取aee7d27b旧模块作为HTTP夹具
    同一模型/相机/768×752/低质量/12、30、64步，两预热七测量，readPixels强制完成绘制
    记录全部AO/光照pass中位数/P95，计入范围归约与滤波；SwiftShader不冒充手机GPU
```

## 六轴IMU网页定向自测（2026-10-03）

```text
npm test:imu:six-axis-test -> 三个测试文件，11项
  固定理想生成器 -> 三类运动14秒 -> 位置<1e-7m，姿态<1e-6rad，四元数归一
  匀速与线性数据 -> 不误清速度/不重复去重力；显式停稳记录
  静置与六面偏置比例 -> 恢复校准，移动窗口拒绝；固定种子噪声对照保留残余
  null/重复/回退/长gap -> 拒绝或冻结，不跨空白积分
  航向重置 -> 抵消水平角、保留倾斜；pause -> 发布最后有效测量时间
  浏览器beta/gamma/alpha -> x/y/z，横竖屏不重复变换
  跟随相机 -> 相对距离方向不变，target=设备位置
  实际WS双源与观察者 -> 所有权/代次/seq、晚加入快照、断线状态
  实际Chromium指针 -> 箭头/圆环拖拽、独立视口、移动后摄像机跟随
  关闭模拟输出后拖右侧 -> 真值变化，左位置/姿态冻结
  第二浏览器手机页面 -> 隐藏模拟器、事件输入共用引擎、同房间结果
Android另行真实采集 -> localhost可信上下文，208样本/约60Hz，静置校准成功，70观察帧
实际距离精度/iOS/手机六面及长期性能 -> 现场待测，不用事件注入冒充真机
```

## TMP14顶点布料检查范围（2026-10-02）

```pseudo
本轮 := 用户未要求测试，不新增或运行自动测试/模拟；只执行现有网页构建及静态检查
静态 := 7源/8生成/4内联语法；27本地导入、22SHA256内容指纹
    6控件唯一；Ammo/XPBD/TMP14三选项；子步3..180/default45；3模块源生成一致
人工 := 自动物理权重组及逐组开关、直接固定根部/静态接缝、自由末端
    源几何/相对morph/反向蒙皮、共享骨骼与原Ammo、代理碰撞掩码/风/AR缩放
    UV接缝/双面层/材质/表情/透明/阴影/AO、暂停/恢复/模型/VMD/失败清理
    低子步穿透、45子步手机耗时、几何morph克隆内存；首版无自碰撞
状态 := 静态通过，本地web-dist同步；实际效果与性能未验收，todo保留人工项
```
## MMD AR阴影像素对齐及跟随自测（2026-10-02）

```text
真实注入fit -> 默认倍率1、自动半幅=原0.5；四倍率往返不累乘
真实Three双光矩阵 -> 各实际尺寸512/1024/2048/4096，宽高不同也各自取步长
    世界原点投影整像素；宽高/近远裁面/光向不变；中心补偿<=半个像素
    重复10次不漂移；连续100帧每帧0.15像素位移 -> 网格最终跟随约15像素
    Three再次updateMatrices -> 对齐保持，不依赖被覆写的camera.position
真实注入跟随 -> 纯平移同步灯位/目标/承接面，静止与平移不再获取Box3
    缩放/复位比例/换根 -> 按新角色拟合；无根 -> 清缓存
真实PMX浏览器 -> 检查四档整像素、倍率宽高及覆盖变化
    translateModelByPixels -> 移动中跟随，资源数/拟合次数保持
    setArPose改变位置/比例 -> 拟合；resetArPose -> 位置/比例/范围恢复
    保存/刷新/复位 -> 默认倍率仍1、资源回收
结果 := 十项单元、真实PMX浏览器（约347秒）、两项面板静态检查通过
    构建及40脚本/4内联/28指纹通过
手机阴影观感/裁切/长时间性能 := 待现场验收
```

## MMD AR阴影相机范围倍率自测（2026-10-01）

```text
倍率规范化 -> 0.1–2、步长0.01；非法/旧偏好缺字段 -> 1
抽取实际生成fitShadowCamera -> 执行0.1/0.5/2/0.5/1/1
    两灯right/top := 初始半幅 * 倍率；left/bottom反号
    投影矩阵X := 初始值 / 倍率；往返不累乘；near/far仍来自原自动拟合
真实网页 -> 等模型实际绘制稳定后统计GPU资源
    设置倍率 -> 等待当前ShadowMap读回 -> 检查范围/贴图尺寸与资源数
    比较2与0.5覆盖估算 -> 缩小范围应增加角色覆盖
    0.1极小范围 -> 可裁切；重新1/0.5 -> 范围还原不累乘
    灯光重新拟合/刷新 -> 当前倍率保留；复位 -> 1
HTTP夹具 -> CSS响应text/css，加载真实面板布局；超时输出范围/可见性诊断
八项定向自测、真实网页回归与两项面板静态检查通过；手机观感待验收
```

## MMD AR骨骼球遮挡轴与零K（2026-10-01，静态完成）

```text
源码/Three实际渲染代码 -> opaque在transparent之前；跨队列renderOrder不足
静态修复检查 -> 关节/原选中轴transparent=true、opacity1，RGB99/关节100/实际101
构建 -> npm网页退出0，6源/5生成/4内联语法、19导入/16指纹、3源生成一致
只读PMX统计 -> 米娅261关节，平移783个K全0、旋转783个K全0；零K灰符合数据
本轮运行测试/模拟 -> 无；不以静态队列推导替代真机图像验收
人工待验收 -> 球间遮挡开关和遮挡透明度0/50/100%；轴在球后且完全不透明
    K轴球尺度、仅归属关节筛选保持，零K灰与白/红实际标记可辨认
```


## MMD AR阴影尺寸及ShadowMap预览自测（2026-10-01）

```text
共享尺寸规范化 -> 四档/非法值/设备上限 -> 合法实际尺寸
旧map与mapPass相同 -> 去重释放；重复销毁 -> 不再释放
预览GPU掩码/灰度 -> Y翻转 -> 灰度输出与占用比例独立正确
禁用/折叠/屏幕外 -> 零读回零新目标；启用 -> 单目标复用且250ms节流
诊断绘制异常 -> finally恢复原目标/视口/剪裁/自动清除/阴影启用
真实网页加载PMX -> await关闭物理的模型重载 -> 开启两灯阴影
逐档512/1024/2048/4096 -> 检查真实map宽高及贴图数量不累积
开启预览 -> 角色与空白同时存在、宽高/覆盖说明、仅增加1个目标
复用/关闭 -> 提示与旧图清除；折叠 -> 读回计数不变
关闭预览 -> 目标回收；保存2048/刷新 -> 恢复；复位 -> 1024/关闭预览
结果：尺寸6项、真实网页1项、相关面板4项通过
```

## MMD AR关节六K轴图形（2026-10-01，仅静态完成）

```text
构建 := npm run build:web:mmd-ar-test -> 本地web-dist生成成功
静态 := 诊断/骨骼/面板/注入/构建源码及生成脚本、内联脚本语法通过
    新3控件唯一且位于骨骼分组；本地导入和内容指纹正确；3源生成一致
    新模块无Canvas/fillText，独立scene两个LineSegments，runtime/Display两API保持
本轮运行测试/物理模拟 := 未请求，未新增/执行
人工待验收 := XYZ箭头/旋转弧及原RGB选中轴同球尺度、六K色阶、图形限位/锁定/自由
    单开关/归属过滤不显示下一节、反向A/B、无亲缘第二端归属
    Ammo/XPBD位移/角度白标，越界/超范围红标，无物理未模拟，面板缓存值
    非零/反向/全圈限位、模型缩放旋转、刷新/模型/VMD重建、关闭清理与手机性能
结论 := 构建/静态通过，真实画面/姿态精度待现场
```


## MMD AR风力上限30（2026-10-01）

```text
已有声明 -> 14项真实Ammo风场夹具、共享规范化、经典Display/面板、真实米娅
明确边界 -> 3保持3；30保持30；31/999截断30；缺失/空白/非法回退0.3
自由体 -> 强度0.3与30分别跨Hz/FPS连续模拟1秒 -> 速度符合缓动后的施力积分
受控type2 -> 强度30、阵风100 -> 位置约束保留，极小惯量风矩有限；零偏移不制造风矩
本地存储 -> 风启用且强度30 -> 执行面板初始化 -> 值30/读数/Display一致
真实米娅 -> 90/180Hz × 风开关 × 强度30模拟2秒 -> 姿态有限、风响应可观察、native全部释放
构建 -> npm run build:web:mmd-ar-test -> 滑条max30与共享模块/经典副本指纹一致
LAN检查 -> 默认0.3 -> 手动30 -> 实际物理30 -> API31截断30 -> 刷新恢复30
结果 -> 14项自测及35脚本/4内联/21指纹通过；LAN控件/物理值30、API31截断和刷新30恢复通过
```


## MMD AR物理风场（2026-10-01）

```text
已有声明 -> 真实THREE/Ammo/MMDLoader/MMDParser，稳定性/子步/生命周期/动作/面板夹具
风夹具 -> 同构造补丁注入MMDPhysics；经典Display及面板执行真实归一化声明
参数 -> 缺失/空白/非法/边界/步长；来向经纬度6基轴、极点、±180一致
时间 -> 0.3秒指数缓动步内均值；30/90/180Hz同秒积分；阵风按模拟秒，暂停不进相位
真实自由体 -> 30/90/180Hz × 30/60/144画面FPS一秒风速度近似一致；关闭保留速度
坐标 -> 非单位缩放与0/±90°旋转枢轴，物理速度转回场景后保持外部来向
受控type2 -> 骨骼局部位置/线性因子保留；风矩旋转，极小惯量受限，零力臂无转矩
回收 -> 施力抛错后继续模拟池稳定；64次开风创建/销毁native对象归零
runtime -> 新实例首次帧前补发；同实例无变更跳过；纯JS弱引用缓存
真实米娅 -> 90/180Hz各模拟2秒，风关/开姿态有限并有差异，全部销毁
稳定性回归 -> 风补丁类运行16项原旋转/type2/纠错测试；蝴蝶结固定刚体不自旋
LAN -> 默认风关 -> 0.5/45/30/50 -> VMD切换新物理继承 -> 刷新保留 -> 关闭 -> 损坏偏好默认
结果 -> 58项通过，35脚本/4内联/21指纹与网页构建通过，手机风效果/CPU待验收
```


## MMD AR默认纠错45Hz与物理90Hz（2026-10-01）

```text
已有声明 -> 物理频率/稳定性/子步/生命周期/动作/面板测试及真实THREE/Ammo
输入 -> 缺失、null、空白、NaN、Infinity、保存65/180、纠错130
共享参数 -> 缺省90Hz/10步/参考45，合法保存值规范化后保持
生成Display接口 -> 无runtime时也按共享规则归一纠错，空白回退45
真实构造 -> 不传步长默认1/90；六轴ERP=1-0.525^(45/90)
回归 -> 骨骼父逆乘刚体世界旋转；type2位置；子步锚点；清速度切换与资源回收
LAN浏览器 -> 新上下文90/45 -> 手动180/130 -> 刷新保持 -> 非法90/45 -> 物理复位90
每次状态 -> 捕获真实物理实例unitStep/referenceHz与6轴ERP，核对控件；页面异常为空
构建 -> npm run build:web:mmd-ar-test -> 34脚本/4内联/19相对指纹通过
结果 -> 51项唯一测试通过（面板夹具同步后复验）；手机实际观感待验收
```


## MMD AR原生预览竖屏方向（2026-10-01，几何自测已通过）

```text
已有声明 -> CameraPreviewGeometry生产实现、JUnit4、现有Android Gradle工程
新增自测 -> app/src/test/java/com/aasc/mmdartest/CameraPreviewGeometryTest.kt
操作流程
  竖屏sensor90/display0 -> 默认TextureView已旋转的横向边仍向下 -> 只做比例补偿，无额外90度
  sensor四方向 × display四方向 × 窗口四比例 -> 64组合
    原始中心映射窗口中心 -> X/Y像素长度一致且正交 -> 四角覆盖窗口并居中
  非中心主点及不等fx/fy -> 四个像素 × 三个深度 × 64组合 = 768条射线
    反推GL相机点 -> 生产投影 -> 还原窗口像素 -> 与相机预览像素一致
  三对应角独立求显示仿射 -> 验证第四角与内部点 -> TextureView补偿与原始帧显示一致
  180度同尺寸变化 -> 几何不同，像素绕窗口中心反转，投影X/Y行反转
  深度近远端 -> NDC -1/+1；非法尺寸/方向/内参/裁剪范围 -> 拒绝
验证 -> Gradle testDebugUnitTest 6项通过，0失败/跳过；两端控件/原生模拟分流2项Node回归通过
真机 -> 修正版APK构建及覆盖安装SM-N9500完成
  真实采集640×480；同进程窗口720×1480/display0 -> 1480×720/display90 -> 720×1480/display0
  预览持续显示，布局及显示旋转更新几何，未因尺寸变化停止定位
  APK方向unspecified；测试后恢复系统自动旋转1/user_rotation0；180度仅数值验证
```

## MMD AR后蝴蝶结末端旋转回写（2026-10-01，已实现并验证）

```text
稳定性tests/mmd-ar-physics-stability.test.js -> 新增5项，与原9项合计14项通过
  合成type1/type2 -> 不同轴父子大角度、刚体偏移、256次回写 -> 世界旋转等于明确目标
    旧回写平均角误差2.053154rad/角增量2.030531rad；修复角增量0
  每帧恢复动作局部姿态/改变模型和父级旋转 -> 当帧物理世界目标一致
  非单位模型缩放/旋转及外层Group -> 真实物理帧世界旋转正确、type2局部位置保持
  父级读取异常 -> 全部池对象归还；连续1300次 -> native稳定且角速度保持
  真实米娅刚体120/127 -> 1200次固定回写，末300次骨骼角增量0
    原回写两目标平均角增量右122.522767度/左118.519752度
    从绑定姿态reset -> 180Hz、60FPS、20秒 -> 两目标回写误差不大于0.000003度
    骨骼转角等于物理目标转角，分别记录角速度RMS，不以平滑掩盖残余物理扰动
  唯一/缺失/互换边界 -> 构建适配失败；固定vendor未改
原回归 -> 频率4/子步6/生命周期6/动作切换8/骨骼8/点选10/碰撞体9，共51项通过
总计 -> 65项；边界互换夹具修正后针对入口用例复测通过
构建 -> npm run build:web:mmd-ar-test；33脚本（含物理vendor2）/4内联/19相对导入指纹通过
LAN网页 -> 180Hz播放12/暂停12/恢复13帧，共37帧，两目标最大世界误差4.214685e-8rad
  骨骼4实例组、无页面错误；实际物理URL内容指纹f3d9add20d67
```

## MMD AR网页全功能同步APK与灯光修复（2026-10-01，已验证）

```text
已有声明 -> 网页/APK生成目录、真实米娅PMX/VMD、Chromium、已连接SM-N9500
新增自测 -> tests/mmd-ar-apk-parity.test.js
  两端ID集合 -> APK剔除5个原生控件 -> 与网页一致；所有ID唯一；共用模块摘要相同
  系统目录回调 -> 相对路径File内容正确；重复/旧消息忽略；取消保留；异常/退出释放令牌
  可用原生能力 + 模拟输入 -> MindAR；真实输入 -> 释放预览 -> SLAM -> 幂等停止并恢复预览
  实际APK页面 -> 加载内置模型 -> 展开灯光并切主光阴影 -> 动作骨骼 -> 目录选择真实PMX
    等待resourceId为local且加载完成 -> 选择本地VMD -> motionResourceId为local -> 定位展开
    官方定位图HTTP200 -> 页面错误为空；允许无关favicon404
  超时诊断 -> 输出profile、文件选择状态、页面错误与缺失资源，不吞掉加载失败
本地文件单测 -> 注册表只接受确切File/扩展名；拒绝未选及已释放路径
验证 -> APK4 + 本地文件2 + 相机动作2 + 进度/分类/频率/动作切换24 = 32项通过
构建 -> npm两端脚本通过；各31脚本/4内联/18导入指纹；APK76网页文件/14模型文件/原生资源校验
真机 -> 覆盖安装成功；三面板展开/收起日志；回环官方图200且大小/摘要一致
现场待验收 -> 系统目录/标定、原生地图精度/回环及长时间帧率/内存
```

## MMD AR骨骼大小、名称、点选与碰撞累计（2026-10-01，已实现并验证）

```text
selection模块10项 -> 真Three、可观察Canvas与真Ammo
  倍率默认/端点/无效值/真实实例半径，骨骼与物理参数不变
  中文固定字号、唯一Canvas、DPR/尺寸变化、空名及相机/屏幕裁剪
  关闭/隐藏即清屏，关闭无额外名称绘制；换模型/幂等销毁释放轴与Canvas
  点选/空白/等距前方优先，多绑定/无绑定骨骼与局部轴父级变换
  刚体过滤压缩有效count，空集合隐藏，不重建资源，取消恢复全量
  真Ammo每子步累计直接对手，不递归链；1000+次读取不改速度/native对象数，4MiB探针复用
  跨子步短暂接触保留；读取异常不打断物理；重建/取消清除回调与累计
  偏好损坏/受限、范围钳制、面板状态与清空按钮
原有骨骼8/刚体9/子步6/切换8/生命周期6/稳定性9 -> 与selection10合计56项通过
面板回归 -> 控件ID和分组、大小范围、开关默认关闭、原交互/滚动保留
真实网页 -> 大小端点/名称/高亮/三轴/实际轻点/拖动/CDP真实双指/取消恢复全量
  刷新恢复设置；PMX切换清选择，VMD保留选择且物理替换清累计；Canvas数量稳定
构建 -> npm run build:web:mmd-ar-test；31生成脚本/4内联语法/16导入指纹/LAN HTTP200通过
当前状态 -> 面板8项与最终真实网页1项通过，总计65项；手机密集名称可读性/触摸命中/帧耗时待现场验收
```

## MMD AR PMX碰撞体显示（2026-10-01，已实现并验证）

```text
模块自测 -> 真Three几何和世界变换
  球半径/盒半边长到完整尺寸/胶囊Y轴与端帽比例，红0/黄2/绿1
  读取Ammo实际COM位置/旋转，故意与骨骼分离 -> 线框跟随物理结果
  无物理 -> 骨骼偏移配置预览；无骨骼仍显示；非法数据安全跳过
  模型/父级平移旋转及非单位缩放 -> 物理到显示坐标无重复变换
  开关独立/默认关闭/偏好异常；首帧隐藏与关闭时无逐体更新
  动作/物理重载 -> 新physics对象生效；不访问已销毁的旧Ammo引用
  native姿态读取 -> 池对象归还，无持续增长；不写入速度/约束
  几何复用/实例化/重复模型替换/幂等释放/绘制异常恢复
真实网页 -> 同时开启骨骼与碰撞体、动作暂停/播放、物理关/开、换PMX/VMD、刷新
  分类/姿态/状态说明正确，无页面异常，资源数量不持续增长
  记录实际刚体数量、实例组数量和开启的帧耗时，手机观感另验收
npm网页构建 -> 生成语法/模块指纹/LAN页面资源核对
当前状态 -> 碰撞体9项/骨骼8项/面板8项/动作切换与生命周期14项/浏览器1项，共40项通过
  真实Ammo -> 1000帧读取，无native数量增长，4MiB探针复用，堆64MiB
  默认PMX形状 -> 134盒/49胶囊，无球体；球体由模块Three/真实Ammo用例覆盖
  网页构建成功，30脚本/4内联语法/16导入指纹/LAN HTTP200通过
  浏览器225秒 -> 183体、33实例组/31几何，累计释放132旧组，无页面异常
  AO/骨骼独立开关/物理实际及预览/两次PMX/VMD/刷新恢复通过
  SwiftShader连续8帧 -> 骨骼开启基线877.89ms/帧，碰撞体开启923.57ms/帧
    软件渲染短窗口不代表手机性能；密集部位观感另验收
```

## MMD AR 骨骼物理状态球（2026-09-30，已实现并验证）

```text
真实Three模块自测 -> 输入已加载刚体元数据与骨骼
  断言红type0、黄type2、绿type1，无关联灰，非法索引忽略
  断言同骨骼type1优先type2优先type0，采用加载后type转换结果
  更新骨骼/父级变换 -> 小球位置等于骨骼世界位置，球大小跟随模型缩放
  关闭/角色首帧隐藏 -> 无实例更新与overlay绘制
  overlay绘制失败 -> renderer状态恢复；骨骼/物理状态不被写入
  换模型/重复销毁 -> 旧实例/几何/材质释放且无残留骨骼引用
面板自测 -> 开关在动作面板、默认关闭、图例映射正确、偏好恢复与转发
真实网页自测 -> 默认PMX开关/动作/物理暂停/恢复、刷新、再次选择PMX
  检查分类与位置、T Pose首帧门控、无页面异常、资源数量不持续增长
现有npm网页构建 -> 生成模块语法及内容指纹校验
当前状态 -> 模块8项/面板8项/切换和生命周期14项/真实网页1项，共31项通过
  软件WebGL真实网页 -> 321骨骼/4实例组；5代模型/旧16组释放；VMD复用球资源
  开关/刷新/AO/两次PMX切换通过，截图确认；构建/语法/指纹/LAN HTTP200通过
  首帧尚隐藏 -> 测试等待真实显示帧再比较资源，避免把未分配状态当泄漏
  性能采样 -> SwiftShader连续8帧，关闭732.16ms/帧，开启778.13ms/帧
    属于软件渲染环境及短窗口，不代表手机性能；真机密集位置观感待验收
```

## MMD AR ORB-SLAM3迁移评估（2026-09-30，尚未实现）

```text
本轮: 只核对源链路与官方资料，未新增/运行测试、构建或实际SLAM
后续实现需验收:
  纯网页无接口/MindAR保持；桥存在但available=false或版本错误仍回退
  APK原生可用才启动，失锁不误切MindAR；启动失败先释放输入再回退
  会话代次拦截迟到回包；两后端不争用相机；原生预览与WebView投影一致
  相机/IMU采集时间基准、校准/尺度初始化、真机三维平移与旋转
  世界相机转换/投影/背景裁切，保留动作/Ammo/手动变换/第二层缓动
  不重复旧IMU积分；失锁/重定位/回环/新地图时锚点处理
  停止/后台恢复/线程释放、手机CPU/帧率/发热/内存
  单图透视模拟仅验证桥接，不能证明空间SLAM稳定性
```

## TTS 内存音频下发与 Node 标准输入播放（2026-09-30）

```text
本轮仅静态检查，不新增或运行测试:
  tts-service/cache/cache-config/http、config-app-service、server-app、Node audio-player
  控制端tts.js/websocket.js -> node --check通过
  定向差异空白检查通过；两处服务端生成与Node URL/Buffer路径无写文件入口
待现场验收:
  默认128MiB、16..1024边界/非法值规范化、容量热应用与持久化失败保留旧值
  Android禁用外部TTS时也恢复显示端回传音频缓存容量
  多控制端广播/断线重连/服务器重启恢复，10秒无回包解除等待
  降额不驱逐有效音频，超额拒绝新增，过期后恢复；升额立即放行
  外部/显示端生成成功及fallback，API/普通/Agent/文本媒体/语音/提醒/报时
  完整GET/HEAD、首尾/后缀/无效Range、重复/多端读取、过期/重启404
  单段/总量/条数超限、异常base64、上游错误/超时/中断不发布半成品
  Windows/Linux：没有新增临时WAV，有正常声音、队列/停止/新句不被旧结束覆盖
  录音暂停后停止恢复，16位PCM额外RIFF块/立体声的AEC回调只执行一次
  旧WAV汇总清理且清理完成后不再磁盘扫描，其他文件/符号链接保留
```

## MMD AR Ammo固定子步锚点与180Hz（2026-09-30，已验证）

```text
已有声明: 真实Three/固定Ammo WASM、WEB_MODE构建补丁、native生命周期与本地资源浏览器压力
新增定义: AnchorTrace { substepTime, position, quaternion, linearVelocity, angularVelocity }
操作流程:
  60FPS/180Hz -> 单帧位置和旋转目标 -> 实际三个单步及其MotionState目标等比例推进
  60/90/120/144FPS -> 固定步余量跨帧 -> 单位时间模拟步数与速度一致
  120FPS/65Hz -> 无子步帧不强制推进；动态速度不清零
  复位/步频改变/后台恢复 -> 同步姿态历史与时钟，无跨旧状态插值
  预算超限 -> 余量不足一步，无无限补算；异常 -> 临时资源归还
  真实关节 -> 锚点带动动态刚体；native循环释放 -> 计数归零
  180Hz网页 -> 模型/动作切换首帧物理、下一帧动作与内存有界
  旧480保存值 -> 页面与实际物理参数限制180，实时调65不重建
验证结果:
  tests/mmd-ar-physics-substeps.test.js -> 6项真实子步/关节/历史/边界测试通过
  同步rate/lifecycle/motion-switch夹具 -> 与构建一致的完整物理补丁链
  定向74项 + 本地资源浏览器3项 -> 77项通过
  64轮锚点关节 / 128轮生命周期 -> native分配清空、4MiB探针地址复用
  浏览器约563秒、24次VMD/4次PMX -> 创建32/释放31/存活1、64MiB、391064字节跨度
  旧480设置恢复180、实时65不重建、首两帧动作门控 -> 通过
  npm网页构建 / 10脚本与4内联语法 / 11导入指纹关系 -> 通过
待现场:
  手机实际CPU、帧率和布料抖动改善程度，不以自动化关节测试代替视觉验收
```

## MMD AR 布料480Hz（2026-09-30，历史验证记录）

```text
已有声明: 网页专用频率适配、固定Three/Ammo、Node测试及本地资源Chromium压力用例
新增定义: RateCases、真实动态刚体位移、BrowserRate { input, persisted, unitStep, maxStepNum }
操作流程:
  规范化边界/默认/非法值 -> 30到480，5Hz步长，65默认；低频3子步、高频0.1秒预算
  固定源码经网页补丁 -> 实际helper创建480Hz物理 -> 与正式90Hz限幅对照
  480Hz刚体恒速运动一秒，输入帧率60/30/10 -> 位移接近一米，无时间截断
  同步修改现有实例预算回65 -> 仍为原实例，不归零速度
  网页滑条默认65、范围30到480 -> 设置480 -> 控件/API/存储/物理参数一致
  真实24次VMD与4次PMX切换 -> 参数保持480，首帧门控与native回收继续验证
  实时调65 -> 当前物理使用3子步，实例未重建；再设480并刷新 -> 恢复480
  既有灯光AO夹具 -> 补齐正式页面已有主光阴影控件，避免全控件初始化提前返回
  既有面板夹具 -> 同步现有过滤/IMU/重力控件与分类名称，默认不透明度50%
结果:
  定向回归57/57；面板/资源10项最终覆盖通过（旧夹具修正后定向复测3/3）
  本地资源浏览器3/3，480Hz压力阶段24次动作与4次模型切换，耗时约589秒
  物理创建32、销毁31、存活1；堆67108864字节、探针跨度3516552字节，无页面异常/OOM
  构建通过；9个源/生成脚本、4个内联脚本语法及6个导入指纹通过
待验收:
  发布后手机480Hz帧率、CPU负荷、布料观感与不同模型兼容性
```

## MMD AR 重力缓动默认20ms（2026-09-30）

```text
本轮构建和静态检查，未执行测试:
  默认过滤/模型/控件状态 -> smoothingMs=20，生成滑条/读数=20ms
  npm run build:web:mmd-ar-test -> 成功，源/生成脚本语法通过
待现场验收:
  无已保存用户设置 -> 默认20ms；已有参数 -> 恢复原值
  0关闭缓动、手动旋转叠加/居中、手机跟随观感
```

## MMD AR 重力摄像头背景与默认外观（2026-09-30）

```text
本轮仅构建和静态检查，不新增或执行自动测试:
  npm run build:web:mmd-ar-test -> 成功生成web-dist
  构建/分组/重力注入/背景模块/跟踪源及生成AR脚本 -> node --check通过
  生成页面复查 -> 三个面板默认50%，开关默认关闭，顶部固定提示DOM已移除
待真机验收（未执行）:
  重力开启 -> 勾选背景 -> 授权成功显示，手动/重力叠加继续
  背景关闭/重力关闭/后台/离开 -> 独立轨道停止，迟到授权轨道停止
  图片定位 + 背景关闭 -> 只隐藏视频，目标识别/蓝框继续
  校准 -> 独立流释放，校准预览显示，关闭后按选择恢复
  快速开关/授权拒绝/前后台/横竖屏/真实及模拟输入切换 -> 无重复占用
  无已保存不透明度 -> 三个面板50%，调节并刷新 -> 恢复手动值
```

## MMD AR Ammo 生命周期压力验证（2026-09-30）

```text
已有声明:
  网页vendor生命周期补丁、固定Three.js/Ammo、Node test runner、Chromium本地资源用例
新增定义:
  NativeFixture { livingPointers, createEvents, destroyEvents, memoryProbes, ownedWorld, borrowedWorld }
  BrowserPhysicsLifetime { activeInstances, createdCount, disposedCount, errors }
操作流程:
  固定物理/动画源码 -> 与构建相同补丁 -> 实际Ammo，观测new与destroy对应native指针
  128轮创建三种形状刚体/约束 -> 物理步进 -> helper.remove -> 存活指针回到0
  每轮4MiB申请/释放 -> 预热后地址稳定复用 -> 64MiB堆不增长
  约束先移除 -> 刚体移除 -> 逆创建销毁，重复dispose不再destroy
  借用world -> 只销毁借用实例的自建对象 -> 所有者world仍可步进
  第二刚体/约束/构造失败、helper物理创建后IK失败 -> 暂存分配为0，网格父级/变换恢复
  新动作已初始化后回滚/失败 -> 旧物理仍存活，新分配消失
  成功移除旧helper -> 绑定姿态骨骼不被旧mixer复位 -> 新物理可步进，最终释放为0
  真实网页 -> importmap同一指纹helper -> 只观测存活物理，不保留历史模型引用
  24次原生VMD文件选择 + 每6次一次PMX/贴图选择共4次模型切换
  每轮 -> 当前仅1实例且创建数减销毁数等于1 -> 被销毁manager拥有对象为0
  每轮4MiB探针 -> 预热后的地址跨度小于8MiB，不要求地址逐次相同
  每轮当前仅1实例、已销毁native为0 -> 64MiB堆保持，无页面异常/OOM
  原PMX/贴图/进度/暂停/恢复默认/物理重载/重力/循环用例继续通过
```

## MMD AR 加载进度与初始化速度清理（2026-09-30）

```text
已有声明:
  ProgressView、模型/VMD专用进度回调、clearPmxPhysicsMotion、固定vendor与Ammo
新增定义:
  ProgressFixture { token, timers, aria, phase, state }
  PhysicsFixture { bodies, velocities, forces, transforms, allocationCount }
操作流程:
  开始 -> 不定进度可见 -> 实际读取比例单调 -> 未提交不能到100% -> 成功收起
  新操作 -> 旧消息/旧定时器忽略；失败 -> 停止且不100%；多PMX -> 等待选择
  非零线/角速度与残留力 -> 清理 -> 全部为零，刚体位姿保持
  临时向量 -> 成功和异常均释放；无物理 -> 旁路
  注入模型helper初始化 -> 清理 -> 返回提交；动作绑定姿态初始化 -> 清理 -> 启用
  真实Ammo不同刚体类型/无骨骼索引 -> 设速度/施力 -> 线/角速度读回零
  下一步进 -> 无残留X速度证明清力 -> 仍受重力，位姿和动作时间保持
  真实VMD自动循环 -> 新增清理调用次数不变
  Chromium原生文件选择 -> 提交前可见进度 -> 模型/动作阶段 -> 成功100%
  缺贴图/损坏VMD -> 错误提示无100% -> 原模型/动作可用
  恢复默认与物理重载 -> 同一进度和清理；无过期进度或页面异常
```

## MMD AR 手动 VMD 切换与继承动作（2026-09-30）

```text
已有声明:
  prepareMotionSwitch、注入runtime实际renderFrame、真实Three.js/Ammo、Chromium文件选择
新增定义:
  MotionTrace { bindingPose, physicsSetup, zeroVelocity, firstFrame, nextFrame }
操作流程:
  解析成功 -> 暂停旧物理 -> 等待Ammo -> 绑定姿态 -> 注册无物理helper -> 世界矩阵 -> 新物理
  初始化helper不得执行update(0)，刚体初始位置等于绑定姿态
  全刚体类型非零线/角速度和残留力 -> 清零且位姿不变，重力随后仍产生运动
  原物理关闭/无刚体 -> 不请求Ammo；播放暂停 -> 保留绑定姿态、动画时间为0
  失败/过期 -> 清理新helper/物理，恢复旧网格/骨骼/表情/IK和原开关
  等待期间帧门控 -> 旧helper不步进、锚点仍更新、重复切换拒绝
  实际renderFrame首帧 -> 动作强制关闭、物理仍步进、角色隐藏
  第二帧 -> 按最新播放开关应用新动作、正常显示；暂停不推进
  自动循环 -> 不新增速度清理或物理实例
  Chromium -> 目录/多选/下拉PMX继承内置VMD；另一个PMX继承本地VMD及名称
  换模型/物理重载 -> 仍可读取继承的动作上下文；关闭动作选PMX -> 无动作
  Chromium前两次真实update -> 物理创建时间0、首帧animation=false、次帧按开关推进
  24次动作+4次模型压力切换 -> 开启/暂停均覆盖，仅当前物理存活，堆与探针有界
  重力缓动数学测试显式使用120ms；浏览器存储显式测试值，不依赖默认参数
```

## MMD AR 完整重力方向与锚点过滤（2026-09-30）

```text
已有声明:
  THREE 四元数、真实 IMU 屏幕转换、网页控制器注入、Chromium 本地资源用例
新增定义:
  GravityFixture { referenceBeta, inputBeta, deadZoneDegrees, smoothingMs, rotations }
操作流程:
  小角度连续输入 -> 不越死区则保持 -> 慢转越界后接受完整目标
  60Hz 与 120Hz 按时间更新 -> 相同收敛 -> 最终精确等于接受目标
  居中/关闭强制单位旋转 -> 绕过死区 -> 手动目标保持
  两参数为0 -> 即时完整角度；降低死区 -> 重新接受最新原始输入
  加载实际 IMU 与注入控制器 -> 首次归零 -> 忽略旧灵敏度存储与 alpha
  无效倾斜忽略 -> 坐标变化重建参考 -> 迟到权限无法重新开启
  Chromium 加载生成页 -> 新控件默认值 -> 修改参数 -> 保存 -> 合成倾斜事件
  小抖动保持目标 -> 30度输入得到30度目标 -> 居中清零
  本地模型/物理重载 -> 独立重力参数仍保留 -> 无页面异常
```

## MMD AR 网页本地资源选择（2026-09-30）

```text
已有声明:
  Node test runner、Chromium、生成 web-dist、构建校验过的 PMX/贴图/VMD
新增定义:
  LocalAssetFixture { pmxFile, textureFiles, vmdFile, invalidVmd }
  LocalAssetResult { ready, modelUrl, motionUrl, motionProgress, error, requests }
操作流程:
  目录索引及平铺索引 -> 检查相对路径、大小写、唯一名称回退、重复/歧义/越界
  注册文件 -> 创建对象 URL -> 读取文件 -> 释放 -> 原 URL 和旧映射均不可复用
  生成网页 -> 本地 HTTP 按正确 CSS/ESM MIME 服务深层目录 -> Chromium 打开
  原生 file input 选择真实 PMX 与贴图 -> 就绪且地址属于当前会话
  选择真实 VMD -> 进度可读 -> 暂停后进度冻结
  选择损坏 VMD 或缺贴图 PMX -> 错误提示 -> 原模型/动作仍就绪
  物理重载 -> 本地模型/动作仍可读取
  恢复默认动作 -> 当前本地模型保持；恢复默认模型 -> 内置 profile 生效
  页面异常与本地虚拟路径的 HTTP 请求均为空
  收集结果 -> 关闭浏览器和 HTTP 服务 -> 删除本用例创建的临时损坏 VMD
```


## 概述

自测功能用于验证系统各模块是否正常工作，包括基础功能测试、播放控制测试、画面控制测试等。

## 数据结构

### 测试结果

```javascript
{
    testResults: {
        passed: number,     // 通过数量
        failed: number,     // 失败数量
        skipped: number,    // 跳过数量
        total: number       // 总数量
    },
    results: [{
        id: string,         // 测试ID
        name: string,       // 测试名称
        category: string,   // 测试分类
        description: string,// 测试描述
        success: boolean,   // 是否成功
        message: string,    // 结果消息
        details: string,    // 详细信息
        timestamp: string   // 时间戳
    }],
    lastRun: string         // 最后运行时间 (ISO格式)
}
```

### 待确认消息

```javascript
{
    pendingAcks: Map<string, {
        resolve: Function,      // Promise resolve 函数
        timer: number,          // 超时定时器ID
        commandType: string,    // 命令类型
        displayId: string       // 显示端ID
    }>,
    ackTimeout: 5000            // 超时时间 (毫秒)
}
```

## 核心函数

### waitForAck(commandType, displayId, timeout)

等待显示端确认命令：

```
waitForAck(commandType, displayId, timeout):
    返回 Promise:
        生成 key = displayId_commandType
        设置超时定时器:
            超时后:
                从 pendingAcks 删除 key
                resolve({ success: false, message: '等待确认超时', details: ... })
        
        将 { resolve, timer, commandType, displayId } 存入 pendingAcks
```

### handleAck(data)

处理显示端确认消息：

```
handleAck(data):
    生成 key = data.displayId_data.commandType
    从 pendingAcks 获取 pending
    
    如果 pending 存在:
        清除超时定时器
        从 pendingAcks 删除 key
        resolve({
            success: data.success,
            message: data.success ? '显示端已确认' : '显示端处理失败',
            details: ...
        })
```

## 测试用例

### 基础功能测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| display_connection | 显示端连接测试 | 检查是否有显示端连接 | DisplayList.getDisplays().length > 0 |
| websocket_connection | WebSocket连接测试 | 检查WebSocket连接状态 | ws.readyState === WebSocket.OPEN |

### 播放控制测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| play_command | 播放命令测试 | 测试播放命令发送并等待显示端确认 | 发送 play 命令，等待 commandAck |
| pause_command | 暂停命令测试 | 测试暂停命令发送并等待显示端确认 | 发送 pause 命令，等待 commandAck |
| volume_control | 音量控制测试 | 测试音量调节 | 发送 volume 命令 |

### 画面控制测试

| ID | 名称 | 描述 | 验证内容 |
|----|------|------|----------|
| fit_mode_contain | 画面填充-适应测试 | 测试适应模式 | 发送 fit: contain |
| fit_mode_height | 画面填充-高度铺满测试 | 测试高度铺满模式 | 发送 fit: height |
| fit_mode_width | 画面填充-宽度铺满测试 | 测试宽度铺满模式 | 发送 fit: width |
| fit_mode_crop | 画面填充-裁剪测试 | 测试裁剪模式 | 发送 fit: crop |
| rotation_0 | 旋转-0度测试 | 测试0度旋转 | 发送 rotation: 0 |
| rotation_90 | 旋转-90度测试 | 测试90度旋转 | 发送 rotation: 90 |

## 命令确认流程

### 显示端发送确认

**public/display.html**:

```
function sendCommandAck(commandType, success, details):
    如果 WebSocket 已连接:
        发送 {
            type: 'commandAck',
            commandType: commandType,
            success: success,
            details: details || '',
            timestamp: Date.now()
        }

消息处理:
    如果 type === 'control':
        handleControl(data)
        sendCommandAck('control', true, data.action)
    
    如果 type === 'tts':
        handleTTS(data)
        sendCommandAck('tts', true, data.action)
    
    如果 type === 'media':
        showMedia(data)
        sendCommandAck('media', true, data.type)
    
    如果 type === 'voiceCommand':
        handleVoiceCommand(data)
        sendCommandAck('voiceCommand', true, data.action)
    
    如果 type === 'reminder':
        handleReminder(data)
        sendCommandAck('reminder', true, data.action)
    
    如果 type === 'restoreState':
        handleRestoreState(data.state)
        sendCommandAck('restoreState', true, 'state restored')
```

### 服务端转发确认

**server.js**:

```
显示端消息处理:
    如果 type === 'commandAck':
        广播到控制端 {
            type: 'commandAck',
            displayId: displayId,
            commandType: data.commandType,
            success: data.success,
            details: data.details,
            timestamp: data.timestamp
        }
```

### 控制端接收确认

**public/js/websocket.js**:

```
handleMessage(data):
    ...
    如果 type === 'commandAck':
        如果 window.SelfTest 存在:
            调用 SelfTest.handleAck(data)
```

## 测试运行流程

```
runAllTests():
    设置 isRunning = true
    重置结果
    
    显示进度界面
    
    遍历所有测试:
        更新进度显示
        执行测试 run()
        记录结果
        更新统计
        
    保存结果到 localStorage
    显示结果界面
    导出 JSON 文件
    
    设置 isRunning = false
```

### 源码契约回归测试同步（2026-09-03）

```
runSourceContractRegressionTests():
    检查 Android ASR 测试 APK 的路由变量按查询字符串拆分
    检查 ASR 网页通过带查询参数的 /api/asr 路由提交音频

    检查正式显示 APK 不复制 GTCRN 资源
    检查 DenoiseModelManager 使用 speech-enhancement 清单和模型下载路由
    检查服务器提供 GTCRN 清单与文件白名单路由

    检查网页 TTS 使用 recoverTtsPlayback 恢复自身 audio 元素
    检查聊天删除单轮按后端选择对应的 runtimeManager 重置会话
    检查 repairMode.password 为字符串且 repairMode.role 为 mainfront
    检查搜索频道按 pi 或 codex Agent 会话设置 ephemeral
    检查语音指令帮助文本传入当前命令集和 topic

    保留 display-native-bridge.test.js 的 DeX 原生触摸/滚轮旧契约失败
    直到明确 DeX 多屏输入桥接的后续处理方案
```

上述契约测试只验证源码中对外可观察的稳定行为和路由，不绑定已经重命名或抽取的内部局部变量。

## 结果存储

测试结果保存在两个地方：

1. **localStorage**: `selfTestResults` 键
2. **JSON 文件**: 自动下载 `self-test-results-{timestamp}.json`

## 消息类型

### commandAck 消息

| 字段 | 类型 | 说明 |
|------|------|------|
| type | string | 'commandAck' |
| displayId | string | 显示端ID |
| commandType | string | 命令类型 (control/tts/media/voiceCommand/reminder/restoreState) |
| success | boolean | 是否成功 |
| details | string | 详细信息 |
| timestamp | number | 时间戳 |

## MMD AR 物理稳定性（2026-09-30，已验证）

```text
已有声明: 固定vendor、真实Ammo WASM、子步插值、资源池、模型/动作切换
新增定义: StabilityFixture { baselinePhysics, stabilizedPhysics, actualPmx, renderFps, tailRms }
流程:
  同一真实vendor -> 生命周期与子步补丁 -> 基线；再加稳定性补丁 -> 新实现
  有骨骼type2 -> 重力/平移目标/旋转速度 -> 每步端点正确且角度保留，无帧末COM重置
  真实锁定角度关节与旋转扰动 -> type2仍受到角冲量纠错，线性因子0不冻结旋转
  无骨骼type2与type1 -> 仍自由平移，速度不被通用清零
  父骨骼/世界偏移/动作目标 -> 多帧跟随；不足一步 -> 不移动刚体
  真实关节 -> 65Hz保持原ERP；变频刷新六轴一次，静止模拟比较残余
  全频率与多画面帧率 -> 一秒位移接近实际固定步时钟，不丢低频时间
  真实米娅30/65/90/120/180Hz、60FPS静止八秒 -> 比较末一秒低质量角速度RMS
  各Hz修复/基线均降低；180Hz为0.315354至0.094321，限制结论仅该模型/窗口
  异常/循环/复位/切换 -> 保持两帧门控及速度清零边界；池归还与native销毁归零
  本地网页 -> 模型/动作连续切换、实时变频、导入指纹和页面异常回归
结果: 首批82加补充角冲量1、本地资源3，共86项覆盖通过
  实际24次VMD/4次PMX切换 -> native创建32/销毁31/存活1；堆64MiB，无OOM
边界: 不宣称所有PMX或手机观感已验收；不替换求解器或发布外网
```

## 原生 ORB-SLAM3 接入检查记录（2026-10-01）

```text
本轮按会话约束不新增/运行测试，不安装设备
允许: npm APK/网页构建、源及生成脚本语法检查、构建资产校验
待现场: 摄像头权限/后台/重启时无残留；代次拒绝旧位姿
待现场: 原定位图首定位+平移初始化尺度；移开图片仍SLAM跟踪
待现场: 失锁角色保留，重定位恢复，新地图重新看图
待现场: 横竖屏/cover裁切/矩阵方向/near=1与原缓动一致
待现场: 导入真实标定启用IMU，UNKNOWN时间戳拒绝，偏移符号正确
待现场: 回环后首关键帧锚点/尺度连续性、手机帧率/发热/内存及多次停止回收
纯网页兼容: 无桥继续MindAR；不含原生库/词袋/WASM，不做模拟接口验收
```

构建/静态检查结果（不属于功能测试）：两种npm构建成功；最终APK资产含SLAM/C++库、词袋、版本/许可及MindAR回退资源，模型/定位资源摘要通过；5个源脚本与4个生成脚本、APK3/网页4个内联脚本语法通过，定向差异检查通过。APK大小95,015,322 bytes，SHA-256 `29cbf0fc2242ebe2f03a3ca3c18a351daf79f5629da05760a3aad1b9abfba991`。上述待手机项目未执行；没有测试代码变更、自动测试或设备安装。

## 六轴IMU默认参数位置偏移回归（2026-10-03）

```text
专用测试 -> 13项通过
默认处理 + 无噪三类轨迹10秒 -> 旋转<1e-6m、平移<1cm、复合<3cm
带噪静置校准10秒 -> 残差<5cm；已有加速度标定 -> 静置对齐不再次引入倾斜
真实浏览器 -> 无噪按钮保留滤波12Hz/加速度死区0.08，噪声归零；原拖动/房间回归
模拟精度与手机实际精度分开，未校准误差不隐藏
```

## 刚体XPBD WebGL2自测伪代码

```text
启动静态服务与Chromium真实WebGL2 -> 导入CPU/GPU后端
相同重力/风积分 -> 比较位置误差小于1e-4 -> 断言实际后端为GPU
六种形状组合 -> 接触标记非空且穿透向外修正
锚点移动/六轴关节/type2/非零全锁 -> 验证随动与锁角
reset -> 无风无重力下一帧不因旧速度移动；保存的renderer状态恢复
重复创建/步进/销毁50次 -> geometry/texture/program回到基线
无renderer -> CPU回退及原因；丢失上下文 -> 暂停释放 -> 恢复重建无GL错误
生成网页加载默认PMX -> 选择GPU -> 实际GPU读回/接触/关节 -> 切回CPU
手机复杂碰撞、动作/模型长期切换、小物件观感和P95 -> 独立现场验收
```

## Offline MMD 首次下载后本地持久缓存（2026-10-08）

```text
固定版本/14项白名单 -> 新 profile 带版本URL；本地manifest优先规则不变
空缓存 -> 固定上游顺序下载 -> 校验HTTP/长度/SHA -> 唯一临时文件原子改名
同版本同资源并发 -> 上游仅一次；下次请求 -> 磁盘命中且上游/DNS调用为0
损坏缓存 -> 丢弃并重取；缓存写入失败 -> 返回已校验内容、不保留半成品
缓存根/版本/父目录或目标为符号链接 -> 不跟随；清理只删除专用根的旧SHA普通目录
版本路由 -> ETag、private一年immutable、If-None-Match命中304
旧静态路由 -> 保持同源兼容和no-store；显示端只接受固定版本白名单路径
自测 -> 服务17项、显示端版本路径定向1项通过；脚本语法/diff-check通过
Android Offline实际冷启动、Runtime更新/进程重启后的缓存命中和加载耗时 -> 现场验收
```

## 显示端语音交互自测（2026-10-09）

```text
执行真实内嵌函数 + 模拟音频/网络 -> 手动结束仅提交一次、过滤空/未匹配声纹
模式/权限/暂停/断线 -> 作废过期识别；麦克风授权迟到 -> 停止轨道
服务端注入持久化/消息 -> 独立 ID、权威值、失败恢复、不处理手动或已关闭模式结果
正式舞台/控件/CSS浏览器夹具 -> 四旋转角、横竖屏居中、状态文字上方、点击和配置同步
结果 -> 新单元15 + 浏览器1通过，结合相关语音模块共32通过
对照旧聊天/MMD测试 -> 当前38/50、HEAD来源38/50，失败集合相同
设备实际录音/模型/ASR/TTS不在浏览器夹具范围
```

## 正式MMD渲染合并回归（2026-10-09）
```text
正式参数输入 -> 新效果默认关闭、倍率与GPU上限、独立存储键
正式HTML/CSS/ESM -> 预建渲染分类展开、控件唯一、语音入口保留
改设置并刷新 -> 倍率/周期/接触和SSGI从正式键恢复，不写测试键
真实米娅PMX和VMD -> 正式runtime加载、实际Canvas尺寸、倍率resize前后相机位置/旋转不变
真实WebGL2组合 -> AO/SSGI/接触三轮滤波与TAA共同绘制有效alpha，无Shader错误
TAA累积 -> 有效历史；主动失效 -> historyValid=false；关闭 -> 5个历史目标释放
灯光复位 -> 倍率1、新效果关闭；语音/原面板功能保持
旧文本/VM兼容测试 -> 使用HEAD源码对照，区分旧夹具失效与本次回归
签名代码包 -> 新模块和HTML/语音脚本逐文件匹配工作区，内外网清单签名/大小/SHA-256一致
```

## 正式FSR2同步自测（2026-10-09）
```text
已有声明: 正式面板GPU集成测试、TAA/FSR2 Shader解析参考
新增定义: 正式模块前缀、输入输出尺寸观察、保存后的FSR2参数
操作流程:
  正式参数测试验证默认TAA/0.67、比例上下限及旧值兼容
  正式面板改模式和比例，刷新恢复并复位默认，确认测试存储不变且语音控件存在
  真实GPU组合接触/SSGI，观察实际场景32×48输入及65×97输出
  显式旁路恢复65×97场景，重开FSR2/切TAA清历史，关闭释放五个历史目标
  指定MMD_RENDER_SOURCE为production运行相同Shader像素参考
  96组解析参考验证像素中心、面积、覆盖重心和最终滤波；检测GL及Shader错误
  重建独立页验证共享尺寸/旁路未重复注入，再运行真实模型与导出回归
```

执行结果：2026-10-09参数/面板/语音37、正式集成2、正式Shader3（96组轮廓参考）、独立真实模型1，共43项通过，无跳过或取消；共享独立构建、源码语法和模块引用通过。手机视觉/性能待验收。

发布验证：code49的931文件源码一致、ZIP CRC、RSA签名及组件约束通过；LAN/WAN全组件HTTP大小与SHA-256一致，精确清理无错误。首次WAN回读中断，完整流程重试成功。

## 实时监听按钮和未选中预览回归（2026-10-10）

```text
实时按钮 -> 默认aria-pressed=true
    实际click -> 请求相反模式；回包前保持旧值并禁用
    成功 -> 更新选中态；失败保留旧值；断线禁用
    深色/浅色 -> 开启为渐变，关闭为中性
主题预览 -> dark/light未选中按钮backgroundImage=none、无光晕
    选中按钮仍渐变；关闭恢复原主题
服务默认值 -> 缺失开启，已保存false保留
结合声纹/浮动布局/群聊/Offline恢复 -> 9文件43项全部通过，无跳过
```

2026-10-10 最终发布：code-v56.zip已发布LAN/WAN，16,936,308字节，SHA-256 3ca3606613e95faa931daa8a974154f2776a6cd6e087beba525cf3d421731e42；源提交34671c31。931文件快照及运行资源完整、ZIP CRC/RSA/组件约束、内外网全部组件HTTP大小/SHA-256通过，签名清单完全一致，精确清理无错误，两端code目录仅保留code-v56.zip。21文件93/93通过，无跳过；servicePackage=false，minApk=true/dependenciesPackage=false保持，未构建原生APK或恢复旧声纹。手机现场验收保留。

code58布局追加：5文件20/20、零跳过，涵盖三字定位入口、贴底/左侧向上面板与常驻状态隐藏；MMD扩展仍38通过/12既有失败，基线一致。服务包code58已发布LAN/WAN，完整校验和精确清理通过，设备验收待现场。


## 快捷面板清空媒体自测（2026-10-10）

```text
正式快捷按钮真实点击 → 选中displayId的control/clearMedia → 回包前状态保持
权威成功结果 → 播放/分页/列表/媒体库标记/预览清零；失败/其他目标不清理
未选择/断线/发送异常 → 提示且不发送
真实server控制处理 → 保存空状态先于取消文本路由和下发，重复清空幂等
真实UserConfig+DataSnapshot → 严格写盘失败恢复旧表，成功从磁盘读取空媒体
清空后旧播放/文本/列表进度 → 提前丢弃，空状态不被覆盖
真实文本模块 → 取消旧加载/回包，释放页句缓存，保留共享聊天音频
Chromium媒体DOM+正式函数 → 图片/视频/音频/HTML/文本都隐藏，列表timer/ended不再推进
旧MHTML请求迟到 → 新图片不被覆盖；restoreState空快照 → 清除断线期间保留的画面
```

新增 tests/floating-media-clear.test.js 7项；12文件103/103通过、零跳过。使用现有npm test对应的node:test机制，因没有定向script，直接node --test --test-concurrency=1运行相关文件；服务包待发布、Android实际验收待完成。


## Offline双页热更新刷新隔离自测（2026-10-10）

```text
正式控制handleMessage + 显示connectWebSocket/socket.onmessage → 首连分别建立基准
共享存储、显示先/控制先、旧页更新共享标记 → 两页分别reload一次
同源多个控制页 → 分别reload一次
同时间/数字字符串/重复/正在刷新后再来新时间 → 不重复导航
新页面加载 → 首连不刷新；下一次服务重启仍刷新
旧共享键及聊天对象 → 原值保留；拒绝全部存储访问 → 仍能处理消息和刷新
无效/非有限/非正时间 → 忽略，不污染基准
Chromium同源正式页面DOM + 正式模块 → 两页实际重新导航，控制页取得清空媒体按钮
```

新增tests/offline-page-reload.test.js 10项，与清空媒体、文本/列表恢复、聊天对象恢复和显示语音生命周期合计15文件119/119、零跳过；正式JS语法通过。旧tests/chat-tts-interruption.test.js 3项中1项仍依赖已移除的displayChatTtsStop，未修改HEAD也同样失败，保留该基线问题。设备当前安装版本尚未取得，未冒充Android实际更新验收。

本轮交付：v60已发布LAN/WAN，全部组件HTTP大小/SHA-256、签名/组件契约、最终清单一致性及精确旧版本清理通过。已有普通APK设备未操作，Offline实际升级后按钮与双页重启仍保留现场验收。

## FSR输出重建倍率回归（2026-10-12）

```text
两端设置→旧字段迁移1，合法1/2/4，非法补1；启用/模式/能力决定应用
基础尺寸固定→输入按内部比例固定，输出按重建倍率递增；限制输出不改变输入
运行时元数据→时域与AO输入一致；直接调用/非匹配元数据回退正确
真实GLSL + 64输入 + 256显示→1/2/4输出，10正负角度解析覆盖误差与alpha/GL错误
真实米娅→160×200输入，三档输出；记录实际场景target不得增大
4×预览→160×200 PNG→所有异步读取帧场景同请求尺寸→恢复原预览
TAA/关闭→不应用重建；存储/刷新/复位→保留选择或默认1
当前灯光默认预设→历史0.85/抖动0.20；自测显式设置历史输入并按实际默认预设断言复位
```

## 独立MMD-AR低倍率FSR扩展（2026-10-12，后续已撤回）

```text
独立端合法倍率0.25/0.5/1/2/4，正式端仍为1/2/4；旧/非法值补1 → 单测8/8通过
固定BaseSize与SceneSize → 独立端输出16/32/64/128/256（64基准），SceneSize保持64
时域历史目标尺寸 → 跟随当前输出倍率；切档清历史，后续帧恢复历史混合
Chromium SwiftShader + 10正负角度 → 独立端50组FSR Shader输出与透明主体检查通过、GL错误0
同一浏览器夹具以正式端源码运行 → 原30组FSR Shader输出通过
npm run build:web:mmd-ar-test → 成功；生成页确认包含五档选项及低倍率画质提示
低倍率 → 确认场景输入固定，输出更小，显示放大后覆盖误差高于1/2/4档；手机实机观感仍待验收
```

## 正式与独立MMD-AR FSR仅保留1×（2026-10-12）

```text
两端设置归一 → 仅接受fsr2ReconstructionScale=1；历史0.25/0.5/2/4 → 1
两端抗锯齿面板 → 不显示FSR输出重建倍率控件
基础Canvas尺寸固定 → FSR场景输入按内部比例；FSR输出与基础Canvas尺寸相同
独立端真实Shader 10角度×1档 + 正式端真实Shader 10角度×1档 → 无GL错误、中心覆盖不透明
正式真实PMX面板/渲染/历史生命周期 → 2项通过；配置旧2×回退1×，两端均不显示重建倍率控件
独立与正式运行时尺寸/时域单测 → 8/8通过；独立WEB重建成功
```

## 独立 MMD-AR IK 镜头方向与膝关节（2026-10-12）

```text
IK镜头水平符号 → 单测确认屏幕向右拖动传负yaw；IK关闭仍调用旧模型旋转分支
膝关节修正 → 合成四元数确认膝骨上限150°、普通骨骼45°；PMX IK范围将膝骨进一步收紧
膝点+脚踝同时拖动 → 合成腿链交替CCD通过，膝骨修正超过旧45°且状态返回正常
真实米娅PMX → 7个头/腕/膝/踝点可绑定；左拖环绕、双指中心平移与捏合分别改变画布截图
node --test tests/mmd-ar-ik-camera-gestures.test.js → 5/5通过
node --test tests/mmd-ar-ik-camera-gestures-browser.test.js → 1/1通过，约166秒
npm run build:web:mmd-ar-test → 成功；Vite输出既有大chunk体积提示
手机触控手感、不同PMX限位/骨名及真实深屈膝造型 → 待设备人工验收
```

## TTS 三行滚动字幕自测（2026-10-13，已实现，待设备验收）

```text
视觉验收 := 三行固定高度；每个新TTS新行开始；按音频进度一次加入一行；黑色0.1背景和8px背景模糊
历史验收 := 101行只保留最后100行；按宽度拆行和显式换行均计数；隐藏/停止不清空；新TTS恢复旧历史
时间验收 := 最后追加后29秒可见、30秒隐藏；追加重置；ASR切换不受旧计时器影响
生命周期 := 普通结束保留；聊天打开期间仍超时；旧模型提示清理不隐藏当前TTS
兼容验收 := 四种旋转；普通浏览器和Offline高DPI；文字能力关闭；重排后最新行可见
性能验收 := 历史和DOM有界；单一定时器和滚动帧；背景模糊真机成本待现场观察
执行状态 := 源脚本及显示页内嵌脚本静态语法、定向差异空白检查通过；未运行自动或播放测试；已更新控制端自测验收提示与原静态断言
```

补充确认：用户选择按播报进度逐行显示；使用现有音频来源记录及playing/timeupdate事件，按时长和字符数估算行时机。暂无逐字时间戳；暂停不推进，下一条来源替换未显示内容。

## Offline v70启动回滚及Download修复自测（2026-10-13，已完成）

```text
ADB已复现 := SM-N9500/Android API28安装full38；版本/签名/大小/SHA256/CRC/profile通过
设备条件 := 普通withserver占用8081，测试前停止；Offline安装首次恢复内置服务69与依赖8
失败证据 := full-config-backup-service.js:45拒绝/data/user/0系统链接，69和70均退出1
更新证据 := Native已原子切换code70/dependencies8 → 候选未就绪 → active release回滚；随后拒绝重复失败候选
本地隔离复现 := 同一真实目录通过；系统风格祖先别名路径失败（未修改真实配置）
回归计划 := 别名根下prepareUpload/导出/恢复；内部恶意链接仍拒绝；原ZIP事务用例继续通过
原生计划 := Download唯一文件/失败清理；错误摘要有界脱敏；退出/超时/回滚UI不被自动重试覆盖
设备计划 := 安装修复min（复用MNN），通过Native更新修复代码；api/status与服务器列表均显示新版本；导出ZIP出现在Download
```

进度：TMPDIR=/var/tmp下npm run test:config-backup 17/17通过（首轮/tmp配额不足，换临时根重跑成功）；Android JVM 208/208通过，新增下载2项与诊断/状态3项。源脚本语法通过。v71/min39/min40构建、ADB实际启动/Download/错误显示与重启通过；最终原生209/209通过，LAN/WAN全组件HTTP大小/SHA256和精确清理通过；API29+MediaStore暂无对应真机。

补齐检查错误验收伪代码（2026-10-13）：

```text
更新结果 := 正常无更新failed=false；签名拒绝/HTTP异常failed=true，与中文文案独立
UI检查失败 := 服务和min都显示错误；网页超时不覆盖已记录的真实进程原因
已完成设备 := min39+v71健康提交、服务器页面v71、Download ZIP 3077字节4项CRC通过、重启仍v71
原生补齐 := min40签名构建/CRC/profile/版本通过并安装；APK0.2.38/code71健康；209项0失败/错误；API29+MediaStore尚无对应真机
```

## TTS主题对比度自测（2026-10-13，已完成）

```text
主题状态 := 默认dark；UiTheme初始化/远端通知设置data-theme-mode
深浅对比 := 深色白字/黑色四向阴影；浅色深字/白色四向阴影；字号与字重保持
背景 := alpha0/0.1/0.1/0对应0%/18%/82%/100%；backdrop blur8px，文字不使用filter
生命周期 := 主题切换不清历史、不重建DOM，不更改音频进度和30秒隐藏规则
兼容 := 检查深/浅/彩色主题、旋转/DPI、三行边界、ASR提示作用范围
自测模块 := 播报命令已发送只提示人工核对，不报告视觉验收成功
执行状态 := 源码/语法/40项既有主题旋转DPI通过；Chromium四种主题尺寸颜色通过；API28实际播报、dark与mint切换、闲置隐藏/历史恢复通过；服务72 LAN/WAN全组件HTTP大小SHA256/清理通过
```

## TTS白字主题色细描边自测（2026-10-13，已完成）

```text
字形 := 所有主题白色rgba0.9，stroke0.5px匹配accent-color，stroke fill顺序保留字面
时间参照 := 相同白色填色/主题色下沿/黑色阴影；TTS字号和字重保持
背景 := 黑色alpha0/0.3/0.3/0（0/18/82/100%），backdrop blur8px
主题变化 := 只更新描边/下沿颜色，白色填色及背景不变
生命周期 := 三行/音频进度/100行/30秒隐藏保留历史继续既有模块
验收 := 浏览器核对多主题计算值及画面；ADB服务73实际播报；自测命令发送不代表视觉通过
执行状态 := 源码/语法/空白检查、40项回归、四主题计算值与时间样式一致、API28实际播报/主题细边变化、code73 LAN/WAN全组件HTTP大小SHA256/精确清理通过
```

## APK数据修复重复提示候选验收（2026-10-13，待代码确认）

```text
只读证据 := API28/min40/code73日志rejected-data-version，修复v2要求dataVersion1→2
状态缺陷 := 服务健康被当作修复成功，isDataRepairApplied仍否，所以同一包再提示
候选验收 := 成功记录才成功；版本拒绝不伪造state；相同失败去重、手动可重试；数据变化再检查
候选兼容 := 混合代码更新/修复失败分开，健康代码保留；旧缺失state默认0仅用于规范化
执行状态 := 未新增/运行测试，等待代码方案确认；不替代已发布TTS73的40项验证
```

数据修复拒绝原因补充（2026-10-13，只读）：

```text
旧包 := v1数据版本0→1，修改声纹开关
现包 := v2要求1→2，仅隐藏状态栏；包内无对v1的业务依赖
首装 := full文件列表没有repair state；缺记录按0；当前源仅v2，单包清单不补链
结果 := 缺v1记录路径触发rejected-data-version，成功标记不会写入
边界 := 未直接读取设备当前数值；未新增/运行测试、未实施兼容修复或修改数据
```

## TTS背景alpha 0.2自测说明（2026-10-13）

```text
背景声明 := 黑色alpha0/0.2/0.2/0，位置0/18/82/100%
自测提示 := 说明背景最高0.2并模糊；命令已发送仍只是发送结果
其他样式 := 沿用0.5px主题细边、时间填色/阴影、4px背景模糊及三行布局
验证范围 := 静态差异/包内源码/发布校验；没有另增自动化测试
```

## Android外部登录只读自测说明（2026-10-14）

```text
非Android控制页 → 跳过原生入口检查并明确环境限制
Android控制页 → 检查NativeControl登录/外部网页桥、Chat2API结果处理函数
Android登录进程重复打开回归 → 独立进程目录后缀只初始化一次；取消销毁WebView但保留进程级初始化状态；由Android JVM单测和Note8 ADB重复打开流程验收
状态映射 → 声明豆包format-only样本 → 应显示未远端验证
通过边界 → 仅原生入口和提示映射可用，不代表真实Cookie已捕获或所有官方站点可用
真实登录 → 用户自行操作；自动自测不打开官网、不读取现有凭据、不添加账号
```

## PMX加载进度条旋转自测伪代码（2026-10-14）

```text
载入正式display.html结构及theme/display/display-mmd样式
载入DisplayStage，并等待舞台初始化
对 viewport ∈ [1280×720, 360×800]:
  显示PMX进度条，设置ARIA值42和填充宽度42%
  对 rotation ∈ [0, 90, 180, 270]:
    调用DisplayStage.setRotation(rotation)
    等待两帧布局更新
    读取进度条包围盒和loadingLayer旋转矩阵
    断言矩阵角度等于rotation
    断言进度条非空、可见且四边位于视口内
    断言ARIA值仍为42、填充宽度仍为42%

执行状态 := PMX旋转浏览器及DisplayStage旋转测试共5项通过
设备边界 := Offline Android WebView安全区与实机观感仍待验收；未出包或发布
```

## 控制端任务布局、TTS透明度与服务器端口自测伪代码（2026-10-14）

```text
任务面板:
  360×800竖屏 -> 检查横向任务轨道可滚动、实例/结果列全宽且在视口内
  1280×720横屏 -> 检查任务/实例/结果维持三列和原列宽
  输入搜索词 -> 检查卡片分组后的过滤结果

TTS透明度:
  配置服务默认值和缺失回退均为0.2
  控制端滑块min=0/max=100/step=1/default=20
  UI 0%/20%/73%/100% -> WebSocket alpha 0/0.2/0.73/1；权威值反向映射为百分比
  服务端0与1边界可保存、0.01步长规范化；负数、大于1与非数值拒绝
  设置CSS变量0.13 -> 渐变峰值alpha=0.13，blur=4px，根节点opacity=1
  控制端/显示端连接初始化与广播均使用服务端权威值

服务器端口:
  1与65535有效；0、65536、非整数和字符串拒绝
  端口变化 -> 权威消息广播到控制端/显示端 -> 延迟托管重启
  页面等待新端口可访问 -> 保留path/query/hash并跳转

本轮状态 := 定向浏览器/单测和相关回归通过
待验收 := Offline Android WebView现场布局，以及运行服务上的真实端口变更/重启
发布状态 := servicePackage=true，minApk=false，dependenciesPackage=false
```

Android外部登录设备观察：SM-N9500/API28/min41/code76健康；豆包公开profile会话显示完成/取消，缺字段完成不关闭、取消返回。只检查入口和计算样式/标签，不读取真实凭据、添加真实账号或发送上游请求；10个Provider完整登录待用户验收。TTS当前计算alpha0.2/blur4px/白色填色/0.5px细边通过，属性恢复，不以此代称真实播报或登录全链路通过。

## MMD-AR单点牵引稳定性自测（2026-10-14）

~~~text
读取已校验PMX和待机VMD首帧 → 按MMDLoader转换骨骼父空间pos/IK范围 → 实际Ammo人体世界
静止/待机 + 模型整体缩放平移旋转 → 验证米制保持0.102557176
默认肘单轴2rad屈曲 → 验证超过90度不Euler折返；显式膝XYZ限位仍遵守
各手/脚/头/骨盆单点偏移[0,3,3]，gravity=false/freePelvis=false，60fps10秒
最后60帧全部19骨位置/四元数相对最终跨度 → 位置<0.02m且角<0.06rad
所有子步角速度≤8rad/s → 骨盆朝向保持 → 用户目标不被包络改写
可达腕/脚/骨盆目标误差<0.02m；不可达头目标有界、无需伪造达到
骨段局部位移/原PMX元数据不变 → 原生分配恒定 → 关闭后归零
每秒改变手目标，30/60/120fps各4秒 → 全骨位置差<3mm、角差<0.02rad
真实网页 → 关闭动作/呼吸/注视，启用人体物理/关重力 → CDP实际鼠标拖点
仅一个目标 → 累计900实际子步 → 最后90子步十一控制点跨度<身高2.5%
随后验证多目标/重置/模式/面板横竖屏与关闭 → 无页面异常
结果 := 身体16 + PBD3 + 标记4 + 镜头手势5 + 动作7，共35项通过；身体浏览器1/1通过
额外相机VMD := 默认Chromium启动失败；显式共享内存包装复跑原测试2/2通过，不改产品/相机测试
边界 := 无渲染骨架测试不替代完整蒙皮/服饰；实时动画/AR/多模型和手机仍待验收
~~~

## MMD-AR Off释放稳定与缺省重力自测（2026-10-14）

~~~text
normalize设置缺省/false/null/字符串 → gravity=false；显式true → true；UI重力checkbox缺省不勾选
真实PMX+待机首帧+真实Ammo → 每场景单独创建世界
场景 = 全Off静置 / 腕 / 踝 / 头 / 骨盆；分别gravity=false与true，共10个
目标On偏移[0,3,3]3秒 → Off10秒 → 末60帧采样全部19骨位姿/原生角速度
关重力 → 位置跨度<3mm、转角跨度<0.01rad、角速度<0.1rad/s；释放手/脚/头平均角速度平方降到首秒2%以下
开重力 → 位置跨度<25mm、转角跨度<0.12rad、原生角速度<3rad/s；自然下垂不当作漂移
原始PMX数据和全部非center骨局部位置保持；native分配恒定、关闭归零
自由骨盆On3秒→Off10秒 → 末秒全身位置跨度<5mm、速度衰减、骨盆整体位置不被重置
位置Off/旋转On → 旋转活动继续，标记立即跟随骨骼；未完成拖动→Off→旧move不改目标
实际网页 → 软件WebGL测试设置关闭阴影/AO/GI/AA、Canvas倍率0.25，保留真实蒙皮/服饰物理
默认无重力 → 真鼠标拖动→10秒保持→面板切位置Off→10秒采样
网页重力checkbox主动打开 → 全Off再采样10秒 → 关闭重力→多点/重置/模式/横竖屏继续回归
当前结果 := 身体20/PBD3/标记4/镜头手势5/动作7，共39项通过；实际网页1/1通过，约348秒
边界 := 合成骨架/无渲染PMX不覆盖完整衣物/实时动画；设备和其他模型另验，不承诺完全无接触抖动
~~~

## 豆包账号保存和复验离线自测（2026-10-14）

~~~text
fixture := 临时私有账号目录 + 虚构Cookie + 注入只读transport，不读取用户账号库
正式网页原生回调 -> 本地OAuth HTTP -> 一次列表校验 -> 403 -> 保存format-only -> 刷新列表可见
显式按钮复验 -> 本地鉴权 -> 相同凭据版本比较写入 -> 空cells成功 -> 显示会话列表已验证
异常矩阵 := 401/403/重定向/HTML/code0/非零status_code/匿名/未知结构/超限/超时/取消/忙
导入/换凭据/删除重建 -> revision改变 -> 旧结果409且不写回；同目录并发保存保留全部账号
隔离Chromium正式DOM -> 完成回调保存提示及账号可见 -> 点击验证登录 -> 状态更新；旧API映射保存回归
命令 := npm run check:chat2api；无专用script的浏览器/手动账号用node --test
边界 := 不在自动自测面板发真实验证，官网和Android真机另获授权验收；列表成功不证明聊天/TTS
~~~


## 共享包与平台依赖自测伪代码（2026-10-14）

```text
npm test:subserver-update → 62项；offline-bootstrap → 60项；offline-sync → 36项；签名/发布 → 23项
目标生产树 → 同内容跨平台归common；os/CPU/libc/native/prebuild归平台
仅linux资源变更 → common/android/win64版本和SHA不变
真实HTTP+双进程 → 主服务器清单/代码/common/linux64 → 本机API实际版本和目录确认
Node min → Offline common+本平台 → 无npm → 后续复用缓存
坏签名/锁/ZIP/冲突/ABI/缓存 → 准备失败不停车；健康失败 → 恢复上一代码+完整依赖
2MiB随机数据ZIP → Node26builtin范围读取背压完成且全部字节一致
控制端server_runtime_version → 查询实际目录/来源；可选launcher版本存在时验证vN并显示；最近更新failed则返回失败详情
Android全部223项 → 分组签名/选择/指纹/ABI/冲突/链接，兼容旧单包读取及bootstrap
生产四组v9 → ZIP展开与实际内容指纹核对；目标组合版本匹配锁；Linux原生模块加载
设备/Windows运行及发布结果 := 单独记录，不由单测推断
```

## 数据修复与发行种子自测伪代码（2026-10-14）

```text
已有v1/v2 → 验签与脚本摘要 → 真实release副本执行 → 两项配置 + 数据基线2
新修复 → 故障/并发/中断注入 → 配置和数据版本不提前升级，产物不误报成功
完整包/首装种子 → 携带基线与摘要 → 新配置初始化，旧配置/成功记录不覆盖
累计脚本 → 明确兼容0/1/2 → 阶段补修；版本2保留后续偏好；未知/坏state拒绝
Native健康 → 核对真实repairId/版本/摘要/数据版本 → 成功或失败分别通知
同失败 → 自动去重；手动重新检查 → 重新展示确认，不直接下载隐藏候选
只读桥 → 数据版本/pending/满足状态 → 自测，不运行修复/网络/配置保存
提交快照验证 := 修复46/46 + 首装打包62/62 + Android228/228；失败/错误/跳过均0
边界 := 正式产物/部署/真机不在当前自动验证范围
```

## 普通 APK 服务端口自测伪代码（2026-10-14）

```text
普通配置8071 → 连续启动写入 → 8071与节点ID/主地址保留
边界端口1/65535 → 保留；非法值 → 回退8081
Offline配置 → 固定8081；普通健康URL → 实际8071 + 当前证书协议
损坏JSON → 健康失败，不把另一个APK端口作为成功
自动验证 := Android232/232 + profile/端口契约16/16
真机普通v2覆盖 + force-stop重开 → 配置/权威8071 + API200/ok + 同nodeId主目录在线URL8071
Offline := 仅配置8081核对，未安装/启动；公网HTTP := HEAD200 + 同ETag的16段206 → 顺序拼接全字节 → 大小/SHA与本地一致
```

## render-display 高 DPI、Offline 模型入口与 MMD 重连自测（2026-10-14）

```text
render-display := DPR1/DPR2 × 0/90/180/270 → 覆盖层比例按 DPR 反向缩小、媒体名避让、包围盒保持在视口内
Offline模型入口 := Offline原生能力存在时初始为左移16 CSS px、露出半宽的边缘把手；主按钮打开原模型列表，收起按钮恢复把手；无原生模型时隐藏
入口避让 := FPS下方且纵向起点至少84 CSS px，按旋转映射安全区/键盘内缩布局，并避开左上72 dp原生控制端把手
入口结构自测 := 控制端只读抓取display.html和display-mmd.css，校验入口控件ID、收起把手宽32 CSS px及左移16 CSS px、展开安全区布局声明
显示端聊天列表 := ChatMarkdown输出ul/ol → 气泡正文样式设置24 CSS px起始缩进 → 只读检查/css/display-chat.css，不创建消息或请求聊天接口
MMD权威状态 := 隐藏请求 → config.set 成功后广播 false；模拟保存失败 → 不广播成功状态
MMD初始化竞态 := 舞台模块注册前收到 false → 缓存待处理值 → 初始化后仍隐藏
MMD重连 := displayId 保存 false → 新显示端连接接收 false → 角色层、按钮和指针交互保持隐藏
自动验证 := render-display旋转/DPR浏览器2项、MMD/Offline入口定向用例、结构自测及JS语法
设备边界 := Offline APK入口与原生按钮现场避让、安全区/软键盘和MMD重连仍待服务包更新后设备验收
```


## 整包安装身份与清理自测（2026-10-14）

```text
Android testDebugUnitTest → 246/246；OfflineFullApkActivationTest新增14项
临时目录旧code85/deps9指针 → full身份48首次切到根代码84/deps8 → 健康前保留 → 成功删除旧版本
两个版本/两个路径任意不匹配 → 不提交；安装取消/运行失败 → 保留目录与指针恢复
同身份热更新86 → 日常重启仍86；同versionCode安装时间变化 → 新一次整包切换
链接/错误记录/目录越界 → 跳过或拒绝 → 外部文件不变；部分失败下次健康重试
额外模型文件 → 换根移动保留；新包同路径定义优先 → 删除旧备份不跟随链接
min/普通profile → 不触发；当前APK8071配置契约仍通过
正式full构建与镜像发布 → 待完成；实际手机首次启动/删除/后续更新 → 待验收
```


## 豆包跨批次账号队列（2026-10-15）

```text
账号队列 := 同账号FIFO/不同账号并行/幂等释放/取消和原deadline/每账号与实例容量/过期交接
适配器 := 独立generate批次共享执行权，完整TTSEnded音频到达且WS清理后立即交接；解码成功/失败/取消不干扰下一条
本地等待失败 := 不创建WS、不扣账号健康；对外固定错误不包含内部标记
自动验证 := 最终释放边界回归check:chat2api 254/254；音频/Ogg/worker 36/36；分句20/20
真实验证/发布 := code92签名/大小/SHA/CRC/src逐项匹配；LAN全HTTP、WAN源站完整12项SHA+公网签名/HEAD通过
主服务与Android := 各并发提交3批，同账号上游峰值1，非静音48kHz WAV均成功，5272ms/2187ms
设备 := 原生入口code90→92/deps10，pendingHealth=false、api/status=ok；仅合成验证，不播放
```


## Android豆包账号重登真实验收（2026-10-15）

```text
只读预检 := 手机profile完整合法；主服务器仍Cookie-only，未发送主服务缺资料LLM
正式Responses流式 := 临时内存会话，首轮好的。6282ms -> previous_response_id -> 荔枝4489ms
续接证据 := 两轮completed，第二轮上游conversation已存在且need_create_conversation=false
内容断言 := 首组口令拒答不计记忆成功；普通水果场景匹配荔枝，通过
正式TTS := 253112bytes/48kHz/非静音/2409ms，无播放或音频落盘
范围 := 安装代码92/min56/deps10，账号映射不改、无浏览器、秘密不导出；无生产代码修改
```

## 豆包外部网页非法请求定位与修复验收（2026-10-15）

```text
定位基线 := min56/code92；修复验收 := 同一min56原生热更新code95/deps10，pendingHealth=false
复现 := 正常外部网页入口打开指定旧会话，初始化出现semi-toast-error/alert精确非法请求
IM := conversation/info与chain/single均HTTP200/status_code0，4消息文本块
缺口 := www host-only sessionid存在，accounts不存在 -> 认证心跳401/账号信息13
临时同账号补齐accounts := 心跳0、信息success、toast消失、消息4条保持
边界 := 部分安全SDK2035仍在；设备存储缺恢复尚未归因为本提示，生产代码不改
生产回归 := 双来源/白名单/来源拒绝/去重/默认值/秘密隔离等定向10/10；check:chat2api 257/257
正式恢复 := 无临时注入，首次accounts sessionid存在；心跳0/0、信息success、IM0/0、4消息，无非法toast/新聊天
刷新复测 := 心跳0、信息success、4消息保持，无非法toast
发布 := code95双站点摘要/签名/CRC/src逐项一致、精确清理0错误；主服务器与手机健康，服务待出包false
```

## Qwen API数据修复v4验证（2026-10-15）

```text
真实runner + 修复脚本 → 旧默认/三业务显式音色/空继承/有效英文ID大小写/未知自选/模型映射冲突 → 迁移或明确保留
真实隔离业务种子 → 数据0至3 → 基线4 → 历史偏好与凭证/速度/共享音量保留
业务保存 → 隐藏休眠速度恢复；显式新速度优先 → 双配置落盘一致
失败保存/断言 → rolled-back → 双配置/内存/版本保持 → 不写成功记录
未知数据/低服务 → 门控等待或拒绝；重复身份 → skipped；脱敏getter无凭证且原始getter不可用
验证 := npm run test:offline-data-repair 71/71；迁移+配置36/36；npm run test:tts-voice-picker 22/22，部分重叠
范围 := 真实隔离配置和浏览器，不等于手机已安装修复或实际合成验收
```

## min 首装语音提示时序回归（2026-10-16）

```text
已有证据 := min55仅覆盖安装/部分缓存验收；未证明干净首装提示可靠
当前只读 := SM-N9500 min58 + bootstrap ready/standalone + offline_voice_first_run_v1=true
状态回归 := ready发生于接收器注销期间/重建后从运行中服务补发 + 空状态不虚构ready + 字节/阶段保留 + 更新事件隔离 + 停进程作废快照
提示回归 := 前台/服务/页面不同先后 + 展示返回失败/异常不消耗标记 + 成功展示前标记仍false + 完整缓存跳过 + 首次标记恢复/去重/profile隔离
Android命令 := ./gradlew :app:testDebugUnitTest --tests com.aasc.display.OfflineModelPreparationPlanTest --tests com.aasc.display.NodeStartupStatusTest --tests com.aasc.display.ServerConfigTest --tests com.aasc.display.NodeServerServiceTest --offline --no-daemon
Android结果 := 48项/0失败/0错误/0跳过；模型准备12 + 启动状态6 + 地址配置14 + Node服务16；新增9项通过，生产/自测编译成功
首装打包 := npm run test:offline-bootstrap → 63/63；不代表新APK已生成或实机首装提示已验收
产物补验 := min59的两份APK大小89951777/SHA39a81020…相同，ZIP完整性/apksigner签名a57fd4c3…与发行清单匹配，来源bb30fa05包含修复bb668d54，DEX含状态补发与tryPrompt
现场授权 := 用户允许完整备份SM-N9500私有数据后安装min59并清空验证；备份归档可读性/摘要校验完成前不清空
备份 := 私有1047040512bytes/54410项/48859普通文件，SHA80daba3a…/逐文件可读与设备数量一致；外部2空目录/原min58APK已备份；证据仅.cache/adb-min59-first-run-20261016-100056，不入Git
空数据首启 := min58覆盖安装59后pm clear，旧服务目录不存在；未卸载APK/不恢复旧缓存 → 原生确认LAN约48MiB服务下载 → HOME退后台
后台 := code105/deps10/task1/HTTPS status=ok/pendingHealth=false，首次标记false；返回原Activity才出现“准备语音模型”
实测UI := TTS约75MiB/ASR声纹约268MiB均默认checked=true/所选合计342MiB；原生截图及XML留证，展示后持久化true
稍后 := 六个语音模型候选路径无文件 → 冷启动无重复弹框 → NEW_TASK加CLEAR_TASK重建Activity无重复且Node15542保持
最终 := min59/code105/deps10/task1/API正常；临时ADB forward已移除；当前设备干净数据/模型未下载，旧数据只保留备份；本轮不验证下载权重或推理
```

## 在线TTS上游并发验证（2026-10-16）

```text
控制端只读SelfTest.tts_provider_config → upstreamConcurrency.doubao-chat为1至8整数 → 不发送合成/配置请求
配置normalize/真实持久化 → 默认3、范围/类型拒绝、失败回滚、进程重启读取；WS保存 → 刷新队列 → 权威广播/重连
同根两个入口/两个适配器 → 同账号总在途3；其他根与账号独立；动态1→3补位、3→1等待在途回落
在线有序调度 → 7/9句全部提交 → 不按分句限制生成 → 实际上游仍最多3 → 乱序完成保持句序，失败亦保序
队列取消/期限/双重释放/容量 → 不迟到建连、不惩罚账号、不泄露凭证
真实Opus共享池 → 三路输入与三个模拟VoiceGenie同时结束 → 两Worker加有界等待 → 三个完整WAV
解码等待数量/字节限制、取消/超时释放、输入副本 → 内存有界且不启动过期Worker；原无等待工厂兼容
范围 := 本地模拟WS、真实WASM、Chromium及隔离配置，未进行真实官网3路合成或设备播放
```

本轮结果：Chat2API277/277、音频/有序调度45/45、配置/浏览器/装配29/29、双端音色25/25、聊天22/22、数据修复兼容71/71，存在重叠；未运行全仓回归。
## Offline可热更JS启动器与网页UI自测（2026-10-16）

```text
范围 := 首装 + 服务/依赖/任务/数据修复 + 模型下载与首次提示 + 启动器自身JS热更
空环境 := 无服务代码/无node_modules也能运行APK内置JS基线并确认准备；Android不执行npm安装
兼容 := min59/旧full的配置/账号/任务/results/模型与活动组合保持；普通APK/独立Node不混用指针
回退 := 候选签名/路径/协议/语法/握手/真实健康失败 → 上一健康JS → APK基线；中断可恢复，避免双写者
模型 := 默认TTS/ASR声纹、状态不下载、稍后/取消、已有缓存、准备与原生引擎ready分离、后台恢复
页面 := Chromium验证首装检查/确认、首次提示绘制令牌、模型选择/下载/进度/取消、服务更新/失败重试；桥命令与网络隔离约束
结果 := npm test:offline-launcher 26/26；test:offline-bootstrap 63/63；test:offline-data-repair 72/72；Gradle Offline/Node 147项通过
边界 := 未出包/发布/清空设备；min59覆盖升级、旧full、真实WebView/权限/后台/推理/性能待过渡APK验收
状态 := minApk/servicePackage=true；依赖/任务集合未变；生产现行min59/code105不含此功能
```

## 千问两路固定模型自测（2026-10-16）

```text
配置 := 任意旧model/mappedModel → 读取固定3.1/QUARK；新错误model拒绝；同固定值兼容
保存 := 两路model/mappedModel不写入用户配置 → 重启权威值仍为固定模型；失败回滚
音色 := API旧四音色在默认/业务/生成恢复乔小娇；有效3.1大小写和未知用户ID保持
目录 := 独立JSON的68项由查询返回副本；旧模型和无效映射不列出；查询不合成
生成 := 旧底层模型/映射/伪造计划/直接适配器请求明确拒绝；参数model不能覆盖业务常量
正式UI := 两路无模型控件，API语速及68项在读取旧配置后立即可用；WS广播/失败/断线/重连
修复 := 旧快照、当前有效快照和真实种子worker均通过；原repair4脚本及归档不变
结果 := Chat2API279/279、双端26/26、业务与浏览器98/98、修复72/72、聊天TTS22/22（有重叠）
边界 := 本地HTTP/WS及浏览器验证；未真实上游合成/ADB播放、未重启或出包发布
```


## min60 原生/JS冷启动与本地页面回归（2026-10-16）

```text
实机发现 := 升级min60后MainActivity构造NativeBridge时报JS模型状态尚未就绪；本地启动页ERR_HTTP_RESPONSE_CODE_FAILURE
备份 := 完整私有tar426248704字节/26366项/23566普通文件，完整读取及数量/SHA256校验通过；旧APK留存；无pm clear
修正 := 模型查询在快照为空时使用可信APK定义占位；JS到达后动态路径；固定顶层本地HTTPS首页返回可信HTML200，其他请求拒绝
新增纯规则 := 无快照语音/LLM占位、JS目录动态接管、未知ID/路径越界拒绝、新增JS模型快照、本地首页/外部与子框架
已完成 := npm test:offline-launcher 26/26；Android Offline/Node152/152；首装打包63/63
设备结果 := min61本地构建及保留数据安装通过；真实WebView本地首页/模型组/服务检查/确认更新；JS启动器106与服务106健康提交；两轮冷启动无新崩溃
数据结果 := 配置/用户配置/修复状态JSON与备份一致；原提示标记迁移handled=true/legacyImported=true；未自动下载模型
边界 := 新页面在切换握手期间可显示暂不可用，重新连接后恢复；min61未发布，空首装/旧full/权重下载与推理/性能尚待专项验收
```

## min61 干净重装启动器观测（2026-10-16）

```text
备份通过 := tar完整读取 + 文件集合23605一致 + SHA256固定；原APK留存；外部目录为空
干净安装通过 := 真正卸载 → 包不存在 → 重装61 → 首启前files不存在
服务安装通过 := 本地网页预览50949299字节 → 用户确认 → code106/deps10/task1且pendingHealth=false
复现一 := common下载100% → 解压/校验/合并真实推进 → UI未显示新阶段
复现二 := 安装页ready → first隐藏 → 返回显示端/授权 → 才首次提示
复现三 := first.top545.92大于视口388 → 未滚动且不可见 → JS已handled=true
待补回归 := 首装直接衔接模型确认 + 前台视口可见才消费token + 后台阶段持续可观测
边界 := 本轮仅实机复现与文档；无模型下载/自动测试/代码变更；修复待用户确认
```


## 首包/更新/模型最终回归

```text
自动首包 := 自动检查下载、不出现确认/取消；返回键不终止；健康后自动收起
分阶段 := 下载字节/解压文件数 → 校验/合并真实耗时 → ready不继承旧100%；重载恢复首包样式
提示证明 := 前台且标题/卡片可见 → visible令牌确认；屏外/隐藏/后台不消费；273px操作按钮完整可见
模型 := 只列默认两组并按选中总量；稍后/可取消进度/失败重试；不自动下载
更新 := 旧提示确认入口保持；未确认无111/112 ZIP；失败重新检查、明确确认112后健康；不跳整页管理
兼容 := 旧宿主无firstRunQuery时不发未知命令；旧原生handled迁移；同快照安装归并，异快照拒绝
套件 := JS/浏览器36通过；首装打包63通过；Android153中152通过/1既有归档环境跳过
真机 := 完整备份后min62空安装code110自动收起/提示 → 最终min62/code112真实更新 → 默认源冷启动112健康/无重复提示
边界 := 273px布局为真实WebView应用同源最终CSS；112通过更新/冷启动，不冒充默认生产源112空安装；权重/旧full/性能未验
```

## Offline自动升版入口观测与后续用例

```text
已调用 := release:offline --help；only=all 与 full,min,code 的 dry-run
观测 := 返回0；六种选择/构建入口；早期all预览code113、deps11、task2、node113、min64、full65；最终默认预览code114/min64，避开新增占用
边界 := 仅帮助/计划调用；未执行测试/构建/发布/中断演练，不据此判断端到端通过
后续用例 := 状态默认与显式选择、依赖联动、共同APK版本、报告预留、并发锁、停止信号
后续用例 := 自动识别最近任务、无路径resume、完整报告不重建、未完成项原编号、fresh原号重建、new递增及目标/源码拒绝
版本策略预览 := fresh沿用最近任务code115/min65；new full66；旧code114/min64标为已发布并保留；仅dry-run，无删除
后续用例 := LAN/WAN部分成功恢复、签名/大小/SHA校验、清理失败不回滚、保留非版本文件与链接
```

## 真人默认两腿前后翻转复核（2026-10-16）

只读复查固定二维点、BODY/PMX映射与18支既有实际数据。真人current的点26膝相对点25膝相机深度差纯二维+0.209126m、加深度+0.216844m；与原图前腿视觉关系相反，记录失败；bent-left/right约-0.086520/-0.086016m，显示前后多解/初值敏感。未发现全局左右链反置，无重推理或算法修正，不将其他种子符号正确称完整姿态通过。

## 肩髋深度线索核查（2026-10-16，未运行新算法）

只读核查原八骨段提示没有左右肩11↔12/左右髋23↔24的横向关系；原始浮点图5×5取样显示真人肩右近、髋略左近，髋分数0.578/0.607未过原0.65门槛。三图肩髋差值与拒绝条件归档于刚体任务，不当可靠关节z；肩髋异号可因扭转或表面污染，不强行同向。后续新增约束须验证胸腔/骨盆独立及交叉手脚反例，不能由同侧髋近直接断言该脚近。本轮没有新推理、物理运行或算法通过声明。

## 肩髋横向深度临时对照（2026-10-16，工具检查完成，质量未达标）

新增忽略子目录torso-depth独立取样/躯干成对力/真实运行报告与三份检查工具；19合成、205实际数据/同初值/历史复现/原始哈希/释放、24报告/切图/正侧/390px检查通过，共248项。9历史二维加本轮18支真实物理共27条质量通过0，不能将工具通过当还原通过。鲜跑旧八段9支与历史实际坐标最大差0，同321骨快照与相机、原二维/左右保持；所有原生实例finally分配归零。真人/示意仅肩接受，动漫两组与三图髋拒绝，原分数门槛0.65保持。肩新力实际进入chest；合成髋进入hips且可与肩反向扭转，不给手脚硬传深度。真人默认RMS8.419934→8.430146%，前膝相对远21.684→19.328cm，仍翻转；动漫完全回退，示意基本不变。原生/显示最大约38.05cm、共享角度差53.53°仍保留。细节、参数和命令见肩髋任务执行记录及模型测试方法；生产未改，手机/WebGPU/运行中推理取消未验。

## 人物分割前置方案（2026-10-16，尚未运行）

核查当前RTMPose整图扩边无人物分割，已形成三图原图/人物裁剪/同框抠图对照方案；拟核对ONNX人物mask、原图双向坐标映射、漏肢/边界/主体不明回退、人物内部深度取样与同初值实际回读。mask不能区分交叉左右腿或证明隐藏关节z，深度主线保留原图上下文。模型仅查官方资料、尚未下载/推理，运行代码未改，无新测试通过声明。具体参数、候选与用例见人物分割评估task。

## 人物分割辅助自测伪代码（2026-10-16）

```text
合成 := 21项RGB/双通道逆缩放/原图坐标往返/同框灰底/分数保持/空满mask/多部件联合框/非法输出通过
真实 := 89项锁定权重/输出Softmax/原图浮点mask/原图RTMPose与历史精确相同/3控制组实际差0/同初值相机/7实际正深度与释放/2语义拒绝/原始哈希/Worker取消通过
报告 := 25项三图三输入/8正侧/拒绝后回退明确/原图参考独列/全图留边提示/390px/快速切图/无异常通过
结果 := 135项工具检查，结构3图通过但视觉观察2图允许实验；动漫猪剑错误归人导致2新三维跳过；7实际姿态质量通过0
限制 := 原模型分数与参考点非真值；不同目标RMS不作准确率排名；mask不能补隐藏z/分开左右腿；正式UI取消与手机/WebGPU未验
```

## Offline本次包HTTP校验进度（2026-10-16）

```text
实现 := publishOfflineUpdate显式传selected；HTTP签名清单保留；仅选中归档回读；旧四参数API未给范围仍全量
进度 := LAN/WAN、文件序号与大小、累计百分比/平均速度/等待、逐文件SHA结论与finally释放计时器
已调用 := 三个脚本node --check、release:offline --help、git diff --check；返回0
待验 := 选择范围/分组/未知URL/重复URL、无数据等待、摘要/大小失败、取消后定时器释放、旧调用兼容
边界 := 未新增或运行测试；没有新构建/发布/HTTP全流程验收；未改动运行中的旧发布进程
```

## 真人左右对应检查伪代码（2026-10-16）

```text
单元 := 不同点/分数/嵌套字段及缺失点 → 三候选显式转移 → 校验来源、深复制、保持上半身与原始分数
实际 := 读取六支真实回读 → 校验对应与重新取样深度、同初值720步、原始历史差0、24张图存在及原生释放0
归属 := 原26/28进入左25/27，原25/27进入右26/28；局部髋不交换，实际左膝比原左预测更靠近指定膝
几何 := 局部两支最大PMX差小于2厘米、限位差小于0.02弧度、连接小于2毫米；整腿失败不可采用
报告 := 两输入乘三候选乘两回读 → 八张实际图及三候选表、来源/失败状态/腿提示0与剩余偏差可见
回归 := 主报告保留旧图并有真人修正入口、非真人隐藏入口、旧报告可访问；390像素无溢出、无页面异常
结果 := 新24+58+36等于118项，旧135项复跑通过；全身姿态六支0通过，与工具通过分别记录
```

## Android SAF重选自测边界（2026-10-16）

```text
实现 := 新能力按钮、AASC type动作、当前主节点本地路由/远程WebSocket、原生单请求/前台检查、完整读写授权、结果轮询与刷新
已调用 := server-list.js/android-saf-control.js/server-app.js的node --check；Manifest XML解析；git diff --check
观测 := 静态检查返回0；不等于系统选择器/原生编译或真机通过
待验 := API29+主/子节点成功、取消/只读/失败保旧、前台/后台、缺授权补选、并发归并、旋转与网络恢复、旧APK/API28能力缺省
边界 := 未新增/运行测试，未构建/发布/重新安装设备；service/min仅标记需出包
```

## 默认MediaPipe恢复验证伪代码（2026-10-16）

```text
资源 := 旧默认RTMPose清单使MediaPipe用例失败 → 恢复后两固定文件/大小/SHA通过；新WEB无RTMPose权重
单元 := MediaPipe预后处理/独立候选与身体质量排序/世界点骨长重定向/取消 + 保留RTMPose/FK/相机/投影兼容 → 27项通过
浏览器 := 首屏不加载模型 → 文件与真实剪贴板导入 → 真Worker返回33点有限world/来源/维度 → 应用11目标及270子步有限 → 无人/取消不改已有目标
候选 := 本机动漫图三候选，默认女孩鼻点208.1乘110.8、11/12身体点、10控制目标；无预览即应用副作用
交互 := 实际骨架/相机已知回环、匹配恢复及手动控制 + 剪贴板晚到丢弃 + 390像素无横向溢出 → 浏览器19项通过
构建 := npm WEB退出0 → 两文件SHA、worker/ui去指纹副本和56173实际清单一致；模型/私图/输出不入Git，不出APK
界限 := 流程恢复验证，不把模型置信度、世界点或相机拟合误差当真实三维还原准确率；手机/WebGPU另验
```


## NLF-S独立试验（2026-10-16）

```text
官方半精度裁剪/整流程比较 → 三图差<0.001mm
官方FP32头/固定ONNX比较 → 三图归一化差<3.1e-6
JS重建/官方XYZ → 三图差<0.001mm
浏览器WASM与WebGPU → 三图有限XYZ与同输入对照<0.005mm
WASM请求审计 → 仅本机GET、实际加载原图与ONNX
390px布局 → 无横向溢出；不是手机推理性能验证
目视质量 → 真人左右腿、动漫手脚不通过，不自动接入VAM
```

复现路径与命令见docs/usage/mmd-pose-model-testing.md的NLF-S章节。

## Android60FPS与系统栏检查边界（2026-10-16）

```text
实现 := Android显示文档RAF共享帧决定/60FPS相位/真实时间戳/原生取消与异常；Offline显示系统栏、普通APK沉浸；同分辨率60Hz窗口偏好
已调用 := android-frame-scheduler.js的node --check；HTMLParser读取display.html第一个script；git diff --check
静态观测 := 返回0；首个脚本为js/android-frame-scheduler.js
待验 := 60/90/120/144Hz、同批取消/新增/异常/恢复、Offline首次与焦点恢复、普通沉浸、DeX及API28/API30+
边界 := 未新增或运行测试，原生未编译、APK未出包发布、帧率与设备性能未验；不能声称系统必然采用60Hz
```

## Offline校验进度减少刷屏（2026-10-16）

```text
实现 := 打印工厂闭包隔离动态行/日志时间；旧printVerificationProgress导出兼容
TTY := 每秒清行回首覆盖；columns-1以内，保守中文双列；大小/文件名逐级压缩
日志 := 单调时钟每10秒记录周期进度，无ANSI；关键阶段立即完整记录
边界 := 文件开始/通过/错误/结束前结束动态行；不改变签名/大小/SHA或归档选择
静态 := node --check辅助模块、npm run release:offline -- --help、git diff --check通过
待观察 := 普通/窄TTY、窗口缩放、管道/重定向、连续LAN/WAN与等待/失败后的显示
限制 := 未新增或运行测试，未构建/发布或中断当前进程；静态检查不代表真实终端验收
```

## 网页启动器APK安装授权返回续装（2026-10-16）

```text
实现 := 原生待安装状态 + 安装来源设置返回/前台统一续接 + 安装前原验证
网页 := apk.installStatus更新apkDetail；RPC立即应答；事件计数阻止较旧应答覆盖新状态
重建 := 配置重建共享准备/提交任务；系统Bundle恢复授权待办的同一APK元数据
防重 := 提交前消费待办，resumePending关闭；准备/提交/等待设置时重复点击归并
拒绝 := 返回权限仍未开 → 停止自动续装、显示未授权、保留手动重试
线程 := 准备/包身份/SHA/会话写入后台，权限设置与生命周期状态主线程
进程边界 := 保存时正在准备/提交则重建后要求手动重试，不猜测系统会话结果
待验场景 := 已授权直装、开启后返回自动一次、拒绝不循环、重复resume、设置期间旋转/系统重建、提交异常与旧桥兼容
验证 := 网页内联脚本node --check、Gradle :app:compileDebugKotlin --offline --no-daemon与git diff --check通过；未新增或运行测试，未出包/发布/真机验证
```
## HMR2.0b 自选图片（2026-10-16）

`node tmp/mmd-pose/depth-eval/hmr2-sam3d/check-custom-report.cjs`以本机临时服务验证文件选择、页面粘贴、人物框非法值拒绝、HMR同源请求和真实浏览器WASM深度PNG；`--real`以官方模型跑动漫原图，回读25点。`check-report.cjs`继续验证固定三图、四种脚掌候选、深度缺失/摘要不匹配回退、WebGL回退与390px布局。该自测验证流程可用，不代表模型姿态准确；手机运行HMR服务、更多私人图片质量未验。

隔离测试的私有源码、凭据和任务目录，以及本轮创建的ADB转发均已清理；用户原有9222转发保留。
