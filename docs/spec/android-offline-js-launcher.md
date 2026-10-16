# Offline 可热更 JS 启动器规格（源码已实现，待过渡APK验收）

## 实施协议与文件契约（先于代码）

```text
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
真实API版本/目录/任务指纹健康；显示页成功另作为首次提示门槛 → 提交组合；失败 → 回滚旧组合/无旧组合返回可重试首装状态
数据修复 → 复用原数据版本门控/快照回滚，不能因迁移启动器重复执行或覆盖私人配置
完整APK首次内置激活 → 保留现行安装身份/健康后精确清理语义；普通APK与独立Node运行器不混用指针
```

## 热更与启动器自更新

```text
更新检查/下载选择/重试/源切换/版本组合 → JS协调；APK不再编写这些业务规则
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
首次提示策略 := min + 前台 + 服务健康 + 显示页成功 + 尚未处理 + 语音组缺验证缓存
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
产物状态 := code106/min60已发布；宿主修正min61已本地出包及真机验证，minApk=false；servicePackage/其它产物不额外标记；min61尚未发布
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
