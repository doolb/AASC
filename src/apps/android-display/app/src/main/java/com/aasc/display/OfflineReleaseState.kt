package com.aasc.display

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import org.json.JSONObject

/** 独立于Android上下文的完整组合事务；健康检查前保留上一组合，不拆开提交组件。 */
internal data class OfflineReleasePointer(
    val codeVersion: Int, val dependencyVersion: Int, val lockSha256: String,
    val legacyDependencies: Boolean, val pendingHealth: Boolean,
    val previous: InstalledServiceVersion?, val previousLegacyDependencies: Boolean?,
    val taskCodeVersion: Int? = null, val taskCodeSha256: String? = null
)

internal object OfflineReleaseState {
    private fun version(value: JSONObject): InstalledServiceVersion {
        val result = InstalledServiceVersion(OfflineTaskCode.positive(value, "codeVersion"),
            OfflineTaskCode.positive(value, "dependencyVersion"), value.getString("lockSha256"),
            OfflineUpdateManager.readTaskVersion(value), value.optString("taskCodeSha256").takeIf(String::isNotEmpty))
        require(Regex("^[a-f0-9]{64}$").matches(result.lockSha256)) { "服务指针锁指纹无效" }
        return result
    }
    fun read(root: File): OfflineReleasePointer? {
        val file = File(root, OfflineUpdateManager.ACTIVE_RELEASE_FILE)
        if (!file.exists()) return null
        require(file.isFile && !Files.isSymbolicLink(file.toPath())) { "服务指针必须是普通文件" }
        val json = JSONObject(file.readText())
        val current = version(json)
        val previous = json.optJSONObject("previous")?.let(::version)
        return OfflineReleasePointer(current.codeVersion, current.dependencyVersion, current.lockSha256,
            json.optBoolean("legacyDependencies", false), json.optBoolean("pendingHealth", false), previous,
            json.optBoolean("previousLegacyDependencies", true), current.taskCodeVersion, current.taskCodeSha256)
    }
    private fun json(value: InstalledServiceVersion) = JSONObject().put("codeVersion", value.codeVersion)
        .put("dependencyVersion", value.dependencyVersion).put("lockSha256", value.lockSha256)
        .put("taskCodeVersion", value.taskCodeVersion).put("taskCodeSha256", value.taskCodeSha256)
    fun write(root: File, pointer: OfflineReleasePointer) {
        val current = InstalledServiceVersion(pointer.codeVersion, pointer.dependencyVersion, pointer.lockSha256,
            pointer.taskCodeVersion, pointer.taskCodeSha256)
        val value = json(current).put("schemaVersion", 1).put("legacyDependencies", pointer.legacyDependencies)
            .put("pendingHealth", pointer.pendingHealth).put("previousLegacyDependencies", pointer.previousLegacyDependencies)
            .put("previous", pointer.previous?.let(::json) ?: JSONObject.NULL)
        atomic(File(root, OfflineUpdateManager.ACTIVE_RELEASE_FILE), value)
    }
    fun rollback(root: File): Boolean {
        val current = read(root) ?: return false
        if (!current.pendingHealth) return false
        atomic(File(root, "updates/failed-release.json"), json(InstalledServiceVersion(current.codeVersion,
            current.dependencyVersion, current.lockSha256, current.taskCodeVersion, current.taskCodeSha256)))
        val previous = current.previous
        if (previous == null) {
            // 首次独立安装失败时恢复无活动组合的状态，保留所有下载和数据供重试。
            Files.delete(File(root, OfflineUpdateManager.ACTIVE_RELEASE_FILE).toPath())
        } else write(root, OfflineReleasePointer(previous.codeVersion, previous.dependencyVersion, previous.lockSha256,
            current.previousLegacyDependencies ?: true, false, null, null, previous.taskCodeVersion, previous.taskCodeSha256))
        return true
    }
    fun atomic(destination: File, value: JSONObject) {
        val parent = destination.parentFile ?: error("状态文件缺少父目录")
        require(!Files.isSymbolicLink(parent.toPath())) { "状态目录不能是链接" }
        check(parent.isDirectory || parent.mkdirs())
        val temporary = File(parent, ".${destination.name}.tmp-${System.nanoTime()}")
        try {
            FileOutputStream(temporary).use { output -> output.write((value.toString() + "\n").toByteArray()); output.fd.sync() }
            Files.move(temporary.toPath(), destination.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
        } finally { temporary.delete() }
    }
}
