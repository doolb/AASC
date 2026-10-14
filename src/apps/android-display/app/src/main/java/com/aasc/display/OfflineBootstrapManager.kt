package com.aasc.display

import android.content.Context
import android.os.StatFs
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/** min 首装只初始化服务环境；独立复用更新器的签名、摘要和受限 ZIP 工具。 */
internal class OfflineBootstrapManager(private val context: Context) {
    data class Preview(val baseUrl: String, val signedManifest: String, val downloadBytes: Long)
    private val updater = OfflineUpdateManager(context)
    @Volatile private var cancellation = AtomicBoolean(false)

    fun cancel() { cancellation.set(true) }
    fun resetCancellation() { cancellation = AtomicBoolean(false) }
    private fun checkCancelled(token: AtomicBoolean) {
        if (token.get() || Thread.currentThread().isInterrupted) throw CancellationException("已取消本机服务准备")
    }

    fun preview(): Preview {
        val source = updater.fetchManifest(updater.readPublicKeyOrNull()
            ?: error("APK 缺少更新验证公钥")) ?: error("没有可用的服务安装清单")
        validateSnapshot(source.manifest)
        val total = listOf(source.manifest.code, *source.manifest.dependencies.androidLayers().map { it.second }.toTypedArray(), source.manifest.nodeMinSeeds!!)
            .fold(0L) { total, artifact -> Math.addExact(total, artifact.size) }
        return Preview(source.baseUrl, source.rawJson, total)
    }

    fun install(preview: Preview, onProgress: (OfflineUpdateProgress) -> Unit): File {
        // 新确认建立新令牌；重试不能把前一轮已取消的下载重新激活。
        val token = cancellation
        require(preview.signedManifest.toByteArray().size <= 128 * 1024) { "首装清单超过限制" }
        val sourceUrl = java.net.URI(preview.baseUrl)
        require(sourceUrl.scheme == "http" && sourceUrl.host in setOf("192.168.1.39", "10.221.70.87", "120.79.245.103", "c.aasc.us")
            && sourceUrl.path == "/mnt/aasc-offline/" && sourceUrl.rawUserInfo == null
            && sourceUrl.rawQuery == null && sourceUrl.rawFragment == null
            && sourceUrl.port in setOf(-1, 80)) { "首装来源不在 Offline 发布范围" }
        val manifest = OfflineUpdateManifest.parse(preview.signedManifest,
            updater.readPublicKeyOrNull() ?: error("APK 缺少更新验证公钥"))
        validateSnapshot(manifest)
        val source = OfflineUpdateManager.ManifestSource(preview.baseUrl, manifest, preview.signedManifest)
        val root = File(context.filesDir, "aasc-server")
        check(root.isDirectory || root.mkdirs()) { "无法创建本机服务目录" }
        val downloads = File(root, "updates/bootstrap-downloads").apply { mkdirs() }
        // 文件锁覆盖安装与指针切换；重复 Service/Activity 请求不能并发写首装目录。
        java.io.RandomAccessFile(File(root, ".bootstrap.lock"), "rw").channel.use { channel ->
            channel.lock().use {
                checkCancelled(token)
                if (OfflineRuntimeState.hasServiceEnvironment(root)) return root
                recoverStages(root)
                val artifacts = listOf("code" to manifest.code, "nodeMinSeeds" to manifest.nodeMinSeeds!!)
                val pendingBytes = Math.addExact(artifacts.sumOf { (_, item) -> item.size }, manifest.dependencies.androidDownloadBytes())
                require(OfflineUpdateManager.hasEnoughSpace(StatFs(root.path).availableBytes, pendingBytes, 0, RESERVE)) {
                    "空间不足，尚未下载本机服务"
                }
                writeJson(File(root, "updates/bootstrap-state.json"), JSONObject()
                    .put("phase", "downloading").put("standalone", true).put("snapshot", preview.signedManifest))
                val packages = artifacts.map { (kind, metadata) ->
                    checkCancelled(token)
                    val destination = File(downloads, "$kind-${metadata.version}-${metadata.sha256}.zip")
                    if (!destination.isFile || destination.length() != metadata.size || !ModelHash.matches(destination, metadata.sha256)) {
                        updater.downloadArtifact(source, metadata, destination) { progress ->
                            checkCancelled(token); onProgress(progress)
                        }
                    }
                    kind to destination
                }.toMap()
                val inspections = packages.mapValues { (kind, file) ->
                    if (kind == "nodeMinSeeds") inspectSeeds(file)
                    else updater.validateComponentArchive(file, kind)
                }
                val expanded = inspections.values.fold(0L) { total, item -> Math.addExact(total, item.expandedBytes) }
                require(OfflineUpdateManager.hasEnoughSpace(StatFs(root.path).availableBytes, 0, expanded, RESERVE)) {
                    "空间不足以解包本机服务"
                }
                val stage = File(root, "updates/.bootstrap-${System.nanoTime()}")
                check(stage.mkdirs()) { "无法创建首装暂存目录" }
                try {
                    onProgress(OfflineUpdateProgress("installing", 0, expanded, "正在安装服务与初始数据"))
                    for ((kind, archive) in packages) {
                        checkCancelled(token)
                        OfflineUpdateManager.extractZipArchive(archive, File(stage, kind))
                    }
                    updater.validateCodePackage(File(stage, "code"), manifest.code)
                    OfflineDependencyGroups.prepare(root, source, stage, updater) { progress -> checkCancelled(token); onProgress(progress) }
                    OfflineDependencyGroups.validateLock(File(stage, "dependencies"), File(stage, "code/package-lock.json"))
                    restoreSeeds(File(stage, "nodeMinSeeds"), root)
                    NodeRuntimeInstaller(context).installBootstrapLibraries(root)
                    installBootstrapAssets(root)
                    checkCancelled(token)
                    updater.installVersionDirectory(File(stage, "code"), File(root, "updates/code/code-v${manifest.code.version}"), manifest.code, "code")
                    updater.installVersionDirectory(File(stage, "dependencies"), File(root, "updates/dependencies/dependencies-v${manifest.dependencies.version}"), manifest.dependencies, "dependencies")
                    val versions = JSONObject().put("schemaVersion", 1).put("codeVersion", manifest.code.version)
                        .put("dependencyVersion", manifest.dependencies.version).put("lockSha256", manifest.dependencies.lockSha256)
                    writeJson(File(root, "offline-update-client.json"), versions)
                    writeJson(File(root, "updates/active-release.json"), JSONObject(versions.toString())
                        .put("legacyDependencies", false).put("pendingHealth", true))
                    writeJson(File(root, "updates/bootstrap-state.json"), JSONObject().put("phase", "starting").put("standalone", true))
                    return root
                } finally {
                    // 只清理本事务专属 staging，下载缓存与用户目录不在此目录内。
                    stage.deleteRecursively()
                }
            }
        }
    }

