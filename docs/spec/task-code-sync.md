# 独立任务代码 ZIP 同步伪代码

> 2026-10-15 用户已确认“执行”，源码已接入独立任务 ZIP 与完整组合事务，尚未正式出包、发布或真机迁移。验证结果记录在末尾。

## 已有声明

```text
OfflineUpdateManifest → 验签并解析现有 code/dependencies/apkMin 等组件
OfflineUpdateManager → 下载、解压、安装版本目录、切换 active-release
NodeServerService → 启动 Node、验证实际版本、失败回滚
active-release → codeVersion/dependencyVersion/lock 与 previous
CODE_ROOT → 实际服务代码位置
TaskIO.tasksDir → 可写任务数据目录
TaskIO._taskPath → 任务数据路径
TaskManager → 提交、运行、恢复、重发及实例生命周期
task:list / task:execute / task:stop → 现有任务消息
publish:offline-update / sync:offline-update → 发布和镜像现有签名资源
```

## 新增定义

```text
TaskCodeSelection := release/task-code-files.json
  tasks := 任务名、明确选择的代码路径、codeRequirement、dependencyRequirement
  retiredTaskNames := 退役名称

TaskCodeArtifact := components.taskCode
  version、relativeUrl、size、sha256、source、bundleSha256
  taskCodeApiVersion、requiredCodeVersion
  maximumCodeVersion := 可选上界，省略时无限制
  requiredApkVersionCode
  requiredDependencyVersion、requiredLockSha256 := 可选成对约束

TaskCodePackage := task-code/task-code-vN.zip
  task-code-manifest.json
  tasks/任务名/代码相对路径

TaskCodeManifest :=
  format := aasc-task-code
  schemaVersion := 1
  version := 独立任务版本
  taskCodeApiVersion、requiredCodeVersion、maximumCodeVersion、requiredApkVersionCode
  requiredDependencyVersion、requiredLockSha256 := 与外层一致
  tasks := {taskName, revision, codeRequirement, dependencyRequirement, files[{path, size, sha256}]}
  retiredTaskNames
  bundleSha256 := 兼容约束、排序任务与退役记录的稳定摘要

CodeRequirement := {minimumVersion, maximumVersion, taskCodeApiVersion}，任务必需依赖
InstalledCodeIdentity := {version, archiveSha256, directory, taskCodeApiVersion}
DependencyRequirement := {version, lockSha256} 或明确 null
InstalledDependencyIdentity := {version, lockSha256, groups, target, NodeAbi, directory}
ReleaseTuple := 已验证 code 身份 + dependencies 版本/锁指纹/组身份 + 可选 taskCodeVersion/taskCodeSha256
PreviousReleaseTuple := 完整的上一健康组合
LaunchTaskCodeContext := {path, version, sha256, codeVersion, dependencyVersion, lockSha256}
TaskCodeCatalog := {固定任务包目录、已验证 manifest、受管名称、退役名称、文件索引}
ExecutionPaths := {entryPath, codeDir, workDir}
Puppeteer入口源码 := 作为evaluate实参传递原始字符串，再构造run函数；不重复JSON编码为字符串字面量
taskCodePackage := 独立产物待出包字段
```

## 构建和签名

