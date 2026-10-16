package com.aasc.display

import org.junit.Assert.*
import org.junit.Test

class OfflineLauncherProtocolTest {
    private fun rejected(raw: String) {
        try { OfflineLauncherProtocol.parse(raw); fail("必须拒绝无效页面消息") }
        catch (_: IllegalArgumentException) { }
    }
    @Test fun 页面模型确认请求可以解析且不能指定任意执行命令() {
        val value = OfflineLauncherProtocol.parse("""{"type":"models.prepareGroup","requestId":"ui-page-123","payload":{"modelIds":["tts"],"allowDownload":true}}""")
        assertEquals("tts", value.getJSONObject("payload").getJSONArray("modelIds").getString(0))
        rejected("""{"type":"exec","requestId":"ui-1","payload":{"code":"bad"}}""")
        rejected("""{"type":"models.prepare","requestId":"ui-1"}""")
    }
    @Test fun 页面代次ID和参数类型必须有效() {
        rejected("""{"type":"state.get","requestId":"../file"}""")
        rejected("""{"type":"state.get","requestId":"ui-1","payload":"bad"}""")
        assertEquals("state.get", OfflineLauncherProtocol.parse("""{"type":"state.get","requestId":"ui-page-2"}""").getString("type"))
    }
    @Test fun 页面消息按UTF8字节限制大小() {
        rejected("""{"type":"state.get","requestId":"ui-1","payload":{"x":"${"中".repeat(720000)}"}}""")
    }
    @Test fun 固定本地顶层文档可以加载且其他来源与子框架仍拒绝() {
        val url = OfflineLauncherProtocol.LOCAL_DOCUMENT_URL
        assertTrue(OfflineLauncherProtocol.isLocalDocument(url, true))
        assertFalse(OfflineLauncherProtocol.isLocalDocument(url, false))
        for (other in listOf("data:text/html;base64,", "file:///tmp/page.html", "https://example.com/", url + "other", "https://offline-launcher.aasc.local.evil/"))
            assertFalse(OfflineLauncherProtocol.isLocalDocument(other, true))
    }
}
