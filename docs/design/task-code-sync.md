# 独立任务代码 ZIP 同步机制

状态：2026-10-15 用户确认执行，源码已接入独立 ZIP、原生完整组合、任务 catalog 和显示端释放，已通过定向验证；尚未签名出包、发布或迁移真机。本文替代上一版“任务代码嵌入服务 ZIP”的建议。

## 需求与现状

目标是让已有 Offline 设备能独立更新任务代码，例如 `render-display` 的 JS/HTML；服务与依赖要求仍满足时，只修改任务代码不需要重新下载或递增服务包、依赖包。用户补充任务代码也可能要求特定依赖版本，该要求纳入签名兼容契约。

现有服务包只收录 `src/`、`package.json`、`package-lock.json`。任务代码来自设备数据根目录 `res/tasks`，该目录会在升级时保留。现有 min APK 更新器只支持既有组件，不会下载或安装独立任务代码包；首装 `nodeMinSeeds` 也不能作为已有设备的代码更新入口。

之前只读核对发现：设备 `render.js` 与仓库 `release/task/render-display/render.js` 同为旧摘要 `c1412c6a…bebadb`，最新 `res/tasks/render-display/render.js` 则为 `d8e5ed4d…6473f9`。发布代码应统一取自 `res/tasks`，避免首装种子中的旧副本继续参与代码更新。

## 独立组件与目录

| 项目 | 约定 |
|---|---|
| 网络组件名 | 现有签名服务清单中的可选 `components.taskCode` |
| 独立产物 | `task-code/task-code-v<N>.zip` |
| 独立版本 | 正整数 taskCodeVersion，内容变化时递增，不跟随 codeVersion |
| 设备安装目录 | `files/aasc-server/updates/task-code/task-code-v<N>/` |
| 包内结构 | `task-code-manifest.json` 与 `tasks/<taskName>/<代码文件>` |
| 生效指针 | 扩展现有 active-release，保存 code/dependencies/taskCode 的完整组合 |
| 数据目录 | 保持 TaskIO.tasksDir 的现有解析，通常为 `res/tasks/<taskName>/` |

任务包与服务包使用不同 ZIP。继续使用同一个签名更新清单作为权威发布入口，使客户端能够校验各包及其兼容关系。首期不另建独立任务 manifest 网络入口。

```text
res/tasks 的明确代码清单
  → task-code-vN.zip（独立构建、版本、下载和复用）
  → 签名 manifest.components.taskCode
  → 更新器仅下载变化组件
  → 校验并解压到 updates/task-code/task-code-vN
  → 原子切换 code/dependencies/taskCode 组合
  → 重启服务，按该组合恢复任务并下发显示端

res/tasks 中的配置、实例、results 和业务数据
  → 继续使用原数据目录
```

首次接入需要更新原生更新器和服务端读取逻辑。后续任务代码变化且当前组合满足兼容要求时，仅生成和下载任务 ZIP；依赖要求变化时计算必要的联合更新。首期通过现有受管服务重启生效，不增加进程内在线替换机制。

## 只同步任务代码

| 内容 | 选择规则 |
|---|---|
| 唯一代码来源 | 仓库 `res/tasks` |
| 文件选择 | `release/task-code-files.json`，明确列出任务名、相对文件名和依赖要求 |
| 支持后缀 | .js、.cjs、.mjs、.html、.css；不因此增加新执行引擎 |
| 首批任务 | render-display、win-monitor、test-echo、webgpu-render |
| 首批六文件 | render-display 的 task.js/render.js/render.html；其余各自的 task.js |
| 辅助代码 | 可明确列出子目录代码，保留相对路径 |
| 排除 | config.json、参数值、results、日志、latest、任务链、模型、媒体、输入输出、依赖、测试和 .src |

`task.js` 中的任务描述和参数定义属于代码；设备已经保存的参数值不受同步影响。`render.smoke.js` 属于自测，不入任务运行包。`release/task` 仍为首次安装种子，不作为任务 ZIP 的代码来源。