```text
构建输入 := TaskCodeSelection + 固定 res/tasks 代码源 + 独立 taskCodeVersion + 兼容约束
代码后缀 := js / cjs / mjs / html / css
排除 := 配置、results、日志、latest、任务链、模型、媒体、输入输出、依赖、测试、.src
安全规则 := 名称合法、无越界/绝对路径/重复/大小写冲突/链接/特殊文件
限额 := 单文件2MiB / 总代码文件1024 / 总代码32MiB / 包内清单1MiB / ZIP项4096 / 名称分段128字符
明确列出的文件缺失或不合法 → 构建失败

每个代码文件 → 独立暂存目录/tasks/任务名/相对路径
逐文件记录 := path/size/sha256
逐任务代码依赖 := 必须存在 CodeRequirement
包级代码下界 := 各任务 minimumVersion 的最大值
包级代码上界 := 各任务已声明 maximumVersion 的最小值
代码兼容区间无交集或任务 API 版本冲突 → 构建失败并指出任务名
代码包依赖上下界相同 → 精确版本依赖
上界省略 → 发布方明确承诺相同任务 API 下向后兼容，不凭较高版本猜测
逐任务依赖 := 已确认的 DependencyRequirement；null 表示没有新增基础依赖约束
有约束的任务 → 必须指向同一依赖版本/锁指纹
存在冲突 → 构建失败并指出任务名称，不自动选较大版本
全部无约束 → 包级依赖字段同时省略
存在一致约束 → 聚合为包级 requiredDependencyVersion/requiredLockSha256
任务 revision := 稳定排序文件记录 + 该任务代码包/生产依赖声明的摘要
bundleSha256 := 兼容约束 + 稳定排序任务记录 + 退役集合的摘要
包内清单 → 暂存目录/task-code-manifest.json
独立暂存目录 → task-code-vN.zip

内容及兼容约束未变 → 复用现有任务版本
版本相同但摘要不同 → 拒绝覆盖
兼容约束变化 → 生成新任务版本
任务 ZIP → 记录 version/relativeUrl/size/sha256/source/兼容字段
当前权威签名清单 + TaskCodeArtifact → 新签名 manifest

task-code-only 模式 → 只构建任务 ZIP
code/dependencies 满足新任务依赖要求 → 其余组件引用保持
不满足 → 不签发不兼容清单，提示准备匹配的 code/dependencies 联合发布
只改任务依赖声明 → 任务版本仍须变化
code-only 模式 → 保留 taskCode 引用并校验新 code 是否满足任务代码版本/API 依赖
联合模式 → 所有新组件就绪后发布同一清单
发布基线已经变化 → 重算并重新签名，不覆盖其他已发布组件
```

## 兼容和更新计划

```text
依赖图 := taskCode→code→dependencies，另有 taskCode→dependencies
当前状态 := 实际已安装 APK + 当前完整活动组合
候选来源 := 验证签名后的单个 manifest
taskCode 缺席且未启用任务包 → 旧任务目录模式
taskCode 存在 → 校验 ZIP 元数据与兼容约束
代码包版本 := 签名 components.code.version，不是 APK 版本或 package.json 应用版本
先选满足任务代码区间/API 的 code，再结合其锁定的 dependencies 计算候选

兼容候选必须满足:
  APK versionCode >= requiredApkVersionCode
  code.version >= requiredCodeVersion
  maximumCodeVersion 存在时 code.version <= maximumCodeVersion
  code.taskCodeApiVersion == taskCode.taskCodeApiVersion
  code.requiredDependencyVersion == dependencies.version
  code.requiredLockSha256 == dependencies.lockSha256
  任务包存在依赖约束时 requiredDependencyVersion == dependencies.version
  任务包存在依赖约束时 requiredLockSha256 == dependencies.lockSha256
  实际服务 package-lock 摘要 == dependencies.lockSha256
  实际依赖组身份/平台/Node ABI/N-API 均匹配

当前 code 不兼容但清单 code 可兼容 → 即使依赖已满足，也提示联合更新 code
候选 code 绑定相同依赖 → 复用；绑定新依赖 → 准备相应依赖组
APK 不支持 → 提示先安装支持版，不切换任务指针
无可兼容候选 → 明确报错，活动组合保持
变化集合 := 候选组件与当前组件按版本/摘要比较的差异
原生候选提示 := 任务单独更新显示任务标题；其他服务更新附带任务版本，复用原确认/重启入口
完整组合兼容且只有任务变化 → task-code-only，不下载服务包或依赖
```

## 依赖约束与联合更新

```text
依赖版本 := components.dependencies.version 的组合版本
不是 common/android 组版本，也不是 npm semver
任务约束 := 精确版本 + lockSha256；两字段同时存在或同时省略
只存在一项/值非法 → TASK_DEPENDENCY_REQUIREMENT_INVALID
多个任务要求不同基线 → TASK_DEPENDENCY_CONFLICT
候选不满足任务或服务任一约束 → TASK_DEPENDENCY_MISMATCH

当前依赖满足全部约束且目录有效 → 可复用
不满足 → 从同一签名清单选择满足约束的 dependencies
服务绑定的依赖与候选不一致 → 一并选择匹配 code
清单无兼容组合 → 发布/安装失败，活动组合保持
所需依赖分组未变 → 复用已验证层；只下载改变的层
联合更新确认内容 := 任务包 + 必要的依赖组 + 必要的服务包
不能绕过锁指纹或临时 npm install

taskDependencies 的独立任务资源 → 原签名资源与执行前准备流程
基础生产依赖约束不代替 taskDependencies 资源版本
任务 ZIP 不含 node_modules 或依赖二进制
```

## 安装、切换、健康与回滚

