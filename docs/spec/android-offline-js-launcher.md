# Offline 可热更 JS 启动器规格（源码已实现，待过渡APK验收）

## 实施协议与文件契约（先于代码）

```text
当前实现·已有声明 := network.UPDATE_SOURCES按两LAN再域名WAN排列；manifest和download复用来源列表
当前实现·新增定义 := WAN热更请求URL由c.aasc.us/mnt/aasc-offline/解析所得IPv4替换主机；配置来源仍为域名
当前实现·操作流程 := response请求前识别固定WAN热更来源 → dns.lookup解析IPv4 → 重建实际IP URL → 发送且Host为IP → 保留LAN优先、逐源回退、签名/SHA-256校验
当前实现·边界 := DNS失败按现有源失败处理；不固定IP，不改模型来源或旧原生更新器
当前验证 := 本地HTTP断言Host为解析所得IP；模型来源不解析；启动器37/37；真实WAN清单验签及code128 ZIP大小/SHA-256下载通过
更新源顺序 := 家庭LAN → 公司LAN → WAN；清单请求逐源尝试，首个验签成功来源即为本轮清单
JS WAN来源配置 := http://c.aasc.us/mnt/aasc-offline/；response先解析IPv4并改写实际请求URL主机，http.get使用IP URL
旧原生路径 := 缺少JS资产的历史APK先DNS解析WAN域名，再把请求URL主机替换为解析得到的IP
清单源失败 := 网络/HTTP/解析/验签失败 → 下一来源；全部失败 → 更新源不可用
下载源顺序 := 清单来源优先 → 其余固定来源；每源下载均要求清单声明大小与SHA-256一致
min APK := 使用同一清单来源和备用源顺序；LAN关闭但WAN可用且文件匹配时继续下载
版本边界 := 有效但旧版LAN清单会被首选，不主动查询WAN比较版本
宿主API := 1；APK资产offline-launcher-manifest.json存在才启用新路径，旧profile仍走原路径
根宿主组成 := Kotlin管道桥 + APK固定builtin supervisor.js；supervisor不被热更覆盖，entry/controller及全部业务模块可热更
启动器切换 := 旧JS先暂存并验证目标code而不改活动服务指针 → 根宿主切到候选启动器 → 启动现行服务健康后提交启动器 → 向新JS重放原安装/更新请求
候选声明 := 固定目录host-api.json{hostApi:1,stateApi:1}；不兼容时先拒绝，不能把现行服务升级成回退启动器不可读取的状态
资产集合 := builtin-only offline-launcher源码 + 共享签名/任务/依赖纯模块 + 可信模型目录/公钥 + HTTPS证书
进程入口 := Node执行APK内置supervisor.js；监督器只负责可信启动器候选/回退/进程切换，业务由entry.js及controller模块执行
HostProtocol := 每行JSON{type,requestId,generation,payload}，最大2MiB；stdout只发协议，stderr承接日志
请求 := bootstrap.preview/install/cancel + service.check/apply + apk.check/prepare + models.catalog/status/locate/require/prepare/prepareGroup/cancel + ui.firstRun/firstRunShown
应答 := rpc.result{requestId,result,error}；通知 := startup.status/update.progress/model.progress/model.prepared/models.state/launcher.ready
首次启动 := 最小Runtime复制不要求已有服务 → 监督器/启动器可用 → 本地网页从bootstrap.preview取得签名清单/字节 → 用户确认后bootstrap.install
取消 := 请求ID独立AbortController；模型同ID归并，共享取消；新请求不复活旧取消令牌
目录 := 延用updates/active-release.json/code/code-vN/dependencies/dependencies-vN/task-code/task-code-vN与旧模型候选目录
JS读取旧指针 → pendingHealth先回滚 → 稳定组合启动；首装无上一组合失败则撤销活动指针但保留下载/种子
下载 := 固定已验签快照，备用源必须提供同摘要字节；流式大小上限/摘要/空间检查/原子落盘，查询不下载
```

```text
已有声明 := NodeServerService进程宿主 + server-launcher父子进程 + Offline签名清单/代码ZIP + 分组依赖/任务/数据修复 + 模型缓存/原生引擎
新增定义 := HostProtocol{type,requestId,generation,payload} + LauncherSelection{active,previous,pending,sourceIdentity,hostApi}
新增定义 := RuntimeSnapshot{phase,serviceVersion,dependencyVersion,taskVersion,modelStates,confirmations,error,generation}
新增定义 := LaunchContext{root,publicKey,runtime,hostApi,launcherSource,offlineProfile}
```

## 空环境启动与首装

