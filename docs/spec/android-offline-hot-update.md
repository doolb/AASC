# Android Offline APK 热更新与原生增量 APK 实现规格（伪代码）

> 2026-09-19 已发布声纹启动预热与注册等待修复的 full APK v17（`0.2.15-offline`），文件为
> `apk/aasc-display-offline-v17.apk`，大小 `995442031` bytes，SHA-256 为
> `355826ce69a6b35de08717263fd94672739492d640dd284bc24cdfb9017ea0e5`。profile 为
> `allserver`、`embeddedNode=true`、`updateOnly=false`，内置 embedding 和 segmentation 声纹模型；
> LAN/WAN 直连 IP HTTP 200、Content-Length、远端 hash、APK v2 签名均通过，服务 `manifest.json` 未替换。

> 2026-09-19 变更服务更新交互：服务 code/dependencies 更新不再由 Node 启动流程静默下载；前台先读取并验签
> 服务清单，显示服务更新卡片，用户确认后由 `NodeServerService` 停止旧 Node、下载校验并原子切换 release，
> 随后重新启动 Node 并沿用候选版本健康检查和失败回滚。min APK 仍由独立卡片和系统安装确认流程处理。

> 2026-09-19 已正式发布服务更新前台确认能力：min APK v18（`0.2.16-offline-min`）大小 `89258826` bytes，
> SHA-256 `491b4e53a84755837b6a1efd7569d42f3d3771b6b4063271e68dd2523b4b22e1`；full APK v18
> （`0.2.16-offline`）大小 `995457930` bytes，SHA-256
> `b0ad329a0b0e3ac2080248e96ca9637abeab747a873efc6f65d61ddda81ebd4a`。正式清单为 `code=6`、
> `dependencies=3`、`apkMin=18`，full v18 不进入服务清单；LAN/WAN 清单字节、签名、HTTP Content-Length
> 和 APK v2 签名均通过。

> 2026-09-19 已正式发布对应的服务代码热更新 v6：`code/code-v6.zip`，大小 `14006751` bytes，SHA-256 为
> `8bca7a10f49888bccd426d449c7d4ccdf2d75c5c1f1fac796996b1e51eb3c9fa`。清单已原子切换到 code v6，
> `requiredDependencyVersion=3`，沿用 dependencies v3 和 apkMin v16；LAN/WAN 清单签名、字节一致、
> HTTP 200/Content-Length 和远端 hash 均通过。full APK 不写入热更新清单。

> 2026-09-19 已发布声纹和凭证导出修复：full v15（`0.2.13-offline`，`995440667` bytes，SHA-256 `346241708a4c2ec4eda24b0ff9c97a1bea80d3d819ec29c7cacab52f141808d9`）内置两个声纹模型；min v16（`0.2.14-offline-min`，`89248606` bytes，SHA-256 `b247b6667047fb6af867741c6f9468366542046ff455d3d710ab903166362c78`）为 update-only 原生修复。两包已同步 LAN/WAN 直连 IP，默认域名 `c.aasc.us` 仍返回 403。

> 2026-09-18 已正式发布完整 Offline APK v13（`0.2.11-offline`），文件为 `apk/aasc-display-offline-v13.apk`，大小 `957338670` bytes，SHA-256 为 `326d30feada394860925d2f11320bd4fb60b84cae1a710135303b89be203429c`。LAN/WAN 直连 IP HTTP 200、Content-Length 和远端 hash 校验通过；默认域名 `c.aasc.us` 返回 403，使用直连 IP 验收。v13 包含 Chat2API 账号凭证导入导出与 Android 外部网页恢复代码。

> 2026-09-18 已正式发布与 full v13 配套的 Offline min APK v14（`0.2.12-offline-min`）。由于 full v13 已占用 versionCode 13，min 热更新使用更高的 versionCode；APK 大小 `89245126` bytes，SHA-256 为 `062aee3158d5534c18b57bf8dcf28dccdffe9b27ebd33cbaa00b35fc0143382f`。LAN/WAN 直连 IP 的清单、签名、APK HTTP 200、Content-Length 和完整 hash 校验通过；SM-N9500 当前 v10 启动后显示 v14 手动下载提示。

