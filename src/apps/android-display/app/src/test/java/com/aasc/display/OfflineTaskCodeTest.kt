package com.aasc.display

import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OfflineTaskCodeTest {
    private val lock = "a".repeat(64)
    private val sha = "b".repeat(64)
    private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun hash(value: JSONObject) = hash(OfflineUpdateManifest.canonicalJson(value).toByteArray())
    private fun descriptor(version: Int = 1) = JSONObject().put("version", version).put("relativeUrl", "task-code/task-code-v$version.zip")
        .put("size", 500).put("sha256", sha).put("taskCodeApiVersion", 1).put("requiredCodeVersion", 96)
        .put("maximumCodeVersion", 100).put("requiredApkVersionCode", 58)
        .put("requiredDependencyVersion", 10).put("requiredLockSha256", lock)
    private fun manifest(version: Int = 1) = OfflineUpdateManifest(
        OfflineUpdateArtifact(96, "code/code-v96.zip", 20000, sha, 10, lock, taskCodeApiVersion = 1),
        OfflineUpdateArtifact(10, "dependencies/dependencies-v10.zip", 50000, sha, lockSha256 = lock), null,
        taskCode = OfflineTaskCode.parse(descriptor(version)))
    private fun fixture(block: (File, File, JSONObject) -> Unit) {
        val root = Files.createTempDirectory("aasc-native-task-code-").toFile()
        try {
            val directory = File(root, "updates/task-code/task-code-v1").apply { mkdirs() }
            val code = "module.exports = {run: async () => 42};".toByteArray()
            File(directory, "tasks/demo/task.js").apply { parentFile.mkdirs(); writeBytes(code) }
            val files = JSONArray().put(JSONObject().put("path", "task.js").put("size", code.size).put("sha256", hash(code)))
            val task = JSONObject().put("taskName", "demo").put("codeRequirement", JSONObject().put("minimumVersion", 96)
                .put("maximumVersion", 100).put("taskCodeApiVersion", 1)).put("dependencyRequirement", JSONObject().put("version", 10).put("lockSha256", lock)).put("files", files)
            task.put("revision", hash(JSONObject().put("codeRequirement", task.get("codeRequirement"))
                .put("dependencyRequirement", task.get("dependencyRequirement")).put("files", files)))
            val bundle = JSONObject().put("taskCodeApiVersion", 1).put("requiredCodeVersion", 96).put("maximumCodeVersion", 100)
                .put("requiredApkVersionCode", 58).put("requiredDependencyVersion", 10).put("requiredLockSha256", lock)
                .put("tasks", JSONArray().put(task)).put("retiredTaskNames", JSONArray().put("retired"))
            val inner = JSONObject(bundle.toString()).put("bundleSha256", hash(bundle)).put("format", "aasc-task-code").put("schemaVersion", 1).put("version", 1)
            File(directory, "task-code-manifest.json").writeText(inner.toString())
            File(directory, ".offline-update-verified.json").writeText(JSONObject().put("kind", "taskCode").put("version", 1).put("sha256", sha).toString())
            block(root, directory, inner)
        } finally { root.deleteRecursively() }
    }
    private fun reject(block: () -> Unit) {
        try { block(); fail("应拒绝无效任务组合") } catch (_: IllegalArgumentException) { }
    }

    @Test fun 任务单独更新只预算任务ZIP并允许联合代码更新() {
        val current = InstalledServiceVersion(96, 10, lock)
        assertEquals(OfflineUpdateManager.ServiceUpdatePlan.TASK_CODE_ONLY, OfflineUpdateManager.planServiceUpdate(current, manifest()))
        assertEquals(500L, OfflineUpdateManager.taskDownloadBytes(current, manifest()))
        val installed = current.copy(taskCodeVersion = 1, taskCodeSha256 = sha)
        assertEquals(OfflineUpdateManager.ServiceUpdatePlan.CURRENT, OfflineUpdateManager.planServiceUpdate(installed, manifest()))
        assertEquals(0L, OfflineUpdateManager.taskDownloadBytes(installed, manifest()))
        assertEquals(OfflineUpdateManager.ServiceUpdatePlan.CODE_ONLY,
            OfflineUpdateManager.planServiceUpdate(InstalledServiceVersion(95, 10, lock), manifest()))
        assertEquals(OfflineUpdateManager.ServiceUpdatePlan.ALL,
            OfflineUpdateManager.planServiceUpdate(InstalledServiceVersion(95, 9, "c".repeat(64)), manifest()))
        assertEquals(OfflineUpdateManager.ServiceUpdatePlan.TASK_CODE_ONLY, OfflineUpdateManager.planServiceUpdate(installed, manifest(2)))
    }
    @Test fun API代码APK和依赖精确绑定都要满足() {
        val source = manifest()
        OfflineTaskCode.assertCombination(source.taskCode, source.code, source.dependencies, 58)
        reject { OfflineTaskCode.assertCombination(source.taskCode, source.code.copy(version = 95), source.dependencies, 58) }
        reject { OfflineTaskCode.assertCombination(source.taskCode, source.code.copy(version = 101), source.dependencies, 58) }
        reject { OfflineTaskCode.assertCombination(source.taskCode, source.code.copy(taskCodeApiVersion = 2), source.dependencies, 58) }
        reject { OfflineTaskCode.assertCombination(source.taskCode, source.code, source.dependencies.copy(version = 11), 58) }
        reject { OfflineTaskCode.assertCombination(source.taskCode, source.code, source.dependencies, 57) }
        reject { OfflineTaskCode.parse(descriptor().put("requiredDependencyVersion", "10")) }
        reject { OfflineTaskCode.parse(descriptor().put("size", "500")) }
    }
    @Test fun 完整RSA清单解析任务组件并拒绝签名和组合冲突() {
        val pair = java.security.KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val publicKey = "-----BEGIN PUBLIC KEY-----\n${java.util.Base64.getEncoder().encodeToString(pair.public.encoded)}\n-----END PUBLIC KEY-----"
        val payload = JSONObject().put("schemaVersion", 1).put("components", JSONObject()
            .put("code", JSONObject().put("version", 96).put("relativeUrl", "code/code-v96.zip").put("size", 2000).put("sha256", sha)
                .put("requiredDependencyVersion", 10).put("requiredLockSha256", lock).put("taskCodeApiVersion", 1))
            .put("dependencies", JSONObject().put("version", 10).put("relativeUrl", "dependencies/dependencies-v10.zip")
                .put("size", 4000).put("sha256", sha).put("lockSha256", lock)).put("taskCode", descriptor()))
        fun signed(): JSONObject {
            val signer = java.security.Signature.getInstance("SHA256withRSA").apply {
                initSign(pair.private); update(OfflineUpdateManifest.canonicalJson(payload).toByteArray())
            }
            return JSONObject().put("payload", payload).put("signature", JSONObject().put("algorithm", "SHA256withRSA")
                .put("value", java.util.Base64.getEncoder().encodeToString(signer.sign())))
        }
        val original = signed()
        assertEquals(1, OfflineUpdateManifest.parse(original.toString(), publicKey).taskCode!!.version)
        payload.getJSONObject("components").getJSONObject("taskCode").put("requiredCodeVersion", 97)
        reject { OfflineUpdateManifest.parse(original.toString(), publicKey) }
        reject { OfflineUpdateManifest.parse(signed().toString(), publicKey) }
    }
    @Test fun 任务降级同版异摘要和移除组件拒绝() {
        val current = InstalledServiceVersion(96, 10, lock, 2, sha)
        reject { OfflineUpdateManager.planServiceUpdate(current, manifest()) }
        reject { OfflineUpdateManager.planServiceUpdate(current, manifest(2).copy(taskCode = OfflineTaskCode.parse(descriptor(2).put("sha256", "c".repeat(64))))) }
        reject { OfflineUpdateManager.planServiceUpdate(current, manifest().copy(taskCode = null)) }
    }
    @Test fun 包内文件摘要revision聚合与额外文件校验() = fixture { _, directory, inner ->
        OfflineTaskCode.validateDirectory(directory, manifest().taskCode!!)
        File(directory, "extra.js").writeText("extra")
        reject { OfflineTaskCode.validateDirectory(directory, manifest().taskCode!!) }
        File(directory, "extra.js").delete()
        File(directory, "tasks/demo/task.js").appendText("tampered")
        reject { OfflineTaskCode.validateDirectory(directory, manifest().taskCode!!) }
        inner.put("requiredCodeVersion", 95)
        File(directory, "task-code-manifest.json").writeText(inner.toString())
        reject { OfflineTaskCode.validateDirectory(directory, manifest().taskCode!!) }
    }
    @Test fun 链接测试目录与非代码路径拒绝() = fixture { root, directory, _ ->
        for (name in listOf("../task.js", "results/task.js", "render.smoke.js", "config.json", "/task.js")) assertFalse(OfflineTaskCode.codePath(name))
        val task = File(directory, "tasks/demo/task.js")
        val outside = File(root, "outside.js").apply { writeBytes(task.readBytes()) }
        task.delete(); Files.createSymbolicLink(task.toPath(), outside.toPath())
        reject { OfflineTaskCode.validateDirectory(directory, manifest().taskCode!!) }
    }
    @Test fun 原生启动快照固定任务身份且健康检查不接受旧进程() = fixture { root, directory, _ ->
        val active = NodeServerService.ActiveRelease(96, 10, false, lock, 1, sha)
        val env = NodeServerService.buildNodeEnvironment(root, "", "apk-test", true, apkVersionCode = 58, activeRelease = active)
        val snapshot = JSONObject(env.getValue("AASC_TASK_CODE_CONTEXT"))
        assertEquals(directory.absolutePath, snapshot.getString("path"))
        assertEquals(1, snapshot.getInt("version"))
        assertFalse(NodeServerService.matchesTaskCodeHealth(root, active, JSONObject()))
        val versions = JSONObject().put("dependencies", "v10").put("dependenciesPath", NodeServerService.nodeModulesDirectory(root, active).path)
            .put("taskCode", JSONObject().put("version", 1).put("sha256", sha).put("path", directory.path).put("verified", true)
                .put("codeVersion", 96).put("dependencyVersion", 10).put("lockSha256", lock).put("taskCodeApiVersion", 1))
        assertTrue(NodeServerService.matchesTaskCodeHealth(root, active, versions))
        versions.getJSONObject("taskCode").put("version", 2)
        assertFalse(NodeServerService.matchesTaskCodeHealth(root, active, versions))
        assertEquals(1, JSONObject(env.getValue("AASC_TASK_CODE_CONTEXT")).getInt("version"))
    }
    @Test fun pending回滚恢复代码依赖锁任务完整组合且保留数据() = fixture { root, _, _ ->
        val data = File(root, "res/tasks/demo/results/keep.txt").apply { parentFile.mkdirs(); writeText("keep") }
        val previous = InstalledServiceVersion(95, 9, "c".repeat(64), 1, "d".repeat(64))
        OfflineReleaseState.write(root, OfflineReleasePointer(96, 10, lock, false, true, previous, true, 2, sha))
        assertEquals(2, OfflineReleaseState.read(root)!!.taskCodeVersion)
        assertTrue(OfflineReleaseState.rollback(root))
        val restored = OfflineReleaseState.read(root)!!
        assertEquals(95, restored.codeVersion); assertEquals(9, restored.dependencyVersion)
        assertEquals(previous.lockSha256, restored.lockSha256); assertEquals(1, restored.taskCodeVersion)
        assertEquals(previous.taskCodeSha256, restored.taskCodeSha256); assertTrue(restored.legacyDependencies)
        assertFalse(restored.pendingHealth); assertNull(restored.previous)
        assertEquals("keep", data.readText())
        assertEquals(2, JSONObject(File(root, "updates/failed-release.json").readText()).getInt("taskCodeVersion"))
        assertFalse(OfflineReleaseState.rollback(root))
    }
    @Test fun 历史无任务指针兼容且首次失败保留任务目录() = fixture { root, directory, _ ->
        OfflineReleaseState.write(root, OfflineReleasePointer(96, 10, lock, false, true, InstalledServiceVersion(95, 10, lock), false, 1, sha))
        OfflineReleaseState.rollback(root)
        assertNull(OfflineReleaseState.read(root)!!.taskCodeVersion)
        OfflineReleaseState.write(root, OfflineReleasePointer(96, 10, lock, false, true, null, null, 1, sha))
        OfflineReleaseState.rollback(root)
        assertNull(OfflineReleaseState.read(root)); assertTrue(directory.isDirectory)
    }
    @Test fun ZIP白名单限量并禁止夹带数据() {
        val root = Files.createTempDirectory("aasc-task-code-zip-").toFile()
        try {
            val zip = File(root, "task.zip")
            ZipOutputStream(zip.outputStream()).use { output ->
                for (name in listOf("task-code-manifest.json", "tasks/demo/task.js", "config/config.json")) {
                    output.putNextEntry(ZipEntry(name)); output.write("{}".toByteArray()); output.closeEntry()
                }
            }
            reject { OfflineUpdateManager.inspectComponentArchive(zip, "taskCode") }
        } finally { root.deleteRecursively() }
    }
    @Test fun 健康前保留全部任务版本健康后仅清理数字旧目录() = fixture { root, directory, _ ->
        File(root, "updates/code/code-v96").mkdirs(); File(root, "updates/dependencies/dependencies-v10").mkdirs()
        val old = File(root, "updates/task-code/task-code-v2").apply { mkdirs() }
        val custom = File(root, "updates/task-code/custom").apply { mkdirs() }
        OfflineReleaseState.write(root, OfflineReleasePointer(96, 10, lock, false, true, InstalledServiceVersion(96, 10, lock, 2, sha), false, 1, sha))
        assertEquals(0, OfflineUpdateManager.cleanupObsoleteReleaseDirectories(root)); assertTrue(old.isDirectory)
        OfflineReleaseState.write(root, OfflineReleaseState.read(root)!!.copy(pendingHealth = false, previous = null, previousLegacyDependencies = null))
        assertEquals(1, OfflineUpdateManager.cleanupObsoleteReleaseDirectories(root))
        assertTrue(directory.isDirectory); assertFalse(old.exists()); assertTrue(custom.isDirectory)
    }
}
