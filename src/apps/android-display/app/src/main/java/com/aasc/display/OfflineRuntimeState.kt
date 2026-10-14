package com.aasc.display

import java.io.File
import java.nio.file.Files
import org.json.JSONObject

/** 服务环境与模型文件分开校验；版本化首装不要求根目录存在旧的源码或依赖。 */
object OfflineRuntimeState {
    val compatibility: JSONObject
        get() = JSONObject().put("abi", "arm64-v8a").put("nodeMajor", 26).put("contractVersion", 1)

    fun requireCompatible(value: JSONObject) {
        require(value.optString("abi") == "arm64-v8a" && value.optInt("nodeMajor") == 26
            && value.optInt("contractVersion") == 1) { "Offline 包与 APK 原生运行环境不兼容" }
    }

    fun hasServiceEnvironment(root: File): Boolean = try {
        val pointerFile = File(root, "updates/active-release.json")
        val pointer = if (pointerFile.isFile) JSONObject(pointerFile.readText()) else null
        val code = pointer?.let {
            require(it.optInt("codeVersion") > 0 && it.optInt("dependencyVersion") > 0)
            File(root, "updates/code/code-v${it.getInt("codeVersion")}")
        } ?: root
        val dependencies = pointer?.takeUnless { it.optBoolean("legacyDependencies") }?.let {
            File(root, "updates/dependencies/dependencies-v${it.getInt("dependencyVersion")}/node_modules")
        } ?: File(root, "node_modules")
        val required = listOf(File(code, "src/apps/server/boot/server-launcher.js"), File(code, "package.json"),
            File(code, "package-lock.json"), File(dependencies, "express/package.json"),
            File(root, "config/config.json"))
        required.all { it.isFile && it.length() > 0 && !Files.isSymbolicLink(it.toPath()) }
            && File(root, "runtime/arm64-v8a/lib").listFiles()?.any { it.isFile && it.length() > 0 } == true
            && (pointer == null || validRelease(root, code, dependencies, pointer))
            && (!isStandalone(root) || listOf("res/certs/cert.pem", "res/certs/key.pem", "offline-model-catalog.json")
                .all { File(root, it).isFile && File(root, it).length() > 0 })
    } catch (_: Exception) { false }

    private fun validRelease(root: File, code: File, dependencies: File, pointer: JSONObject): Boolean {
        val rootPath = root.canonicalFile.toPath()
        if (!code.canonicalFile.toPath().startsWith(rootPath)
            || !dependencies.canonicalFile.toPath().startsWith(rootPath)
            || Files.isSymbolicLink(code.toPath()) || Files.isSymbolicLink(dependencies.toPath())) return false
        val lock = pointer.optString("lockSha256")
        if (!Regex("^[a-f0-9]{64}$").matches(lock)
            || !ModelHash.matches(File(code, "package-lock.json"), lock)) return false
        if (!pointer.optBoolean("legacyDependencies")) {
            val metadata = JSONObject(File(dependencies.parentFile, "dependency-manifest.json").readText())
            if (metadata.optInt("version") != pointer.optInt("dependencyVersion")
                || metadata.optString("lockSha256") != lock) return false
        }
        return true
    }

    internal fun isStandalone(root: File): Boolean = runCatching {
        JSONObject(File(root, "updates/bootstrap-state.json").readText()).optBoolean("standalone", false)
    }.getOrDefault(false)
}
