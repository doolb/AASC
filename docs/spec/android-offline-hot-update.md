# Android Offline APK 热更新与原生增量 APK 实现规格（伪代码）

> 本规格记录 Android 更新目标和伪代码；服务更新包/发布器、min build profile、Android 运行时更新及独立更新密钥接入已实现。full v2/min v3 APK、code/dependencies v3 已完成构建，2026-09-17 修复后的 min v4（versionCode 4、`0.2.2-offline-min`）已正式发布到 LAN/WAN。两站点 manifest 字节一致且签名有效，LAN HTTP 整包 hash、WAN 远端文件 hash、HTTP HEAD 和首段响应校验通过；min v4 的 APK SHA-256 为 `be31e437ca17488fab20eefd1874be2a1b40689cac59f667873e761dd17b1027`。full v2 APK 另已上传到外网 `apk/aasc-display-offline-v2.apk`，远端大小和完整 hash 与本地一致；真机 full v2 fresh install 后已成功应用 code/dependencies v3，`active-release.json` 的 `pendingHealth=false`，服务接口、默认模型和 Chat Completions 已通过。2026-09-17 重新生成的 min v3 携带 `libaasc_node.so` 并原位安装成功，配置、任务目录和 LLM 模型缓存保留；发布器已支持双站点精确清理旧 code/dependencies/min/full 版本。固定 ID/Chat2API 完成按钮对应的 min v6（versionCode 6、`0.2.4-offline-min`）已正式发布到 LAN/WAN，包含 Offline 任务索引迁移逻辑；APK SHA-256 为 `0f7af47dbba366758ebbe818994da37f39028bd8174ba6b3dfa8754f33366b68`，两站点 manifest 字节一致、签名有效、HTTP APK 返回 200 且 Content-Length 正确。回滚、异常降级及 ASR/TTS 完整业务回归仍待验收。

## 清单与签名伪代码

```text
SignedManifest:
    payload.schemaVersion = 1
    payload.generatedAt = ISO-8601
    payload.components.code = {
        version, requiredDependencyVersion, requiredLockSha256,
        relativeUrl, size, sha256
    }
    payload.components.dependencies = {
        version, lockSha256, relativeUrl, size, sha256
    }
    payload.components.apkMin = optional {
        versionCode, versionName, packageName, signerSha256,
        modelCompatibilitySha256, relativeUrl, size, sha256
    }
    signature.algorithm = "SHA256withRSA"
    signature.value = Base64(sign(privateKey, canonicalJson(payload)))

canonicalJson(value):
    recursively sort object keys
    preserve array order and JSON scalar values
    encode UTF-8 without BOM or trailing newline
```

```text
loadOfflineUpdateKeyPair(options):
    privatePath = options.privateKeyPath
        or AASC_OFFLINE_UPDATE_PRIVATE_KEY
        or ~/.config/aasc-user/offline-update-private.pem
    publicPath = options.publicKeyPath
        or AASC_OFFLINE_UPDATE_PUBLIC_KEY
        or ~/.config/aasc-user/offline-update-public.pem
    require both files are regular files and not symbolic links
    require private key permissions allow only current user to read
    parse both PEM files; require RSA keys and a matching public/private pair
    return privateKeyPem, publicKeyPem

prepareOfflineApk(profile):
    if profile.offline:
        keyPair = loadOfflineUpdateKeyPair()
        pass keyPair.publicKeyPem to Android Runtime asset staging
        never copy keyPair.privateKeyPem to APK assets or Runtime
```

依赖归档在 ZIP 前移除 npm 生成的每层 `node_modules/.bin` 工具软链接目录；其他依赖符号链接和特殊文件均拒绝。发布器先校验本地归档，代码-only 还要求目标已有 hash 匹配的依赖包；版本化归档先安装，清单最后用临时文件原子替换。HTTP 复验流式计算清单内组件的 SHA-256；完整 APK 使用远端 hash/HTTP HEAD 校验，不写入服务更新清单。远端清理脚本通过 `/bin/sh -c` 执行，清理参数使用固定字符集，避免 fish 登录 shell 改变参数含义。

## 服务更新构建伪代码

