package com.aasc.display

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NodeServerServiceTest {

    @Test
    fun Node命令使用私有目录launcher并关闭TUI() {
        val root = File("/data/user/0/com.aasc.display/files/aasc-server")

        assertEquals(
            listOf(
                "/data/user/0/com.aasc.display/files/aasc-server/runtime/arm64-v8a/node",
                "/data/user/0/com.aasc.display/files/aasc-server/src/apps/server/boot/server-launcher.js",
                "--no-tui"
            ),
            NodeServerService.buildNodeCommand(root)
        )
    }

    @Test
    fun Node命令优先使用APK提取的原生库路径() {
        val root = File("/data/user/0/com.aasc.display/files/aasc-server")
        val nativeLibraryDir = File("/data/app/com.aasc.display/lib/arm64")

        assertEquals(
            "/data/app/com.aasc.display/lib/arm64/libaasc_node.so",
            NodeServerService.buildNodeCommand(root, nativeLibraryDir).first()
        )
    }

    @Test
    fun 进程失败使用一秒起步三十秒封顶退避() {
        assertEquals(1000L, NodeServerService.retryDelayMs(0))
        assertEquals(2000L, NodeServerService.retryDelayMs(1))
        assertEquals(30000L, NodeServerService.retryDelayMs(5))
        assertEquals(30000L, NodeServerService.retryDelayMs(10))
    }

    @Test
    fun launcher仍存活时需要强制终止而已结束进程不需要() {
        assertEquals(true, NodeServerService.shouldForceTerminate(true))
        assertEquals(false, NodeServerService.shouldForceTerminate(false))
    }

    @Test
    fun Node运行环境使用APK私有目录和Runtime动态库() {
        val root = File("/data/user/0/com.aasc.display/files/aasc-server")
        val environment = NodeServerService.buildNodeEnvironment(
            root,
            "https://192.168.1.39:8081",
            "apk-0.1"
        )

        assertEquals(
            "/data/user/0/com.aasc.display/files/aasc-server/home",
            environment["HOME"]
        )
        assertEquals(
            "/data/user/0/com.aasc.display/files/aasc-server/runtime/arm64-v8a/lib",
            environment["LD_LIBRARY_PATH"]
        )
        assertEquals("1", environment["AASC_ANDROID_NODE"])
        assertEquals("https://192.168.1.39:8081", environment["AASC_MAIN_SERVER_URL"])
        assertEquals("/dev/null", environment["OPENSSL_CONF"])
    }

    @Test
    fun Node运行环境信任APK内置主服务器证书() {
        val root = Files.createTempDirectory("aasc-node-environment").toFile()
        val certificate = File(root, "res/certs/cert.pem")
        certificate.parentFile?.mkdirs()
        certificate.writeText("test-certificate")

        try {
            val environment = NodeServerService.buildNodeEnvironment(
                root,
                "https://127.0.0.1:8081",
                "apk-0.1"
            )

            assertEquals(certificate.absolutePath, environment["NODE_EXTRA_CA_CERTS"])
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun Node运行环境缺少APK内置证书时不注入证书变量() {
        val root = Files.createTempDirectory("aasc-node-environment-missing-cert").toFile()

        try {
            val environment = NodeServerService.buildNodeEnvironment(
                root,
                "https://127.0.0.1:8081",
                "apk-0.1"
            )

            assertNull(environment["NODE_EXTRA_CA_CERTS"])
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun 离线Node运行环境带有离线标记() {
        val root = File("/data/user/0/com.aasc.display.offline/files/aasc-server")
        val environment = NodeServerService.buildNodeEnvironment(
            root,
            "https://127.0.0.1:8081",
            "apk-0.1.0-offline",
            offlineMode = true
        )

        assertEquals("1", environment["AASC_OFFLINE_MODE"])
    }

    @Test
    fun Node运行环境传递回环SAF网关地址和临时令牌() {
        val root = File("/data/user/0/com.aasc.display/files/aasc-server")
        val environment = NodeServerService.buildNodeEnvironment(
            root,
            "http://127.0.0.1:8081",
            "apk-0.1",
            safBaseUrl = "http://127.0.0.1:39123",
            safToken = "runtime-token"
        )

        assertEquals("http://127.0.0.1:39123", environment["AASC_ANDROID_SAF_URL"])
        assertEquals("runtime-token", environment["AASC_ANDROID_SAF_TOKEN"])
    }

    @Test
    fun Node运行环境传递Android应用专属外部媒体根目录() {
        val root = File("/data/user/0/com.aasc.display/files/aasc-server")
        val environment = NodeServerService.buildNodeEnvironment(
            root,
            "http://127.0.0.1:8081",
            "apk-0.1",
            androidMediaHome = "/storage/emulated/0/Android/data/com.aasc.display/files"
        )

        assertEquals(
            "/storage/emulated/0/Android/data/com.aasc.display/files",
            environment["AASC_ANDROID_MEDIA_HOME"]
        )
    }

}