当前首批六个源码文件合计 **31,019 字节，约 30.3 KiB**。隔离暂存树的未签名样包实测 ZIP **13,119 字节，约 12.8 KiB**，不是正式发布制品；正式大小与SHA以出包机签名清单为准。每个任务 ZIP 是完整的受管代码快照，不做逐字节差分；本地已有同版本同摘要的包直接复用。

## 清单和兼容契约

外层沿用已有签名 payload/schemaVersion，新增可选 taskCode 组件；不改 code ZIP 白名单，也不把任务文件伪装成 code 组件。

```text
components.taskCode:
  version、relativeUrl、size、sha256、source、bundleSha256
  taskCodeApiVersion
  requiredCodeVersion（必须，最小服务代码包版本）
  maximumCodeVersion（可选，服务代码包版本上界）
  requiredApkVersionCode
  requiredDependencyVersion、requiredLockSha256（可选，必须成对声明）

components.code:
  既有字段
  taskCodeApiVersion（支持任务包的服务声明其读取契约版本）

task-code-manifest.json:
  format = aasc-task-code
  schemaVersion = 1
  version = 外层 taskCode.version
  taskCodeApiVersion、requiredCodeVersion、maximumCodeVersion、requiredApkVersionCode
  requiredDependencyVersion、requiredLockSha256（与外层一致）
  tasks = 每个任务的 revision、codeRequirement、dependencyRequirement 与逐文件 path/size/sha256
  retiredTaskNames = 显式停止提供代码的任务名称
  bundleSha256 = 兼容约束、任务记录和退役集合的稳定内容摘要
```

外层 ZIP 大小与 SHA-256 受现有 RSA 签名约束；包内字段必须与外层一致。内部摘要用于文件校验、内容复用和任务 revision，不另建签名体系。版本重用比较内容及兼容约束，不能只看文件名或更新时间；修改兼容约束也需要新版本。

候选组合同时满足：APK 达到最低版本，code 达到 requiredCodeVersion 且不超过可选上界，服务 taskCodeApiVersion 与任务包声明一致，依赖满足下节的版本和锁指纹约束。任务包可兼容多个已声明兼容的服务代码包版本，不要求两者版本号相等；服务代码包是任务包的必需依赖。

不兼容时不尝试执行，不静默回退设备旧代码。更新器若能从同一签名清单组成兼容候选，可提示联合更新；需要新 APK 时先提示安装支持版。本轮配置支持版 min v58，首批任务要求 code≥96、任务API=1；win-monitor额外固定 dependencies v10 与当前锁摘要。这些是待构建基线，正式发布前仍应核对目标最新清单；版本已被占用时调整配置与任务约束后重建。

任务名采用安全名称规则；文件拒绝绝对路径、越界、反斜杠、重复、大小写折叠冲突、链接和特殊文件。单文件上限 2 MiB，累计 1024 个代码文件/32 MiB，ZIP目录与文件合计4096项、包内清单1MiB、名称分段128字符；构建、解压和启动均按同一限额校验。ZIP 仅允许 task-code-manifest.json、tasks 及其受管文件目录，不能夹带配置、results 或执行更新脚本。

## 任务包对代码包的依赖

这里的“代码包”明确指服务代码产物 code/code-vN.zip，版本来自签名 components.code.version，不是 APK versionCode，也不是 package.json 的应用版本。任务包通过该服务提供的任务加载、执行、路由和上下文 API 运行，因此必须声明服务代码包依赖。

```text
taskCode → code：requiredCodeVersion / maximumCodeVersion / taskCodeApiVersion
taskCode → dependencies：可选的精确依赖版本与锁指纹
code → dependencies：现有精确依赖版本与锁指纹
```

每个受管任务在选择清单中声明 codeRequirement={minimumVersion, maximumVersion, taskCodeApiVersion}。构建器按最大下界、最小有效上界求所有任务兼容区间的交集，API 版本必须一致；交集为空或 API 冲突时构建失败，指出冲突任务。包级 requiredCodeVersion/maximumCodeVersion/taskCodeApiVersion 由该结果生成，与包内清单一致。任务 revision 和 bundleSha256 都包含代码包依赖声明，仅改声明也需要新的任务版本。

