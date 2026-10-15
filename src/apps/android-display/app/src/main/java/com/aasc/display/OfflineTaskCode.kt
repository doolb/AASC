package com.aasc.display

import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import org.json.JSONObject

/** .src/hal/android-task-code-sync.md：任务代码只写入版本目录，任何校验失败都不切换指针。 */
data class OfflineTaskCodeArtifact(val artifact: OfflineUpdateArtifact, val contract: JSONObject, val bundleSha256: String? = null) {
    val version: Int get() = artifact.version
    val sha256: String get() = artifact.sha256
}

object OfflineTaskCode {
    const val MAX_BYTES = 32L * 1024 * 1024
    private val hashes = Regex("^[a-f0-9]{64}$")
    private val names = Regex("^[A-Za-z0-9][A-Za-z0-9._-]*$")
    private val reserved = setOf("results", "logs", "models", "node_modules", "inputs", "outputs", "latest")
    private val keys = listOf("taskCodeApiVersion", "requiredCodeVersion", "maximumCodeVersion", "requiredApkVersionCode", "requiredDependencyVersion", "requiredLockSha256")
    fun positive(value: JSONObject, key: String): Int {
        val result = integer(value, key)
        require(result in 1..Int.MAX_VALUE.toLong()) { "任务包 $key 无效" }
        return result.toInt()
    }
    private fun integer(value: JSONObject, key: String): Long {
        val number = value.get(key)
        require(number is Int || number is Long) { "任务包 $key 必须是整数" }
        return (number as Number).toLong()
    }
    private fun digest(value: ByteArray) = MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun fingerprint(value: JSONObject) = digest(OfflineUpdateManifest.canonicalJson(value).toByteArray(Charsets.UTF_8))
    private fun contract(value: JSONObject) = JSONObject().apply { keys.filter(value::has).forEach { put(it, value.get(it)) } }
    fun validName(value: String) = value.length <= 128 && names.matches(value) && !Regex("^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\\.|$)", RegexOption.IGNORE_CASE).containsMatchIn(value)
    fun codePath(value: String): Boolean = value.length <= 512 && value.split('/').all { validName(it) && it.lowercase() !in reserved } &&
        Regex("\\.(js|cjs|mjs|html|css)$", RegexOption.IGNORE_CASE).containsMatchIn(value) &&
        !Regex("(^|[./_-])(test|tests|spec|smoke)([./_-]|$)", RegexOption.IGNORE_CASE).containsMatchIn(value)

    fun parse(value: JSONObject): OfflineTaskCodeArtifact {
        validateContract(value)
        val version = positive(value, "version")
        val size = integer(value, "size")
        val sha = value.getString("sha256")
        require(size in 1..(MAX_BYTES + 1024 * 1024) && hashes.matches(sha) &&
            value.getString("relativeUrl") == "task-code/task-code-v$version.zip") { "任务包制品路径/大小/摘要无效" }
        val bundle = if (value.has("bundleSha256")) value.getString("bundleSha256").also { require(hashes.matches(it)) } else null
        return OfflineTaskCodeArtifact(OfflineUpdateArtifact(version, value.getString("relativeUrl"), size, sha), contract(value), bundle)
    }
    private fun validateContract(value: JSONObject) {
        require(positive(value, "taskCodeApiVersion") == 1) { "任务 API 不支持" }
        val minimum = positive(value, "requiredCodeVersion")
        positive(value, "requiredApkVersionCode")
        require(!value.has("maximumCodeVersion") || positive(value, "maximumCodeVersion") >= minimum) { "任务代码版本区间无效" }
        if (value.has("requiredDependencyVersion") || value.has("requiredLockSha256")) {
            positive(value, "requiredDependencyVersion")
            require(hashes.matches(value.getString("requiredLockSha256"))) { "任务依赖锁指纹无效" }
        }
    }
    fun assertCombination(task: OfflineTaskCodeArtifact?, code: OfflineUpdateArtifact, dependencies: OfflineUpdateArtifact, apkVersion: Long? = null) {
        if (task == null) return
        val value = task.contract
        require(code.version >= value.getInt("requiredCodeVersion") &&
            (!value.has("maximumCodeVersion") || code.version <= value.getInt("maximumCodeVersion")) &&
            code.taskCodeApiVersion == value.getInt("taskCodeApiVersion")) { "任务需要兼容的服务代码/API版本" }
        require(code.requiredDependencyVersion == dependencies.version && code.requiredLockSha256 == dependencies.lockSha256) { "服务依赖组合不匹配" }
        if (value.has("requiredDependencyVersion")) require(value.getInt("requiredDependencyVersion") == dependencies.version &&
            value.getString("requiredLockSha256") == dependencies.lockSha256) { "任务要求的依赖包不匹配" }
        require(apkVersion == null || apkVersion >= value.getInt("requiredApkVersionCode")) { "请先安装 min APK v${value.getInt("requiredApkVersionCode")}" }
    }

