package com.aasc.display

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import org.json.JSONArray
import org.json.JSONObject

/** 整包每次安装仅切回一次内置环境；目录清理延迟到真实服务健康后，不影响后续热更新。 */
object OfflineFullApkActivation {
    data class Installation(val versionCode: Int, val lastUpdateTime: Long, val runtimeVersion: String) {
        val id: String get() = "$versionCode:$lastUpdateTime:$runtimeVersion"
        init {
            require(versionCode > 0 && lastUpdateTime > 0 && runtimeVersion.isNotBlank()
                && runtimeVersion.length <= 256) { "完整 APK 安装身份无效" }
        }
    }

    data class CleanupResult(val removed: Int, val errors: List<String>)
    private const val STATE_FILE = "updates/full-apk-activation.json"
    private const val MAX_STATE_BYTES = 256 * 1024L
    private val buckets = mapOf("code" to "code-v", "dependencies" to "dependencies-v")

    fun isFullProfile(mode: String, updateOnly: Boolean): Boolean = mode == "offline" && !updateOnly

    /** 身份包含系统安装时间，因此同版本重装会触发，日常重启不会触发。 */
    fun requiresInstallation(root: File, installation: Installation): Boolean =
        readState(root)?.optString("installationId") != installation.id

    fun isPending(root: File): Boolean = readState(root)?.optString("phase") == "pending"

    /** 由完整 Runtime 目录事务调用：先持久化恢复记录，再退役旧指针。 */
    fun begin(root: File, installation: Installation) {
        requireSafeRoot(root)
        val metadata = bundledMetadata(root)
        val previousState = readState(root)
        val pointer = File(root, OfflineUpdateManager.ACTIVE_RELEASE_FILE)
        val previousPointer = boundedText(pointer, 16 * 1024L)
        val targets = buckets.flatMap { (bucket, prefix) ->
            val parent = File(root, "updates/$bucket")
            require(!Files.isSymbolicLink(parent.toPath())) { "旧下载目录是链接: $bucket" }
            parent.listFiles().orEmpty().filter { safeVersionDirectory(it, prefix) }
                .map { "updates/$bucket/${it.name}" }
        }
        require(targets.size <= 1000) { "旧下载版本目录过多" }
        writeState(root, JSONObject().put("schemaVersion", 1).put("installationId", installation.id)
            .put("phase", "pending").put("codeVersion", metadata.getInt("codeVersion"))
            .put("dependencyVersion", metadata.getInt("dependencyVersion"))
            .put("previousPointer", previousPointer ?: JSONObject.NULL)
            .put("previousState", previousState ?: JSONObject.NULL).put("targets", JSONArray(targets)))
        resumePending(root)
    }

    /** 记录落盘后进程中断也能继续；新用户确认的指针不能被旧安装事务删除。 */
    fun resumePending(root: File) {
        val state = readState(root)?.takeIf { it.optString("phase") == "pending" } ?: return
        val pointer = File(root, OfflineUpdateManager.ACTIVE_RELEASE_FILE)
        val current = boundedText(pointer, 16 * 1024L) ?: return
        check(current == nullableText(state, "previousPointer")) { "整包切换期间服务指针已变化" }
        Files.delete(pointer.toPath())
    }

    /** 安装事务失败恢复准备前的状态，不能把没有安装成功的身份标为已处理。 */
    fun cancelInstallation(root: File, installation: Installation) {
        val state = readState(root)?.takeIf { it.optString("installationId") == installation.id
            && it.optString("phase") == "pending" } ?: return
        restorePointer(root, state)
        val previous = state.optJSONObject("previousState")
        if (previous != null) writeState(root, previous)
        else Files.deleteIfExists(File(root, STATE_FILE).toPath())
    }

    /** 启动失败保留全部下载目录；同一安装不再反复强制切回，旧指针可继续由监督器启动。 */
    fun rollbackPending(root: File): Boolean {
        val state = readState(root)?.takeIf { it.optString("phase") == "pending" } ?: return false
        val restored = restorePointer(root, state)
        state.put("phase", "failed").remove("previousState")
        writeState(root, state)
        return restored
    }