需要精确依赖单个服务版本时，将上下界设为同一版本。省略上界表示发布方明确承诺在相同任务 API 契约下向后兼容；不能仅因代码包版本较大就默认兼容。没有该保证时填写经确认的上界，并以相应服务版本验证任务。

更新计划首先选择符合任务声明的 code，再检查该 code 绑定的 dependencies 与任务额外依赖约束是否同时满足。所选代码包仍须通过签名清单中的大小/SHA-256 验证，实际版本/目录/任务 API 与启动组合相符；不能只相信任务提交端传来的版本。

示例：T2 要求服务 code≥96、API=1，当前为 code95/deps10。即使 deps10 已满足任务要求，也需要下载并切换到满足条件的服务代码包；若候选 code96 仍绑定 deps10，可复用依赖，否则补齐与其匹配的依赖组。所有组件准备并校验完成后再原子切换，不逐个启用半成品组合。

code-only 发布也必须验证被沿用的任务包是否允许新代码版本与 API；不兼容时需要同步准备新的任务包，不能只校验服务自身的生产依赖。安装缺少兼容代码包时保持原完整组合，并明确提示所需代码版本。

## 任务包对依赖包的版本要求

首期复用现有精确绑定规则：任务需要基础生产依赖时，声明 `requiredDependencyVersion` 与 `requiredLockSha256`，对应签名 components.dependencies.version 与 lockSha256。依赖包版本是发布组合版本，不是 npm 包语义版本；不能仅凭版本更大推断兼容，也不能把 common/android 单组版本当组合版本。

每个任务在选择清单中另明确给出 dependencyRequirement={version, lockSha256}，或 null 表示不额外约束基础生产依赖。未确认的要求不能自动推断为兼容所有版本。构建器聚合各任务声明：有约束的任务必须指向同一版本/锁指纹，生成包级 requiredDependencyVersion/requiredLockSha256；全部无约束时包级两字段同时省略。两个任务要求不同基线则报错并指出任务名，不自动选较大的版本。任务 revision 包含其代码包及生产依赖声明，聚合结果纳入包摘要，包内外字段须一致。

“不额外约束”只表示任务没有新增生产依赖要求，服务对依赖的现有约束仍然生效。候选组合必须同时满足：

```text
code.requiredDependencyVersion == dependencies.version
code.requiredLockSha256 == dependencies.lockSha256
任务包声明依赖要求时：
  taskCode.requiredDependencyVersion == dependencies.version
  taskCode.requiredLockSha256 == dependencies.lockSha256
实际服务 package-lock 摘要 == dependencies.lockSha256
实际依赖组身份、平台、Node ABI/N-API 通过既有验证
```

依赖已满足全部要求且目录校验正常时，可只更新任务 ZIP；不满足时从同一签名清单选择匹配 dependencies，再检查 code 是否也需要更新。沿用现有分组复用，仅下载改变的组，并明确展示联合更新的组件。

示例：当前服务 C1 绑定 D10/H10，新任务 T2 要求 D11/H11。需要选择同样绑定 D11/H11 的服务 C2，再切换到 C2/D11/T2；C1/D11/T2 不合法。缺少兼容服务或依赖时，发布/安装明确失败，保持原活动组合，不能绕过锁校验或临时 npm install。

发布清单必须描述可兼容的 code/dependencies/taskCode。task-code-only 发布所沿用的服务/依赖不满足任务要求时，不能签发或切换不兼容清单，须准备兼容联合发布；任务 ZIP 本身仍可独立构建。仅修改依赖声明也需生成新任务版本。

现有 taskDependencies 是另行按任务准备的资源，例如 ORT，继续走现有签名资源和执行前准备机制，其版本不由基础生产依赖组合版本替代。任务 ZIP 只含代码和描述依赖的元数据，不包含 node_modules 或依赖二进制。