> 2026-09-18 已发布 Chat2API 账户凭证按钮修复的服务代码 v5。`code/code-v5.zip` 大小 `14005201` bytes、SHA-256 为 `dae26685353195f23afb4828980b829bb30e5aef6822887233e927714576de9e`，沿用 dependencies v3（不触发依赖下载和 APK 安装）。SM-N9500 重启后 `active-release` 原子切换为 `code=5, dependencies=3`；设备加载的 `chat2api.js` 含“导出账号凭证”“导入账号凭证”，其 SHA-256 为 `9dd599441e8b45b319fff5ecd4832d9db4b4bff2dbd19b61aa3d963463e93e7f`。

> 追加验收：min v14 的 APK v2 签名和证书 SHA-256（`a57fd4c34c0c769246239a7d8c606b5edb62c215ecf9659448ea178eda3fb7df`）与清单、full v13 一致；SM-N9500 的 Android 应用内 `getPackageArchiveInfo` 仍在 `OfflineUpdateManager.kt:930` 报 signer 不匹配。full v13 通过 `adb install -r` 直接安装成功，作为当前外网整包更新路径。

> 本规格记录 Android 更新目标和伪代码；服务更新包/发布器、min build profile、Android 运行时更新及独立更新密钥接入已实现。full v2/min v3 APK、code/dependencies v3 已完成构建，2026-09-17 修复后的 min v4（versionCode 4、`0.2.2-offline-min`）已正式发布到 LAN/WAN。两站点 manifest 字节一致且签名有效，LAN HTTP 整包 hash、WAN 远端文件 hash、HTTP HEAD 和首段响应校验通过；min v4 的 APK SHA-256 为 `be31e437ca17488fab20eefd1874be2a1b40689cac59f667873e761dd17b1027`。full v2 APK 另已上传到外网 `apk/aasc-display-offline-v2.apk`，远端大小和完整 hash 与本地一致；真机 full v2 fresh install 后已成功应用 code/dependencies v3，`active-release.json` 的 `pendingHealth=false`，服务接口、默认模型和 Chat Completions 已通过。2026-09-17 重新生成的 min v3 携带 `libaasc_node.so` 并原位安装成功，配置、任务目录和 LLM 模型缓存保留；发布器已支持双站点精确清理旧 code/dependencies/min/full 版本。固定 ID/Chat2API 完成按钮对应的 min v6（versionCode 6、`0.2.4-offline-min`）已正式发布到 LAN/WAN，包含 Offline 任务索引迁移逻辑；APK SHA-256 为 `0f7af47dbba366758ebbe818994da37f39028bd8174ba6b3dfa8754f33366b68`，两站点 manifest 字节一致、签名有效、HTTP APK 返回 200 且 Content-Length 正确。当前实现已生成并正式发布 min v7（versionCode 7、`0.2.5-offline-min`），APK 大小 `89535999` bytes、SHA-256 为 `80501f7ea36a96377f8cddec3f238e0ec31b2d2bc30681d3f4b650c3ada324af`，LAN/WAN 清单和 APK HTTP 校验通过。SM-N9500 Android 9/API 28 真机已在 Display 2 `Desktop` 虚拟屏运行 v7，窗口为 1920×1018 app 区域、160 dpi，固定 `offline-display` 服务健康接口返回 200，UI 自动化可见浮动“控制端”按钮；因 Display 2 为 `touch NONE` 且无法通过 `screencap -d 2` 取图，本轮未宣称真实触控回归。现行校正以 `1280px@320dpi` 为 100%，Display 2 的 1920×1080@160dpi 目标比例为 75%；回滚、异常降级及 ASR/TTS 完整业务回归仍待验收。

