# Offline 通用数据修复包实现规格（伪代码）

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
    delete only old data/data-repair-v<digits>.zip files not referenced by manifest
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
