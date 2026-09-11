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
            File(root, "runtime/arm64-v8a/lib/libcrypto.so").apply {
                parentFile?.mkdirs()
                writeText("library")
            }

            assertTrue(NodeRuntimeInstaller.canReuseInstalledRuntime(root, "dev"))
        } finally {
            root.deleteRecursively()
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