```text
buildOfflineUpdate(mode):
    require mode in {"code-only", "all"}
    codeSnapshot = copy full project/src excluding src/apps/android-display
    add project/package.json and package-lock.json to code snapshot
    codeVersion = configured monotonic release identifier
    lockSha256 = SHA256(package-lock.json)

    if mode == "code-only":
        deployedManifest = fetchAndVerifyCurrentManifest(LAN, then WAN)
        deployedDependencies = deployedManifest.payload.components.dependencies
        require lockSha256 == deployedDependencies.lockSha256
        require dependency declarations match deployedDependencies.lockSha256
        create code archive only; do not run npm ci; do not create dependencies archive
        nextManifest = deployedManifest.payload with code entry replaced

    if mode == "all":
        dependencyVersion = configured monotonic dependency identifier
        dependencyStage = npm ci --omit=dev --ignore-scripts in clean Android package stage
        validate Android production dependency package
        create code archive and dependencies archive
        nextManifest = latest signed manifest with code and dependencies entries replaced

    keyPair = loadOfflineUpdateKeyPair()
    sign nextManifest using keyPair.privateKeyPem
    verify signature using keyPair.publicKeyPem
    workDirectory = mkdtemp(os.tmpdir())
    for each staged code/dependencies archive:
        outputTemp = unique temporary file beside the final output path
        copy staged archive to outputTemp
        atomically rename outputTemp to the versioned final path
        on failure, remove outputTemp
    manifestTemp = unique temporary file beside the final manifest path
    write signed manifest to manifestTemp
    atomically rename manifestTemp to manifest path last
    on manifest write/rename failure, remove manifestTemp
    return artifact paths, sizes and hashes
```

## APK profile 与 update-only Runtime 构建伪代码

```text
loadApkProfile(name):
    read release/apkbuild/<name>/app.json
    return profile.updateOnly, versionCode, versionName, features, models
    require allserver-min.updateOnly == true
    require allserver-min.models is empty

buildApk(profile):
    prepare Android MNN/JNI app libraries
    if profile.updateOnly:
        do not prepare/copy Android server package into Runtime assets
        copy only REQUIRED_RUNTIME_LIBRARIES into runtime/arm64-v8a/lib
        copy libaasc_node.so into Android jniLibs so an in-place APK update
        keeps the Node launcher executable available after replacing nativeLibraryDir
        write runtime-manifest.updateOnly = true with exact file allowlist
        pass profile.versionCode/versionName to Gradle
    else:
        prepare the existing full server package and runtime assets
```

`code-only` uses the existing signed deployment manifest as the authoritative dependency baseline. If no valid deployed dependency entry is available, lock fingerprints differ, or signing key is missing, stop before creating a publishable manifest.

## 发布伪代码

```text
CleanupPolicy:
    codePattern = code/code-v<digits>.zip
    dependencyPattern = dependencies/dependencies-v<digits>.zip
    minApkPattern = apk/aasc-display-offline-min-v<digits>.apk
    fullApkPattern = apk/aasc-display-offline-v<digits>.apk
    never match manifest.json, symlinks, directories, logs, models, config,
        tasks, results, temporary files or any other name

cleanupPublishedArtifacts(targetRoot, signedManifest, currentFullApk? ):
    keep code.relativeUrl from signedManifest
    keep dependencies.relativeUrl from signedManifest
    keep apkMin.relativeUrl when present
    if currentFullApk is provided: keep it
    full APK cleanup requires the current full APK path supplied by publishOfflineFullApk
    for each regular file directly below code/dependencies/apk:
        if exact CleanupPolicy pattern matches and file is not a keep path:
            unlink only that file
    do not follow or remove symlinks

cleanupRemotePublishedArtifacts(remoteRoot, signedManifest, currentFullApk?):
    execute the same exact-name and regular-file checks with /bin/sh -c
    if unlink fails: report a retryable cleanup error without changing manifest

aiOfflineExecutionRules:
    read repository CLAUDE.md and AGENTS.md before changing Offline packaging/publishing
    keep their Offline APK rules synchronized with this design and spec

publishOfflineUpdate(mode):
    verify every local artifact against signed manifest
    localRoot = /mnt/aasc-offline
    remoteRoot = as@120.79.245.103:~/a/aasc-offline
    for target in [localRoot, remoteRoot]:
        upload versioned code archive
        if mode == "all": upload versioned dependencies archive
        upload signed manifest to manifest.json.tmp-<publishId>
        atomically rename temporary manifest to manifest.json
        verify target manifest and component hashes
        cleanupPublishedArtifacts(target, manifest)

publishOfflineFullApk(apkPath, buildManifest):
    require buildManifest.profile == allserver and updateOnly != true
    read numeric versionCode from buildManifest
    targetRelativeUrl = apk/aasc-display-offline-v<versionCode>.apk
    validate apkPath as regular file and calculate size/SHA-256
    for target in [localRoot, remoteRoot]:
        upload targetRelativeUrl atomically without changing manifest.json
        verify remote/local file hash and HTTP HEAD content length
        cleanup exact fullApkPattern files except targetRelativeUrl

remoteCommand(host, posixScript):
    # 远端默认 shell 可能不是 POSIX shell（当前主机为 fish）
    execute ssh host /bin/sh -c shellQuote(posixScript)
    before the final rename, set the public manifest temporary file mode to 0644
    cleanup only exact old versioned artifacts after HTTP verification
    never overwrite the existing aasc-display-offline.apk symlink

publisherCli(argv):
    outputRoot = argv.outputDir or projectRoot/release/offline-update/output
    resolve outputRoot before validating local artifacts
    if mode == apk-full:
        invoke publishOfflineFullApk with --apk and --build-manifest
    else:
        invoke publishOfflineUpdate with outputRoot
```

