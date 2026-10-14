package com.aasc.display

import android.os.StatFs
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

/** 只处理签名清单指定的依赖层，组合目录继续交由现有版本指针和健康回滚管理。 */
internal object OfflineDependencyGroups {
    fun hashFile(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    fun assertSafePath(root: File, file: File) {
        require(!Files.isSymbolicLink(root.toPath())) { "依赖根目录不能是链接" }
        val relative = file.absoluteFile.toPath().normalize().let { target ->
            val base = root.absoluteFile.toPath().normalize()
            require(target.startsWith(base)) { "依赖目录越界" }; base.relativize(target)
        }
        var current = root
        for (part in relative) { current = File(current, part.toString()); require(!Files.isSymbolicLink(current.toPath())) { "依赖路径含链接" } }
    }

    fun contentHash(directory: File): String {
        require(directory.isDirectory && !Files.isSymbolicLink(directory.toPath())) { "依赖层node_modules缺失或为链接" }
        val values = JSONArray()
        fun visit(current: File, prefix: String) {
            for (file in current.listFiles()?.sortedBy { it.name } ?: error("无法读取依赖层目录")) {
                require(!Files.isSymbolicLink(file.toPath())) { "依赖层含符号链接" }
                val name = if (prefix.isEmpty()) file.name else "$prefix/${file.name}"
                when {
                    file.isDirectory -> visit(file, name)
                    file.isFile -> values.put(JSONObject().put("path", name).put("sha256", hashFile(file)))
                    else -> error("依赖层含特殊文件")
                }
            }
        }
        visit(directory, "")
        return MessageDigest.getInstance("SHA-256").digest(OfflineUpdateManifest.canonicalJson(values).toByteArray())
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    fun verifyLayer(directory: File, name: String, entry: OfflineUpdateArtifact): Boolean = runCatching {
        assertSafePath(directory, File(directory, "dependency-group.json"))
        val metadata = JSONObject(File(directory, "dependency-group.json").readText())
        require(metadata.optString("group") == name && metadata.optInt("version") == entry.version &&
            metadata.optString("contentSha256") == entry.contentSha256 &&
            OfflineUpdateManifest.canonicalJson(metadata.opt("target")) == OfflineUpdateManifest.canonicalJson(entry.target)) { "依赖层元数据不匹配" }
        require(contentHash(File(directory, "node_modules")) == entry.contentSha256) { "依赖层实际内容指纹不匹配" }
        true
    }.getOrDefault(false)

    /** 相同路径绝不覆盖，避免一个组静默替换另一个组的JS加载器或原生库。 */
    fun merge(source: File, destination: File) {
        require(source.isDirectory && !Files.isSymbolicLink(source.toPath())) { "依赖源目录无效" }
        check(destination.isDirectory || destination.mkdirs()) { "无法创建组合依赖目录" }
        require(!Files.isSymbolicLink(destination.toPath())) { "组合依赖目录不能是链接" }
        for (file in source.listFiles()?.sortedBy { it.name } ?: error("无法读取依赖目录")) {
            require(!Files.isSymbolicLink(file.toPath())) { "依赖层不能包含链接" }
            val target = File(destination, file.name)
            when {
                file.isDirectory -> merge(file, target)
                file.isFile -> { require(!target.exists()) { "依赖层文件冲突：${file.name}" }; file.copyTo(target, overwrite = false) }
                else -> error("依赖层含特殊文件")
            }
        }
    }

    fun prepare(root: File, source: OfflineUpdateManager.ManifestSource, stage: File,
        updater: OfflineUpdateManager, onProgress: ((OfflineUpdateProgress) -> Unit)? = null): File {
        val dependency = source.manifest.dependencies
        val destination = File(stage, "dependencies")
        assertSafePath(root, destination)
        if (dependency.groups.isEmpty()) {
            val archive = updater.downloadArtifact(source, dependency, File(stage, "dependencies.zip"), onProgress)
            val inspection = updater.validateComponentArchive(archive.file, "dependencies")
            checkSpace(root, inspection.expandedBytes)
            OfflineUpdateManager.extractZipArchive(archive.file, destination)
        } else {
            for ((name, entry) in dependency.androidLayers()) {
                val cache = File(root, "updates/dependency-groups/$name/dependencies-v${entry.version}-${entry.sha256.take(12)}")
                assertSafePath(root, cache)
                if (cache.exists()) require(verifyLayer(cache, name, entry)) { "缓存依赖组${name}已损坏，保留当前版本" }
                else {
                    val downloaded = updater.downloadArtifact(source, entry, File(stage, "$name.zip"), onProgress)
                    val inspection = updater.validateComponentArchive(downloaded.file, "dependencies")
                    checkSpace(root, Math.multiplyExact(inspection.expandedBytes, 2))
                    val layer = File(stage, "group-$name")
                    OfflineUpdateManager.extractZipArchive(downloaded.file, layer)
                    require(verifyLayer(layer, name, entry)) { "依赖组${name}内容校验失败" }
                    check(cache.parentFile!!.isDirectory || cache.parentFile!!.mkdirs()) { "无法创建依赖组缓存目录" }
                    check(layer.renameTo(cache)) { "无法原子保存依赖组缓存" }
                }
                checkSpace(root, File(cache, "node_modules").walkTopDown().filter { it.isFile }.sumOf { it.length() })
                merge(File(cache, "node_modules"), File(destination, "node_modules"))
            }
            File(destination, "dependency-manifest.json").writeText(JSONObject().put("version", dependency.version)
                .put("lockSha256", dependency.lockSha256).put("sha256", dependency.sha256).toString())
        }
        updater.validateDependencyPackage(destination, dependency)
        return destination
    }

    private fun checkSpace(root: File, expanded: Long) {
        require(OfflineUpdateManager.hasEnoughSpace(StatFs(root.path).availableBytes, 0, expanded, 128L * 1024 * 1024)) { "空间不足以组装依赖并保留回滚版本" }
    }

    fun validateLock(directory: File, lockFile: File) {
        val packages = JSONObject(lockFile.readText()).optJSONObject("packages") ?: error("生产锁文件缺少packages")
        for (relative in packages.keys()) {
            if (relative.isEmpty()) continue
            val entry = packages.getJSONObject(relative)
            if (entry.optBoolean("dev") || entry.optBoolean("optional")) continue
            require(relative.startsWith("node_modules/") && OfflineUpdateManifest.isSafeRelativePath(relative)) { "生产锁文件路径无效" }
            val manifest = File(directory, "$relative/package.json")
            assertSafePath(directory, manifest)
            require(manifest.isFile && JSONObject(manifest.readText()).optString("version") == entry.optString("version")) { "生产包与代码锁版本不匹配：$relative" }
        }
    }
}