    /** 首次健康必须验证两种版本及实际路径，HTTP 200 或单独代码版本不足以提交。 */
    fun matchesPendingHealth(root: File, versions: JSONObject): Boolean {
        val state = readState(root)?.takeIf { it.optString("phase") == "pending" } ?: return true
        return runCatching {
            !Files.exists(File(root, OfflineUpdateManager.ACTIVE_RELEASE_FILE).toPath(), NOFOLLOW_LINKS)
                && versions.optString("code") == "v${state.getInt("codeVersion")}"
                && versions.optString("dependencies") == "v${state.getInt("dependencyVersion")}"
                && versions.optString("codePath").isNotBlank()
                && File(versions.getString("codePath")).canonicalFile == root.canonicalFile
                && versions.optString("dependenciesPath").isNotBlank()
                && File(versions.getString("dependenciesPath")).canonicalFile == File(root, "node_modules").canonicalFile
        }.getOrDefault(false)
    }

    /** 调用方已核对实际 HTTP 健康；先记录提交，再清理冻结的旧目录，失败保留可重试清单。 */
    fun markHealthyAndCleanup(root: File): CleanupResult? {
        val state = readState(root) ?: return null
        if (state.optString("phase") !in setOf("pending", "cleanup_pending")) return null
        val targets = state.getJSONArray("targets")
        val paths = (0 until targets.length()).map { targets.getString(it) }
        require(paths.size <= 1000 && paths.all { relative ->
            Regex("^updates/(code/code-v|dependencies/dependencies-v)[1-9][0-9]*$").matches(relative)
                && relative.substringAfterLast("-v").toIntOrNull()?.let { it > 0 } == true
        }) { "整包清理记录路径无效" }
        if (state.optString("phase") == "pending") {
            check(!Files.exists(File(root, OfflineUpdateManager.ACTIVE_RELEASE_FILE).toPath(), NOFOLLOW_LINKS)) {
                "整包服务仍指向下载版本，不能提交"
            }
            val metadata = bundledMetadata(root)
            check(metadata.getInt("codeVersion") == state.getInt("codeVersion")
                && metadata.getInt("dependencyVersion") == state.getInt("dependencyVersion")) { "整包基线已变化" }
            state.put("phase", "cleanup_pending")
            state.remove("previousPointer")
            state.remove("previousState")
            writeState(root, state)
        }
        val keep = referencedDirectories(root)
        val errors = mutableListOf<String>()
        val remaining = mutableListOf<String>()
        var removed = 0
        for (relative in paths) {
            if (relative in keep) continue
            val candidate = File(root, relative)
            try {
                val parent = candidate.parentFile ?: error("下载目录缺少父路径")
                require(!Files.isSymbolicLink(parent.toPath())) { "下载目录是链接" }
                if (!Files.exists(candidate.toPath(), NOFOLLOW_LINKS)) continue
                check(OfflineUpdateManager.removeDownloadedVersionDirectory(candidate)) { "目录包含链接或不可读项" }
                removed += 1
            } catch (error: Exception) {
                remaining += relative
                errors += "$relative: ${error.message}"
            }
        }
        state.put("targets", JSONArray(remaining)).put("phase", if (remaining.isEmpty()) "ready" else "cleanup_pending")
        writeState(root, state)
        return CleanupResult(removed, errors)
    }

    private fun referencedDirectories(root: File): Set<String> {
        val text = boundedText(File(root, OfflineUpdateManager.ACTIVE_RELEASE_FILE), 16 * 1024L) ?: return emptySet()
        val pointer = JSONObject(text)
        val versions = listOfNotNull(pointer, pointer.optJSONObject("previous"))
        return versions.flatMap { value ->
            val code = value.getInt("codeVersion")
            val dependencies = value.getInt("dependencyVersion")
            require(code > 0 && dependencies > 0) { "当前热更新指针版本无效，不能清理" }
            listOf("updates/code/code-v$code", "updates/dependencies/dependencies-v$dependencies")
        }.toSet()
    }