    /** 验证实际文件集合、每文件摘要、任务revision和聚合依赖；不接受额外代码或符号链接。 */
    fun validateDirectory(root: File, expected: OfflineTaskCodeArtifact): JSONObject {
        require(!Files.isSymbolicLink(root.toPath()) && root.isDirectory) { "任务目录不是普通目录" }
        root.walkTopDown().onEnter { require(!Files.isSymbolicLink(it.toPath())); true }.forEach {
            require(!Files.isSymbolicLink(it.toPath()) && (it.isDirectory || it.isFile)) { "任务包不能包含链接或特殊文件" }
        }
        val metadata = File(root, "task-code-manifest.json")
        require(metadata.length() in 1..(1024 * 1024)) { "任务包清单大小无效" }
        val manifest = JSONObject(metadata.readText())
        validateContract(manifest)
        require(manifest.getString("format") == "aasc-task-code" && positive(manifest, "schemaVersion") == 1 &&
            positive(manifest, "version") == expected.version &&
            OfflineUpdateManifest.canonicalJson(contract(manifest)) == OfflineUpdateManifest.canonicalJson(expected.contract)) { "任务包内外契约不一致" }
        val allowed = mutableSetOf("task-code-manifest.json")
        val folded = mutableSetOf<String>()
        val taskNames = mutableSetOf<String>()
        var bytes = 0L
        var count = 0
        var minimum = 0
        var maximum: Int? = null
        var dependency: String? = null
        var dependencyVersion: Int? = null
        val tasks = manifest.getJSONArray("tasks")
        require(tasks.length() in 1..1024) { "任务数量无效" }
        for (index in 0 until tasks.length()) {
            val task = tasks.getJSONObject(index)
            val name = task.getString("taskName")
            require(validName(name) && taskNames.add(name.lowercase())) { "任务名无效/重复" }
            val code = task.getJSONObject("codeRequirement")
            val lower = positive(code, "minimumVersion")
            require(positive(code, "taskCodeApiVersion") == 1) { "任务API不支持" }
            minimum = maxOf(minimum, lower)
            if (code.has("maximumVersion")) {
                val upper = positive(code, "maximumVersion")
                require(upper >= lower) { "任务区间无效" }
                maximum = minOf(maximum ?: upper, upper)
            }
            require(task.has("dependencyRequirement")) { "必须明确声明任务依赖" }
            if (!task.isNull("dependencyRequirement")) {
                val dep = task.getJSONObject("dependencyRequirement")
                val version = positive(dep, "version")
                val lock = dep.getString("lockSha256")
                require(hashes.matches(lock) && (dependency == null || dependency == lock && dependencyVersion == version)) { "任务依赖冲突" }
                dependency = lock; dependencyVersion = version
            }
            val files = task.getJSONArray("files")
            require(files.length() > 0) { "任务文件为空" }
            for (fileIndex in 0 until files.length()) {
                val file = files.getJSONObject(fileIndex)
                val relative = file.getString("path")
                val key = "tasks/$name/$relative"
                val size = integer(file, "size")
                require(codePath(relative) && folded.add(key.lowercase()) && size in 0..(2L * 1024 * 1024)) { "任务文件路径/大小无效" }
                allowed.add(key); count++; bytes = Math.addExact(bytes, size)
                require(count <= 1024 && bytes <= MAX_BYTES) { "任务文件总量超限" }
                val actual = File(root, key)
                require(actual.isFile && actual.length() == size && digest(actual.readBytes()) == file.getString("sha256")) { "任务文件校验失败: $key" }
            }
            val revision = JSONObject().put("codeRequirement", code).put("dependencyRequirement", task.get("dependencyRequirement")).put("files", files)
            require(fingerprint(revision) == task.getString("revision")) { "任务revision不匹配" }
        }
        val retired = manifest.getJSONArray("retiredTaskNames")
        for (index in 0 until retired.length()) {
            val name = retired.getString(index)
            require(validName(name) && taskNames.add(name.lowercase())) { "退役任务名重复/无效" }
        }
        val aggregate = JSONObject().put("taskCodeApiVersion", 1).put("requiredCodeVersion", minimum)
            .put("requiredApkVersionCode", positive(manifest, "requiredApkVersionCode"))
        if (maximum != null) { require(maximum >= minimum); aggregate.put("maximumCodeVersion", maximum) }
        if (dependency != null) aggregate.put("requiredDependencyVersion", dependencyVersion).put("requiredLockSha256", dependency)
        require(OfflineUpdateManifest.canonicalJson(aggregate) == OfflineUpdateManifest.canonicalJson(contract(manifest))) { "任务聚合契约不匹配" }
        val bundle = contract(manifest).put("tasks", tasks).put("retiredTaskNames", retired)
        require(fingerprint(bundle) == manifest.getString("bundleSha256")) { "任务包内容指纹无效" }
        require(expected.bundleSha256 == null || expected.bundleSha256 == manifest.getString("bundleSha256")) { "任务包内外内容指纹不一致" }
        // walkTopDown在进入目录前拒绝链接；版本校验marker由安装器生成，不能来自ZIP。
        root.walkTopDown().onEnter { require(!Files.isSymbolicLink(it.toPath())); true }.forEach { file ->
            require(!Files.isSymbolicLink(file.toPath())) { "任务包不能包含链接" }
            val relative = file.relativeTo(root).invariantSeparatorsPath
            if (file.isFile) require(relative in allowed || relative == ".offline-update-verified.json") { "任务包包含额外文件: $relative" }
            else require(file.isDirectory && (relative.isEmpty() || allowed.any { it.startsWith("$relative/") })) { "任务包包含额外目录: $relative" }
        }
        return manifest
    }
}