## 构建、发布与待出包状态

已扩展既有 npm 入口：

```text
npm run build:offline-update -- --mode=task-code-only --task-code-version <N>
npm run publish:offline-update -- --mode=task-code-only ...
npm run sync:offline-update -- ...（包含 taskCode 组件）
```

task-code-only 只构建任务 ZIP；沿用的 code/dependencies 满足新任务约束时，签发引用该 ZIP 的新服务 manifest，其余组件引用保持原值。不满足时提示准备联合发布，不发布不兼容清单。客户端仅在已安装组件满足要求时只下载任务 ZIP；落后或不兼容设备按变化集合补齐所需组件。

code-only 发布保留现有 taskCode 引用并检查兼容；联合发布先备齐所有新组件再切清单。重新发布前读取当前权威清单，若发布基线变化则重新计算并签名，不能用旧清单覆盖别人已发布的版本。

发布仍按“校验大小/摘要/签名与契约 → 上传版本文件 → 原子替换清单 → LAN/WAN 验证 → 精确清理”。publish/sync/共享清单校验器都必须认识 taskCode，避免漏传 ZIP 却发布引用。

release 状态文件已新增 `taskCodePackage`，AGENTS/rules 已同步项目发布规范：
- 首次接入更新器与服务解析：minApk、servicePackage 需要对应新产物；任务 ZIP 同时由 taskCodePackage 跟踪。
- 后续仅任务代码变化且无需改动服务或依赖：只标记 taskCodePackage；依赖集合或服务锁文件实际变化时，分别标记受影响的 dependenciesPackage/servicePackage。选用已经构建好的包不等于要求重建该包。
- 对应产物成功构建且覆盖最新源码后才能清除其状态。

本轮实际状态：minApk=true、servicePackage=true、taskCodePackage=true、dependenciesPackage=false；尚未正式出包，不能清除需求标记。

## 下载、生效与完整组合回滚

现有 active-release 保留其字段语义，已增加 `taskCodeVersion`、`taskCodeSha256`；previous 也保存完整组合。历史指针缺少这些字段表示尚未启用独立任务包，不应猜测“最新任务目录”。

更新计划由变化组件集合驱动，支持 task-code-only、code-only 和联合更新：
1. 读取并验签当前权威 manifest，先解析 taskCode→code→dependencies 以及 taskCode→dependencies 的约束，再比较版本/摘要并计算完整兼容候选。
2. 按现有受管更新的停止/启动时机执行，只下载候选中改变的组件；未变的任务、代码、依赖目录先校验再复用。
3. 所有候选包在独立暂存目录完成解压、类型/路径、元数据和摘要校验后，安装为不可变版本目录。
4. 候选目录全部就绪后一次原子写入完整 pending 组合；失败前不能留下“新任务指针+旧不兼容服务”的活动状态。
5. NodeServerService 一次读取启动组合，将任务目录、版本及摘要作为同一启动上下文传入 Node；旧进程和新进程各使用自己的快照。
6. 服务健康同时核对 code/dependencies/taskCode 的实际版本、已验证的包身份、路径、服务任务 API、依赖锁指纹、平台契约与 catalog 状态，成功才提交；失败恢复包含依赖版本/锁指纹/组身份的完整 previous 组合并重启。
7. 没有任务包的历史组合走原目录；有 taskCode 指针却包缺失、损坏或不兼容时必须失败，不回退旧目录掩盖问题。

当前服务和依赖满足要求时的 task-code-only 更新仍重启本地服务，因此会有短暂重连；下载内容只有变化任务 ZIP，不重新下载约 17 MB 的服务包。依赖要求不满足时改为明确的联合更新计划。健康只证明目录/契约/摘要和运行身份一致，任务视觉与业务功能需单独验收。显示端离线不导致本地候选永远不能健康。

设备清理保留 active/pending/previous 引用的任务目录，健康提交后按现有回滚保留策略精确处理。发布端新增清理规则前，必须同步项目的精确清理规范；只允许在 task-code/ 中处理严格匹配 `task-code-v<数字>.zip` 的普通文件，保留清单引用，不跟随链接，不触碰任务数据。

