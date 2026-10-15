# Offline 通用数据修复包实现规格（伪代码）

## Qwen API 累计修复 v4（2026-10-15，已出包未发布）

```text
已有声明 := 签名repair事务 + readVersion + config公开TTS读取/保存 + 官方3.1目录 + v3阶段迁移
新增定义 := repair4 { compatibleDataVersions: [0,1,2,3], targetDataVersion: 4 }
新增定义 := legacyQwen { model: qwen3-tts-flash, voices: [Cherry, Serena, Ethan, Chelsie] }
新增定义 := targetQwen { model: qwen-audio-3.1-tts-flash, voice: qiaoxiaojiao_v3.1 }
操作流程 := 扩充config能力白名单 → 仅公开脱敏TTS读取与现有TTS保存
实际数据版本 → 按缺失阶段执行既有v3累计规则 → 不重复应用已完成的偏好阶段
公开TTS配置 → 判定旧模型或3.1残留旧音色 → 未知自定义组合整体跳过
旧默认模型/音色 → 生成最小Provider补丁；3.1有效音色保持
三个业务选择 → 仅qwen-api且已知旧显式音色替换为乔小娇 → 其他选择保持
候选补丁非空 → 业务保存 → 重读校验；凭证/语速/音量/其他Provider保持
业务保存读取用户配置已存Qwen语速 → 旧模型规范化结果隐藏语速时补回previous输入 → 新补丁显式语速仍优先
种子worker → config与userconfig纳入快照 → 隔离运行同一repair → 配置与基线4一起提交
失败 → 恢复快照和业务内存 → 不写成功状态
成功 → repairId及版本记录 → 再次执行跳过
构建 := 配套新服务代码包 + data-repair-v4.zip + 新首装种子ZIP + 保留其他组件的签名清单
实现验证 := npm数据修复71项通过；迁移与配置36项通过；双端快选22项通过（部分重叠）
构建结果 := code104 + repair4 + seeds104数据4；13项本地完整大小/SHA与签名通过，584代码文件逐字节一致
后续发布 := 先code-only使用manifest-code-v104，再data-repair使用manifest-data-repair-v4；当前未执行
发布 := 本阶段未授权；不提前切换LAN/WAN清单
```

## 累计v3物理映射与发布组合（2026-10-14）

```text
已有 := release/config + release/userconfig + repair真实事务 + 内置运行时默认视图
readVersion.dataVersion ∈ {0,1,2} → 只补缺失历史配置阶段
services.chat2api.listModelMappings(includeDefaults=false) → 原始保存项
十条公开规则逐项匹配精确/单通配 → 未覆盖则saveModelMapping → 重新读取并断言全覆盖
隔离seed-worker → restoreLegacyAccounts=false → 不写账号、不读开发机旧账号
真实执行成功 → 基线3/脚本摘要/配置摘要 → repair3与种子同一事务提交
min47签名/大小/SHA/profile/模型指纹验证 → 各镜像保留各自旧组件并先发布min
code85 + 四组已存在deps9 + seeds85 → 沿用原归档 → 两端上传与清单原子替换
初稿repair元数据 + 验证后的服务/min组件 → releaseSeedVersion=85且种子真实dataVersion=3 → 最终重新签名
repair3最低code85/APK46/兼容0,1,2 → 两端发布 → 所有组件全部HTTP字节核验
旧full46/v1/v2不可变归档 → 不覆盖；旧data与seeds不清理
清理白名单 → 仅code/dependencies/min及明确full版本；恢复本任务已删的旧镜像seed69/79 → 大小/SHA一致
设备确认执行及登录验收另计
```


## release 基线与修复结果实际流程（2026-10-14，源码完成）