    private fun validateSnapshot(manifest: OfflineUpdateManifest) {
        require(manifest.nodeMinSeeds != null) { "发布清单缺少 nodeMinSeeds 初始数据" }
        OfflineRuntimeState.requireCompatible(manifest.runtimeCompatibility
            ?: error("发布清单尚未提供独立首装运行契约，请更新服务包"))
    }

    private fun installBootstrapAssets(root: File) {
        val metadata = JSONObject(context.assets.open("offline-bootstrap-manifest.json").bufferedReader().use { it.readText() })
        require(metadata.optInt("schemaVersion") == 1)
        OfflineRuntimeState.requireCompatible(metadata.getJSONObject("runtimeCompatibility"))
        val files = metadata.getJSONArray("files")
        val allowed = setOf("res/certs/cert.pem", "res/certs/key.pem", "offline-model-catalog.json")
        val names = (0 until files.length()).map { files.getJSONObject(it).getString("path") }
        require(names.toSet() == allowed && names.size == allowed.size) { "首装资产清单不完整" }
        for (index in 0 until files.length()) {
            val item = files.getJSONObject(index)
            val target = File(root, item.getString("path"))
            target.parentFile!!.mkdirs()
            if (target.isFile) {
                // 原环境证书始终保留；本轮全新安装的其他资产必须与当前 APK 一致。
                if (target.path.contains("/res/certs/")) continue
            }
            val temporary = File(target.parentFile, "${target.name}.bootstrap-tmp")
            context.assets.open(item.getString("path")).use { input ->
                FileOutputStream(temporary).use { output -> input.copyTo(output); output.fd.sync() }
            }
            require(temporary.length() == item.getLong("size") && ModelHash.matches(temporary, item.getString("sha256"))) { "首装资产校验失败" }
            Files.move(temporary.toPath(), target.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
        }
        require(File(root, "res/certs/cert.pem").length() > 0 && File(root, "res/certs/key.pem").length() > 0) { "本机 HTTPS 证书不完整" }
    }

    companion object {
        private const val RESERVE = 128L * 1024 * 1024
        internal fun recoverStages(root: File) {
            val updates = File(root, "updates")
            require(!Files.isSymbolicLink(updates.toPath())) { "首装更新目录为链接" }
            val pattern = Regex("^\\.bootstrap--?[0-9]+$")
            updates.listFiles().orEmpty().filter { directory ->
                pattern.matches(directory.name) && directory.isDirectory
                    && !Files.isSymbolicLink(directory.toPath())
                    && directory.canonicalFile.parentFile == updates.canonicalFile
                    && directory.walkTopDown().none { Files.isSymbolicLink(it.toPath()) }
            }.forEach { check(it.deleteRecursively()) { "恢复首装暂存目录失败" } }
        }

        internal fun inspectSeeds(archive: File): OfflineUpdateManager.ZipInspection {
            val inspection = OfflineUpdateManager.inspectZipArchive(archive)
            require(inspection.entryNames.all { it.substringBefore('/') in setOf("config", "userconfig", "task") }) { "种子 ZIP 包含不允许的目录" }
            require("config/config.json" in inspection.entryNames) { "首装种子缺少配置" }
            return inspection
        }

        internal fun restoreSeeds(seeds: File, root: File) {
            val mapping = mapOf("config" to "config", "userconfig" to "home/.config/aasc-user", "task" to "res/tasks")
            require(File(seeds, "config/config.json").isFile)
            JSONObject(File(seeds, "config/config.json").readText())
            OfflineDataRepairState.beginSeed(root, File(seeds, "config/data-repair-state.json")) { name -> File(seeds, name) }
            val latestMarkers = mutableListOf<File>()
            for ((sourceName, targetName) in mapping) {
                val source = File(seeds, sourceName)
                require(source.isDirectory) { "种子目录缺少 $sourceName" }
                for (file in source.walkTopDown().filter { it.isFile }) {
                    val relative = file.relativeTo(source).invariantSeparatorsPath
                    val destination = File(root, "$targetName/$relative")
                    val isLatest = sourceName == "task" && relative.split('/').let { it.size == 3 && it[1] == "results" && it[2] == "latest" }
                    if (isLatest && Files.isSymbolicLink(destination.toPath())) continue
                    var ancestor: File? = destination
                    while (ancestor != null && ancestor != root) {
                        require(!Files.isSymbolicLink(ancestor.toPath())) { "种子目标或父目录为链接" }
                        ancestor = ancestor.parentFile
                    }
                    if (destination.exists()) {
                        // 进程可能在写入文本 marker 后退出；下次补种完成后再恢复链接。
                        if (isLatest && destination.isFile) latestMarkers += destination
                        continue
                    }
                    destination.parentFile!!.mkdirs()
                    file.copyTo(destination)
                    if (isLatest) latestMarkers += destination
                }
            }
            for (latest in latestMarkers) {
                val id = latest.readText().trim()
                require(Regex("^[A-Za-z0-9][A-Za-z0-9._-]*$").matches(id)
                    && File(latest.parentFile, id).isDirectory) { "任务 latest 指向无效实例" }
                latest.delete()
                Files.createSymbolicLink(latest.toPath(), java.nio.file.Paths.get(id))
            }
            OfflineDataRepairState.finishSeed(root)
        }

        internal fun writeJson(target: File, value: JSONObject) {
            target.parentFile!!.mkdirs()
            val temporary = File(target.parentFile, "${target.name}.tmp-${System.nanoTime()}")
            FileOutputStream(temporary).use { output ->
                output.write((value.toString() + "\n").toByteArray()); output.fd.sync()
            }
            Files.move(temporary.toPath(), target.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
        }
    }
}