```text
APK安装/验证随包Node及配套库 → 选择可校验活动JS入口；不存在或失败 → 选择APK内置JS基线
宿主启动Node JS主进程并传LaunchContext → 启动器握手 → 不依赖服务node_modules即可响应状态与确认
服务环境缺失 → JS读取签名manifest/校验兼容/计算code+common+android+种子+任务缺项量 → 发布等待确认快照
用户确认{requestId,generation}匹配 → 单写者锁 → 缓存下载/大小摘要/安全解压 → 恢复缺失种子和合法任务目录/latest
写入候选完整服务组合{code,dependencies,taskCode,pendingHealth,previous} → 启动服务子进程
真实API版本/目录/任务指纹健康 → 提交组合；新首装同时持久化launcherEligible后通知ready，启动页可直接引导模型；旧显示页仍可触发首次策略；失败 → 回滚旧组合/无旧组合返回可重试首装状态
数据修复 → 复用原数据版本门控/快照回滚，不能因迁移启动器重复执行或覆盖私人配置
完整APK首次内置激活 → 保留现行安装身份/健康后精确清理语义；普通APK与独立Node运行器不混用指针
```

## 热更与启动器自更新

```text
更新检查/下载选择/重试/源切换/版本组合 → JS协调；APK不再编写这些业务规则
打包代码快照 → 按启动器目录及四个启动器共享文件的路径/长度/SHA-256计算launcherSha256
当前签名清单的launcherSha256相同 → 沿用launcherVersion；否则launcherVersion := 本次递增的codeVersion
新签名code组件同时记录launcherVersion与launcherSha256；旧清单没有这两个字段时仍可读取
launcher.ready保留既有launcherVersion代码包身份，另报launcherReleaseVersion为当前活动/待提交签名启动器版本
服务更新时codeVersion不同 → 下载并验证目标code ZIP、解压到受管版本目录、核对签名的launcherSha256
目标启动器文件集合与当前运行启动器文件集合逐字节指纹相同 → 不切换启动器进程，继续现有服务停止/准备/启动/健康回滚流程
目标启动器文件不同 → 按原launcher.switch、自更新健康提交及请求重放流程处理
首次引入独立版本的更新仍可能按旧控制器规则切换一次；旧设备保持旧签名清单兼容
代码ZIP内固定offline-launcher目录 → 经签名和完整包摘要验证后准备启动器候选 → 记录来源与宿主兼容声明
候选启动器先支持现行服务状态/宿主API → 无在途事务或已安全取消 → 持久化切换恢复点 → 请求宿主launcher.switch
宿主重新校验签名来源/固定受管入口/候选字节 → 停旧服务与启动器 → 新Node进程运行候选JS
新启动器握手 + 已有服务实际健康 → 提交启动器活动身份；空首装环境 → 握手及确认/恢复能力健康，不要求缺失模型就绪
启动失败/超时/异常退出 → 先上一健康JS，再APK内置基线；保留下载和数据恢复点，不删除用户目录
启动器提交完成后 → 按目标服务兼容要求完成服务组合更新；组合失败仅回滚到可读的上一服务状态
清理保留集合 := 活动/上一健康启动器引用 + 活动/回滚服务组合引用 + 当前事务暂存
尚被保留集合引用的版本 → 不清理；未知目录/符号链接/用户数据/日志/模型 → 不作为版本清理目标
```

## 模型与界面

```text
模型目录 := 已签名代码的可信定义；modelId/revision → 固定候选路径；原生引擎支持范围仍由APK接口约束
查询状态 → JS只读属性/验证记录 → 快照；不自动下载/不自动弹确认
首次提示策略 := min + 前台 + 服务健康 +（本次健康首装launcherEligible 或 显示页成功）+ 尚未处理 + 语音组缺验证缓存
策略满足 → JS决策打开本地网页确认区{TTS,ASR声纹,默认勾选,缺项字节} → 页面展示令牌回传 → 成功才持久化首次标记
选择下载 → JS按modelId去重/串行或有界执行/独立原子提交/取消令牌 → 分组字节进度 → 通知原生模型已准备
原生模型管理器 → 只使用受管定义映射的已准备目录 → 验证加载并报告引擎ready；不重放旧录音/播报/聊天
模型失败/稍后/取消 → 保留完成缓存/回到手动入口；旧本机缓存及既有ID/路径/摘要兼容，不静默迁移或删除
UI重建/后台返回 → 按generation请求权威快照 → 最新阶段/确认恢复；丢失窗口回调不得消费首次机会
可远端配置项 → 既有AASC WS配置/set/权威广播/重连补发；不新增重复HTTP配置读写
```

