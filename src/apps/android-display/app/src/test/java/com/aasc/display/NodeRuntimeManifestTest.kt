package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test

class NodeRuntimeManifestTest {

    @Test
    fun 正常manifest保留固定ABI和启动入口() {
        val manifest = NodeRuntimeManifest.parse(
            """
            {
              "version": "dev",
              "abi": "arm64-v8a",
              "entrypoint": "server/src/apps/server/boot/server-launcher.js",
              "nodePath": "runtime/arm64-v8a/node",
              "files": [
                {"path": "runtime/arm64-v8a/node", "size": 12, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
                {"path": "server/src/apps/server/boot/server-launcher.js", "size": 32, "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},
                {"path": "server/package.json", "size": 20, "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
              ]
            }
            """.trimIndent()
        )

        assertEquals("dev", manifest.version)
        assertEquals("arm64-v8a", manifest.abi)
        assertEquals("runtime/arm64-v8a/node", manifest.nodePath)
        assertEquals(3, manifest.files.size)
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
