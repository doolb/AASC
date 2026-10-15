package com.aasc.display

import android.app.PendingIntent
import android.content.Intent
import android.content.Context
import android.content.res.AssetManager
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.StatFs
import android.util.Log
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.Inet4Address
import java.net.InetAddress
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.FileVisitResult
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.security.MessageDigest
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import java.util.zip.ZipFile
import org.json.JSONObject

data class InstalledServiceVersion(
    val codeVersion: Int,
    val dependencyVersion: Int,
    val lockSha256: String,
    val taskCodeVersion: Int? = null,
    val taskCodeSha256: String? = null
)

data class OfflineUpdateProgress(
    val phase: String,
    val completedBytes: Long = 0L,
    val totalBytes: Long = 0L,
    val detail: String? = null
)

data class MinApkUpdateResult(
    val status: String,
    val apkFile: File? = null,
    val metadata: OfflineMinApkArtifact? = null,
    val failed: Boolean = false
)

data class ServiceUpdateResult(
    val status: String,
    val hasUpdate: Boolean = false,
    val plan: OfflineUpdateManager.ServiceUpdatePlan = OfflineUpdateManager.ServiceUpdatePlan.CURRENT,
    val installed: InstalledServiceVersion? = null,
    val targetCodeVersion: Int? = null,
    val targetDependencyVersion: Int? = null,
    val downloadBytes: Long = 0L,
    val dataRepair: OfflineDataRepairArtifact? = null,
    val failed: Boolean = false,
    val targetTaskCodeVersion: Int? = null
)

data class ServiceUpdateApplyResult(
    val status: String,
    val applied: Boolean = false
)

/**
 * Offline APK 的签名更新协调器。构建前 profile 和清单纯校验在 companion object 中，
 * 设备侧下载、安装及版本切换状态由实例方法处理。
 */