## 迁移与验收约束

```text
首次启用 := 发布兼容宿主协议的过渡min + 携带启动器JS的签名code包；旧min59继续原逻辑，不能仅换服务JS就启用新宿主
事务写入权 := Kotlin旧更新器 或 JS新启动器二选一；APK仅维护启动器选择/恢复记录
Android目标 := common+android已构建依赖；禁止目标机npm安装，禁止依赖服务已启动或外部依赖可用
源码定向验证 := 空首装/模型缓存与取消/热更组合/种子与修复门槛/自更新回退/网页交互
待设备验收 := 新宿主WebView/权限/后台恢复/min59和旧full升级/原生模型加载与推理/低空间与性能
产物状态 := 生产code106/min61；本地min62/code112已签名构建并完成专项验收，五项false；发布待用户指令
```

### 兼容与事务补充

```text
模型状态快照 = JS启动器就绪/模型操作后发送的目录、文件存在、验证、任务状态
原生模型门面读取快照；加载/下载/取消通过管道RPC；原生不抢占JS下载事务
首装提示令牌 = JS生成的一次展示确认；Activity前台展示成功后回传令牌
组合候选 = 验证代码锁与全部必需生产依赖版本、任务字节和已有目录marker
整包根目录首次发生组合更新时物化代码版本目录，避免指针指向不存在路径
回退到整包根 = 移除热更指针；不将根代码误写为版本目录
启动器切换失败 = 为原请求返回可重试错误，恢复原健康启动器，再回到APK基线
解压前按声明展开大小保留空间；下载/模型/服务事务停止完成后切换启动器
```

### 本地网页UI数据流

```text
页面根 = 固定supervisor核验并在launcher.ready事件中报告的uiRoot
宿主读取页面 = 仅私有目录下基线或updates/code版本目录的ui/index.html，拒绝链接与越界
页面来源 = 独立固定HTTPS本地来源，禁止网络资源、文件访问、外部导航与子窗口
UI请求 = {type, requestId, payload}，白名单RPC；结果/状态/下载进度通过页面事件回传
系统安装 = 原生重新取得JS已准备APK并执行现有包名/签名校验及系统安装流程
首次提示 = 显示端前台已健康后打开启动页，网页真实绘制模型确认区后回传JS提示令牌
返回显示端 = 启动MainActivity并退出启动页；失败时保留页面可重试/重新检查/取消
首装APK = 固定内置HTML基线；服务不存在也可展示与操作
```

```text
本地页面桥协议 = 每次页面实例独立requestId；拒绝未知命令、重复/超量请求、超过2MiB消息
页面返回显示端 = 携带固定Offline服务URL触发已有singleTask MainActivity重新连接
健康清理 = 限updates/code、dependencies、task-code直属数字版本普通目录，预扫描拒绝链接/特殊文件；失败记录重试，不影响健康提交
页面重载 = 启动器切换后使用supervisor报告的新uiRoot；原操作由宿主继续等待，页面重新请求快照
```

```text
旧legacy-root指针修复 = 版本依赖目录marker或版本/锁/express元数据有效 → 仅改legacyDependencies为false → 保留pending/previous字段；不联网、不覆盖用户文件
宿主会话替换 = 旧请求显式失败；状态/模型目录/页面根仅接收当前generation，避免跨重启迟到结果
```

## min60 真机启动时序与本地文档修正（2026-10-16，用户确认）

```text
NativeBridge构造时 = 不等待JS、不发RPC、不下载、不要求模型快照已存在
目录查询 = 有当前JS快照 → 使用受管私有目录；无快照 → 从APK可信模型定义映射已有固定缓存候选路径
临时路径 = 仅用于构造轻量原生管理器，不代表模型已就绪；加载前仍经JS requirePrepared校验
JS状态到达后 = 各管理器原有directoryProvider重新读取当前权威路径，不能缓存构造时占位目录
本地网页入口 = 固定HTTPS来源的顶层首页请求；WebView.loadUrl → 拦截器返回已核验HTML的200响应
其他请求/子框架/外部导航 = 拒绝；不使用会被自身拦截器403拒绝的loadDataWithBaseURL文档
文档响应 = text/html UTF-8 + no-store；页面切换读取supervisor最新uiRoot后重新请求首页
验证 = 快照为空也可构造；JS新快照路径生效；未知ID/越界拒绝；顶层本地首页允许、其他请求拒绝；真机冷启动和启动页交互
```