> 2026-09-18 已将分辨率与 DPI 校正打包为 min v8（versionCode 8、`0.2.6-offline-min`），APK 大小 `89231402` bytes、SHA-256 为 `470c19c57ca528d84e87729ece45b74d48a3e2acdfbf124a16751a04786b0d2c`，并正式发布到 LAN/WAN。两站点 manifest、HTTP 200/Content-Length 和 WAN 远端 hash 校验通过；SM-N9500 Android 9/API 28 已安装 v8，在 Display 2 运行并确认 Qwen `readyDisplayIds=["offline-display"]`。Display 2 目标比例为 75%；手机 2309 长边、480 dpi 目标比例约 271%。因 `touch NONE` 和 Desktop 虚拟屏截图限制，本轮仍未宣称真实触控回归。

> 2026-09-18 新增右下角分辨率/DPI/缩放诊断浮层后，min v9（versionCode 9、`0.2.7-offline-min`）已构建、安装并正式发布到 LAN/WAN；UI 自动化读取到 `分辨率 1920×1018 | DPI 160 | 缩放 75%`。v9 大小 `89233662` bytes、SHA-256 为 `32181e75e3dbfe7b381bd0660f49778860ca62c4683bc69d7dbb3254eef549b7`，LAN `192.168.1.39` 和 WAN 直接 IP `120.79.245.103` 的 manifest、HTTP 200/Content-Length 和 WAN 远端 APK hash 已复核一致。默认域名 `c.aasc.us` 当前返回备案拦截 403，未作为本次验收入口。

> 2026-09-18 完整 Offline APK 的发布版本跟随当前 min 最新版本：读取 `allserver-min.versionCode` 作为 full 的 `versionCode`，full 版本名按当前版本生成；本次 versionCode 12 使用 `0.2.10-offline`，目标文件名为 `apk/aasc-display-offline-v12.apk`。若目标已有同版本但 SHA 不同的 full APK，必须先重新构建新版本，禁止覆盖既有版本。

> 2026-09-18 完整 Offline APK v12（`0.2.10-offline`）已与 min versionCode 12 对齐并正式发布，文件为 `apk/aasc-display-offline-v12.apk`。大小 `957319386` bytes、SHA-256 `b107d7963bf4dd18068404427e12f4edc72ff8253e8914e3d1909ca66e6c8183`；LAN/WAN 直连 IP HTTP、Content-Length、远端 hash、APK v2 签名和 ZIP 完整性校验通过。默认域名 `c.aasc.us` 返回 403，使用直连 IP 验收。

> 2026-09-18 控制端聊天设置 profile 协议保护已随服务 code v4 和 Offline min v12（`0.2.10-offline-min`）正式发布。code v4 大小 `13996510` bytes、SHA-256 `7ca5adf90be5738ee94b47e31534d574b411a1934e3b0d0db6702955b1247bd2`；min v12 大小 `89236426` bytes、SHA-256 `c4c20af9ab6b71c5e0e5dad1b4d3d2f1cdfce8cb7eaee91d6dde0ff1afdcf253`。清单包含本次发布更新日志，LAN/WAN 直连 IP 的清单和 APK HTTP 200、Content-Length、签名、APK v2 校验均通过；默认域名 `c.aasc.us` 返回 403，验收使用直连 IP。

> 2026-09-18 缩放曲线校正已完成：`WebViewScalePolicy` 将分辨率比例与 DPI 比例等权混合，
> `round((((长边 / 1280) + (densityDpi / 320)) / 2) × 100)`；min v10 本地包 SHA-256 为
> `713a0ecd53536afadf5115864e1ea28a90409717aa2bbd95655fbad155ce139e`，LAN/WAN manifest 字节一致（manifest SHA-256 `bc613aba55e41fced9b01d38cbfc83d0541c4eb5b8b61b4b0d6545dbd6134ac0`），Display 2 浮层显示 100%，已正式发布；默认域名 `c.aasc.us` 返回 403，使用直连 IP 验收。

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
        modelCompatibilitySha256, relativeUrl, size, sha256,
        releaseNotes?
    }
    signature.algorithm = "SHA256withRSA"
    signature.value = Base64(sign(privateKey, canonicalJson(payload)))