class OfflineUpdateManager(
    private val context: Context,
    private val assetManager: AssetManager = context.assets
) {

    enum class ServiceUpdatePlan {
        CURRENT,
        CODE_ONLY,
        ALL,
        NEEDS_ALL,
        TASK_CODE_ONLY,
        DATA_REPAIR_ONLY
    }

    internal data class ManifestSource(val baseUrl: String, val manifest: OfflineUpdateManifest, val rawJson: String = "")

    internal data class DownloadedArtifact(val metadata: OfflineUpdateArtifact, val file: File)

    data class ZipInspection(val expandedBytes: Long, val entryNames: Set<String>)

    data class DependencyDirectoryResolution(
        val directory: File,
        val legacyDependencies: Boolean
    )

    companion object {
        const val PUBLIC_KEY_ASSET = "offline-update-public-key.pem"
        const val CLIENT_METADATA_FILE = "offline-update-client.json"
        const val ACTIVE_RELEASE_FILE = "updates/active-release.json"
        const val HOME_LAN_BASE_URL = "http://192.168.1.39/mnt/aasc-offline/"
        const val COMPANY_LAN_BASE_URL = "http://10.221.70.87/mnt/aasc-offline/"
        // 保留旧常量名，兼容已有测试和调用方；新的源列表同时包含家庭和公司内网。
        const val LAN_BASE_URL = HOME_LAN_BASE_URL
        const val WAN_BASE_URL = "http://c.aasc.us/mnt/aasc-offline/"
        private const val TAG = "AASC-Offline-Update"
        private const val CONNECT_TIMEOUT_MS = 4_000
        private const val READ_TIMEOUT_MS = 12_000
        private const val MAX_MANIFEST_BYTES = 2 * 1024 * 1024
        private const val MAX_ARCHIVE_EXPANDED_BYTES = 8L * 1024L * 1024L * 1024L
        private const val MAX_ZIP_ENTRIES = 250_000
        private const val ROLLBACK_RESERVE_BYTES = 128L * 1024L * 1024L
        private const val MIN_APK_PACKAGE_NAME = "com.aasc.display.offline"
        private const val MIN_APK_INSTALL_RESERVE_BYTES = 256L * 1024L * 1024L
        const val MIN_APK_INSTALL_ACTION = "com.aasc.display.action.INSTALL_OFFLINE_MIN_APK"
        private val UPDATE_BASE_URLS = listOf(
            HOME_LAN_BASE_URL,
            COMPANY_LAN_BASE_URL,
            WAN_BASE_URL
        )

        /**
         * 将更新源的域名替换为解析得到的 IP，同时保留协议、端口和完整路径。
         * 不在这里设置 Host 头，后续 HttpURLConnection 会按替换后的 IP 建立请求。
         */
        @JvmStatic
        fun replaceUpdateUrlHost(baseUrl: String, resolvedIp: String): String {
            val sourceUrl = URL(baseUrl)
            val ip = resolvedIp.trim()
            require(ip.isNotEmpty()) { "热更源解析地址不能为空" }
            return URL(sourceUrl.protocol, ip, sourceUrl.port, sourceUrl.file).toString()
        }

        private fun resolveUpdateBaseUrl(baseUrl: String): List<String> {
            val sourceUrl = URL(baseUrl)
            val host = sourceUrl.host.trim()
            require(host.isNotEmpty()) { "热更源地址缺少主机" }

            // 已经是 IP 时无需再次解析；IPv6 文字地址也直接沿用，避免给数字地址增加 DNS 延迟。
            if (host.matches(Regex("(\\\\d{1,3}\\\\.){3}\\\\d{1,3}")) || host.contains(':')) {
                return listOf(baseUrl)
            }

            val addresses = InetAddress.getAllByName(host).toList()
            val preferredAddresses = addresses.filterIsInstance<Inet4Address>().ifEmpty { addresses }
            return preferredAddresses.map { address ->
                replaceUpdateUrlHost(baseUrl, address.hostAddress)
            }.distinct()
        }

        private fun resolveConfiguredUpdateBaseUrls(configuredBaseUrls: Iterable<String>): List<String> {
            val resolved = linkedSetOf<String>()
            for (configuredBaseUrl in configuredBaseUrls) {
                try {
                    resolved.addAll(resolveUpdateBaseUrl(configuredBaseUrl))
                } catch (error: IOException) {
                    Log.w(TAG, "热更源 DNS 解析失败: $configuredBaseUrl - ${error.message}")
                }
            }
            return resolved.toList()
        }

        @JvmStatic
        fun planServiceUpdate(
            installed: InstalledServiceVersion,
            manifest: OfflineUpdateManifest
        ): ServiceUpdatePlan {
            require(installed.codeVersion > 0 && installed.dependencyVersion > 0) {
                "已安装 Offline 服务版本无效"
            }
            val code = manifest.code
            val dependencies = manifest.dependencies
            val requiredDependency = code.requiredDependencyVersion ?: -1
            require(code.version > 0 && dependencies.version > 0 && requiredDependency > 0) {
                "更新清单服务版本无效"
            }
            // 同一次迁移中本机可能领先正式源；旧清单不代表正在移除已启用任务。
            if (code.version < installed.codeVersion || dependencies.version < installed.dependencyVersion) {
                return ServiceUpdatePlan.CURRENT
            }
            OfflineTaskCode.assertCombination(manifest.taskCode, code, manifest.dependencies)
            val targetTask = manifest.taskCode
            require(installed.taskCodeVersion == null || targetTask != null) { "候选清单不能移除已启用任务组件" }
            if (installed.taskCodeVersion != null && targetTask != null) {
                require(targetTask.version >= installed.taskCodeVersion) { "任务组件不能降级" }
                require(targetTask.version != installed.taskCodeVersion || targetTask.sha256 == installed.taskCodeSha256) { "任务组件同版本不能覆盖" }
            }
            val taskChanged = targetTask != null && targetTask.version != installed.taskCodeVersion
            val currentHash = installed.lockSha256.lowercase()
            val targetLock = dependencies.lockSha256.orEmpty().lowercase()
            val codeLock = code.requiredLockSha256.orEmpty().lowercase()
            if (dependencies.version == installed.dependencyVersion) {
                if (targetLock != currentHash || codeLock != currentHash ||
                    requiredDependency != installed.dependencyVersion) {
                    return ServiceUpdatePlan.NEEDS_ALL
                }
                return if (code.version > installed.codeVersion) {
                    ServiceUpdatePlan.CODE_ONLY
                } else {
                    if (taskChanged) ServiceUpdatePlan.TASK_CODE_ONLY else ServiceUpdatePlan.CURRENT
                }
            }
            if (dependencies.version > installed.dependencyVersion &&
                code.version > installed.codeVersion &&
                requiredDependency == dependencies.version &&
                codeLock == targetLock) {
                return ServiceUpdatePlan.ALL
            }
            return ServiceUpdatePlan.NEEDS_ALL
        }

        internal fun taskDownloadBytes(installed: InstalledServiceVersion, manifest: OfflineUpdateManifest): Long =
            manifest.taskCode?.takeIf { it.version != installed.taskCodeVersion }?.artifact?.size ?: 0L

        internal fun readTaskVersion(json: JSONObject): Int? {
            if (!json.has("taskCodeVersion") && !json.has("taskCodeSha256")) return null
            val version = OfflineTaskCode.positive(json, "taskCodeVersion")
            require(Regex("^[a-f0-9]{64}$").matches(json.getString("taskCodeSha256"))) { "任务指针缺少摘要" }
            return version
        }

        @JvmStatic
        fun isDataRepairApplied(root: File, repair: OfflineDataRepairArtifact): Boolean {
            return OfflineDataRepairState.satisfied(root, repair)
        }

        /**
         * code-only 不应因为旧 active-release 使用 legacy-root 就跳过已经安装的依赖包。
         * 只有目录、node_modules 和安装校验标记全部匹配时，才把热更依赖目录提升为当前来源。
         */
        @JvmStatic
        fun resolveCodeOnlyDependencyDirectory(
            root: File,
            dependencyVersion: Int,
            dependencySha256: String,
            previousDependencyVersion: Int?,
            previousLegacyDependencies: Boolean?
        ): DependencyDirectoryResolution {
            val candidate = File(root, "updates/dependencies/dependencies-v$dependencyVersion")
            if (isVerifiedDependencyDirectory(candidate, dependencyVersion, dependencySha256)) {
                return DependencyDirectoryResolution(
                    File(candidate, "node_modules"),
                    legacyDependencies = false
                )
            }

            if (previousLegacyDependencies == true || previousLegacyDependencies == null) {
                return DependencyDirectoryResolution(
                    File(root, "node_modules"),
                    legacyDependencies = true
                )
            }

            val fallbackVersion = previousDependencyVersion ?: dependencyVersion
            return DependencyDirectoryResolution(
                File(root, "updates/dependencies/dependencies-v$fallbackVersion/node_modules"),
                legacyDependencies = false
            )
        }

        private fun isVerifiedDependencyDirectory(
            directory: File,
            expectedVersion: Int,
            expectedSha256: String
        ): Boolean {
            return hasDependencyDirectoryMarker(directory, expectedVersion) { sha256 ->
                sha256.equals(expectedSha256, ignoreCase = true)
            }
        }

        private fun hasDependencyDirectoryMarker(
            directory: File,
            expectedVersion: Int,
            sha256Matches: (String) -> Boolean
        ): Boolean {
            if (!directory.isDirectory || !File(directory, "node_modules").isDirectory) return false
            val marker = File(directory, ".offline-update-verified.json")
            return runCatching {
                val metadata = JSONObject(marker.readText())
                val markerSha256 = metadata.optString("sha256").lowercase()
                metadata.optString("kind") == "dependencies" &&
                    metadata.optInt("version", -1) == expectedVersion &&
                    markerSha256.matches(Regex("^[a-f0-9]{64}$")) &&
                    sha256Matches(markerSha256)
            }.getOrDefault(false)
        }

        private fun hasDependencyPackageMetadata(
            directory: File,
            expectedVersion: Int,
            expectedLockSha256: String
        ): Boolean {
            if (!directory.isDirectory || !File(directory, "node_modules/express/package.json").isFile) return false
            return runCatching {
                val metadata = JSONObject(File(directory, "dependency-manifest.json").readText())
                metadata.optInt("version", -1) == expectedVersion &&
                    metadata.optString("lockSha256").equals(expectedLockSha256, ignoreCase = true)
            }.getOrDefault(false)
        }

        @JvmStatic
        fun extractZipArchive(archive: File, destination: File): Long {
            val inspection = inspectZipArchive(archive)
            val canonicalDestination = destination.canonicalFile
            check(canonicalDestination.isDirectory || canonicalDestination.mkdirs()) {
                "无法创建更新 ZIP 暂存目录: ${canonicalDestination.absolutePath}"
            }
            val rootPath = canonicalDestination.toPath()
            var actualExpandedBytes = 0L
            ZipFile(archive).use { zipFile ->
                val entries = zipFile.entries()
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    val relativePath = entry.name.removeSuffix("/")
                    if (relativePath.isEmpty()) continue
                    require(isSafeArchivePath(entry.name)) { "更新 ZIP 路径不安全: ${entry.name}" }
                    val output = File(canonicalDestination, relativePath).canonicalFile
                    require(output.toPath().startsWith(rootPath)) { "更新 ZIP 路径越界: ${entry.name}" }
                    if (entry.isDirectory) {
                        check(output.isDirectory || output.mkdirs()) { "无法创建更新目录: ${entry.name}" }
                        continue
                    }
                    check(output.parentFile?.isDirectory == true || output.parentFile?.mkdirs() == true) {
                        "无法创建更新文件父目录: ${entry.name}"
                    }
                    FileOutputStream(output, false).use { fileOutput ->
                        val bufferedOutput = BufferedOutputStream(fileOutput)
                        try {
                            zipFile.getInputStream(entry).use { input ->
                                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                                var fileBytes = 0L
                                while (true) {
                                    val count = input.read(buffer)
                                    if (count < 0) break
                                    fileBytes = safeAdd(fileBytes, count.toLong())
                                        ?: throw IllegalArgumentException("ZIP 文件展开大小溢出: ${entry.name}")
                                    require(fileBytes <= entry.size && fileBytes <= MAX_ARCHIVE_EXPANDED_BYTES) {
                                        "ZIP 文件展开超过声明大小: ${entry.name}"
                                    }
                                    bufferedOutput.write(buffer, 0, count)
                                }
                                require(fileBytes == entry.size) { "ZIP 文件展开大小不一致: ${entry.name}" }
                                actualExpandedBytes = safeAdd(actualExpandedBytes, fileBytes)
                                    ?: throw IllegalArgumentException("ZIP 总展开大小溢出")
                            }
                            bufferedOutput.flush()
                            fileOutput.fd.sync()
                        } finally {
                            bufferedOutput.close()
                        }
                    }
                }
            }
            require(actualExpandedBytes == inspection.expandedBytes) { "ZIP 实际展开大小与目录记录不一致" }
            return actualExpandedBytes
        }

        @JvmStatic
        fun inspectZipArchive(archive: File): ZipInspection {
            require(archive.isFile && !Files.isSymbolicLink(archive.toPath())) { "更新 ZIP 必须是普通文件" }
            validateUnixZipEntryTypes(archive)
            val names = linkedSetOf<String>()
            var expandedBytes = 0L
            ZipFile(archive).use { zipFile ->
                val entries = zipFile.entries()
                var entryCount = 0
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    entryCount += 1
                    require(entryCount <= MAX_ZIP_ENTRIES) { "更新 ZIP 文件数量超过限制" }
                    require(isSafeArchivePath(entry.name)) { "更新 ZIP 路径不安全: ${entry.name}" }
                    val normalizedName = entry.name.removeSuffix("/")
                    require(names.add(normalizedName)) { "更新 ZIP 包含重名文件: $normalizedName" }
                    require(entry.size >= 0L && entry.compressedSize >= 0L) {
                        "更新 ZIP 缺少可靠的大小信息: ${entry.name}"
                    }
                    expandedBytes = safeAdd(expandedBytes, if (entry.isDirectory) 0L else entry.size)
                        ?: throw IllegalArgumentException("更新 ZIP 展开大小溢出")
                    require(expandedBytes <= MAX_ARCHIVE_EXPANDED_BYTES) { "更新 ZIP 解压空间超过安全上限" }
                }
            }
            return ZipInspection(expandedBytes, names)
        }

        @JvmStatic
        fun hasEnoughSpace(availableBytes: Long, downloadBytes: Long, extractionBytes: Long, reserveBytes: Long): Boolean {
            if (availableBytes < 0 || downloadBytes < 0 || extractionBytes < 0 || reserveBytes < 0) return false
            val withExtraction = safeAdd(downloadBytes, extractionBytes) ?: return false
            val required = safeAdd(withExtraction, reserveBytes) ?: return false
            return availableBytes >= required
        }

        /** 合并 Android 不同 PackageManager 读取路径返回的证书摘要，并统一大小写。 */
        @JvmStatic
        fun mergeSignerSha256Digests(primary: Set<String>, fallback: Set<String>): Set<String> =
            (primary + fallback).map { it.lowercase() }.toSet()

        /** 与 Node 发布器使用相同的规范化字段计算 bundled 模型兼容指纹。 */
        @JvmStatic
        fun parseModelCompatibility(
            compatibilityJson: String,
            modelManifestJson: String
        ): Pair<String, List<String>> {
            val compatibility = JSONObject(compatibilityJson)
            require(compatibility.optInt("schemaVersion", -1) == 1) {
                "Offline 模型兼容清单 schemaVersion 无效"
            }
            val declaredSha256 = compatibility.optString("modelCompatibilitySha256").lowercase()
            require(declaredSha256.matches(Regex("^[a-f0-9]{64}$"))) {
                "Offline 模型兼容 SHA-256 无效"
            }

            val sourceModels = JSONObject(modelManifestJson).optJSONArray("models")
                ?: throw IllegalArgumentException("Offline 模型 manifest 缺少 models")
            val stableModels = mutableListOf<JSONObject>()
            val modelIds = mutableListOf<String>()
            for (index in 0 until sourceModels.length()) {
                val model = sourceModels.optJSONObject(index)
                    ?: throw IllegalArgumentException("Offline 模型 manifest models[$index] 无效")
                val modelId = model.optString("modelId").trim()
                val revision = model.optString("revision").trim()
                require(Regex("^[A-Za-z0-9][A-Za-z0-9._-]*$").matches(modelId) && revision.isNotEmpty()) {
                    "Offline 模型 ID/revision 无效"
                }
                val files = model.optJSONArray("files")
                    ?: throw IllegalArgumentException("Offline 模型 $modelId 缺少 files")
                val stableFiles = mutableListOf<JSONObject>()
                for (fileIndex in 0 until files.length()) {
                    val file = files.optJSONObject(fileIndex)
                        ?: throw IllegalArgumentException("Offline 模型 $modelId 文件元数据无效")
                    val name = file.optString("name").trim()
                    val size = file.optLong("size", -1L)
                    val sha256 = file.optString("sha256").trim().lowercase()
                    require(name.isNotEmpty() && File(name).name == name && size >= 0L &&
                        sha256.matches(Regex("^[a-f0-9]{64}$"))) {
                        "Offline 模型 $modelId 文件校验信息无效"
                    }
                    stableFiles += JSONObject()
                        .put("name", name)
                        .put("size", size)
                        .put("sha256", sha256)
                }
                require(stableFiles.isNotEmpty()) { "Offline 模型 $modelId 没有权重文件" }
                stableModels += JSONObject()
                    .put("modelId", modelId)
                    .put("revision", revision)
                    .put("files", org.json.JSONArray(stableFiles.sortedBy { it.optString("name") }))
                modelIds += modelId
            }
            require(modelIds.distinct().size == modelIds.size) {
                "Offline 模型兼容清单包含重复模型"
            }
            val payload = JSONObject()
                .put("schemaVersion", 1)
                .put("models", org.json.JSONArray(stableModels.sortedBy { it.optString("modelId") }))
            val actualSha256 = MessageDigest.getInstance("SHA-256")
                .digest(OfflineUpdateManifest.canonicalJson(payload).toByteArray(Charsets.UTF_8))
                .toHexString()
            require(actualSha256 == declaredSha256) {
                "Offline 模型兼容清单与模型 manifest 指纹不匹配"
            }
            return actualSha256 to modelIds
        }

        @JvmStatic
        fun isSafeArchivePath(rawPath: String): Boolean {
            if (rawPath.isBlank() || rawPath.startsWith('/') || rawPath.contains('\\') || rawPath.contains('\u0000')) {
                return false
            }
            val relativePath = rawPath.removeSuffix("/")
            if (relativePath.isEmpty() || relativePath.contains(':')) return false
            return relativePath.split('/').all { segment ->
                segment.isNotEmpty() && segment != "." && segment != ".." && segment.none { it.code < 0x20 }
            }
        }

        /**
         * 判断已经去掉目录项尾部斜杠的 ZIP 条目是否属于对应组件。
         * inspectZipArchive() 会统一保存规范化名称，因此根目录 src/ 和 node_modules/
         * 在这里分别表现为 src 和 node_modules，不能只用文件路径前缀判断。
         */
        @JvmStatic
        fun isAllowedComponentEntry(component: String, normalizedEntryName: String): Boolean {
            if (normalizedEntryName.isBlank()) return false
            return when (component) {
                "taskCode" -> normalizedEntryName == "task-code-manifest.json" || normalizedEntryName == "tasks" || normalizedEntryName.startsWith("tasks/")
                "code" -> normalizedEntryName == "src" ||
                    normalizedEntryName == "package.json" ||
                    normalizedEntryName == "package-lock.json" ||
                    (normalizedEntryName.startsWith("src/") &&
                        normalizedEntryName != "src/apps/android-display" &&
                        !normalizedEntryName.startsWith("src/apps/android-display/"))
                "dependencies" -> normalizedEntryName == "node_modules" ||
                    normalizedEntryName == "dependency-manifest.json" ||
                    normalizedEntryName == "dependency-group.json" ||
                    normalizedEntryName.startsWith("node_modules/")
                "dependencyGroup" -> normalizedEntryName == "node_modules" ||
                    normalizedEntryName == "dependency-group.json" ||
                    normalizedEntryName.startsWith("node_modules/")
                "dataRepair" -> normalizedEntryName == "repair.js"
                else -> false
            }
        }

        /** 分组只检查组契约；完整依赖在合并后再检查Express及全局清单，不能混用两个阶段。 */
        internal fun inspectComponentArchive(archiveFile: File, component: String): ZipInspection {
            require(component in setOf("code", "dependencies", "dependencyGroup", "dataRepair", "taskCode")) {
                "未知更新包组件: $component"
            }
            val inspection = inspectZipArchive(archiveFile)
            if (component == "taskCode") require(inspection.expandedBytes <= OfflineTaskCode.MAX_BYTES + 1024 * 1024 &&
                inspection.entryNames.size <= 4096 && "task-code-manifest.json" in inspection.entryNames) { "任务ZIP超限或缺少清单" }
            for (entryName in inspection.entryNames) {
                if (entryName.isEmpty()) continue
                require(isAllowedComponentEntry(component, entryName)) {
                    "${component} 更新包包含不允许的路径: $entryName"
                }
            }
            when (component) {
                "code" -> {
                    require(inspection.entryNames.contains("src/apps/server/boot/server-launcher.js")) {
                        "服务代码更新包缺少 Node launcher"
                    }
                    require(inspection.entryNames.containsAll(setOf("package.json", "package-lock.json"))) {
                        "服务代码更新包缺少 package 元信息"
                    }
                }
                "dataRepair" -> require(inspection.entryNames.contains("repair.js")) {
                    "dataRepair 更新包缺少 repair.js"
                }
                "dependencies" -> {
                    require(inspection.entryNames.contains("dependency-manifest.json")) {
                        "依赖更新包缺少 dependency-manifest.json"
                    }
                    require(inspection.entryNames.contains("node_modules/express/package.json")) {
                        "依赖更新包缺少 express"
                    }
                }
                "dependencyGroup" -> {
                    require(inspection.entryNames.contains("dependency-group.json")) {
                        "依赖组更新包缺少 dependency-group.json"
                    }
                    ZipFile(archiveFile).use { zip ->
                        require(zip.entries().asSequence().any { !it.isDirectory && it.name.startsWith("node_modules/") }) {
                            "依赖组更新包缺少 node_modules 文件"
                        }
                    }
                }
            }
            return inspection
        }

        private fun validateUnixZipEntryTypes(archive: File) {
            RandomAccessFile(archive, "r").use { input ->
                val tailSize = minOf(input.length(), 22L + 65_535L).toInt()
                require(tailSize >= 22) { "更新 ZIP 末尾目录无效" }
                val tail = ByteArray(tailSize)
                input.seek(input.length() - tailSize)
                input.readFully(tail)
                var eocdOffset = -1
                for (offset in tail.size - 22 downTo 0) {
                    if (readLittleEndianInt(tail, offset) == EOCD_SIGNATURE &&
                        offset + 22 + readLittleEndianShort(tail, offset + 20) == tail.size) {
                        eocdOffset = offset
                        break
                    }
                }
                require(eocdOffset >= 0) { "更新 ZIP 缺少有效中央目录结束标记" }
                val entryCount = readLittleEndianShort(tail, eocdOffset + 10)
                val centralOffset = readLittleEndianUnsignedInt(tail, eocdOffset + 16)
                require(entryCount != 0xffff && centralOffset != 0xffff_ffffL) {
                    "暂不支持超过 ZIP32 限制的更新档案"
                }
                input.seek(centralOffset)
                repeat(entryCount) {
                    val header = ByteArray(46)
                    input.readFully(header)
                    require(readLittleEndianInt(header, 0) == CENTRAL_DIRECTORY_SIGNATURE) {
                        "更新 ZIP 中央目录条目无效"
                    }
                    val operatingSystem = readLittleEndianShort(header, 4) ushr 8
                    val nameLength = readLittleEndianShort(header, 28)
                    val extraLength = readLittleEndianShort(header, 30)
                    val commentLength = readLittleEndianShort(header, 32)
                    val externalAttributes = readLittleEndianUnsignedInt(header, 38)
                    val unixMode = (externalAttributes ushr 16).toInt() and 0xffff
                    val entryType = unixMode and UNIX_FILE_TYPE_MASK
                    if (operatingSystem == UNIX_MADE_BY && entryType != 0 &&
                        entryType != UNIX_REGULAR_FILE && entryType != UNIX_DIRECTORY) {
                        throw IllegalArgumentException("更新 ZIP 不允许符号链接或特殊文件")
                    }
                    val skipBytes = nameLength.toLong() + extraLength + commentLength
                    require(input.filePointer + skipBytes <= input.length()) { "更新 ZIP 中央目录越界" }
                    input.seek(input.filePointer + skipBytes)
                }
            }
        }

        private fun readLittleEndianShort(bytes: ByteArray, offset: Int): Int =
            (bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8)

        private fun readLittleEndianInt(bytes: ByteArray, offset: Int): Int =
            readLittleEndianShort(bytes, offset) or (readLittleEndianShort(bytes, offset + 2) shl 16)

        private fun readLittleEndianUnsignedInt(bytes: ByteArray, offset: Int): Long =
            readLittleEndianInt(bytes, offset).toLong() and 0xffff_ffffL

        private fun safeAdd(left: Long, right: Long): Long? {
            if (left < 0L || right < 0L || Long.MAX_VALUE - left < right) return null
            return left + right
        }

        private const val EOCD_SIGNATURE = 0x06054b50
        private const val CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
        private const val UNIX_MADE_BY = 3
        private const val UNIX_FILE_TYPE_MASK = 0xf000
        private const val UNIX_REGULAR_FILE = 0x8000
        private const val UNIX_DIRECTORY = 0x4000

        /** 健康 release 仅在有严格命名的非活动版本目录时才需要额外监视。 */
        @JvmStatic
        fun hasObsoleteReleaseDirectories(root: File): Boolean {
            val active = readHealthyReleaseVersions(root) ?: return false
            return hasObsoleteVersionDirectory(File(root, "updates/code"), "code-v", active.first)
                || hasObsoleteVersionDirectory(File(root, "updates/dependencies"), "dependencies-v", active.second)
                || hasObsoleteVersionDirectory(File(root, "updates/task-code"), "task-code-v",
                    readTaskVersion(JSONObject(File(root, ACTIVE_RELEASE_FILE).readText())))
        }

        /** 仅清理健康 active-release 未引用的版本目录；符号链接及含链接目录树完整跳过。 */
        @JvmStatic
        fun cleanupObsoleteReleaseDirectories(root: File): Int {
            val active = readHealthyReleaseVersions(root) ?: return 0
            var removedDirectories = 0
            listOf(
                Triple(File(root, "updates/code"), "code-v", active.first),
                Triple(File(root, "updates/dependencies"), "dependencies-v", active.second),
                Triple(File(root, "updates/task-code"), "task-code-v",
                    readTaskVersion(JSONObject(File(root, ACTIVE_RELEASE_FILE).readText())))
            ).forEach parentLoop@{ (parent, prefix, activeVersion) ->
                if (Files.isSymbolicLink(parent.toPath()) || !parent.isDirectory) return@parentLoop
                val candidates = parent.listFiles().orEmpty().filter { child ->
                    val version = parseVersionDirectory(child.name, prefix)
                    version != null && version != activeVersion && !Files.isSymbolicLink(child.toPath())
                        && child.isDirectory && runCatching { child.canonicalFile.parentFile == parent.canonicalFile }.getOrDefault(false)
                }
                candidates.forEach candidateLoop@{ candidate ->
                    if (containsSymbolicLinkOrUnreadablePath(candidate)) {
                        // 含链接或不可读项的版本树是预期跳过场景，不能跟随或部分删除。
                        return@candidateLoop
                    }
                    try {
                        deleteDirectoryWithoutFollowingLinks(candidate)
                        removedDirectories += 1
                    } catch (error: Exception) {
                        Log.w(TAG, "Offline 旧版本目录清理失败，将在后续健康启动重试: ${candidate.name}", error)
                    }
                }
            }
            return removedDirectories
        }

        private fun readHealthyReleaseVersions(root: File): Pair<Int, Int?>? = runCatching {
            val rootPath = root.toPath()
            if (Files.isSymbolicLink(rootPath) || !root.isDirectory) return@runCatching null
            val updates = File(root, "updates")
            if (Files.isSymbolicLink(updates.toPath()) || !updates.isDirectory) return@runCatching null
            val pointerFile = File(updates, "active-release.json")
            if (Files.isSymbolicLink(pointerFile.toPath()) || !pointerFile.isFile) return@runCatching null
            val pointer = JSONObject(pointerFile.readText())
            val codeVersion = pointer.optInt("codeVersion", -1)
            val dependencyVersion = pointer.optInt("dependencyVersion", -1)
            if (pointer.optBoolean("pendingHealth", false) || codeVersion <= 0 || dependencyVersion <= 0) {
                return@runCatching null
            }
            if (!isSafeVersionDirectory(root, "code", "code-v", codeVersion)) return@runCatching null
            val legacyDependencies = pointer.optBoolean("legacyDependencies", false)
            if (!legacyDependencies && !isSafeVersionDirectory(root, "dependencies", "dependencies-v", dependencyVersion)) {
                return@runCatching null
            }
            val taskVersion = readTaskVersion(pointer)
            if (taskVersion != null && !isSafeVersionDirectory(root, "task-code", "task-code-v", taskVersion)) return@runCatching null
            codeVersion to dependencyVersion.takeUnless { legacyDependencies }
        }.getOrNull()

        private fun isSafeVersionDirectory(root: File, bucketName: String, prefix: String, version: Int): Boolean {
            val parent = File(root, "updates/$bucketName")
            val directory = File(parent, "$prefix$version")
            if (Files.isSymbolicLink(parent.toPath()) || !parent.isDirectory
                || Files.isSymbolicLink(directory.toPath()) || !directory.isDirectory) return false
            return runCatching {
                directory.canonicalFile.parentFile == parent.canonicalFile
            }.getOrDefault(false)
        }

        private fun hasObsoleteVersionDirectory(parent: File, prefix: String, activeVersion: Int?): Boolean {
            if (Files.isSymbolicLink(parent.toPath()) || !parent.isDirectory) return false
            return parent.listFiles().orEmpty().any { child ->
                val version = parseVersionDirectory(child.name, prefix)
                version != null && version != activeVersion && !Files.isSymbolicLink(child.toPath())
                    && child.isDirectory && runCatching { child.canonicalFile.parentFile == parent.canonicalFile }.getOrDefault(false)
            }
        }

        private fun parseVersionDirectory(name: String, prefix: String): Int? {
            val match = Regex("^${Regex.escape(prefix)}([0-9]+)$").matchEntire(name) ?: return null
            val version = match.groupValues[1].toIntOrNull()?.takeIf { it > 0 } ?: return null
            return version.takeIf { name == "$prefix$version" }
        }

        private fun containsSymbolicLinkOrUnreadablePath(directory: File): Boolean {
            var rejected = false
            try {
                Files.walkFileTree(directory.toPath(), object : SimpleFileVisitor<Path>() {
                    override fun visitFile(file: Path, attributes: BasicFileAttributes): FileVisitResult {
                        if (Files.isSymbolicLink(file)) {
                            rejected = true
                            return FileVisitResult.TERMINATE
                        }
                        return FileVisitResult.CONTINUE
                    }

                    override fun visitFileFailed(file: Path, error: IOException): FileVisitResult {
                        rejected = true
                        return FileVisitResult.TERMINATE
                    }
                })
            } catch (_: IOException) {
                rejected = true
            }
            return rejected
        }

        private fun deleteDirectoryWithoutFollowingLinks(directory: File) {
            Files.walkFileTree(directory.toPath(), object : SimpleFileVisitor<Path>() {
                override fun visitFile(file: Path, attributes: BasicFileAttributes): FileVisitResult {
                    check(!Files.isSymbolicLink(file)) { "拒绝删除 Offline 版本目录中的符号链接" }
                    Files.delete(file)
                    return FileVisitResult.CONTINUE
                }

                override fun postVisitDirectory(directory: Path, error: IOException?): FileVisitResult {
                    if (error != null) throw error
                    Files.delete(directory)
                    return FileVisitResult.CONTINUE
                }
            })
        }

        /** 整包健康提交复用受限删除器；整个目录含链接时保持，不能跟随链接或部分删除。 */
        internal fun removeDownloadedVersionDirectory(directory: File): Boolean {
            if (!Files.isDirectory(directory.toPath(), java.nio.file.LinkOption.NOFOLLOW_LINKS)
                || containsSymbolicLinkOrUnreadablePath(directory)) return false
            deleteDirectoryWithoutFollowingLinks(directory)
            return true
        }
    }

    /** 只读取并验签服务清单，供前台显示服务代码/依赖更新提示，不下载更新包。 */
    fun checkForServerUpdate(root: File, manualRetry: Boolean = false): ServiceUpdateResult {
        return try {
            val publicKeyPem = readPublicKeyOrNull()
                ?: return ServiceUpdateResult("未配置 Offline 更新验证公钥", failed = true)
            val source = fetchManifest(publicKeyPem)
                ?: return ServiceUpdateResult("局域网与外网均无可用更新清单")
            val current = readInstalledServiceVersion(root)
            OfflineTaskCode.assertCombination(source.manifest.taskCode, source.manifest.code, source.manifest.dependencies,
                packageVersionCode(getInstalledPackageInfo()))
            if (isRejectedRelease(root, source.manifest)) {
                return ServiceUpdateResult(
                    "候选服务版本此前启动失败，已跳过自动重试",
                    installed = current,
                    targetCodeVersion = source.manifest.code.version,
                    targetDependencyVersion = source.manifest.dependencies.version,
                    failed = true
                )
            }
            val plan = planServiceUpdate(current, source.manifest)
            val pendingRepair = source.manifest.dataRepair?.takeUnless {
                isDataRepairApplied(root, it) || (!manualRetry && OfflineDataRepairState.failure(root, it) != null)
            }
            if (plan == ServiceUpdatePlan.CURRENT) {
                if (pendingRepair == null) {
                    return ServiceUpdateResult("服务已是当前版本", installed = current, plan = plan)
                }
                val minimumApk = pendingRepair.requiredApkVersionCode
                if (minimumApk != null && packageVersionCode(getInstalledPackageInfo()) < minimumApk.toLong()) {
                    return ServiceUpdateResult("数据修复需要先安装 APK v$minimumApk 或更高版本", installed = current, plan = plan)
                }
                if (pendingRepair.requiredCodeVersion > current.codeVersion) {
                    return ServiceUpdateResult("数据修复需要先更新服务代码到 v${pendingRepair.requiredCodeVersion}", installed = current, plan = plan)
                }
                return ServiceUpdateResult(
                    status = "发现 Offline 数据修复",
                    hasUpdate = true,
                    plan = ServiceUpdatePlan.DATA_REPAIR_ONLY,
                    installed = current,
                    targetCodeVersion = current.codeVersion,
                    targetDependencyVersion = current.dependencyVersion,
                    downloadBytes = pendingRepair.artifact.size,
                    dataRepair = pendingRepair
                )
            }
            if (plan == ServiceUpdatePlan.NEEDS_ALL) {
                return ServiceUpdateResult(
                    "服务版本/依赖指纹不匹配，需要发布 all 更新",
                    installed = current,
                    plan = plan,
                    failed = true,
                    targetCodeVersion = source.manifest.code.version,
                    targetDependencyVersion = source.manifest.dependencies.version,
                    dataRepair = pendingRepair
                )
            }
            val downloadBytes = when (plan) {
                ServiceUpdatePlan.CODE_ONLY -> source.manifest.code.size
                ServiceUpdatePlan.ALL -> safeAdd(source.manifest.code.size, source.manifest.dependencies.androidDownloadBytes())
                    ?: throw IllegalArgumentException("更新下载总大小溢出")
                else -> 0L
            }.let { base -> Math.addExact(base, taskDownloadBytes(current, source.manifest)) }
                .let { base -> if (pendingRepair == null) base else safeAdd(base, pendingRepair.artifact.size) }
                ?: throw IllegalArgumentException("更新下载总大小溢出")
            ServiceUpdateResult(
                status = if (plan == ServiceUpdatePlan.TASK_CODE_ONLY) "发现 Offline 任务代码更新 v${source.manifest.taskCode?.version}" else "发现 Offline 服务更新",
                hasUpdate = true,
                plan = plan,
                installed = current,
                targetCodeVersion = source.manifest.code.version,
                targetDependencyVersion = source.manifest.dependencies.version,
                targetTaskCodeVersion = source.manifest.taskCode?.version,
                downloadBytes = downloadBytes,
                dataRepair = pendingRepair
            )
        } catch (error: Exception) {
            Log.e(TAG, "Offline 服务更新检查失败: ${error.message}", error)
            ServiceUpdateResult("拒绝服务更新：${error.message ?: "检查失败"}", failed = true)
        }
    }

    /**
     * 修复旧版 active release 已指向 legacy-root、但目标版本热更依赖已经存在的状态。
     * 该迁移不联网、不下载文件，优先信任安装器 marker；兼容旧流程时使用依赖包自身的
     * version/lockSha256/express 元数据校验，并保留当前健康检查状态。
     */
    fun repairLegacyDependencyPointer(root: File): Boolean {
        val pointer = readReleasePointer(root) ?: return false
        if (!pointer.legacyDependencies) return false
        val dependencyDirectory = File(root, "updates/dependencies/dependencies-v${pointer.dependencyVersion}")
        val markerValid = hasDependencyDirectoryMarker(dependencyDirectory, pointer.dependencyVersion) { true }
        val packageMetadataValid = hasDependencyPackageMetadata(
            dependencyDirectory,
            pointer.dependencyVersion,
            pointer.lockSha256
        )
        if (!markerValid && !packageMetadataValid) {
            Log.w(TAG, "未自动修复 legacy-root：热更依赖目录校验失败 ${dependencyDirectory.absolutePath}")
            return false
        }
        writeReleasePointer(root, pointer.copy(legacyDependencies = false))
        Log.i(TAG, "已将 active release 依赖来源从 legacy-root 修复为 dependencies-v${pointer.dependencyVersion}")
        return true
    }

    /** 用户确认后重新读取并验签清单，下载、校验并原子切换服务 release。 */
    fun applyServerUpdate(
        root: File,
        onProgress: ((OfflineUpdateProgress) -> Unit)? = null
    ): ServiceUpdateApplyResult {
        return try {
            File(root, "data-repair/notified-failure.json").delete()
            val status = checkAndApplyServerUpdateInternal(root, onProgress)
            ServiceUpdateApplyResult(
                status,
                status.startsWith("已应用服务更新") || status.startsWith("已准备数据修复")
            )
        } catch (error: Exception) {
            Log.e(TAG, "服务更新失败，继续使用当前版本: ${error.message}", error)
            ServiceUpdateApplyResult("保留当前版本：${error.message ?: "更新失败"}")
        }
    }

    /** 兼容现有启动日志调用；新的前台流程使用 applyServerUpdate。 */
    fun checkAndApplyServerUpdate(root: File): String {
        return applyServerUpdate(root).status
    }

    private fun checkAndApplyServerUpdateInternal(
        root: File,
        onProgress: ((OfflineUpdateProgress) -> Unit)? = null
    ): String {
        val publicKeyPem = readPublicKeyOrNull() ?: return "未配置 Offline 更新验证公钥"
        val source = fetchManifest(publicKeyPem) ?: return "局域网与外网均无可用更新清单"
        if (isRejectedRelease(root, source.manifest)) {
            return "候选服务版本此前启动失败，已跳过自动重试"
        }
        val current = readInstalledServiceVersion(root)
        check(readReleasePointer(root)?.pendingHealth != true) { "当前候选组合尚未通过健康检查，请先完成启动或回滚" }
        OfflineTaskCode.assertCombination(source.manifest.taskCode, source.manifest.code, source.manifest.dependencies,
            packageVersionCode(getInstalledPackageInfo()))
        val plan = planServiceUpdate(current, source.manifest)
        val pendingRepair = source.manifest.dataRepair?.takeUnless { isDataRepairApplied(root, it) }
        if (plan == ServiceUpdatePlan.CURRENT && pendingRepair == null) return "服务已是当前版本"
        if (plan == ServiceUpdatePlan.NEEDS_ALL) return "服务版本/依赖指纹不匹配，需要发布 all 更新"
        val effectivePlan = if (plan == ServiceUpdatePlan.CURRENT) ServiceUpdatePlan.DATA_REPAIR_ONLY else plan

        val updatesDirectory = File(root, "updates")
        check(updatesDirectory.isDirectory || updatesDirectory.mkdirs()) { "无法创建 Offline 更新目录" }
        val requiredDownloads = when (effectivePlan) {
            ServiceUpdatePlan.CODE_ONLY -> source.manifest.code.size
            ServiceUpdatePlan.ALL -> safeAdd(source.manifest.code.size, source.manifest.dependencies.androidDownloadBytes())
                ?: throw IllegalArgumentException("更新下载总大小溢出")
            ServiceUpdatePlan.DATA_REPAIR_ONLY -> 0L
            else -> 0L
        }.let { base -> Math.addExact(base, taskDownloadBytes(current, source.manifest)) }.let { base ->
            if (pendingRepair == null) base else safeAdd(base, pendingRepair.artifact.size)
        } ?: throw IllegalArgumentException("更新下载总大小溢出")
        onProgress?.invoke(OfflineUpdateProgress("checking", 0L, requiredDownloads, "正在检查服务更新空间"))
        val initialAvailable = StatFs(root.absolutePath).availableBytes
        check(hasEnoughSpace(initialAvailable, requiredDownloads, 0L, ROLLBACK_RESERVE_BYTES)) {
            "设备剩余空间不足，未下载或切换 Offline 服务更新"
        }

        val stage = File(updatesDirectory, ".staging-${System.currentTimeMillis()}-${android.os.Process.myPid()}")
        check(stage.mkdir()) { "无法创建 Offline 更新暂存目录" }
        try {
            val codeArchive = if (effectivePlan in setOf(ServiceUpdatePlan.CODE_ONLY, ServiceUpdatePlan.ALL)) {
                downloadArtifact(source, source.manifest.code, File(stage, "code.zip"), onProgress)
            } else {
                null
            }
            val repairArchive = pendingRepair?.let {
                downloadArtifact(source, it.artifact, File(stage, "data-repair.zip"), onProgress)
            }
            val taskArchive = source.manifest.taskCode?.takeIf {
                taskDownloadBytes(current, source.manifest) > 0 && !reuseTaskCodeDirectory(root, it)
            }?.let {
                downloadArtifact(source, it.artifact, File(stage, "task-code.zip"), onProgress)
            }
            onProgress?.invoke(OfflineUpdateProgress("verifying", 0L, 1L, "正在校验服务更新包"))
            val codeInspection = codeArchive?.let { validateComponentArchive(it.file, "code") }
            val repairInspection = repairArchive?.let { validateComponentArchive(it.file, "dataRepair") }
            val taskInspection = taskArchive?.let { validateComponentArchive(it.file, "taskCode") }
            val expandedBytes = safeAdd(codeInspection?.expandedBytes ?: 0L, 0L)
                ?.let { safeAdd(it, repairInspection?.expandedBytes ?: 0L) }
                ?.let { safeAdd(it, taskInspection?.expandedBytes ?: 0L) }
                ?: throw IllegalArgumentException("更新展开大小溢出")
            val afterDownloadAvailable = StatFs(root.absolutePath).availableBytes
            check(hasEnoughSpace(afterDownloadAvailable, 0L, expandedBytes, ROLLBACK_RESERVE_BYTES)) {
                "设备剩余空间不足以保留回滚版本并解压更新"
            }

            val codeDirectory = if (codeArchive != null) {
                val codeStage = File(stage, "code")
                extractZipArchive(codeArchive.file, codeStage)
                validateCodePackage(codeStage, source.manifest.code)
                installVersionDirectory(
                    stageDirectory = codeStage,
                    destination = File(updatesDirectory, "code/code-v${source.manifest.code.version}"),
                    component = source.manifest.code,
                    kind = "code"
                )
            } else {
                null
            }

            val dependencyDirectory = if (effectivePlan == ServiceUpdatePlan.ALL) {
                val dependencyStage = OfflineDependencyGroups.prepare(root, source, stage, this, onProgress)
                OfflineDependencyGroups.validateLock(dependencyStage, File(codeDirectory, "package-lock.json"))
                installVersionDirectory(dependencyStage,
                    File(updatesDirectory, "dependencies/dependencies-v${source.manifest.dependencies.version}"),
                    source.manifest.dependencies, "dependencies")
            } else null

            val oldPointer = readReleasePointer(root)
            source.manifest.taskCode?.let { metadata ->
                val destination = File(updatesDirectory, "task-code/task-code-v${metadata.version}")
                if (taskArchive != null) {
                    val taskStage = File(stage, "task-code")
                    extractZipArchive(taskArchive.file, taskStage)
                    OfflineTaskCode.validateDirectory(taskStage, metadata)
                    installVersionDirectory(taskStage, destination, metadata.artifact, "taskCode")
                }
                OfflineTaskCode.validateDirectory(destination, metadata)
            }
            val dependencyResolution = if (dependencyDirectory == null) {
                resolveCodeOnlyDependencyDirectory(
                    root = root,
                    dependencyVersion = source.manifest.dependencies.version,
                    dependencySha256 = source.manifest.dependencies.sha256,
                    previousDependencyVersion = oldPointer?.dependencyVersion ?: current.dependencyVersion,
                    previousLegacyDependencies = oldPointer?.legacyDependencies
                )
            } else {
                DependencyDirectoryResolution(dependencyDirectory, legacyDependencies = false)
            }
            if (source.manifest.taskCode != null) {
                // 复用组件也必须来自这份签名清单，不能只凭同版本号接受未知内容。
                val selectedCode = codeDirectory ?: File(root, "updates/code/code-v${source.manifest.code.version}")
                requireVerifiedIdentity(selectedCode, source.manifest.code, "code")
                val selectedDependencies = if (dependencyResolution.directory.name == "node_modules")
                    dependencyResolution.directory.parentFile!! else dependencyResolution.directory
                requireVerifiedIdentity(selectedDependencies, source.manifest.dependencies, "dependencies")
                validateCodePackage(selectedCode, source.manifest.code)
                OfflineDependencyGroups.validateLock(selectedDependencies, File(selectedCode, "package-lock.json"))
            }
            repairArchive?.let {
                val repairMetadata = pendingRepair ?: throw IllegalStateException("数据修复包元数据缺失")
                val repairStage = File(stage, "data-repair")
                extractZipArchive(it.file, repairStage)
                validateDataRepairPackage(repairStage, repairMetadata)
                val repairDirectory = installVersionDirectory(
                    stageDirectory = repairStage,
                    destination = File(updatesDirectory, "data-repair/data-repair-v${repairMetadata.repairVersion}"),
                    component = repairMetadata.artifact,
                    kind = "dataRepair"
                )
                writePendingDataRepair(root, repairMetadata, repairDirectory)
            }
            if (effectivePlan != ServiceUpdatePlan.DATA_REPAIR_ONLY) {
                val installedDependencyDirectory = dependencyResolution.directory
                check(installedDependencyDirectory.isDirectory) { "当前 Android production dependencies 目录不存在" }
                val pointer = OfflineReleasePointer(
                    codeVersion = source.manifest.code.version,
                    dependencyVersion = source.manifest.dependencies.version,
                    lockSha256 = source.manifest.dependencies.lockSha256.orEmpty(),
                    legacyDependencies = dependencyResolution.legacyDependencies,
                    pendingHealth = true,
                    previous = current,
                    previousLegacyDependencies = oldPointer?.legacyDependencies ?: true,
                    taskCodeVersion = source.manifest.taskCode?.version,
                    taskCodeSha256 = source.manifest.taskCode?.sha256
                )
                onProgress?.invoke(OfflineUpdateProgress("switching", 1L, 1L, "正在切换服务版本"))
                writeReleasePointer(root, pointer)
                Log.i(TAG, "已原子切换服务版本 code=${pointer.codeVersion}, dependencies=${pointer.dependencyVersion}")
            }

            onProgress?.invoke(OfflineUpdateProgress("switching", 1L, 1L, "正在切换服务版本"))
            return if (effectivePlan == ServiceUpdatePlan.DATA_REPAIR_ONLY) {
                "已准备数据修复 ${pendingRepair?.repairId ?: "unknown"}"
            } else {
                "已应用服务更新 ${source.manifest.code.version}/${source.manifest.dependencies.version} 任务${source.manifest.taskCode?.version ?: "内置"}"
            }
        } finally {
            stage.deleteRecursively()
        }
    }

    /** 只检查是否存在更高版本，不下载 APK，供前台显示手动下载提示。 */
    fun checkForMinApkUpdate(root: File): MinApkUpdateResult {
        return try {
            val candidate = resolveMinApkCandidate(root)
            if (candidate == null) {
                MinApkUpdateResult("当前没有可用的 min APK 更新")
            } else {
                MinApkUpdateResult(
                    "发现 min APK ${candidate.metadata.versionName} 更新",
                    metadata = candidate.metadata
                )
            }
        } catch (error: Exception) {
            Log.e(TAG, "Offline min APK 更新检查失败: ${error.message}", error)
            MinApkUpdateResult("拒绝 min APK 更新：${error.message ?: "校验失败"}", failed = true)
        }
    }

    /** 用户确认后下载、验签并预检 update-only APK；模型缓存物化发生在 PackageInstaller 之前。 */
    fun checkAndPrepareMinApkUpdate(
        root: File,
        onProgress: ((OfflineUpdateProgress) -> Unit)? = null
    ): MinApkUpdateResult {
        return try {
            checkAndPrepareMinApkUpdateInternal(root, onProgress)
        } catch (error: Exception) {
            Log.e(TAG, "Offline min APK 更新检查失败: ${error.message}", error)
            MinApkUpdateResult("拒绝 min APK 更新：${error.message ?: "校验失败"}", failed = true)
        }
    }

    private data class MinApkCandidate(
        val source: ManifestSource,
        val metadata: OfflineMinApkArtifact,
        val apkFile: File,
        val modelIds: List<String>
    )

    private fun resolveMinApkCandidate(root: File): MinApkCandidate? {
        check(context.packageName == MIN_APK_PACKAGE_NAME) { "当前安装包不是 Offline APK" }
        check(NodeRuntimeInstaller.hasFullOfflineInstall(root)) { "尚未检测到完整 Offline APK 数据目录" }
        val publicKeyPem = readPublicKeyOrNull() ?: return null
        val source = fetchManifest(publicKeyPem) ?: return null
        val minApk = source.manifest.apkMin ?: return null
        require(minApk.packageName == context.packageName) { "min APK applicationId 不匹配" }

        val installedInfo = getInstalledPackageInfo()
        val installedVersionCode = packageVersionCode(installedInfo)
        if (minApk.versionCode <= installedVersionCode) return null
        val installedSigners = signerSha256Digests(installedInfo)
        require(minApk.signerSha256 in installedSigners) {
            "min APK signer 与当前已安装 Offline APK 不一致"
        }

        val compatibility = minApk.runtimeCompatibility
        val modelIds = if (compatibility != null) {
            OfflineRuntimeState.requireCompatible(compatibility)
            // 新契约只保护当前 APK 真正持有的模型；历史记录不能伪造新 APK 的 assets。
            runCatching {
                val metadata = JSONObject(assetManager.open("offline-model-manifest.json").bufferedReader().use { it.readText() })
                val models = metadata.getJSONArray("models")
                (0 until models.length()).map { models.getJSONObject(it).getString("modelId") }
            }.getOrDefault(emptyList())
        } else {
            val (legacySha256, legacyIds) = readModelCompatibility(root)
            require(minApk.modelCompatibilitySha256 == legacySha256) { "min APK 旧模型兼容指纹不匹配" }
            legacyIds
        }

        val apkFile = File(root, "updates/apk/aasc-display-offline-min-v${minApk.versionCode}.apk")
        return MinApkCandidate(source, minApk, apkFile, modelIds)
    }

    private fun checkAndPrepareMinApkUpdateInternal(
        root: File,
        onProgress: ((OfflineUpdateProgress) -> Unit)?
    ): MinApkUpdateResult {
        val candidate = resolveMinApkCandidate(root)
            ?: return MinApkUpdateResult("当前没有可用的 min APK 更新")
        val source = candidate.source
        val minApk = candidate.metadata
        val apkFile = candidate.apkFile
        onProgress?.invoke(OfflineUpdateProgress("checking", 0L, minApk.artifact.size, "正在检查更新空间"))
        val cachedArtifactExists = apkFile.isFile
        if (cachedArtifactExists) {
            require(apkFile.length() == minApk.artifact.size &&
                sha256File(apkFile) == minApk.artifact.sha256) {
                "已缓存的 min APK 与签名清单不匹配，拒绝覆盖"
            }
        }
        var modelsToMaterialize = 0L
        val modelManagers = candidate.modelIds.map { modelId ->
            val manager = MnnLlmModelManager(context, { null }, bundledModelId = modelId)
            modelsToMaterialize = safeAdd(
                modelsToMaterialize,
                manager.estimateBundledModelMaterializationBytes(modelId)
            ) ?: throw IllegalArgumentException("bundled 模型缓存空间预算溢出")
            manager
        }
        val installReserve = safeAdd(minApk.artifact.size, MIN_APK_INSTALL_RESERVE_BYTES)
            ?: throw IllegalArgumentException("min APK 安装空间预算溢出")
        check(hasEnoughSpace(
            StatFs(root.absolutePath).availableBytes,
            if (cachedArtifactExists) 0L else minApk.artifact.size,
            modelsToMaterialize,
            installReserve
        )) { "设备空间不足，未下载或安装 min APK" }

        val downloaded = if (cachedArtifactExists) {
            onProgress?.invoke(OfflineUpdateProgress("downloading", minApk.artifact.size, minApk.artifact.size, "已使用已缓存 APK"))
            DownloadedArtifact(minApk.artifact, apkFile)
        } else {
            check(apkFile.parentFile?.isDirectory == true || apkFile.parentFile?.mkdirs() == true) {
                "无法创建 min APK 下载目录"
            }
            downloadArtifact(source, minApk.artifact, apkFile, onProgress)
        }
        onProgress?.invoke(OfflineUpdateProgress("verifying", 0L, 1L, "正在校验 APK 签名和 SHA-256"))
        validateMinApkArchive(downloaded.file, minApk)

        // Android 更新 APK 会替换 APK assets；先把完整包中的 bundled MNN 权重物化到 files/models。
        modelManagers.forEachIndexed { index, manager ->
            onProgress?.invoke(
                OfflineUpdateProgress(
                    "materializing",
                    index.toLong(),
                    modelManagers.size.toLong(),
                    "正在准备模型缓存 ${index + 1}/${modelManagers.size}"
                )
            )
            manager.ensureBundledModelMaterialized(candidate.modelIds[index])
        }
        onProgress?.invoke(OfflineUpdateProgress("ready", 1L, 1L, "APK 已校验，准备提交系统安装"))
        return MinApkUpdateResult(
            "min APK ${minApk.versionName} 已验证，可请求系统安装",
            downloaded.file,
            minApk
        )
    }

    fun requiresUnknownSourcesApproval(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()

    /** 将已经验证并缓存的 min APK 写入系统 PackageInstaller 会话；最终仍由系统展示用户确认。 */
    fun installPreparedMinApk(update: MinApkUpdateResult): Boolean {
        if (requiresUnknownSourcesApproval()) return false
        val root = File(context.filesDir, "aasc-server").canonicalFile
        val canonicalApk = update.apkFile?.canonicalFile
            ?: throw IllegalArgumentException("min APK 更新结果没有本地安装文件")
        val metadata = update.metadata
            ?: throw IllegalArgumentException("min APK 更新结果没有签名元数据")
        require(metadata.versionCode.toLong() > packageVersionCode(getInstalledPackageInfo())) {
            "min APK versionCode 已不是当前安装版本的增量更新"
        }
        require(canonicalApk.toPath().startsWith(File(root, "updates/apk").canonicalFile.toPath())) {
            "min APK 安装文件不在受控更新缓存目录"
        }
        require(canonicalApk.length() == metadata.artifact.size && sha256File(canonicalApk) == metadata.artifact.sha256) {
            "min APK 安装前 SHA-256 校验失败"
        }
        validateMinApkArchive(canonicalApk, metadata)

        val installer = context.packageManager.packageInstaller
        val parameters = android.content.pm.PackageInstaller.SessionParams(
            android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL
        ).apply {
            setAppPackageName(MIN_APK_PACKAGE_NAME)
            setSize(canonicalApk.length())
        }
        val sessionId = installer.createSession(parameters)
        installer.openSession(sessionId).use { session ->
            FileInputStream(canonicalApk).use { input ->
                session.openWrite("base.apk", 0L, canonicalApk.length()).use { output ->
                    input.copyTo(output)
                    session.fsync(output)
                }
            }
            val callback = Intent(context, OfflineApkInstallReceiver::class.java)
                .setAction(MIN_APK_INSTALL_ACTION)
                .putExtra(OfflineApkInstallReceiver.EXTRA_APK_PATH, canonicalApk.absolutePath)
            val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
            val pendingIntent = PendingIntent.getBroadcast(context, sessionId, callback, pendingFlags)
            session.commit(pendingIntent.intentSender)
        }
        Log.i(TAG, "已将 min APK 提交给系统 PackageInstaller 会话 #$sessionId")
        return true
    }

    internal fun readPublicKeyOrNull(): String? {
        return try {
            assetManager.open(PUBLIC_KEY_ASSET).bufferedReader().use { it.readText() }
                .takeIf { it.isNotBlank() }
        } catch (_: IOException) {
            null
        }
    }

    internal fun fetchManifest(publicKeyPem: String): ManifestSource? {
        var lastError: IOException? = null
        for (baseUrl in resolveConfiguredUpdateBaseUrls(UPDATE_BASE_URLS)) {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(URL(baseUrl), "manifest.json").openConnection() as HttpURLConnection).apply {
                    connectTimeout = CONNECT_TIMEOUT_MS
                    readTimeout = READ_TIMEOUT_MS
                    requestMethod = "GET"
                    instanceFollowRedirects = false
                }
                val status = connection.responseCode
                if (status == HttpURLConnection.HTTP_NOT_FOUND) continue
                if (status !in 200..299) throw IOException("读取更新清单 HTTP $status")
                val raw = connection.inputStream.use { readBoundedText(it, MAX_MANIFEST_BYTES) }
                // 响应正常但签名错误时直接拒绝，不把信任失败伪装成网络故障回退。
                return ManifestSource(baseUrl, OfflineUpdateManifest.parse(raw, publicKeyPem), raw)
            } catch (error: IOException) {
                lastError = error
            } finally {
                connection?.disconnect()
            }
        }
        if (lastError != null) throw IOException("LAN/WAN 更新清单读取失败：${lastError.message}", lastError)
        return null
    }

    internal fun downloadArtifact(
        source: ManifestSource,
        metadata: OfflineUpdateArtifact,
        destination: File,
        onProgress: ((OfflineUpdateProgress) -> Unit)? = null
    ): DownloadedArtifact {
        val candidateBases = resolveConfiguredUpdateBaseUrls(
            listOf(source.baseUrl) + UPDATE_BASE_URLS
        )
        var lastError: IOException? = null
        for (baseUrl in candidateBases) {
            val temporary = File(destination.parentFile, "${destination.name}.part")
            temporary.delete()
            var connection: HttpURLConnection? = null
            try {
                connection = (URL(URL(baseUrl), metadata.relativeUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = CONNECT_TIMEOUT_MS
                    readTimeout = READ_TIMEOUT_MS
                    requestMethod = "GET"
                    instanceFollowRedirects = false
                }
                val status = connection.responseCode
                if (status !in 200..299) throw IOException("下载 ${metadata.relativeUrl} HTTP $status")
                val digest = MessageDigest.getInstance("SHA-256")
                var totalBytes = 0L
                var lastReportedBytes = 0L
                var lastReportedAt = 0L
                onProgress?.invoke(OfflineUpdateProgress("downloading", 0L, metadata.size, metadata.relativeUrl))
                connection.inputStream.use { input ->
                    FileOutputStream(temporary).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            totalBytes = safeAdd(totalBytes, count.toLong())
                                ?: throw IllegalStateException("更新下载大小溢出")
                            require(totalBytes <= metadata.size) { "更新包大于签名清单声明大小" }
                            digest.update(buffer, 0, count)
                            output.write(buffer, 0, count)
                            val now = System.currentTimeMillis()
                            if (totalBytes == metadata.size ||
                                totalBytes - lastReportedBytes >= 256L * 1024L ||
                                now - lastReportedAt >= 250L) {
                                onProgress?.invoke(
                                    OfflineUpdateProgress(
                                        "downloading",
                                        totalBytes,
                                        metadata.size,
                                        metadata.relativeUrl
                                    )
                                )
                                lastReportedBytes = totalBytes
                                lastReportedAt = now
                            }
                        }
                        output.fd.sync()
                    }
                }
                require(totalBytes == metadata.size) { "更新包下载大小校验失败: ${metadata.relativeUrl}" }
                require(digest.digest().toHexString() == metadata.sha256.lowercase()) {
                    "更新包 SHA-256 校验失败: ${metadata.relativeUrl}"
                }
                check(temporary.renameTo(destination)) { "无法落盘更新包: ${metadata.relativeUrl}" }
                return DownloadedArtifact(metadata, destination)
            } catch (error: IOException) {
                lastError = error
                temporary.delete()
            } finally {
                connection?.disconnect()
                temporary.delete()
            }
        }
        throw IOException("局域网和外网均无法下载 ${metadata.relativeUrl}: ${lastError?.message}", lastError)
    }

    internal fun validateComponentArchive(archiveFile: File, component: String): ZipInspection =
        inspectComponentArchive(archiveFile, component)

    private fun validateDataRepairPackage(directory: File, expected: OfflineDataRepairArtifact) {
        val script = File(directory, "repair.js")
        require(script.isFile) { "dataRepair 更新包缺少 repair.js" }
        require(sha256File(script).equals(expected.scriptSha256, ignoreCase = true)) {
            "dataRepair repair.js SHA-256 与签名清单不匹配"
        }
        val entries = directory.walkTopDown()
            .filter { it.isFile }
            .map { it.relativeTo(directory).invariantSeparatorsPath }
            .toSet()
        require(entries == setOf("repair.js")) { "dataRepair 更新包只能包含 repair.js" }
    }

    private fun writePendingDataRepair(
        root: File,
        metadata: OfflineDataRepairArtifact,
        installedDirectory: File
    ) {
        val pendingFile = File(root, "data-repair/pending-repair.json")
        val script = File(installedDirectory, "repair.js")
        val scriptRelativePath = script.relativeTo(root).invariantSeparatorsPath
        val pending = JSONObject()
            .put("format", "aasc-offline-data-repair")
            .put("schemaVersion", 1)
            .put("repairId", metadata.repairId)
            .put("repairVersion", metadata.repairVersion)
            .put("requiredCodeVersion", metadata.requiredCodeVersion)
            .put("requiredDataVersion", metadata.requiredDataVersion)
            .put("targetDataVersion", metadata.targetDataVersion)
            .put("compatibleDataVersions", org.json.JSONArray(metadata.compatibleDataVersions))
            .put("script", scriptRelativePath)
            .put("scriptSha256", metadata.scriptSha256)
            .put("capabilities", org.json.JSONArray(metadata.capabilities))
            .put("sensitive", metadata.sensitive)
        metadata.requiredApkVersionCode?.let { pending.put("requiredApkVersionCode", it) }
        writeJsonAtomically(pendingFile, pending)
    }

    internal fun validateCodePackage(directory: File, expected: OfflineUpdateArtifact) {
        val launcher = File(directory, "src/apps/server/boot/server-launcher.js")
        val packageJson = File(directory, "package.json")
        val packageLock = File(directory, "package-lock.json")
        require(launcher.isFile && packageJson.isFile && packageLock.isFile) { "更新服务包缺少入口或 package 文件" }
        require(!File(directory, "node_modules").exists()) { "code-only 更新包不得包含 node_modules" }
        require(sha256File(packageLock) == expected.requiredLockSha256) {
            "更新代码包 package-lock.json 与签名清单不匹配"
        }
        val metadata = JSONObject(packageJson.readText())
        require(metadata.optJSONObject("dependencies")?.has("express") == true) {
            "更新代码 package.json 缺少 express 依赖声明"
        }
    }

    internal fun validateDependencyPackage(directory: File, expected: OfflineUpdateArtifact) {
        val metadata = JSONObject(File(directory, "dependency-manifest.json").readText())
        require(metadata.optInt("version", -1) == expected.version) { "dependencies 版本与签名清单不匹配" }
        require(metadata.optString("lockSha256").equals(expected.lockSha256, ignoreCase = true)) {
            "dependencies lockfile 指纹与签名清单不匹配"
        }
        require(File(directory, "node_modules/express/package.json").isFile) { "Android production dependencies 缺少 express" }
    }

    private fun readModelCompatibility(root: File): Pair<String, List<String>> {
        return parseModelCompatibility(
            File(root, "offline-model-compatibility.json").readText(),
            File(root, "offline-model-manifest.json").readText()
        )
    }

    @Suppress("DEPRECATION")
    private fun getInstalledPackageInfo(): PackageInfo {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES
        } else {
            PackageManager.GET_SIGNATURES
        }
        return context.packageManager.getPackageInfo(context.packageName, flags)
    }

    private fun packageVersionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun signerSha256Digests(info: PackageInfo): Set<String> {
        val signatures = mutableListOf<android.content.pm.Signature>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners?.let { signatures += it.toList() }
            info.signingInfo?.signingCertificateHistory?.let { signatures += it.toList() }
        }
        info.signatures?.let { signatures += it.toList() }
        return signatures.map { signature ->
            MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()).toHexString()
        }.toSet()
    }

    @Suppress("DEPRECATION")
    private fun readArchivePackageInfos(apkFile: File): List<PackageInfo> {
        val packageManager = context.packageManager
        val infos = mutableListOf<PackageInfo>()
        val primaryFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES
        } else {
            PackageManager.GET_SIGNATURES
        }
        packageManager.getPackageArchiveInfo(apkFile.absolutePath, primaryFlags)?.let { infos += it }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageManager.getPackageArchiveInfo(apkFile.absolutePath, PackageManager.GET_SIGNATURES)?.let { infos += it }
        }
        return infos
    }

    @Suppress("DEPRECATION")
    private fun validateMinApkArchive(apkFile: File, metadata: OfflineMinApkArtifact) {
        require(apkFile.isFile) { "min APK 文件不存在" }
        val packageInfos = readArchivePackageInfos(apkFile)
        val packageInfo = packageInfos.firstOrNull()
            ?: throw IllegalArgumentException("无法解析 min APK 包信息")
        require(packageInfo.packageName == metadata.packageName && packageInfo.packageName == context.packageName) {
            "min APK applicationId 与当前安装包不匹配"
        }
        require(packageVersionCode(packageInfo) == metadata.versionCode.toLong()) {
            "min APK versionCode 与签名清单不匹配"
        }
        require(packageInfo.versionName == metadata.versionName) { "min APK versionName 与签名清单不匹配" }
        val apkSigners = packageInfos.fold(emptySet<String>()) { merged, info ->
            mergeSignerSha256Digests(merged, signerSha256Digests(info))
        }
        require(metadata.signerSha256 in apkSigners) { "min APK signer SHA-256 与签名清单不匹配" }
        require(metadata.signerSha256 in signerSha256Digests(getInstalledPackageInfo())) {
            "min APK signer 与当前已安装 Offline APK 不一致"
        }
    }

    internal fun installVersionDirectory(
        stageDirectory: File,
        destination: File,
        component: OfflineUpdateArtifact,
        kind: String
    ): File {
        val parent = destination.parentFile ?: throw IllegalArgumentException("更新版本目录缺少父目录")
        require(!Files.isSymbolicLink(parent.toPath()) && !Files.isSymbolicLink(destination.toPath())) { "更新版本目录不能为链接" }
        check(parent.isDirectory || parent.mkdirs()) { "无法创建更新版本目录" }
        if (destination.exists()) {
            val marker = File(destination, ".offline-update-verified.json")
            val previous = runCatching { JSONObject(marker.readText()) }.getOrNull()
            require(previous?.optInt("version", -1) == component.version &&
                previous.optString("sha256") == component.sha256 && previous.optString("kind") == kind) {
                "更新版本目录已存在但来源校验标记不匹配，拒绝覆盖: ${destination.absolutePath}"
            }
            return destination
        }
        File(stageDirectory, ".offline-update-verified.json").writeText(JSONObject()
            .put("kind", kind)
            .put("version", component.version)
            .put("sha256", component.sha256)
            .toString())
        check(stageDirectory.renameTo(destination)) { "无法原子安装更新版本目录: ${destination.absolutePath}" }
        return destination
    }

    private fun reuseTaskCodeDirectory(root: File, metadata: OfflineTaskCodeArtifact): Boolean {
        val directory = File(root, "updates/task-code/task-code-v${metadata.version}")
        if (!directory.exists()) return false
        requireVerifiedIdentity(directory, metadata.artifact, "taskCode")
        OfflineTaskCode.validateDirectory(directory, metadata)
        return true
    }

    private fun requireVerifiedIdentity(directory: File, component: OfflineUpdateArtifact, kind: String) {
        require(!Files.isSymbolicLink(directory.toPath())) { "组件目录不能为链接" }
        val marker = JSONObject(File(directory, ".offline-update-verified.json").readText())
        require(marker.optString("kind") == kind && marker.optInt("version") == component.version &&
            marker.optString("sha256") == component.sha256) { "复用组件身份与签名清单不一致: $kind" }
    }

    private fun readInstalledServiceVersion(root: File): InstalledServiceVersion {
        val pointer = readReleasePointer(root)
        if (pointer != null) return InstalledServiceVersion(
            pointer.codeVersion,
            pointer.dependencyVersion,
            pointer.lockSha256,
            pointer.taskCodeVersion,
            pointer.taskCodeSha256
        )
        val metadataFile = File(root, CLIENT_METADATA_FILE)
        if (metadataFile.isFile) {
            val metadata = JSONObject(metadataFile.readText())
            val codeVersion = metadata.optInt("codeVersion", -1)
            val dependencyVersion = metadata.optInt("dependencyVersion", -1)
            val lockSha256 = metadata.optString("lockSha256").lowercase()
            require(codeVersion > 0 && dependencyVersion > 0 && lockSha256.matches(Regex("^[a-f0-9]{64}$"))) {
                "Offline APK 内置服务基线 metadata 无效"
            }
            return InstalledServiceVersion(codeVersion, dependencyVersion, lockSha256)
        }
        val lockFile = File(root, "package-lock.json")
        val lockSha256 = if (lockFile.isFile) sha256File(lockFile) else ""
        return InstalledServiceVersion(1, 1, lockSha256)
    }

    private fun readReleasePointer(root: File): OfflineReleasePointer? = OfflineReleaseState.read(root)

    private fun writeReleasePointer(root: File, pointer: OfflineReleasePointer) = OfflineReleaseState.write(root, pointer)

    private fun writeJsonAtomically(destination: File, json: JSONObject) {
        val parent = destination.parentFile ?: throw IllegalArgumentException("JSON 文件缺少父目录")
        check(parent.isDirectory || parent.mkdirs()) { "无法创建更新状态目录" }
        val temporary = File(parent, "${destination.name}.tmp-${android.os.Process.myPid()}-${System.currentTimeMillis()}")
        FileOutputStream(temporary).use { output ->
            output.write((json.toString() + "\n").toByteArray(Charsets.UTF_8))
            output.fd.sync()
        }
        try {
            Files.move(temporary.toPath(), destination.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
        } catch (error: Exception) {
            temporary.delete()
            throw IllegalStateException("无法原子切换 Offline 更新状态文件", error)
        }
    }

    fun rollbackPendingRelease(root: File): Boolean {
        if (OfflineFullApkActivation.isPending(root)) return OfflineFullApkActivation.rollbackPending(root)
        val changed = OfflineReleaseState.rollback(root)
        if (changed) Log.w(TAG, "候选服务启动失败，已回滚完整code/dependencies/taskCode组合")
        return changed
    }

    fun markCurrentReleaseHealthy(root: File): Boolean {
        val pointer = readReleasePointer(root) ?: return false
        if (!pointer.pendingHealth) return false
        writeReleasePointer(root, pointer.copy(
            pendingHealth = false,
            previous = null,
            previousLegacyDependencies = null
        ))
        File(root, "updates/failed-release.json").delete()
        val removed = cleanupObsoleteReleaseDirectories(root)
        if (removed > 0) Log.i(TAG, "健康 Offline release 已清理 $removed 个旧版本目录")
        return true
    }

    fun isReleaseHealthPending(root: File): Boolean = readReleasePointer(root)?.pendingHealth == true

    private fun isRejectedRelease(root: File, manifest: OfflineUpdateManifest): Boolean {
        val failedFile = File(root, "updates/failed-release.json")
        if (!failedFile.isFile) return false
        val failed = JSONObject(failedFile.readText())
        return failed.optInt("codeVersion", -1) == manifest.code.version &&
            failed.optInt("taskCodeVersion", -1) == (manifest.taskCode?.version ?: -1) &&
            failed.optString("taskCodeSha256") == (manifest.taskCode?.sha256 ?: "") &&
            failed.optInt("dependencyVersion", -1) == manifest.dependencies.version &&
            failed.optString("lockSha256").equals(manifest.dependencies.lockSha256, ignoreCase = true)
    }

    private fun readBoundedText(input: java.io.InputStream, maxBytes: Int): String {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            require(total <= maxBytes) { "Offline 更新清单超过大小限制" }
            output.write(buffer, 0, count)
        }
        return output.toString(Charsets.UTF_8.name())
    }

    private fun sha256File(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().toHexString()
    }

    private fun ByteArray.toHexString(): String = joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
}