```text
min61设备结果 = 原生构造无快照不崩溃 → 显示页已连接 → 本地顶层文档200/标题与模型列表可读/桥可操作
真实自更新 = 网页确认105→106 → launcher.active106且pending为空 → 服务106/deps10/task1健康提交 → 冷启动保持组合
数据兼容 = 主配置/用户配置/数据修复记录JSON与备份一致；模型状态只读且不自动下载
切换窗口查询拒绝 = 显示暂不可用 → 手动重新连接读取最新快照；自动重连列为可选优化
发布边界 = 本地min61已构建/安装，LAN/WAN仍min60；不将本机验证等同生产发布
```

## min61 完整重装观测与待确认修复

```text
已有声明 := SM-N9500 + 已发布min61 + LAN签名code106/deps10/task1
安全前置 := force-stop → 私有tar完整读取与文件集合/摘要一致 → 保存APK和外部目录 → 才卸载
干净环境 := uninstall成功 → 包不存在 → install成功 → 首启前files不存在 → 系统权限确认
安装结果 := 网页预览50949299字节 → 确认安装 → 启动器自更新106 → 服务106/依赖10/任务1 → pendingHealth=false
实际进度 := 下载common到100% → 解压/重复内容校验/合并继续 → 页面未切阶段 → 约5分半完成
首装页结果 := 服务ready且first隐藏 → 返回显示端/摄像头授权 → 新启动页带首次token
可见性缺陷 := first未hidden且top545.92 > viewport388 → 实际不可见 → handled已true
待确认定义 := 前台可见提示证明 + 首装完成后的模型确认衔接 + 阶段进度事件
待确认流程 := 服务健康 → 启动器直接衔接模型确认 → 提示进入视口 → 才确认token → 用户确认才下载
验证边界 := 当前只完成复现；运行实现与自动回归待确认；模型权重未下载，产物状态不变
```

## 首包、更新提示与模型弹窗修正（2026-10-16，用户最终确认）

```text
最终交互 := 首包自动下载且无取消；已有服务的更新提示需确认/可稍后；语音模型按原生确认与进度弹窗
首包入口 := requestBootstrap/启动遮罩重试附automatic=true → 浮动WebView窗口，页面自动读取签名资源并bootstrap.install
首包界面 := 只显示准备进度/阶段/失败重试；不显示下载确认、稍后、取消、版本管理或其它模型；返回键与点窗口外部不取消
首包恢复 := 自动页面初始化时awaiting_confirmation或installing均恢复首包样式；同一签名快照的在途install归并，跨快照拒绝并发
健康收起 := 候选真实API/目录/任务指纹通过 → 提交组合 → ready → 自动native.openDisplay并关闭启动页
语音资格 := 无旧健康组合的fresh安装，在健康回调中写launcherEligible后通知ready；失败不写；旧安装等待显示端真实handled迁移
语音提示 := min/前台/健康/显示页成功或已获launcherEligible → 查询ui.firstRun；已有handled和验证缓存不重弹；同一未消费token复用
自动模型窗口 := 仅默认TTS与ASR声纹两组，默认勾选，总量随选择变化；下载所选/准备所选/稍后
模型准备 := 确认后保持可取消进度，后台不重放旧语音请求；完成关闭；失败显示错误/重新准备；稍后直接回显示端
提示可见证明 := 卡片放顶部/滚入视口 → 文档visible/标题完整/足够卡片高度在视口 → 两帧复核 → ui.firstRunShown{token,visible:true}
消费约束 := 原生仍检查resumed；JS仅接受匹配token和visible=true后原子写handled；后台/屏外/隐藏/旧代次不消费，返回前台重试
宿主能力兼容 := 新ui.init声明firstRunQuery=true才允许网页查询；旧min61页面只接收原有firstRunToken，不调用旧桥未知命令
更新入口 := MainActivity现有新版本提示 → 用户确认 → 原startServiceUpdate/startMinApkDownload → JS更新/下载编排；不跳整页管理，不走首包自动分支
手动管理 := 保留模型/服务检查、重试/重启与取消；未确认的模型/更新操作仍不下载
```