The min APK publisher uploads a versioned APK to both targets, then replaces the signed manifest with an updated `apkMin` entry. A failed target remains on its prior signed manifest; a device still verifies every component before applying it.

## Android 清单读取与服务更新伪代码

```text
checkAndApplyServiceUpdate(root):
    if APK profile is not offline or is update-only:
        return NotApplicable
    manifest = fetch signed manifest from LAN with short timeout
    if LAN connection fails:
        manifest = fetch signed manifest from WAN with bounded timeout
    if neither source responds:
        return KeepInstalledRelease("offline")
    verify RSA signature with public key embedded in APK
    validate schema, versions, safe relative URLs and bounded sizes

    installed = read active-release.json or legacyRuntimeVersion
    if code version and dependency version are already active:
        return Unchanged

    if only code differs:
        if installed dependency version != code.requiredDependencyVersion:
            return KeepInstalledRelease("needs-all-update")
        download only code archive to staging
    else:
        require code.requiredDependencyVersion == manifest.dependencies.version
        download code and dependencies archives to staging

    require availableBytes >= downloadBytes + extractionBytes + rollbackReserve
    verify exact byte count and SHA-256 for each archive
    extract only regular files; reject absolute paths, traversal, symlinks and special entries
    verify source entrypoint, package metadata and dependency lock fingerprint
    create versioned dependency directory when dependencies changed
    create versioned code/dependency-pair release and local node_modules link
    write active-release.json.tmp and fsync
    atomically rename it to active-release.json
    retain previous active release until candidate passes startup health check
    on failure, restore prior active-release.json and start previous release
    on success, retain active and rollback release; prune only older unreferenced update dirs

normalizeZipEntryName(entryName):
    validate the raw safe ZIP path
    return entryName without one trailing "/"

isAllowedComponentEntry(component, normalizedEntryName):
    code allows the normalized root directory "src", package metadata,
    and paths below src except src/apps/android-display
    dependencies allows the normalized root directory "node_modules",
    dependency-manifest.json, and paths below node_modules
    reject every other normalized entry
```

```text
planServiceUpdate(installed, signedManifest):
    if target code/dependency versions are older than installed:
        return CURRENT  # never downgrade
    if target dependency version and lock hash equal installed:
        if target code version is newer: return CODE_ONLY
        if versions and lock hash are identical: return CURRENT
        return NEEDS_ALL
    if target dependency version and target code version are both newer:
        return ALL  # one active pointer switches both versions
    return NEEDS_ALL  # dependency-only or incompatible lock fingerprint is forbidden
```

```text
NodeServerService.startNodeProcess:
    root = NodeRuntimeInstaller.ensureInstalled()
    updateOnlyMode = OfflineUpdateManager.isUpdateOnlyApk()
    if updateOnlyMode:
        require root/.full-offline-installed marker
        NodeRuntimeInstaller.applyAllowlistedNativeRuntimeUpdateOnly()
    else:
        NodeRuntimeInstaller.ensureInstalled preserves root/updates as mutable update data
        OfflineUpdateManager.checkAndApplyServiceUpdate(root)

    release = read active-release.json
    if release is valid:
        entrypoint = root/updates/releases/<releaseId>/src/apps/server/boot/server-launcher.js
        nodeModules = root/updates/releases/<releaseId>/node_modules
    else:
        entrypoint = root/src/apps/server/boot/server-launcher.js
        nodeModules = root/node_modules
    ProcessBuilder(nodeBinary, entrypoint, "--no-tui")
        .directory(root)
        .environment["NODE_PATH"] = nodeModules
        .environment["AASC_NODE_MODULES_DIR"] = nodeModules
        .environment["AASC_PROJECT_ROOT"] = root
        .start()
```

## APK 更新與模型保留伪代码