canonicalJson(value):
    recursively sort object keys
    preserve array order and JSON scalar values
    encode UTF-8 without BOM or trailing newline

createOfflineMinApkArtifact(options):
    releaseNotes = read options.releaseNotesFile as UTF-8 text when provided
    releaseNotes = trim(releaseNotes)
    require Unicode character count <= 4096
    如果 releaseNotes 非空：写入 payload.components.apkMin.releaseNotes
    对包含 releaseNotes 的 payload 重新签名并验证

OfflineUpdateManifest.parse:
    apkMin.releaseNotes 为可选字符串
    如果存在：trim 后长度必须 <= 4096；缺少时返回 null

MainActivity.showMinApkUpdatePrompt:
    显示版本和下载大小
    如果 releaseNotes 非空：显示更新内容，最多 6 行并省略尾部
    否则隐藏更新内容区域
```

2026-09-18 实现验证：Node 离线 APK/发布参数回归 39/39 通过，Android `OfflineUpdateManifestTest` BUILD SUCCESSFUL；发布日志随 `apkMin` 一起签名，旧清单缺少字段时解析结果为 `null`。

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
    if profile.name == allserver:
        profile.versionCode = read allserver-min.versionCode
        require full versionCode does not overwrite a different published SHA-256
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

publishChat2ApiCredentialButtonsFix():
    require package-lock SHA-256 == published dependencies.lockSha256
    build code-only with codeVersion = 5 and requiredDependencyVersion = 3
    verify archive contains chat2apiExportAccounts and chat2apiImportAccounts
    publish code/code-v5.zip to LAN and WAN
    atomically replace manifest.json while preserving dependencies-v3 and apkMin-v14
    on Offline startup:
        verify signed manifest and code hash
        atomically switch active-release to code=5, dependencies=3

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
checkForServiceUpdate(root):
    if APK profile is not offline or is update-only:
        return NotApplicable
    manifest = fetch signed manifest from LAN with short timeout
    if LAN connection fails:
        manifest = fetch signed manifest from WAN with bounded timeout
    for configured source in priority order:
        if source host is a domain:
            resolvedIps = DNS lookup source host
            for resolvedIp in resolvedIps:
                requestUrl = replace source host with resolvedIp
                do not set or preserve the original Host header
                request manifest and relative components with requestUrl
        if all resolved IPs fail:
            continue to next configured source
    if neither source responds:
        return NoVisibleUpdate("offline")
    verify RSA signature with public key embedded in APK
    validate schema, versions, safe relative URLs and bounded sizes

    installed = read active-release.json or legacyRuntimeVersion
    if code version and dependency version are already active:
        return NoVisibleUpdate("current")

    if dependency/code fingerprints are incompatible:
        return NoVisibleUpdate("needs-all-update")

    return VisibleServiceUpdate(plan, target versions, download bytes)

applyConfirmedServiceUpdate(root):
    require a previously displayed and user-confirmed service update
    stop the current Node process before changing active-release.json
    re-fetch and verify the signed manifest; re-plan to prevent stale decisions

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
    restart Node and report applied/failed status to the foreground Activity

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
        if active-release.json has pendingHealth:
            OfflineUpdateManager.rollbackPendingRelease(root)
        do not download service packages during Node startup

    release = read active-release.json
    if release is valid:
        entrypoint = root/updates/code/code-v<release.codeVersion>/src/apps/server/boot/server-launcher.js
        if release.legacyDependencies:
            nodeModules = root/node_modules
        else:
            nodeModules = root/updates/dependencies/dependencies-v<release.dependencyVersion>/node_modules
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

validateMinApkArchive(apkFile, metadata):
    parse APK package info with Android PackageManager
    compare package, versionCode, versionName and certificate SHA-256
    if certificate digest differs:
        reject update and report signer mismatch
    # full v14/API 28 now reaches the merged signer set for min v15.

readArchivePackageInfos(apkFile):
    request GET_SIGNING_CERTIFICATES | GET_SIGNATURES on Android P+
    request GET_SIGNATURES separately on Android P+ as an API 28 compatibility fallback
    return all non-null package records for the same archive

signerSha256Digests(packageInfo):
    collect SigningInfo.apkContentsSigners when available
    collect SigningInfo.signingCertificateHistory when available
    collect PackageInfo.signatures when available (including the legacy fallback)
    hash each certificate byte array with SHA-256 and normalize to lowercase hex

validateMinApkArchive(apkFile, metadata):
    packageInfos = readArchivePackageInfos(apkFile)
    require packageInfos is not empty
    compare package, versionCode and versionName from the first archive record
    merge signerSha256Digests(packageInfo) from every archive record
    require metadata.signerSha256 is in merged archive signers
    require metadata.signerSha256 is in installed package signers

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

MainActivity.handleBackNavigation():
    if controlWebView is visible:
        hide controlWebView
        restore controlToggleButton visibility and "控制端" label
        return

NodeServerService.applyConfirmedServiceUpdate:
    receive an explicit in-app command from MainActivity
    stop current Node process
    call applyConfirmedServiceUpdate(root) on the service executor
    broadcast update progress, success or failure
    restart Node after success or failure so the old release remains usable on failure

MainActivity.onNodeStatus(STARTING):
    once per Activity process, run service manifest check and min APK check off the UI thread
    if a service update is available, show service code/dependencies versions and download size
    if a min APK update is available, show the existing APK update card
    service update and min APK candidates share one card; service update has priority
    return to UI thread with result
    if update is ready: request unknown-source approval or submit PackageInstaller session
    system install receiver launches STATUS_PENDING_USER_ACTION intent
    never install APK silently or on fresh update-only app data

MainActivity.confirmServiceUpdate:
    send explicit apply command to NodeServerService
    display download, verification and release-switch progress
    keep the card retryable on failure

MainActivity.onResume:
    if full Offline data directory exists and no check ran in this Activity process:
        rerun the signed service and min APK checks
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

## Offline 声纹模型和凭证导出

### 声纹模型路径伪代码

```text
NativeBridge 创建 VoiceprintModelManager
    如果 offlineMode
        modelDirectory = files/aasc-server/res/models/voiceprint
    否则
        modelDirectory = files/models/voiceprint