```text
阶段事件 := update.progress{phase,detail,indeterminate,elapsedSeconds,completedFiles,totalFiles,completedBytes,totalBytes}
下载 := 按真实字节；解压 := 通过CRC并落盘的文件数/展开字节，150ms节流且首尾必发；路径/链接/大小拒绝规则不变
校验/合并/种子恢复 := 包裹真实异步操作 → 开始事件/每秒进行中耗时 → 结束清计时器；未知总量为不定进度
页面进度 := 下载/解压有可靠总量才显示百分比；后续阶段不继承下载100%；state.get恢复最新阶段；ready清旧进度
重载恢复 := automatic且installing立即恢复首包样式；有效阶段事件清旧握手错误
只读重试 := models.catalog/state.get/bootstrap.preview/ui.firstRun遇明确暂不可用错误时300ms重试、上限30秒；安装/更新/模型写请求不自动重试
桥 := 增加ui.firstRun白名单；固定宿主仍只承载浮动窗口、前台约束、返回显示及原生能力；业务规则留JS
产物 := JS与APK基线受影响；需要service/min产物；依赖/任务/子显示端集合不变；签名构建后才恢复对应状态false，发布另行执行
验证 := JS/Chromium36项通过；首装打包63项通过；Android Offline/Node153项中152通过、1既有归档环境跳过；min62/code110空首包及最终min62/code112真实更新/冷启动结果见下节
```

```text
横屏操作区 := 模型弹窗固定高度内flex排版 → 顶部提示紧凑 → 中部选择区可滚动 → 底部下载/稍后/取消固定可见
验收补充 := 真实273px高WebView也必须完整看到操作按钮，不能只验证提示标题可见
```

## 最终设备结果

```text
空首启 := 完整备份后uninstall/install，files不存在 → 隔离签名code110自动准备 → 无取消/无确认点击 → 各阶段无UI错误 → 健康自动收起
模型 := 显示成功自动弹TTS/ASR默认342MiB → 提示top0.19/视口273 → 最终同源CSS下按钮bottom256.38 → 稍后收起且未下载
最终产物 := min62/code112内置18项与源码逐文件相同；profile/updateOnly/CRC/签名匹配；代码与APK已构建，五项状态false
更新 := 显示端旧提示列111/112 → 未确认无代码下载 → 稍后关闭 → 明确更新112 → 服务/启动器健康提交
故障恢复 := 隔离测试源进程退出导致连接拒绝 → 保持旧110 → 恢复源/重新检查/确认 → 成功112；不记为生产源故障
冷启动 := 恢复默认源 → HTTPS API ok/code112/deps10/task1 verified → launcher112/pending空 → 无重复模型弹窗
证明边界 := 空首包行为由110观测，112补布局后经真实更新/冷启动；273px布局在真实WebView应用同源最终CSS验证；不称默认生产源112空安装
未验 := 旧full迁移/真实权重下载与加载推理/基准性能；不将准备提示等同权重或引擎ready
```

## 安装来源授权返回续装（2026-10-16，源码完成）

```text
已有声明 := OfflineLauncherActivity.Bridge/native.installApk/onResume；OfflineUpdateManager.requiresUnknownSourcesApproval/installPreparedMinApk
新增定义 := 待安装记录 { 已验证更新, 授权等待, 已提交 }；Activity重建恢复标记
操作流程 := 用户点击安装 → 后台取得/验证缓存APK → 前台保存待安装记录
已有授权 → 先消费待办以阻止重复提交 → 现有校验与PackageInstaller提交 → 网页反馈已请求系统安装
没有授权 → 打开本应用安装来源设置 → 网页反馈等待授权，不长期挂起RPC
设置返回且前台 → 重新查询真实权限，不依赖resultCode → 已允许则续装一次
未允许/取消 → 提示未授权，保留手动重试，不自动循环弹设置
Activity重建 → 恢复待办标记，后台重新验证受控缓存后续装，不接受网页任意路径
异常 → 恢复可重试状态并明确显示原因；系统最终安装确认继续由用户操作
边界 := 不改服务更新/模型下载；不以等待授权伪装已提交安装；min APK需重新出包
实现细化 := 原生安装状态独立保留于配置重建；Bundle保存系统待办身份，不接受网页路径
准备与安装 := 后台执行缓存准备/大小SHA与PackageInstaller写入；主线程仅调度、权限与状态
网页RPC := 立即返回准备/授权等待等当前状态；apk.installStatus事件继续更新apkDetail；onPageFinished重放最新状态
设置返回 := onActivityResult与onResume共用前台检查；onPause记录确实离开，避免刚打开设置即认作返回
重复点击/恢复 := preparing/submitting/awaitingApproval阶段归并；提交前消费待办，配置重建共享在途状态
进程重建 := 授权等待恢复同一元数据/缓存；保存时正在准备/提交则要求手动重试，不自动重复系统提交
未授权/失败 := 保留已验证待办供手动重试，关闭自动续装闸门；没有权限不创建安装会话
影响 := OfflineLauncherActivity.kt、启动页ui/index.html及minApk/servicePackage出包标记
状态 := 源码完成；Kotlin compileDebugKotlin与网页内联脚本语法/diff检查通过；未新增/运行测试或出包/真机验收
```
