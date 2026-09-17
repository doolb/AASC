package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import java.io.File
import java.nio.file.Files
import org.junit.Test

class NodeRuntimeManifestTest {

    @Test
    fun 版本标记一致且文件大小正确时允许快速复用() {
        val root = Files.createTempDirectory("aasc-runtime-fast-path").toFile()
        try {
            val launcher = File(root, "src/apps/server/boot/server-launcher.js")
            launcher.parentFile?.mkdirs()
            launcher.writeText("launcher")
            File(root, "package.json").writeText("{}")
            File(root, "package-lock.json").writeText("{}")
            File(root, "config/config.json").apply {
                parentFile?.mkdirs()
                writeText("{}")
            }
            File(root, "runtime/arm64-v8a/lib/libcrypto.so").apply {
                parentFile?.mkdirs()
                writeText("library")
            }
            File(root, ".runtime-version").writeText("dev")
            val manifest = testManifest(launcher.length())

            assertTrue(NodeRuntimeInstaller.canReuseInstalledRuntime(root, manifest))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun 版本标记变化时不允许快速复用() {
        val root = Files.createTempDirectory("aasc-runtime-version").toFile()
        try {
            val launcher = File(root, "src/apps/server/boot/server-launcher.js")
            launcher.parentFile?.mkdirs()
            launcher.writeText("launcher")
            File(root, ".runtime-version").writeText("old")

            assertFalse(NodeRuntimeInstaller.canReuseInstalledRuntime(root, testManifest(launcher.length())))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun 关键启动文件缺失时不允许快速复用() {
        val root = Files.createTempDirectory("aasc-runtime-missing-file").toFile()
        try {
            File(root, ".runtime-version").writeText("dev")

            assertFalse(NodeRuntimeInstaller.canReuseInstalledRuntime(root, testManifest(7L)))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun 只使用小型版本标记和关键目录时允许快速复用() {
        val root = Files.createTempDirectory("aasc-runtime-version-fast-path").toFile()
        try {
            File(root, ".runtime-version").writeText("dev")
            File(root, "src/apps/server/boot/server-launcher.js").apply {
                parentFile?.mkdirs()
                writeText("launcher")
            }
            File(root, "package.json").writeText("{}")
            File(root, "package-lock.json").writeText("{}")
            File(root, "config/config.json").apply {
                parentFile?.mkdirs()
                writeText("{}")
            }
            File(root, "runtime/arm64-v8a/lib/libcrypto.so").apply {
                parentFile?.mkdirs()
                writeText("library")
            }

            assertTrue(NodeRuntimeInstaller.canReuseInstalledRuntime(root, "dev"))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun 离线Runtime快速复用时只检查内置模型元数据不要求LLM文件已解包() {
        val root = Files.createTempDirectory("aasc-offline-runtime-fast-path").toFile()
        try {
            File(root, ".runtime-version").writeText("dev")
            File(root, "src/apps/server/boot/server-launcher.js").apply {
                parentFile?.mkdirs()
                writeText("launcher")
            }
            File(root, "package.json").writeText("{}")
            File(root, "package-lock.json").writeText("{}")
            File(root, "runtime/arm64-v8a/lib/libcrypto.so").apply {
                parentFile?.mkdirs()
                writeText("library")
            }
            File(root, "offline-model-manifest.json").writeText(
                """{"version":1,"models":[{"modelId":"qwen-test","files":[] }]}"""
            )
            File(root, "config/config.json").apply {
                parentFile?.mkdirs()
                writeText("{\"chat\":{}}")
            }

            assertTrue(NodeRuntimeInstaller.canReuseInstalledRuntime(root, "dev", "offline"))
            File(root, "offline-model-manifest.json").writeText("{\"models\":[]}")
            assertFalse(NodeRuntimeInstaller.canReuseInstalledRuntime(root, "dev", "offline"))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun 用户任务目录不存在时才允许首次播种() {
        val root = Files.createTempDirectory("aasc-task-seed").toFile()
        try {
            assertTrue(NodeRuntimeInstaller.shouldSeedTaskDirectory(root))
            File(root, "res/tasks").mkdirs()
            assertFalse(NodeRuntimeInstaller.shouldSeedTaskDirectory(root))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun latest指向空实例目录时安装器创建目录() {
        val results = Files.createTempDirectory("aasc-task-results").toFile()
        try {
            val instanceDirectory = NodeRuntimeInstaller.ensureTaskInstanceDirectory(results, "running-1")

            assertTrue(instanceDirectory.isDirectory)
        } finally {
            results.deleteRecursively()
        }
    }

    private fun testManifest(launcherSize: Long): NodeRuntimeManifest {
        return NodeRuntimeManifest(
            version = "dev",
            abi = "arm64-v8a",
            entrypoint = "server/src/apps/server/boot/server-launcher.js",
            nodePath = "native/arm64-v8a/libaasc_node.so",
            files = listOf(
                NodeRuntimeFile(
                    path = "server/src/apps/server/boot/server-launcher.js",
                    size = launcherSize,
                    sha256 = "a".repeat(64)
                )
            )
        )
    }

    @Test
    fun 正常manifest保留固定ABI和启动入口() {
        val manifest = NodeRuntimeManifest.parse(
            """
            {
              "version": "dev",
              "abi": "arm64-v8a",
              "entrypoint": "server/src/apps/server/boot/server-launcher.js",
                "nodePath": "native/arm64-v8a/libaasc_node.so",
              "files": [
                {"path": "server/src/apps/server/boot/server-launcher.js", "size": 32, "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},
                {"path": "server/package.json", "size": 20, "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
              ]
            }
            """.trimIndent()
        )

        assertEquals("dev", manifest.version)
        assertEquals("arm64-v8a", manifest.abi)
        assertEquals("native/arm64-v8a/libaasc_node.so", manifest.nodePath)
        assertEquals(2, manifest.files.size)
    }

    @Test
    fun manifest解析可选模型资产且不将模型资产当成安装文件() {
        val manifest = NodeRuntimeManifest.parse(
            """
            {
              "version": "dev",
              "abi": "arm64-v8a",
              "entrypoint": "server/src/apps/server/boot/server-launcher.js",
              "nodePath": "native/arm64-v8a/libaasc_node.so",
              "files": [
                {"path": "server/src/apps/server/boot/server-launcher.js", "size": 1, "sha256": "${"a".repeat(64)}"}
              ],
              "modelAssets": [
                {"path": "display-models/qwen-test/model.bin", "size": 2, "sha256": "${"b".repeat(64)}"}
              ]
            }
            """.trimIndent()
        )

        assertEquals(1, manifest.modelAssets.size)
        assertEquals("display-models/qwen-test/model.bin", manifest.modelAssets[0].path)
        assertEquals(1, manifest.files.size)
    }

    @Test
    fun manifest默认校验且支持关闭内容校验() {
        val disabled = NodeRuntimeManifest.parse(
            """
            {
              "version": "dev",
              "abi": "arm64-v8a",
              "entrypoint": "server/src/apps/server/boot/server-launcher.js",
              "nodePath": "native/arm64-v8a/libaasc_node.so",
              "verifyRuntime": false,
              "files": [
                {"path": "server/src/apps/server/boot/server-launcher.js", "size": 0, "sha256": "${"a".repeat(64)}"}
              ]
            }
            """.trimIndent()
        )
        assertFalse(disabled.verifyRuntime)

        val defaultManifest = NodeRuntimeManifest.parse(
            """
            {
              "version": "dev",
              "abi": "arm64-v8a",
              "entrypoint": "server/src/apps/server/boot/server-launcher.js",
              "nodePath": "native/arm64-v8a/libaasc_node.so",
              "files": [
                {"path": "server/src/apps/server/boot/server-launcher.js", "size": 0, "sha256": "${"a".repeat(64)}"}
              ]
            }
            """.trimIndent()
        )
        assertTrue(defaultManifest.verifyRuntime)
    }

    @Test
    fun updateOnlyManifest只允许明确列出的Runtime动态库且不需要Node入口() {
        val manifest = NodeRuntimeManifest.parse(
            """
            {
              "version": "update-a1",
              "abi": "arm64-v8a",
              "updateOnly": true,
              "allowedRuntimeLibraryPaths": ["runtime/arm64-v8a/lib/libz.so.1"],
              "files": [
                {"path": "runtime/arm64-v8a/lib/libz.so.1", "size": 3, "sha256": "${"a".repeat(64)}"}
              ]
            }
            """.trimIndent()
        )

        assertTrue(manifest.updateOnly)
        assertEquals("", manifest.entrypoint)
        assertEquals(setOf("runtime/arm64-v8a/lib/libz.so.1"), manifest.allowedRuntimeLibraryPaths)
    }

    @Test(expected = IllegalArgumentException::class)
    fun updateOnlyManifest不能覆盖服务代码或模型() {
        NodeRuntimeManifest.parse(
            """
            {
              "version": "update-a1",
              "abi": "arm64-v8a",
              "updateOnly": true,
              "allowedRuntimeLibraryPaths": ["server/package.json"],
              "files": [
                {"path": "server/package.json", "size": 1, "sha256": "${"a".repeat(64)}"}
              ]
            }
            """.trimIndent()
        )
    }

    @Test
    fun minAPK只能复用已存在的完整offline运行目录() {
        val root = Files.createTempDirectory("aasc-full-offline-guard").toFile()
        try {
            assertFalse(NodeRuntimeInstaller.hasFullOfflineInstall(root))
            File(root, "src/apps/server/boot/server-launcher.js").apply {
                parentFile?.mkdirs()
                writeText("launcher")
            }
            File(root, "package.json").writeText("{}")
            File(root, "package-lock.json").writeText("{}")
            File(root, "node_modules/express/package.json").apply {
                parentFile?.mkdirs()
                writeText("{}")
            }
            File(root, "runtime/arm64-v8a/lib/libz.so.1").apply {
                parentFile?.mkdirs()
                writeText("lib")
            }
            File(root, "offline-model-manifest.json").writeText(
                """{"models":[{"modelId":"qwen-test","files":[]}]}"""
            )

            assertTrue(NodeRuntimeInstaller.hasFullOfflineInstall(root))
        } finally {
            root.deleteRecursively()
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun 不接受非arm64ABI() {
        NodeRuntimeManifest.parse(
            """
            {
              "version": "dev",
              "abi": "x86_64",
              "entrypoint": "server/src/apps/server/boot/server-launcher.js",
              "nodePath": "runtime/x86_64/node",
              "files": []
            }
            """.trimIndent()
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun 不接受路径穿越manifest() {
        NodeRuntimeManifest.parse(
            """
            {
              "version": "dev",
              "abi": "arm64-v8a",
              "entrypoint": "../server-launcher.js",
              "nodePath": "runtime/arm64-v8a/node",
              "files": [{"path": "../escape", "size": 1, "sha256": "abc"}]
            }
            """.trimIndent()
        )
    }
}