    private fun restorePointer(root: File, state: JSONObject): Boolean {
        val previous = nullableText(state, "previousPointer") ?: return false
        val pointer = File(root, OfflineUpdateManager.ACTIVE_RELEASE_FILE)
        val current = boundedText(pointer, 16 * 1024L)
        check(current == null || current == previous) { "服务指针已由其他事务修改，不能回滚整包切换" }
        if (current == null) atomicWrite(pointer, previous)
        return true
    }

    private fun bundledMetadata(root: File): JSONObject {
        val metadata = JSONObject(boundedText(File(root, OfflineUpdateManager.CLIENT_METADATA_FILE), 16 * 1024L)
            ?: error("整包缺少内置服务基线"))
        val lock = metadata.optString("lockSha256")
        require(metadata.optInt("codeVersion") > 0 && metadata.optInt("dependencyVersion") > 0
            && Regex("^[a-f0-9]{64}$").matches(lock) && ModelHash.matches(File(root, "package-lock.json"), lock)) {
            "整包服务基线与依赖指纹不匹配"
        }
        require(listOf("src/apps/server/boot/server-launcher.js", "package.json", "node_modules/express/package.json")
            .all { Files.isRegularFile(File(root, it).toPath(), NOFOLLOW_LINKS) && File(root, it).length() > 0 }) {
            "整包服务或生产依赖不完整"
        }
        return metadata
    }

    private fun safeVersionDirectory(directory: File, prefix: String): Boolean {
        val number = directory.name.removePrefix(prefix).toIntOrNull() ?: return false
        return number > 0 && directory.name == "$prefix$number"
            && Files.isDirectory(directory.toPath(), NOFOLLOW_LINKS)
    }

    private fun nullableText(value: JSONObject, key: String): String? =
        if (value.isNull(key)) null else value.getString(key)

    private fun readState(root: File): JSONObject? {
        requireSafeRoot(root)
        return boundedText(File(root, STATE_FILE), MAX_STATE_BYTES)?.let {
            JSONObject(it).also { state ->
                require(state.optInt("schemaVersion") == 1 && state.optString("installationId").isNotBlank()
                    && state.optString("phase") in setOf("pending", "ready", "failed", "cleanup_pending")) {
                    "整包切换状态无效"
                }
            }
        }
    }

    private fun requireSafeRoot(root: File) {
        require(!Files.isSymbolicLink(root.toPath()) && !Files.isSymbolicLink(File(root, "updates").toPath())) {
            "整包服务目录不能是链接"
        }
    }

    private fun boundedText(file: File, limit: Long): String? {
        if (!Files.exists(file.toPath(), NOFOLLOW_LINKS)) return null
        require(Files.isRegularFile(file.toPath(), NOFOLLOW_LINKS) && file.length() <= limit) { "整包状态文件无效" }
        return file.readText()
    }

    private fun writeState(root: File, state: JSONObject) {
        requireSafeRoot(root)
        atomicWrite(File(root, STATE_FILE), state.toString() + "\n")
    }

    private fun atomicWrite(file: File, value: String) {
        require(value.toByteArray(Charsets.UTF_8).size <= MAX_STATE_BYTES) { "整包状态超出限制" }
        val parent = file.parentFile ?: error("整包状态缺少父路径")
        check(parent.isDirectory || parent.mkdirs()) { "无法创建整包状态目录" }
        require(!Files.isSymbolicLink(file.toPath())) { "整包状态不能是链接" }
        val temporary = File(parent, ".${file.name}.${java.util.UUID.randomUUID()}.tmp")
        try {
            FileOutputStream(temporary).use { output -> output.write(value.toByteArray(Charsets.UTF_8)); output.fd.sync() }
            Files.move(temporary.toPath(), file.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
        } finally {
            Files.deleteIfExists(temporary.toPath())
        }
    }
}