## 读取代码与保留任务数据

TaskCodeCatalog 改为读取启动组合选定的 `updates/task-code/task-code-vN/`，不再读取 CODE_ROOT 内的任务快照。服务代码 CODE_ROOT 和任务代码 root 分别固定，不根据变化中的指针实时跳转。

| 读取目标 | 来源 |
|---|---|
| 清单管理的任务代码 | 活动组合选定的任务包版本目录 |
| 受管任务未列出的代码 | 不存在，不回退同名设备旧文件 |
| 配置、参数、实例、results、refs、业务输入输出 | 原 TaskIO 数据目录与访问规则 |
| 清单外的自定义任务 | 原有目录读取行为 |
| src 中既有 builtin 实现 | 原 builtin registry，不额外复制到任务包 |
| 显式退役任务 | 不再提供代码，保留数据并报告 TASK_CODE_RETIRED |

`TaskIO._taskPath()` 保持为数据位置，代码解析使用独立入口。任务列表是本地任务与 catalog 任务的并集，新任务没有实例时只列出，不自动运行。执行入口、元数据、文件列表、HTTP、恢复和重发必须统一读取有效代码，不能让旧 payload.files 绕过当前任务包。

Node 服务和子进程从任务代码目录加载入口及相对模块，cwd/context.workDir/结果仍使用原任务数据目录。发布任务不得依靠 __dirname 写入代码目录；相对非代码数据通过既有 context/refs/files 读取。

既有 /res/tasks URL 继续可用：受管代码由 catalog 响应并使用 Cache-Control: no-store；受管代码不存在时终止为 404，不能继续落到旧静态回退。数据请求仍走原有流程。

受管代码只读，已有同名本地代码保留但不运行；需要自定义时使用新任务名。上传代码、编辑、代码删除和受管整任务删除须在停止/创建实例或写文件前返回明确错误；参数、配置、停止/运行和实例操作继续使用原流程。该策略已获用户执行确认并接入前置校验。

移除单个代码文件后，旧目录残留不能补回；移除整个任务时显式登记 retiredTaskNames 并保留退役记录，防止其被误判为用户任务。退役实例按原任务错误状态报告，不删除历史。

## 显示端和首次迁移

恢复原有运行实例，保持 taskName/instanceId/params/任务链。沿用 task:execute 下发最新有效代码，附带 taskCodeVersion/revision。相同实例替换前完整释放旧定时器、监听器、DOM 和回调；重复恢复不积累资源，离线显示端在重连时接收当前代码。

建议分阶段迁移：
1. 发布支持独立 taskCode 的 min APK，以及兼容“无任务包指针”的桥接服务代码；此阶段仍能使用原任务目录。
2. 设备安装支持版 min 并加载支持任务包的服务。现有 min56 不能仅靠服务热更获得原生独立组件支持。
3. 发布首个独立任务 ZIP。新版客户端识别后按兼容候选应用；可单独更新任务，也可与所需服务更新合并为一次组合切换。

也可同批上传支持版 min、桥接服务和任务包，但客户端必须满足以上先决条件。旧客户端可能忽略未知可选组件，不能把它看到新清单等同于任务代码已同步；桥接服务在原生未提供任务上下文时维持旧路径。

首期面向 Offline APK。共享清单/发布/镜像需要兼容 taskCode；其他 Node/Termux 客户端暂按原流程，独立任务包自动应用另行接入，不因共享清单增加可选字段改变其代码路径。

## 实现文件