```text
已有声明 := repair.js + createDataRepairRunner + config/chat2api业务服务 + 签名dataRepair组件
已有种子 := release/config + release/userconfig + release/task
新增基线 := release/config/data-repair-state.json { dataVersion, latestRepairVersion, includedRepairs }
新增结果 := 私有data-repair/last-result.json { repairId, repairVersion, actualVersion, requiredVersion, targetVersion, status }

现有v1/v2 → 验签归档清单 + 原脚本SHA → 隔离按0/1/2执行 → release基线2，includedRepairs记录真实种子包含
新增修复包 → 校验已发布签名/递增修复版本/合法数据前置版本
读取release基线 → 隔离复制配置 → 使用相同脚本与业务服务完成真实修复
修复成功 + 配置校验 + 源文件未并发变化 → 配置/数据版本/归档/签名元数据一起提交
提交 → 保存私有撤销日志 → 写配置/基线/修复ZIP/对应nodeMinSeeds/签名清单 → 删除撤销日志
任何失败 → 恢复原release配置和版本；中断后相同输出目录重试恢复；不得先抬版本再执行脚本

完整APK打包 → 携带release业务配置与基线
nodeMinSeeds打包 → 携带相同基线；独立min仍只内置动态库/bootstrap资产
真正全新配置初始化 → 完成配置与用户配置恢复 → 初始化私有数据状态
覆盖安装/已有配置 → 保留原数据版本和成功记录；只更新代码不提升数据版本
初始化中断 → 恢复同一初始化事务，不能误把旧用户配置认成新版种子

旧修复无compatibleDataVersions → actualVersion必须等于requiredDataVersion
新累计修复声明compatibleDataVersions → actualVersion必须属于已签名明确集合
缺前序记录设备 → 实际补齐对应配置效果 → 校验后记录新目标版本
未知版本/损坏state → 拒绝；不把坏状态规范化为0
较旧包 → 仅凭真实成功/包含记录与数据版本、摘要证明跳过；不凭空抬版本或伪造旧repairId已运行

Node启动前修复 → 记录真实执行结果
Native健康成功 → 单独提交健康服务代码
预期修复结果/身份吻合且有成功或首装包含证明 → 修复满足
拒绝/回滚 → 报告实际与要求版本；相同自动失败指纹去重
手动重试/数据或清单变化 → 允许重新检查
```

已实现构建器、隔离业务worker、签名已有修复同步器、基线验证、Runtime/种子初始化、Node真实结果与原生健康通知；具体测试和范围见`../task/20261014_数据修复同步Release基线与版本.md`。既有严格单版本签名格式继续兼容；新的多版本声明需匹配支持版本的APK/服务端。

修复包的业务内容使用 `repair.js`，不使用 `repair.json` 或 JSON payload。现有 Offline `manifest.json` 继续承担版本、下载地址和 hash 元数据；服务内部状态文件仍可使用现有 JSON 格式。

## 数据结构

```text
DataRepairComponent:
    version
    repairId
    requiredCodeVersion
    requiredApkVersionCode?
    requiredDataVersion
    targetDataVersion
    relativeUrl
    size
    sha256
    scriptSha256
    capabilities[]
    releaseNotes?

RepairBundle:
    format = 'aasc-offline-data-repair'
    schemaVersion = 1
    repairId
    repairVersion
    requiredCodeVersion
    requiredApkVersionCode?
    requiredDataVersion
    targetDataVersion
    script = 'repair.js'
    capabilities[]

RepairContext:
    services
    readVersion()
    assert(condition, message)
    log(event, details)

RepairTransaction:
    begin()
    wrap(service)
    commit()
    rollback()

DataRepairState:
    dataVersion
    latestRepairVersion
    appliedRepairs[]
```

## 逻辑路径解析

```text
resolveLogicalPath(logicalPath, runtimeRoot):
    require logicalPath 使用允许的逻辑根
    reject 空路径、绝对路径、反斜杠、'.'、'..'
    reject logs、models、results、src、node_modules、updates、certs 等保留目录
    map server-config → runtimeRoot/config
    map user-config → runtimeRoot/home/.config/aasc-user
    map task-config → runtimeRoot/res/tasks
    resolve targetPath
    require targetPath 位于对应允许根目录
    return targetPath

修复脚本不能调用 resolveLogicalPath。该函数只供服务注册表、事务备份和审计使用。
```

## 清单解析

```text
parseOfflineManifest(raw):
    verify RSA signature over canonical payload
    validate code, dependencies and optional apkMin as before
    if components.dataRepair exists:
        validate positive repair version
        validate repairId and required versions
        validate safe relativeUrl
        validate size and SHA-256
    return signed manifest
```

## 修复包校验