```text
更新执行 → 沿用现有受管停止/启动流程
变化组件 → 单独下载 → 校验签名绑定的大小/SHA-256
未变组件 → 验证对应已安装目录后复用
任务 ZIP 路径白名单 := task-code-manifest.json、tasks 及合法子路径
安全解压 → 独立暂存目录
包内版本/契约字段 == 外层 taskCode 组件对应字段
逐文件摘要与 bundleSha256 → 全部验证
成功 → 安装 updates/task-code/task-code-vN

code/dependencies/taskCode 候选目录全部就绪
  → previous := 旧完整活动组合
  → 原子写 pending 完整组合
  → 一次读取组合用于启动新 Node

LaunchTaskCodeContext.directory := 已选版本目录的受控绝对路径
LaunchTaskCodeContext.version / archiveSha256 := 指针中的已验证身份
原生启动环境 → 传递同一份任务上下文
当前 Node 进程 → 固定任务上下文，不随指针变化跳转

有任务指针 → 必须存在有效 catalog 且与启动上下文/实际代码包身份及 API/依赖身份一致
读取任务元数据或执行代码之前 → 再次验证必需代码包约束和任务依赖约束
依赖版本相同但锁指纹不同 → 失败；更高版本不能自动视为兼容
无任务指针 → 桥接服务允许 legacy-local，支持旧客户端和首次迁移
有指针但文件缺失/损坏/不兼容 → 健康失败，不退回旧目录
校验前不得宣布服务健康，错误不得被可选任务初始化吞掉

健康返回 := 实际 code/dependencies/taskCode 版本、包身份、目录、服务任务 API、依赖锁/组身份与 catalog 状态
原生验证身份与候选完整组合一致 → 提交
失败/中断 → 恢复完整 previous → 重启上一组合
失败前的未完成暂存不会成为活动目录
任务自身视觉/业务错误 → 原任务错误状态，不等同于组合健康校验
显示端离线 → 原待恢复流程，不阻塞本地组合健康
```

## 有效代码和任务数据

```text
catalog.root := LaunchTaskCodeContext.directory
codeRoot := 当前实际服务 CODE_ROOT，与任务根目录独立
数据目录 := TaskIO.tasksDir/任务名
受管代码 → catalog.root/tasks/任务名/相对代码路径
受管任务未列出的代码 → 不存在，不回退旧数据目录代码
退役任务代码 → TASK_CODE_RETIRED，历史数据保留
配置/参数/results/refs/输入输出 → 原数据目录和访问规则
未受管用户任务 → 原读写流程
src 内 builtin → 原 registry

task:list := 本地任务 ∪ catalog 任务
新增任务无实例 → 仅列出，不自动启动
元数据/文件列表/执行/HTTP/恢复/重发 → 同一有效解析入口
旧 payload.files → 不能覆盖受管代码
有效派发文件 := catalog 代码 + 原流程允许读取的本地非代码输入
results/日志/隐藏状态 → 不作为任务代码派发

entryPath := 有效代码入口
codeDir := 有效代码根
workDir / cwd / context.workDir := 原任务数据目录
相对模块 → codeDir；业务写数据 → workDir
/res/tasks 代码请求 → catalog，缺失返回 404 不再静态回退
/res/tasks 数据请求 → 原静态流程
代码缓存 := revision ETag + 重验证

编辑/上传替换/删除受管代码或整任务 → 写入和生命周期变更前返回只读错误
配置/参数/实例操作 → 原流程
整个任务停止发布 → 明确 retiredTaskNames，后续保留退役记录
同步本身写任务数据目录 := 空集合
```

## 恢复、首次迁移、清理和状态

```text
应用任务版本 → 受管重启服务 → 恢复原 taskName/instanceId/params/任务链
显示端连接 → task:execute 携带有效 files、可选 taskCodeVersion/revision
同实例替换 → 释放旧定时器/监听/DOM/回调 → 重建
重复重连 → 幂等，无资源累积

首次接入:
  支持版 min 原生更新器 + 支持任务上下文的桥接服务
  → 客户端具备独立任务组件能力
  → 首个任务 ZIP
历史 min56 + 仅服务热更 → 可加载桥接服务，但不能宣称原生已同步任务 ZIP
支持版 min + 旧服务 → 任务契约不兼容，先准备支持版服务
支持版 min + 桥接服务 + 任务包 → 按完整组合切换

发布路径 := LAN/WAN 各自的 task-code/版本 ZIP
发布清理 := 新增规则经项目规范同步后，仅处理严格数字版本普通文件
设备清理 := 只处理受管任务版本目录，保留 active/pending/previous 引用
链接、配置、模型、res/tasks 数据、临时文件 → 不跟随或删除

taskCodePackage 状态:
  仅任务代码变更 → taskCodePackage=true
  首次原生/服务接入 → 同时记录实际受影响的 minApk/servicePackage
  任务包成功生成且包含最新代码 → taskCodePackage=false
本轮源码接入 → minApk=true、servicePackage=true、taskCodePackage=true、dependenciesPackage维持false
```