voiceprintConfigure(config)
    校验 threshold、multiMode、speakerCount
    manager.ensureModel(serverOrigin, multiSpeaker)
    如果是 Offline 内置目录
        检查 embedding 文件大于 5 MiB
        按需检查 segmentation 文件大于 500 KiB
        两个文件有效时回调 ready
        任一文件缺失时回调 error，不发起网络下载
    否则
        按原有接口下载 embedding/segmentation
    ready 回调中加载 VoiceprintEngine
    注册请求通过 voiceprintExtract 使用已加载引擎返回 embedding
```

full Offline profile 必须选择 `voiceprint` 模型目录，Runtime 清单负责校验和解压；min profile 不携带模型，
依赖已安装 full 包提供的 `aasc-server/res/models/voiceprint`。

### Chat2API 导出伪代码

```text
控制端请求 /api/chat2api/export 或 /api/chat2api/accounts/export
    读取 response blob 和既有时间戳文件名
    如果存在 NativeControl.saveDownloadFile
        blob 转 base64
        调用原生桥写入系统 Download 目录
        Android 10+ 使用 MediaStore Downloads 并结束 pending 状态
        Android 9 使用公共 Download 目录
        原生返回失败时提示错误，不静默丢失文件
    否则
        使用浏览器 <a download> 回退
```

原生保存接口只接受单文件名、JSON MIME 类型和有限大小的 base64 数据，拒绝路径分隔符、控制字符和超大
输入；不记录凭证正文。

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
    build allserver full with the current allserver-min versionCode, then verify the full APK target name
    confirm equal package ID and signing-certificate digest
    install full over v1 without uninstall; update to min in place
    verify /api/status, /v1/models, chat, ASR/TTS and display UI
    compare configuration, tasks/results, logs, ASR/TTS files and LLM cache before/after
```
