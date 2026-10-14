package com.aasc.display

import java.io.File
import java.nio.file.Files
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OfflineFullApkActivationTest {
    private val installation = OfflineFullApkActivation.Installation(48, 1000, "full48")
    private fun file(root: File, relative: String, text: String = "synthetic"): File = File(root, relative).apply {
        parentFile.mkdirs(); writeText(text)
    }
    private fun pointer(code: Int = 85, dependencies: Int = 9): String = JSONObject()
        .put("schemaVersion", 1).put("codeVersion", code).put("dependencyVersion", dependencies)
        .put("lockSha256", "a".repeat(64)).put("legacyDependencies", false).put("pendingHealth", false).toString()
    private fun fixture(block: (File) -> Unit) {
        val base = Files.createTempDirectory("aasc-full-activation-").toFile()
        val root = File(base, "aasc-server").apply { mkdirs() }
        try {
            file(root, "package-lock.json", "{}")
            val hash = MessageDigest.getInstance("SHA-256").digest("{}".toByteArray()).joinToString("") { "%02x".format(it) }
            file(root, "offline-update-client.json", JSONObject().put("codeVersion", 84)
                .put("dependencyVersion", 8).put("lockSha256", hash).toString())
            file(root, "package.json", "{}")
            file(root, "src/apps/server/boot/server-launcher.js")
            file(root, "node_modules/express/package.json", "{}")
            file(root, "updates/active-release.json", pointer())
            file(root, "updates/code/code-v85/src/launcher.js")
            file(root, "updates/dependencies/dependencies-v9/node_modules/express/package.json", "{}")
            block(root)
        } finally { base.deleteRecursively() }
    }
    private fun versions(root: File): JSONObject = JSONObject().put("code", "v84").put("dependencies", "v8")
        .put("codePath", root.canonicalPath).put("dependenciesPath", File(root, "node_modules").canonicalPath)
    private fun state(root: File): JSONObject = JSONObject(File(root, "updates/full-apk-activation.json").readText())

    @Test fun 完整离线包触发而min普通包不触发() {
        assertTrue(OfflineFullApkActivation.isFullProfile("offline", false))
        assertFalse(OfflineFullApkActivation.isFullProfile("offline", true))
        assertFalse(OfflineFullApkActivation.isFullProfile("online", false))
    }

    @Test fun 首次切回根目录健康前不删旧版本() = fixture { root ->
        assertTrue(OfflineFullApkActivation.requiresInstallation(root, installation))
        OfflineFullApkActivation.begin(root, installation)
        assertFalse(File(root, "updates/active-release.json").exists())
        assertNull(NodeServerService.readActiveRelease(root))
        assertEquals(File(root, "src/apps/server/boot/server-launcher.js").absolutePath,
            NodeServerService.buildNodeCommand(root, null, NodeServerService.readActiveRelease(root))[1])
        assertTrue(File(root, "updates/code/code-v85").isDirectory)
        assertTrue(File(root, "updates/dependencies/dependencies-v9").isDirectory)
        assertTrue(OfflineFullApkActivation.isPending(root))
        assertFalse(OfflineFullApkActivation.requiresInstallation(root, installation))
    }

    @Test fun 两种实际版本及路径必须全部匹配() = fixture { root ->
        OfflineFullApkActivation.begin(root, installation)
        assertTrue(OfflineFullApkActivation.matchesPendingHealth(root, versions(root)))
        assertFalse(OfflineFullApkActivation.matchesPendingHealth(root, versions(root).put("dependencies", "v9")))
        assertFalse(OfflineFullApkActivation.matchesPendingHealth(root, versions(root).put("code", "v85")))
        assertFalse(OfflineFullApkActivation.matchesPendingHealth(root, versions(root).put("codePath", File(root, "updates/code/code-v85").path)))
        assertFalse(OfflineFullApkActivation.matchesPendingHealth(root, versions(root).put("dependenciesPath", File(root, "updates/dependencies/dependencies-v9/node_modules").path)))
    }

    @Test fun 健康后删除冻结旧目录并保留私人目录及ZIP() = fixture { root ->
        val keep = listOf("config/config.json", "home/accounts.json", "res/tasks/task/results.txt",
            "data-repair/state.json", "updates/downloads/code-v85.zip", "updates/code/custom/file",
            "updates/code/code-v0/file", "updates/code/code-v085/file", "logs/run.log")
        keep.forEach { file(root, it) }
        file(root.parentFile, "models/llm/weights.bin")
        OfflineFullApkActivation.begin(root, installation)
        val result = OfflineFullApkActivation.markHealthyAndCleanup(root)!!
        assertEquals(2, result.removed)
        assertTrue(result.errors.isEmpty())
        assertFalse(File(root, "updates/code/code-v85").exists())
        assertFalse(File(root, "updates/dependencies/dependencies-v9").exists())
        keep.forEach { assertTrue(it, File(root, it).isFile) }
        assertTrue(File(root, "node_modules/express/package.json").isFile)
        assertTrue(File(root.parentFile, "models/llm/weights.bin").isFile)
        assertEquals("ready", state(root).getString("phase"))
    }

    @Test fun 日常重启保留后来热更新同版本重装再次触发() = fixture { root ->
        OfflineFullApkActivation.begin(root, installation)
        OfflineFullApkActivation.markHealthyAndCleanup(root)
        file(root, "updates/active-release.json", pointer(86, 10))
        assertFalse(OfflineFullApkActivation.requiresInstallation(root, installation))
        OfflineFullApkActivation.resumePending(root)
        assertEquals(86, NodeServerService.readActiveRelease(root)!!.codeVersion)
        assertTrue(OfflineFullApkActivation.requiresInstallation(root,
            installation.copy(lastUpdateTime = 2000)))
    }

    @Test fun 记录后退役指针中断可以继续且不删并发新指针() = fixture { root ->
        val original = File(root, "updates/active-release.json").readText()
        OfflineFullApkActivation.begin(root, installation)
        file(root, "updates/active-release.json", original)
        OfflineFullApkActivation.resumePending(root)
        assertFalse(File(root, "updates/active-release.json").exists())
        file(root, "updates/active-release.json", pointer(86, 10))
        assertThrows(IllegalStateException::class.java) { OfflineFullApkActivation.resumePending(root) }
        assertEquals(86, NodeServerService.readActiveRelease(root)!!.codeVersion)
        assertThrows(IllegalStateException::class.java) { OfflineFullApkActivation.markHealthyAndCleanup(root) }
        assertTrue(File(root, "updates/code/code-v85").exists())
    }

    @Test fun 安装失败恢复原指针并允许同一次安装重试() = fixture { root ->
        val previous = File(root, "updates/active-release.json").readText()
        OfflineFullApkActivation.begin(root, installation)
        OfflineFullApkActivation.cancelInstallation(root, installation)
        assertEquals(previous, File(root, "updates/active-release.json").readText())
        assertFalse(File(root, "updates/full-apk-activation.json").exists())
        assertTrue(OfflineFullApkActivation.requiresInstallation(root, installation))
    }

    @Test fun 服务启动失败恢复旧指针且不删除旧目录或反复重置() = fixture { root ->
        OfflineFullApkActivation.begin(root, installation)
        assertTrue(OfflineFullApkActivation.rollbackPending(root))
        assertEquals(85, NodeServerService.readActiveRelease(root)!!.codeVersion)
        assertTrue(File(root, "updates/code/code-v85").isDirectory)
        assertTrue(File(root, "updates/dependencies/dependencies-v9").isDirectory)
        assertNull(OfflineFullApkActivation.markHealthyAndCleanup(root))
        assertFalse(OfflineFullApkActivation.requiresInstallation(root, installation))
    }

    @Test fun 坏整包依赖指纹不能切换() = fixture { root ->
        file(root, "package-lock.json", "changed")
        assertThrows(IllegalArgumentException::class.java) { OfflineFullApkActivation.begin(root, installation) }
        assertEquals(85, NodeServerService.readActiveRelease(root)!!.codeVersion)
    }

    @Test fun 链接目录保持并记录待清理重新启动可重试() = fixture { root ->
        val outside = file(root.parentFile, "outside/keep.txt")
        val link = File(root, "updates/code/code-v85/link")
        Files.createSymbolicLink(link.toPath(), outside.parentFile.toPath())
        OfflineFullApkActivation.begin(root, installation)
        val first = OfflineFullApkActivation.markHealthyAndCleanup(root)!!
        assertEquals(1, first.errors.size)
        assertEquals("cleanup_pending", state(root).getString("phase"))
        assertTrue(File(root, "updates/code/code-v85").isDirectory)
        assertEquals("synthetic", outside.readText())
        Files.delete(link.toPath())
        val second = OfflineFullApkActivation.markHealthyAndCleanup(root)!!
        assertEquals(1, second.removed)
        assertTrue(second.errors.isEmpty())
        assertEquals("ready", state(root).getString("phase"))
    }

    @Test fun 清理重试不删除后续热更新及其回滚目录() = fixture { root ->
        val outside = file(root.parentFile, "outside/keep.txt")
        Files.createSymbolicLink(File(root, "updates/code/code-v85/link").toPath(), outside.toPath())
        OfflineFullApkActivation.begin(root, installation)
        OfflineFullApkActivation.markHealthyAndCleanup(root)
        file(root, "updates/code/code-v86/launcher")
        file(root, "updates/active-release.json", JSONObject(pointer(86, 10))
            .put("previous", JSONObject().put("codeVersion", 85).put("dependencyVersion", 9)).toString())
        OfflineFullApkActivation.markHealthyAndCleanup(root)
        assertTrue(File(root, "updates/code/code-v85").exists())
        assertTrue(File(root, "updates/code/code-v86").exists())
    }

    @Test fun 非法清理记录不能删除任何目录() = fixture { root ->
        OfflineFullApkActivation.begin(root, installation)
        val invalid = state(root).put("targets", JSONArray(listOf("updates/code/code-v85", "../models")))
        file(root, "updates/full-apk-activation.json", invalid.toString())
        assertThrows(IllegalArgumentException::class.java) { OfflineFullApkActivation.markHealthyAndCleanup(root) }
        assertTrue(File(root, "updates/code/code-v85").isDirectory)
    }

    @Test fun 整包换根保留额外模型并采用新包同路径定义() = fixture { root ->
        val source = File(root.parentFile, "old").apply { mkdirs() }
        file(source, "res/models/llm/weights.bin", "downloaded weights")
        file(source, "res/models/llm/manifest.json", "old definition")
        file(root, "res/models/llm/manifest.json", "new bundled definition")
        val moved = mutableListOf<String>()
        NodeRuntimeInstaller.moveUnbundledModelFiles(source, root, moved)
        assertEquals(listOf("res/models/llm/weights.bin"), moved)
        assertEquals("downloaded weights", File(root, moved.single()).readText())
        assertEquals("new bundled definition", File(root, "res/models/llm/manifest.json").readText())
        assertFalse(File(source, "res/models/llm/weights.bin").exists())
    }

    @Test fun 清理本次安装备份不跟随外部模型链接() = fixture { root ->
        val outside = file(root.parentFile, "outside/keep.bin", "keep external model")
        val backup = File(root.parentFile, "aasc-server.backup-test").apply { mkdirs() }
        Files.createSymbolicLink(File(backup, "models").toPath(), outside.parentFile.toPath())
        NodeRuntimeInstaller.deleteOwnedRuntimeBackup(backup)
        assertFalse(backup.exists())
        assertEquals("keep external model", outside.readText())
    }
}