```text
offerMinApkUpdate(manifest, currentPackageInfo):
    require manifest.apkMin.versionCode > currentPackageInfo.versionCode
    require signed manifest contains current bundled-model compatibility fingerprint
    download APK to app cache; verify size and SHA-256
    require APK package id == com.aasc.display.offline
    require APK signer certificate == current installed signer
    require APK bundled model ID/revision == current offline profile model ID/revision
    for each bundled LLM model required by current offline profile:
        MnnLlmModelManager.ensureBundledModelFromAssets(modelId)
        require files/models/llm/bundled/modelId passes size/SHA-256 checks
    require sufficient free space for install and rollback reserve
    retain verified artifact metadata with the cached APK
    if Android disallows installs from this source:
        ask the user before opening this app's install permission settings
        after returning, reuse verified metadata; do not require another network request
    launch Android PackageInstaller with user confirmation

showMinApkUpdatePrompt(metadata):
    render floating card with versionName, versionCode and artifact.size
    card actions = ["下载更新", "稍后"]
    do not create APK .part file before "下载更新"

onDownloadUpdateClicked():
    set card phase = "downloading", progress = 0
    OfflineUpdateManager.checkAndPrepareMinApkUpdate(root, onProgress)
    onProgress(phase, completedBytes, totalBytes):
        post to MainActivity main thread
        update floating progress bar and received/total text
    after SHA-256 and APK metadata checks:
        set phase = "installing"
        submit PackageInstaller session
    on STATUS_PENDING_USER_ACTION:
        let Android system display its confirmation page
    on STATUS_SUCCESS:
        show "更新完成" and dismiss card after a short delay
    on failure:
        show error and "重试", retain current APK and service data

runtimeInstallProgress:
    phase = "reading_manifest"
    phase = "runtime_libraries" with copiedBytes / phaseTotalBytes
    phase = "server_source" with copiedBytes / phaseTotalBytes
    phase = "node_dependencies" with copiedBytes / phaseTotalBytes
    phase = "config_and_metadata" with copiedBytes / phaseTotalBytes
    phase = "starting_node"
    if installed Runtime is reusable:
        report phase = "reused" and progress = 100

NodeServerService.sendStatus(status, detail, phase?, completedBytes?, totalBytes?):
    broadcast only to this package
    MainActivity renders phase/detail on the existing startup panel
    never report a completed phase before its files are durable

MainActivity.onNodeStatus(STARTING):
    once per Activity process, run min APK check/download/model materialization off the UI thread
    return to UI thread with result
    if update is ready: request unknown-source approval or submit PackageInstaller session
    system install receiver launches STATUS_PENDING_USER_ACTION intent
    never install silently or on fresh update-only app data

MainActivity.onResume:
    if full Offline data directory exists and no check ran in this Activity process:
        rerun the signed min APK check
    process a prepared update only while Activity is foreground-visible

MainActivity.onCreate:
    if APK profile updateOnly and no .full-offline-installed marker:
        show "请先安装完整 Offline APK"
        do not start NodeServerService

NodeRuntimeInstaller.applyAllowlistedNativeRuntimeUpdateOnly:
    read update-only runtime manifest
    require profile updateOnly == true
    require every destination starts with aasc-server/runtime/arm64-v8a/lib/
    stage and verify allowlisted .so files
    replace only staged native runtime library files
    preserve src, node_modules, config, home, logs, res/models,
        tasks, uploads, Android ASR/TTS assets and files/models/llm/bundled
    never run full Runtime root replacement from min APK
```

## 测试伪代码

```text
Node package tests:
    code-only output has full src and no node_modules/dependencies archive
    code-only rejects changed lock fingerprint and preserves deployed dependencies entry
    all output contains code and Android production dependencies with matching lock hash
    manifest signature fails after any signed field changes
    publish writes packages before manifest, cleans only stale exact versioned files,
        and leaves unrelated files/symlinks unchanged
    code/dependencies/min cleanup keeps the manifest-referenced versions on LAN and WAN
    full APK publish keeps the selected version and removes only older full APK versions
    cleanup failure preserves the verified manifest and reports a retryable error

Android JVM tests:
    LAN success, LAN timeout to WAN fallback, both unavailable -> current release
    invalid signature/hash/path/size -> no active pointer change
    code-only dependency mismatch -> no dependency download and old release remains
    all update -> code/dependencies pair changes in one pointer rename
    insufficient storage or failed extraction -> old release remains
    min update-only mode preserves user data and refuses fresh installation
    APK applicationId, signer and versionCode checks gate PackageInstaller
    Node and Kotlin calculate model compatibility using the same code-point ordering
    model assets are materialized and hash-checked before APK installation
    min APK omits model assets/manifest but reuses a verified same-revision cache

Build/device checks:
    build full allserver at baseline versionCode 2, then allserver-min at 3
    confirm equal package ID and signing-certificate digest
    install full over v1 without uninstall; update to min in place
    verify /api/status, /v1/models, chat, ASR/TTS and display UI
    compare configuration, tasks/results, logs, ASR/TTS files and LLM cache before/after
```