```text
inspectRepairBundle(archive):
    reject absolute paths, '..', symlink and special ZIP entries
    require repair.js at ZIP root
    read RepairBundle metadata from signed Offline manifest
    require format, schemaVersion and repair.js hash supported
    require declared capabilities belong to service whitelist
    require expanded size below limits
    reject extra scripts, symlinks and special ZIP entries
    return validated bundle
```

## 版本门控

```text
planRepair(installedCodeVersion, installedApkVersionCode, state, bundle):
    if bundle.repairId already in state.appliedRepairs:
        return skipped(reason = 'already-applied')
    if installedCodeVersion < bundle.requiredCodeVersion:
        return pending(reason = 'code-version-too-old')
    if bundle.requiredApkVersionCode exists and installedApkVersionCode < it:
        return pending(reason = 'apk-version-too-old')
    if state.dataVersion != bundle.requiredDataVersion:
        return rejected(reason = 'data-version-mismatch')
    if bundle.repairVersion <= state.latestRepairVersion and bundle is not independent snapshot:
        return skipped(reason = 'old-repair-version')
    return applicable
```

`requiredDataVersion` 只约束修复包，不添加到控制端普通配置请求。

修复执行语义：

```text
same device + same repairId + applied successfully => skip subsequent execution
execution failed or rolled back => do not mark applied, allow retry
different device => maintain independent applied state
```

## 原有业务类操作

```text
createRepairContext(runtime, transaction):
    services.config = transaction.wrap(runtime.configService)
    services.chat2api = transaction.wrap(runtime.chat2apiManagementService)
    services.userConfig = transaction.wrap(runtime.userConfigService)
    expose only registered methods
    hide require, import, process, fs, path, child_process and network clients
    return { services, assert, readVersion, log }

callOriginalService(script, context):
    load signed repair.js in restricted execution context
    require exported entry function
    await entry(context)
    reject direct filesystem or unregistered service access
```

## 运行时自动保存

```text
applyRuntimeConfigChange(command):
    acquire runtime data write lock
    service = serviceRegistry.resolve(command.service)
    call service's original class method with normalized input
    persist through RuntimeDataManager transaction
    reload affected runtime module
    broadcast authoritative normalized value
    release lock
    return saved result and hash
```

控制端不发送 `requiredDataVersion`，服务端不拒绝旧控制端请求；写入锁只负责同一进程内的保存顺序。

## 修复事务

```text
applyRepair(runtimeRoot, bundle, state):
    acquire repair lock
    plan = planRepair(currentCode, currentApk, state, bundle)
    if plan is not applicable:
        release lock
        return plan

    transaction = createRuntimeDataTransaction(runtimeRoot)
    context = createRepairContext(runtime, transaction)
    backups = transaction.snapshotRegisteredServices(bundle.capabilities)
    try:
        run signed repair.js with context
        validate all service results and sensitive policy
        transaction.commit()
        reload affected runtime modules
        write state with targetDataVersion and applied repair record
        write completed marker
        return applied
    catch error:
        transaction.rollback(backups)
        restore previous state
        write rollback result
        return failed
    finally:
        remove temporary files
        release repair lock
```

## Offline Android 协作

```text
checkForOfflineUpdates:
    fetch LAN manifest, fallback WAN
    verify signed manifest
    plan service code/dependencies update
    plan optional dataRepair update
    return foreground update card data

applyConfirmedRepair:
    stop Node service
    download dataRepair to staging
    verify size and SHA-256
    write pending-repair marker
    start Node service
    server launcher applies pending repair before listening
    health check local service
    if healthy:
        clear pending marker
        report applied
    else:
        repair runner restores backup
        report failed and keep previous data
```

## 构建和发布

```text
buildOfflineDataRepair(repairFile, currentManifest):
    read and validate RepairBundle metadata from signed manifest
    require repairVersion greater than published dataRepair version
    require current manifest code/dependencies are valid
    create data/data-repair-v<repairVersion>.zip containing repair.js
    calculate size and SHA-256
    add optional dataRepair component to current payload with script hash and capabilities
    sign complete payload
    verify signature and all component hashes
    write versioned manifest

publishOfflineDataRepair(manifest, artifactRoot, localRoot, remoteRoot):
    verify local artifact against signed manifest
    upload data repair artifact to LAN and WAN version path
    verify HTTP response and remote hash
    atomically replace manifest.json last
    keep historical data repair and seed archives; project cleanup permits only code/dependencies/min/full numeric version files
```

