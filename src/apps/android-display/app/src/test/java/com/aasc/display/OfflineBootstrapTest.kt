package com.aasc.display

import java.io.File
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OfflineBootstrapTest {
    @Test
    fun 首装重试清理自己的中断暂存而保留版本和其他目录() {
        val root = Files.createTempDirectory("aasc-bootstrap-recovery").toFile()
        try {
            val stage = File(root, "updates/.bootstrap-1").apply { mkdirs() }
            File(stage, "partial").writeText("partial")
            val active = File(root, "updates/code/code-v1").apply { mkdirs() }
            val other = File(root, "updates/.staging-2").apply { mkdirs() }
            OfflineBootstrapManager.recoverStages(root)
            assertFalse(stage.exists())
            assertTrue(active.exists())
            assertTrue(other.exists())
        } finally { root.deleteRecursively() }
    }

    @Test
    fun 模型中断恢复只处理自身暂存且保留其他模型和链接() {
        val root = Files.createTempDirectory("aasc-model-recovery").toFile()
        try {
            val target = File(root, "qwen-test")
            val backup = File(root, ".model-backup-qwen-test-1").apply { mkdirs() }
            File(backup, "weight").writeText("old")
            val partial = File(root, ".model-qwen-test-2").apply { mkdirs() }
            File(partial, "weight").writeText("partial")
            val other = File(root, ".model-other-2").apply { mkdirs() }
            val outside = File(root, "outside").apply { mkdirs() }
            File(outside, "keep").writeText("keep")
            val linked = File(root, ".model-qwen-test-3")
            Files.createSymbolicLink(linked.toPath(), outside.toPath())
            OfflineModelRecovery.recover(target, "qwen-test")
            assertEquals("old", File(target, "weight").readText())
            assertFalse(partial.exists())
            assertTrue(other.exists())
            assertTrue(Files.isSymbolicLink(linked.toPath()))
            assertEquals("keep", File(outside, "keep").readText())
        } finally { root.deleteRecursively() }
    }

    @Test
    fun WebSocket健康要求101与真实accept摘要() {
        val headers = mapOf("upgrade" to "websocket", "connection" to "Upgrade",
            "sec-websocket-accept" to "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
        assertTrue(OfflineBootstrapHealth.validUpgrade("HTTP/1.1 101 Switching Protocols", headers))
        assertFalse(OfflineBootstrapHealth.validUpgrade("HTTP/1.1 200 OK", headers))
        assertFalse(OfflineBootstrapHealth.validUpgrade("HTTP/1.1 101 Switching Protocols",
            headers + ("sec-websocket-accept" to "incorrect")))
    }

    @Test
    fun 首装版本目录可复用且无需根源码或LLM元数据() {
        val root = Files.createTempDirectory("aasc-bootstrap-env").toFile()
        try {
            fun write(name: String, value: String) = File(root, name).apply { parentFile!!.mkdirs(); writeText(value) }
            val code = "updates/code/code-v5"
            write("$code/src/apps/server/boot/server-launcher.js", "launcher")
            write("$code/package.json", "{}")
            val lock = write("$code/package-lock.json", "{}")
            write("updates/dependencies/dependencies-v3/node_modules/express/package.json", "{}")
            write("updates/dependencies/dependencies-v3/dependency-manifest.json",
                JSONObject().put("version", 3).put("lockSha256", ModelHash.sha256(lock)).toString())
            write("config/config.json", "{}")
            write("runtime/arm64-v8a/lib/libz.so.1", "lib")
            write("updates/active-release.json", JSONObject().put("codeVersion", 5).put("dependencyVersion", 3)
                .put("legacyDependencies", false).put("lockSha256", ModelHash.sha256(lock)).toString())
            assertTrue(OfflineRuntimeState.hasServiceEnvironment(root))
            assertFalse(File(root, "src").exists())
            write("offline-model-manifest.json", "{\"models\":[]}")
            assertTrue(OfflineRuntimeState.hasServiceEnvironment(root))
            write("$code/package-lock.json", "tampered")
            assertFalse(OfflineRuntimeState.hasServiceEnvironment(root))
        } finally { root.deleteRecursively() }
    }

    @Test
    fun 种子映射恢复latest且保留用户配置() {
        val parent = Files.createTempDirectory("aasc-bootstrap-seeds").toFile()
        val seeds = File(parent, "seeds")
        val root = File(parent, "root")
        try {
            fun seed(name: String, text: String) = File(seeds, name).apply { parentFile!!.mkdirs(); writeText(text) }
            seed("config/config.json", "{}")
            seed("userconfig/profile.json", "user")
            seed("task/example/results/latest", "one\n")
            seed("task/example/results/one/result.json", "{}")
            File(root, "config/config.json").apply { parentFile!!.mkdirs(); writeText("{\"custom\":true}") }
            // 模拟上次进程在最新结果文本 marker 写入后退出。
            File(root, "res/tasks/example/results/latest").apply { parentFile!!.mkdirs(); writeText("one\n") }
            OfflineBootstrapManager.restoreSeeds(seeds, root)
            assertEquals("{\"custom\":true}", File(root, "config/config.json").readText())
            assertEquals("user", File(root, "home/.config/aasc-user/profile.json").readText())
            val latest = File(root, "res/tasks/example/results/latest")
            assertTrue(Files.isSymbolicLink(latest.toPath()))
            assertEquals("one", Files.readSymbolicLink(latest.toPath()).toString())
            OfflineBootstrapManager.restoreSeeds(seeds, root)
            assertTrue(Files.isSymbolicLink(latest.toPath()))
        } finally { parent.deleteRecursively() }
    }

    @Test(expected = IllegalArgumentException::class)
    fun 种子归档拒绝其他根目录() {
        val archive = Files.createTempFile("aasc-bootstrap-unsafe", ".zip").toFile()
        try {
            ZipOutputStream(archive.outputStream()).use { zip ->
                zip.putNextEntry(ZipEntry("res/models/llm.mnn")); zip.write(byteArrayOf(1)); zip.closeEntry()
            }
            OfflineBootstrapManager.inspectSeeds(archive)
        } finally { archive.delete() }
    }

    @Test
    fun 空任务实例目录恢复latest且中断重试保持数据() {
        val parent = Files.createTempDirectory("aasc-bootstrap-empty-instance").toFile()
        val seeds = File(parent, "seeds")
        val root = File(parent, "root")
        try {
            File(seeds, "config/config.json").apply { parentFile!!.mkdirs(); writeText("{}") }
            File(seeds, "userconfig").mkdirs()
            for (name in listOf("llm-server", "time.announce")) {
                File(seeds, "task/$name/results/empty").mkdirs()
                File(seeds, "task/$name/results/latest").writeText("empty\n")
            }
            val old = File(root, "res/tasks/llm-server/results/latest").apply { parentFile!!.mkdirs(); writeText("empty\n") }
            OfflineBootstrapManager.restoreSeeds(seeds, root)
            OfflineBootstrapManager.restoreSeeds(seeds, root)
            for (name in listOf("llm-server", "time.announce")) {
                val instance = File(root, "res/tasks/$name/results/empty")
                assertTrue(instance.isDirectory)
                assertEquals(0, instance.list()!!.size)
                assertEquals("empty", Files.readSymbolicLink(File(instance.parentFile, "latest").toPath()).toString())
            }
            assertTrue(Files.isSymbolicLink(old.toPath()))
        } finally { parent.deleteRecursively() }
    }

    @Test(expected = IllegalArgumentException::class)
    fun 空目录恢复拒绝链接父目录() {
        val parent = Files.createTempDirectory("aasc-bootstrap-directory-link").toFile()
        try {
            val seeds = File(parent, "seeds")
            val root = File(parent, "root")
            File(seeds, "config/config.json").apply { parentFile!!.mkdirs(); writeText("{}") }
            File(seeds, "userconfig").mkdirs()
            File(seeds, "task/example/results/empty").mkdirs()
            val outside = File(parent, "outside").apply { mkdirs() }
            val target = File(root, "res/tasks/example").apply { parentFile!!.mkdirs() }
            Files.createSymbolicLink(target.toPath(), outside.toPath())
            OfflineBootstrapManager.restoreSeeds(seeds, root)
        } finally { parent.deleteRecursively() }
    }

    @Test
    fun LAN模型下载策略只允许固定源与安全相对文件路径() {
        OfflineModelStore.requireAllowedSource("http://192.168.1.39/mnt/aimodel/tts/MSTTSLocZhCN.dat")
        OfflineModelStore.requireAllowedSource("https://c.aasc.us/mnt/aimodel/llm/qwen-test/llm.mnn")
        for (url in listOf("http://evil/mnt/aimodel/manifest.json", "http://192.168.1.39/other/model",
            "http://192.168.1.39/mnt/aimodel/../private", "https://c.aasc.us/mnt/aimodel/%2e%2e/private",
            "https://c.aasc.us/mnt/aimodel/manifest.json?redirect=evil")) {
            try { OfflineModelStore.requireAllowedSource(url); fail(url) } catch (_: IllegalArgumentException) { }
        }
    }

    @Test
    fun 模型目录定义拒绝重复文件和越界路径() {
        val model = JSONObject().put("modelId", "test").put("revision", "r").put("totalBytes", 1)
            .put("files", org.json.JSONArray().put(JSONObject().put("name", "llm.mnn")
                .put("path", "llm/test/llm.mnn").put("size", 1).put("sha256", "a".repeat(64))))
        val root = JSONObject().put("schemaVersion", 1).put("models", org.json.JSONArray().put(model))
        assertEquals(1, OfflineModelStore.parseCatalog(root.toString()).size)
        model.getJSONArray("files").getJSONObject(0).put("path", "llm/../llm.mnn")
        try { OfflineModelStore.parseCatalog(root.toString()); fail() } catch (_: IllegalArgumentException) { }
    }

    @Test
    fun 空内置LLM集合具有合法兼容指纹() {
        val metadata = """{"schemaVersion":1,"models":[]}"""
        val sha = java.security.MessageDigest.getInstance("SHA-256")
            .digest(OfflineUpdateManifest.canonicalJson(JSONObject(metadata)).toByteArray())
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        val compatibility = JSONObject(metadata).put("modelCompatibilitySha256", sha)
        assertTrue(OfflineUpdateManager.parseModelCompatibility(compatibility.toString(), metadata).second.isEmpty())
    }
}
