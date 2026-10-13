package com.aasc.display

import org.junit.Assert.*
import org.junit.Test

class NodeStartupDiagnosticsTest {
    @Test fun 实际错误优先于堆栈且摘要有界脱敏() {
        val diagnostics = NodeStartupDiagnostics()
        diagnostics.record("    at function (file.js:1)", true)
        diagnostics.record("Error: 路径错误 token=secret https://example.com/?key=private", true)
        diagnostics.record("Node.js v26.4.0", true)
        val message = diagnostics.describe("服务启动失败")
        assertTrue(message.contains("路径错误"))
        assertFalse(message.contains("secret"))
        assertFalse(message.contains("private"))
        assertTrue(NodeStartupDiagnostics.sanitize("a".repeat(2000)).length <= 768)
    }

    @Test fun 健康确认拒绝旧进程和不同版本路径() {
        assertTrue(NodeStartupDiagnostics.matchesRuntime("v71", "/code/code-v71", 71, "/code/code-v71"))
        assertFalse(NodeStartupDiagnostics.matchesRuntime("v68", "/code/code-v68", 71, "/code/code-v71"))
        assertFalse(NodeStartupDiagnostics.matchesRuntime("v71", "/code/code-v68", 71, "/code/code-v71"))
    }

    @Test fun 重试与网页等待不会覆盖真实失败且错误可恢复() {
        val state = OfflineFailureState()
        assertEquals("目录错误", state.startup("目录错误", true))
        assertEquals("目录错误", state.startup("正在重试", false))
        state.updateFailed("更新启动失败，保留v68")
        state.retryStartup()
        assertNull(state.startupError)
        assertEquals("更新启动失败，保留v68", state.updateError)
        val restored = OfflineFailureState()
        restored.restore(state.startupError, state.updateError)
        assertEquals(state.updateError, restored.updateError)
        restored.retryUpdate()
        assertNull(restored.updateError)
    }
}