- release/task-code-files.json、scripts/ops/task-code-package.js：选择、ZIP 和包内清单。
- scripts/ops/offline-update-package.js、publish-offline-update.js、sync-offline-update.js：新构建/发布模式、taskCode 组件、复制和精确清理。
- 共享 manifest 校验、版本诊断、release 状态及项目发布规范：组件/兼容约束、独立产物标记。
- Android OfflineTaskCode.kt、OfflineReleaseState.kt、OfflineUpdateManifest.kt、OfflineUpdateManager.kt、OfflineBootstrapManager.kt、NodeServerService.kt：解析、首装、新组件校验/下载、组合指针、启动上下文、健康和回滚。
- 任务 catalog、TaskIO/TaskManager/WS handler、执行器、server-app 和 display.html：统一代码路径、数据工作目录及显示端释放。
- 对应打包/原生/任务/显示端用例和 design/spec/task/todo/changelog。

## 验收与评审

核心验收包含两种情况：已有 C1/D1 满足新任务 T2 要求时，只下载并切换 T1→T2；不满足时选择兼容 C2/D2/T2 联合更新，无兼容候选则保持 C1/D1/T1。render-display 有效摘要等于发布源，参数与历史仍可使用。失败时回到含依赖锁与组身份的完整 C1/D1/T1，不能保留新依赖而只回滚任务代码。

必须覆盖任务 ZIP 缺失/损坏/越界/伪造摘要、代码或 APK 不兼容、任务包相同内容复用、兼容时仅任务更新不下载 code/deps、任务要求的代码包过旧/超出上界/API 不符、逐任务代码兼容区间无交集、依赖同版本异锁/高版本不兼容/约束缺半对/多任务冲突、依赖要求变化产生新任务版本、联合更新与完整回滚、旧客户端忽略可选组件、首装和旧指针、任务移除、同名代码优先级、显示端重复恢复和精确清理。隔离 fixture 无业务写入时比较配置/results/日志/输入前后摘要；实机正常业务写入不能误报为覆盖。

需求等级仍为 L6 模块与 L5 流程，采用 analyze-requirement-level enterprise：层级 24/25、证据 19/20、完备 18/20、风险 19/20、L4 14/15，共 94/100。证据为“任务同步机制”“只同步任务代码文件”“单独的 zip 文件”“先设计”“可能需要依赖包的版本”“任务包也需要依赖代码包”六项 L6 强证据，加既有更新/回滚流程一项 L5 中证据；置信度 (18/20)×0.90=0.81。结论为可进入实施评审，风险中，必须下放到 L4；本轮配置支持版min58、首批服务下界96，正式发布前核对占用情况。

关键断点已在方案中处理：独立包由原生识别、任务对代码包及依赖包的声明共同参与候选选择、三组件作为完整组合回滚、taskCode 独立待出包状态及清理规则需同步扩展。L4 的已有声明/新增定义/操作流程见 [伪代码](../spec/task-code-sync.md)。用户在完成设计评审后已明确“执行”；实施前已补齐 .src/framework/task-code-sync.md 与 .src/hal/android-task-code-sync.md 的流程描述。


## 2026-10-15 实施验证与交付边界

- 已实现独立构建/签名、联合任务版本、完整候选校验、发布基线核对、镜像和精确清理。沿用任务组件的新服务更新也必须满足原任务版本区间/API和依赖约束。
- Android加入任务组件解析、任务专用下载预算、目录复用、首装、完整指针、固定启动上下文、健康身份与完整回滚；任务版本会在原生更新提示中显示。
- TaskIO/catalog统一列表、元数据、HTTP、执行入口和重发；Node/Puppeteer入口与数据工作目录分离。受管写入在实例变化前拒绝，显示端20次恢复不积累计时器/监听/DOM。
- 隔离样包：4任务/6源码文件31,019字节，按构建器`zip -X`参数压缩13,119字节；内容指纹7694a72c8df7f1fd3a4c4f5651ccceed1f7b01e4c312a8223629c77992030bdc。样包已清理，未提交ZIP。
- 定向验证、原生结果和命令见对应spec/task/self-test；真机首次迁移、仅任务网络流量、重连耗时及render-display视觉仍需支持版制品后验收。
- 本轮不构建正式签名资源、不发布LAN/WAN、不重启主服务或改设备。Git只同步源码/规则/状态/文档；minApk、servicePackage、taskCodePackage保持true，dependenciesPackage保持false。
