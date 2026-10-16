# Offline 自动出包与发布命令伪代码

## 参数与选择

```text
已有声明 := 现有 APK 构建、Offline 更新包、min APK 包装、完整 APK 独立索引、Node ZIP 构建与发布器
新增定义 := releasePlan { requested, selected, versions, baseline, artifactRoot, targets }
新增定义 := releaseReport { schemaVersion, plan, manifestPath, files, completed, published, cleanupErrors }

解析 only、publish、dry-run、resume、fresh、new、manifest-file、output-dir、local-root、remote-dir、local-verify-url、remote-verify-url
拒绝未知参数、重复参数、空选择和未知种类
only 未提供 → 按五项 offline-release-status 选择 min/code/deps/task/node
only 提供 → 仅采用显式选择；all 展开六种，包含 full
full 只由显式选择进入；不增加 full 待出包状态
deps 需要同时重建 code；锁指纹变化且选择 code → 加入 deps
根据当前签名清单和任务契约校验联合选择
无选择且非fresh → 输出无需出包，成功退出
无选择但fresh → 只清理旧报告/未发布包；仍保存高水位和新报告，不加载私钥或构建
dry-run → 输出最终选择、必要联动、版本和命令，不写文件、不加载私钥、不出包、不发布
默认执行或无路径 resume → 扫描相同输出目录、项目和目标的最新报告，显式 only 时还需种类匹配
最新报告未完成 → 自动走恢复流程；最新报告 built 且本次 publish → 自动发布既有产物
最新报告已完成 → 不自动恢复更早已被新任务取代的报告
fresh → 忽略自动恢复，开始新任务；清理同项目/输出目录/目标的旧任务报告及其未发布APK/ZIP，保留独立历史高水位，原号重建沿用本任务编号
fresh 有构建选择 → 复用最近匹配旧任务已分配的各包版本，不递增；缺少某种预留版本或版本已发布则拒绝
new → 跳过自动恢复，按最大编号加一创建新版本；与resume/fresh互斥
自动恢复保留原目标/参数；代码改变或锁存在时明确拒绝，不静默接管
```

## 版本与构建

```text
读取并验证基线签名清单、可用的 full 独立签名索引
读取版本化普通文件、已有候选清单/出包报告预留编号、APK profile 与构建元数据；不跟随符号链接
普通新任务版本 := max(对应已发布版本、本地已占用版本、配置版本) + 1
resume := 保持原任务 versions 完全不变；不重新计算编号
fresh := 采用最近同目标报告的 versions；不覆盖当前已发布版本
读取独立 .release-offline-versions.json 高水位；新计划落盘前先原子保存所有已占用/新分配编号
旧报告即使删除 → 独立高水位仍约束新版本，不重复使用历史编号
full/min 共用 Android 包名 → 两种 APK 从共同最大 versionCode 分配不同递增编号
code 与 node 独立版本递增；联合构建时复用同版本 Node 产物且避开两种本地产物版本
获取输出目录独占锁 → 再次读取基线/状态/计算计划
加载并校验签名密钥 → 保存初始报告与受管源码指纹
先构建并包装 min → 候选清单包含新 APK，任务契约可校验本轮新 min 版本
构建 code/deps/task → 以当前候选清单调用已有 npm script；按选择关闭附带 Node ZIP；读取并验证新签名清单
单独 node → 调用已有独立 ZIP 构建器并以独占版本文件保存
构建 min/full 的共同操作 → 先将计划内的 versionCode/versionName 原子写入对应 app.json，再调用已有 npm script
APK 构建失败 → 保留已占用版本和待出包状态；resume/fresh 沿用本任务编号，其他新任务避开该编号
min → 用最终服务候选清单调用已有 min 包装器
full → 校验 profile、实际包名/版本、签名、大小和 SHA256，保存版本化 APK 与独立构建元数据
full serviceVersions 使用本轮服务候选清单版本，保证首次安装内置版本与本次代码一致
每个构建步骤成功 → 报告保存不可变产物及 SHA256
只有构建前后受管源码指纹一致且该项构建成功 → 清除该项待出包标记
未选中项、构建失败项、构建期间代码改变项 → 保留原标记；full 不清除 min 标记
```

## 发布与恢复

```text
publish 未提供 → 保存 built 报告、输出恢复发布命令并退出
publish 提供 → 验证报告记录的所有文件仍为普通文件且大小/SHA256相符
服务清单 → 按 selected 模式一次选择实际改变的组件（含分组依赖/任务依赖）
每个发布目标 → 检查当前组件等于构建基线或本次候选；拒绝覆盖其他更新
复用发布器：校验 → 上传版本化文件 → 原子切换签名 manifest → HTTP完整校验 → 精确清理
full → 独立发布 APK 和 full-apk-manifest，不写服务 manifest
node → 独立发布 ZIP/签名元数据，不写服务 manifest
报告逐步保存已发布结果；清理错误写入报告并以非零状态提示可重试
resume 完整出包报告 + publish → 不升版、不重新构建，验证产物后重试发布
resume 未完成报告 → 校验已完成文件/签名候选与源码指纹；复用已完成项，未完成步骤使用原号重做
未完成步骤同号半成品 → 先证实其版本未发布，清理本步骤归档及相应构建元数据，再原号构建
resume 不带 publish → 补完构建后停止；带 publish → 补完后发布
resume 禁止与 only/manifest-file 混用；采用报告中的目标和最初发布基线
SIGINT/SIGTERM/SIGHUP → 标记停止、取消可取消的命令/网络、等待当前步骤退出、保存报告，再释放锁
正常停止不清除未完成标记；强制杀死/断电可能残留锁，须先确认旧进程/子进程退出，才能手工移除精确锁文件
失败 → 保存阶段、错误及已完成项，非零退出；释放本进程持有的锁
锁已存在 → 拒绝并发；不自动删除其他进程或未知锁
```