## 验收声明

```text
任务 T1→T2 且 C1/D1 满足全部约束 → 只下载任务 ZIP，组合 C1/D1/T2
任务文件哈希 → 与 res/tasks 发布快照一致
失败回滚 → C1/D1/T1，不能只退 code 留下 T2
联合 C2/D2/T3 失败 → 回到完整 C1/D1/T1
同版本同摘要 → 复用；同版本不同摘要 → 失败
代码/APK/契约不兼容 → 明确提示，不执行错误组合
旧客户端忽略 taskCode → 仍使用旧路径，不报告任务同步成功
无业务写入 fixture → 配置/results/logs/inputs 前后字节相同
移除文件 → 无旧代码回退；退役任务 → 数据仍保留
显示端连续重连 → 一份覆盖层、无定时器和监听增长
依赖要求已满足 → task-code-only 不下载 code/deps/seeds
依赖要求未满足 → 提示必要的联合更新，不谎报只下载任务包
C1 绑定 D10/H10 + T2 要求 D11/H11 → 选择 C2/D11/T2，拒绝 C1/D11/T2
同版本异锁/高版本不兼容/约束缺半对 → 拒绝
任务依赖约束冲突 → 构建失败；全 null → 仍执行服务原有依赖约束
依赖约束变化、文件未变 → 仍为新任务包身份
沿用的服务/依赖不满足 → 拒绝发布，不切换签名清单
T2 需要 code96，当前 code95/deps10 → 依赖满足也必须联更 code
新 code 超出任务代码上界/API 不符 → code-only 发布也拒绝
逐任务代码区间无交集/API 冲突 → 构建失败
只改任务的代码包依赖声明 → revision/任务包身份仍变化
```


## 本轮实际实现映射

```text
构建契约 → src/apps/server/modules/aasc/task-code-contract.js
选择和暂存 → scripts/ops/task-code-package.js + release/task-code-files.json
独立模式 → offline-update-package 的 task-code-only，或 code-only/all 指定 task-code-version 联合构建
发布基线 → task-code-only先验签目标当前清单，上传前/切换前比较除taskCode外所有组件
镜像 → SYNC_COMPONENT_NAMES包含taskCode，仍按签名大小/摘要复用
原生契约/目录校验 → OfflineTaskCode
完整组合读写/回滚 → OfflineReleaseState；原子写code/dependencies/lock/taskCode/version/hash/previous
任务单独更新 → TASK_CODE_ONLY，不下载code/deps；若已有同身份已校验任务目录则复用
启动身份 → AASC_TASK_CODE_CONTEXT固定version/path/sha/codeVersion/dependencyVersion/lock
启动catalog → 逐文件校验后建立索引，API=1，缺失/额外/链接失败中止启动
有效代码 → TaskIO.resolveCodePath/readTaskFiles + WS元数据 + HTTP受管中间件
HTTP受管代码 → no-store；缺失立即404，不回退旧种子
可写数据 → tasksDir；Node cwd/context.workDir固定原任务数据目录
官方写入/整任务删除 → submit/update/delete操作前assertTaskWritable
显示端重发 → 强制当前有效files及revision；替换前旧update(_stop)、onCleanup回调、DOM和style依次释放
退役 → retiredTaskNames保持名称墓碑，列表不再运行旧代码，数据保留
首批基线 → min58 / code最低96 / API1；win-monitor额外要求deps10与当前锁指纹
生产依赖集合 → 本轮未变化
```


## 定向验证结果（2026-10-15）

```text
test:task-code-sync → 66/66；包含TaskIO/TaskManager/NodeRunner既有自测入口
关联test:task-dependencies → 106/106
Android :app:testDebugUnitTest → 285项，0失败/0错误/1既有归档环境跳过；新任务11项通过
JS入口语法与文档链接/代码围栏/git diff --check → 通过
显示端20次重载与Puppeteer执行 → VM夹具；未替代真实浏览器与设备验收
正式签名包/部署/真机迁移/网络字节和视觉 → 未执行，保留待办
```
