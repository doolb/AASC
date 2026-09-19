package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class OfflineUpdateManagerTest {

    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun 同依赖版本且lock一致时只更新服务代码() {
        val manifest = manifest(codeVersion = 3, dependencyVersion = 1, lock = LOCK_A)

        assertEquals(
            OfflineUpdateManager.ServiceUpdatePlan.CODE_ONLY,
            OfflineUpdateManager.planServiceUpdate(InstalledServiceVersion(2, 1, LOCK_A), manifest)
        )
    }

    @Test
    fun 依赖版本变化时将代码和依赖作为一个release整体应用() {
        val manifest = manifest(codeVersion = 3, dependencyVersion = 2, lock = LOCK_B)

        assertEquals(
            OfflineUpdateManager.ServiceUpdatePlan.ALL,
            OfflineUpdateManager.planServiceUpdate(InstalledServiceVersion(2, 1, LOCK_A), manifest)
        )
    }

    @Test
    fun 过期清单和dependencyOnly变化都不能降级或单独切换依赖() {
        val stale = manifest(codeVersion = 2, dependencyVersion = 1, lock = LOCK_A)
        val dependencyOnly = manifest(codeVersion = 3, dependencyVersion = 2, lock = LOCK_B)

        assertEquals(
            OfflineUpdateManager.ServiceUpdatePlan.CURRENT,
            OfflineUpdateManager.planServiceUpdate(InstalledServiceVersion(3, 2, LOCK_B), stale)
        )
        assertEquals(
            OfflineUpdateManager.ServiceUpdatePlan.NEEDS_ALL,
            OfflineUpdateManager.planServiceUpdate(InstalledServiceVersion(3, 1, LOCK_A), dependencyOnly)
        )
    }

    @Test
    fun 下载空间预算使用溢出安全的大小比较() {
        assertTrue(OfflineUpdateManager.hasEnoughSpace(500, 100, 200, 100))
        assertFalse(OfflineUpdateManager.hasEnoughSpace(399, 100, 200, 100))
        assertFalse(OfflineUpdateManager.hasEnoughSpace(Long.MAX_VALUE, Long.MAX_VALUE, 1, 1))
    }

    @Test
    fun API28归档签名读取会合并现代和旧版证书来源() {
        val method = OfflineUpdateManager::class.java.declaredMethods.firstOrNull {
            it.name == "mergeSignerSha256Digests" && it.parameterTypes.size == 2
        }
        assertTrue("应提供归档签名摘要合并方法", method != null)

        val merged = method!!.invoke(
            null,
            setOf("modern"),
            setOf("legacy")
        ) as Set<*>

        assertEquals(setOf("modern", "legacy"), merged)
    }

    @Test
    fun 热更域名解析后使用IP替换主机并保留路径端口() {
        val method = OfflineUpdateManager::class.java.declaredMethods.firstOrNull {
            it.name == "replaceUpdateUrlHost" && it.parameterTypes.size == 2
        }
        assertTrue("应提供热更 URL 主机替换方法", method != null)

        val rewritten = method!!.invoke(
            null,
            "http://c.aasc.us:8080/mnt/aasc-offline/",
            "120.79.245.103"
        ) as String

        assertEquals("http://120.79.245.103:8080/mnt/aasc-offline/", rewritten)
    }

    @Test
    fun minApk模型兼容指纹与Node发布器规范化结果一致() {
        val compatibility = """{"schemaVersion":1,"modelCompatibilitySha256":"31b71f35b06ce06a77b31a3ebc22a1963af3705cbc36d6014b24d5adece8c20a"}"""
        val modelManifest = """{"models":[{"modelId":"m","revision":"r","assetPrefix":"ignored","files":[{"name":"a_b","assetPath":"display-models/m/a_b","size":2,"sha256":"${"b".repeat(64)}"},{"name":"a-b","assetPath":"display-models/m/a-b","size":1,"sha256":"${"a".repeat(64)}"}]}]}"""

        val result = OfflineUpdateManager.parseModelCompatibility(compatibility, modelManifest)

        assertEquals("31b71f35b06ce06a77b31a3ebc22a1963af3705cbc36d6014b24d5adece8c20a", result.first)
        assertEquals(listOf("m"), result.second)
    }

    @Test
    fun minApk模型兼容指纹不匹配时拒绝安装() {
        val compatibility = """{"schemaVersion":1,"modelCompatibilitySha256":"${"0".repeat(64)}"}"""
        val modelManifest = """{"models":[{"modelId":"m","revision":"r","files":[{"name":"weights.bin","size":4,"sha256":"${"a".repeat(64)}"}]}]}"""

        try {
            OfflineUpdateManager.parseModelCompatibility(compatibility, modelManifest)
            fail("预期模型兼容指纹不匹配时抛出异常")
        } catch (_: IllegalArgumentException) {
            // 指纹不匹配必须在下载 APK 或请求 PackageInstaller 前被拒绝。
        }
    }

    @Test
    fun ZIP相对路径阻止绝对路径穿越盘符和反斜杠() {
        assertTrue(OfflineUpdateManager.isSafeArchivePath("src/apps/server/app.js"))
        assertFalse(OfflineUpdateManager.isSafeArchivePath("../outside.js"))
        assertFalse(OfflineUpdateManager.isSafeArchivePath("/data/local/tmp/file"))
        assertFalse(OfflineUpdateManager.isSafeArchivePath("C:/data/file"))
        assertFalse(OfflineUpdateManager.isSafeArchivePath("src\\outside.js"))
    }

    @Test
    fun 组件白名单接受去除目录斜杠后的根目录并继续拒绝跨组件路径() {
        assertTrue(OfflineUpdateManager.isAllowedComponentEntry("code", "src"))
        assertTrue(OfflineUpdateManager.isAllowedComponentEntry("code", "src/apps/server"))
        assertTrue(OfflineUpdateManager.isAllowedComponentEntry("dependencies", "node_modules"))
        assertTrue(OfflineUpdateManager.isAllowedComponentEntry("dependencies", "node_modules/express"))
        assertFalse(OfflineUpdateManager.isAllowedComponentEntry("code", "src/apps/android-display"))
        assertFalse(OfflineUpdateManager.isAllowedComponentEntry("code", "node_modules"))
        assertFalse(OfflineUpdateManager.isAllowedComponentEntry("dependencies", "src"))
    }

    @Test
    fun ZIP展开前校验路径并验证实际写入大小() {
        val archive = temporaryFolder.newFile("code.zip")
        ZipOutputStream(FileOutputStream(archive)).use { zip ->
            zip.putNextEntry(ZipEntry("src/apps/server/app.js"))
            zip.write("server code".toByteArray())
            zip.closeEntry()
        }
        val destination = temporaryFolder.newFolder("expanded")

        val expandedBytes = OfflineUpdateManager.extractZipArchive(archive, destination)

        assertEquals("server code".length.toLong(), expandedBytes)
        assertEquals("server code", File(destination, "src/apps/server/app.js").readText())
    }

    @Test(expected = IllegalArgumentException::class)
    fun ZIP穿越路径在写入前被拒绝() {
        val archive = temporaryFolder.newFile("traversal.zip")
        ZipOutputStream(FileOutputStream(archive)).use { zip ->
            zip.putNextEntry(ZipEntry("../outside.txt"))
            zip.write("unsafe".toByteArray())
            zip.closeEntry()
        }

        OfflineUpdateManager.extractZipArchive(archive, temporaryFolder.newFolder("safe"))
    }

    private fun manifest(codeVersion: Int, dependencyVersion: Int, lock: String): OfflineUpdateManifest {
        val code = OfflineUpdateArtifact(
            version = codeVersion,
            relativeUrl = "code/code-v$codeVersion.zip",
            size = 10,
            sha256 = "a".repeat(64),
            requiredDependencyVersion = dependencyVersion,
            requiredLockSha256 = lock
        )
        val dependencies = OfflineUpdateArtifact(
            version = dependencyVersion,
            relativeUrl = "dependencies/dependencies-v$dependencyVersion.zip",
            size = 20,
            sha256 = "b".repeat(64),
            lockSha256 = lock
        )
        return OfflineUpdateManifest(code, dependencies, null)
    }

    companion object {
        private val LOCK_A = "c".repeat(64)
        private val LOCK_B = "d".repeat(64)
    }
}
