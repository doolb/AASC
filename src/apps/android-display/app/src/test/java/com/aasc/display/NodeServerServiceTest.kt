package com.aasc.display

import java.io.File
import org.junit.Assert.assertEquals
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
}