## 状态和错误

```text
dataRepairStatus:
    available
    waitingCodeVersion
    waitingApkVersion
    downloading
    verifying
    applying
    applied
    skipped
    rejected
    rolledBack
    failed
```

状态只记录 repairId、版本、服务能力、变更数量、hash、时间和错误码，不记录敏感配置内容。

## 当前代码对应的实现伪代码

```text
createDataRepairRunner(options):
    projectRoot = options.projectRoot
    services = options.services
    managedFiles = options.managedFiles
    codeVersion = options.codeVersion or runtime version pointer
    apkVersionCode = options.apkVersionCode or environment value
    create process-local operation queue

applyPendingRepair():
    read projectRoot/data-repair/pending-repair.json
    if not found:
        return not-found
    validate format, schema, repairId, versions, script path, scriptSha256 and capabilities
    read and normalize projectRoot/data-repair/state.json
    if repairId already applied:
        remove pending marker
        return skipped
    if code/APK/data version gate is not satisfied:
        keep pending marker
        return waiting or rejected
    read only signed repair.js and verify scriptSha256
    snapshot managedFiles and state.json
    expose only registered methods from options.services
    execute repair.js in vm context with code generation, require, process and network disabled
    if execution and state write succeed:
        write target dataVersion and appliedRepairs atomically
        remove pending marker
        return applied
    else:
        restore managedFiles and state snapshot
        keep pending marker for retry
        return rolled-back
```

```text
createDataRepairArtifacts(options):
    load current signed Offline manifest
    require dataRepairFile is ordinary repair.js and <= 512 KiB
    require repairVersion greater than existing dataRepair version
    zip only repair.js as data/data-repair-v<repairVersion>.zip
    calculate archive sha256 and scriptSha256
    merge dataRepair metadata into existing signed payload
    sign and write versioned manifest
```

```text
Android apply server update:
    parse optional components.dataRepair
    if repair is not already applied:
        download dataRepair artifact
        verify archive size and sha256
        extract to updates/data-repair/data-repair-v<repairVersion>
        require exact file set { repair.js }
        write data-repair/pending-repair.json
    restart Node

Node server boot:
    before media/listen initialization:
        if pending marker exists:
            create temporary Chat2API runtime management service
            applyPendingRepair()
            stop temporary runtime
    then continue normal server listen
```

## APK成功误判与重复提示候选伪代码（2026-10-13，未实施）

```text
已定位现状 := 执行器rejected-data-version → 保留pending/不写成功state → 服务健康 → Native误发APPLIED → 再次提示同一修复
包契约 := 当前v2 requiredDataVersion=1、targetDataVersion=2；设备具体当前值待原生读取
候选完成条件 := 读取私有root/data-repair/state.json → appliedRepairs存在预期repairId → 才报告修复成功
候选拒绝条件 := 实际dataVersion与签名requiredDataVersion不一致 → 回报原因，保持真实数据及成功记录
候选去重 := 失败指纹repairId/repairVersion/实际数据版本不变 → 自动检查不重复弹同一失败；手动重试或指纹变化可再检查
候选状态 := 服务代码健康和数据修复应用结果分开；修复拒绝不回滚健康服务，也不冒充已应用
执行状态 := 只定位/设计，等待用户按AGENTS确认后修改Native与自测/重出min APK
```

首装拒绝链路伪代码（2026-10-13，现状说明）：

```text
state缺失 := normalizeState返回dataVersion0、空appliedRepairs
旧修复1 := requiredDataVersion0 → 开启voiceprint特定开关 → 成功记录dataVersion1
当前修复2 := requiredDataVersion1 → 隐藏offline-display状态栏 → 成功记录dataVersion2
full种子 := 未携带data-repair/state.json
更新源 := 当前只提供修复2；单修复清单不补跑修复1
未有修复1记录的首装 := dataVersion0 != 修复2要求1 → rejected-data-version
说明边界 := 当前设备具体数值没有直接读取；两脚本业务独立，首装兼容方案尚未实施
```

## 用户暂缓决定（2026-10-13）

用户明确“暂时先不处理”。只读定位与候选方案保留为待办；当前停止此问题的实施，不修改修复执行逻辑、成功记录、包元数据或APK，不运行修复、不构建或发布相关产物。后续由用户明确恢复后继续。