## fresh 清理

```text
扫描本输出目录 releases 内严格匹配本入口命名的旧报告，不跟随符号链接
仅匹配相同 projectRoot、artifactRoot、发布目标；不触碰新任务报告
候选报告关联文件 := 报告 files + min/full已分配版本的精确APK路径 + code/task/Node精确版本ZIP
从旧签名候选清单补充依赖ZIP；未完成步骤的部分版本化输出也按报告分配编号识别
可删除归档 := 本产物根内严格版本名称的普通 code/dependencies/task-code/Node ZIP与min/full APK
不删除种子/修复ZIP、不删除源profile输出、不删除源码/配置/模型/任务/结果/日志/非版本文件
先保存独立版本高水位 + 新任务报告，再开始删除
每个归档 → 逐级确认根/父目录/目标无符号链接且为普通文件
LAN任意同路径存在 → 保留；WAN SSH实际目录同路径存在/HTTP非404 → 保留
当前LAN/WAN签名manifest或full索引引用 → 保留；HTTP无法确认/非404 → 保留并记录原因
当前清理报告 retained 的发布证据 → 中断恢复后继续加入保护集合，即使旧报告已经删除
准备原号重建的版本 → 必须证明全部未发布；已存在于LAN/WAN或无法确认则停止，不能静默升号
旧报告或当前清理报告 retained 记录已发布 → 保留；两端目录及WAN HTTP均证明未发布 → unlink精确归档文件；不递归删除目录
先处理归档，成功或保留结果写入新报告，再移除精确旧报告/同ID基线与full构建元数据
文件已消失 → 幂等跳过；权限/本地I/O等删除失败 → 新报告保留错误、非零退出，可自动恢复重试
正常中断 → 新报告保留fresh标记与清理进度；恢复building阶段先幂等补清理，再构建
dry-run → 只输出旧报告和关联归档候选；发布状态需正式执行时确认，不删除或保存高水位
同号重建候选元数据 := 对应未发布code/min/task签名候选、Node sidecar、full构建元数据；只删本任务/步骤精确路径，保留已完成checkpoint
```

## 发布后按本次资源校验与进度

```text
已有声明 := verifyHttpTarget；streamHash；release:offline 发布编排；getPublishComponents
新增定义 := verificationProgress { target, stage, relativePath, fileIndex, fileCount, received, expectedSize, completedBytes, totalBytes, elapsedMs, bytesPerSecond }
发布前 := 本地待发布包与未变更目标资源继续使用既有大小/SHA256及清单基线检查
发布器本次selected → 作为HTTP校验artifacts范围；按签名清单relativeUrl精确匹配和去重，未知路径拒绝
HTTP清单 := 始终验证签名及本次候选内容相等；不因包范围缩小而跳过
HTTP归档 := 仅回读selected内本次发布资源；all仍回读全部选择资源
旧四参数verifyHttpTarget调用 := 未传范围时保留全清单校验兼容性
HTTP校验开始 → 输出LAN/WAN、基地址、文件总数与本次资源总字节
逐个文件 → 输出文件路径、序号与待校验大小
流式读取每个chunk → 同步更新SHA256与接收字节；每秒上报进度事件，打印器按终端模式显示
无chunk到达 → 定时器仍每秒更新当前进度与等待时长；结束/失败时释放定时器
大小与SHA256均匹配 → 输出该文件通过；累加已校验总字节
任一校验异常 → 输出文件与失败原因，沿用现有失败及恢复路径
全部文件通过 → 输出目标校验完成、总大小与耗时
独立offline-publish-verification模块 := 承载HTTP流式校验与进度格式化，保留发布器原导出以兼容旧调用
release:offline和独立发布CLI → 接入进度回调，以中文显示阶段、百分比、文件和累计大小及速度
打印器 := 每实例保存当前动态行及上次普通日志时间，保持原printVerificationProgress导出兼容
交互终端isTTY=true → 每秒清当前行/回行首覆盖；按columns压缩文件名和摘要，显示宽度不超过columns-1
非TTY日志/管道 → 采用单调时钟，每10秒输出一行进度；无光标控制序列
开始/清单通过/文件开始/通过/失败/完成 → 先结束动态行，立即换行记录；不会被10秒节流吞掉
窄终端 → 优先保留序号/百分比/速度，必要时缩短文件名及大小字段；不让长行自动换行刷屏
校验规则、清单切换与清理顺序 → 保持既有流程
日志观察者异常 := 停止观察输出，不改变大小/SHA256结论；计时器在finally释放
当前状态 := 选择范围、TTY单行与非TTY10秒进度已实现；静态语法及命令帮助通过，未新增或运行测试/真实发布
```
