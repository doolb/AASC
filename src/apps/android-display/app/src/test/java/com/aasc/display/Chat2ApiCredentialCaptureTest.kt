package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class Chat2ApiCredentialCaptureTest {

    @Test
    fun `默认端口和大小写是等效来源_恶意来源不能恢复`() {
        val profile = Chat2ApiCaptureProfile(allowedOrigins = listOf("https://www.qianwen.com", "http://local.example"))
        assertTrue(Chat2ApiCredentialCapture.isAllowed(profile, "HTTPS://WWW.QIANWEN.COM:443/chat/test?ticket=hidden"))
        assertTrue(Chat2ApiCredentialCapture.isAllowed(profile, "http://local.example:80/page"))
        for (url in listOf("https://www.qianwen.com:444/", "https://www.qianwen.com.evil.example/", "http://www.qianwen.com/",
            "https://secret@www.qianwen.com/", "https://www.qianwen.com:0/", "https://www.qianwen.com:65536/", "about:blank", "javascript:alert(1)")) {
            assertFalse(url, Chat2ApiCredentialCapture.isAllowed(profile, url))
        }
    }

    @Test
    fun `恢复提示显示来源但没有路径查询片段和凭证`() {
        val profile = Chat2ApiCaptureProfile(allowedOrigins = listOf("https://www.qianwen.com"))
        val success = Chat2ApiCredentialRestore.pageStatus(profile, "https://WWW.QIANWEN.COM:443/private?ticket=secret#token=hidden", true)
        assertTrue(success.contains("https://www.qianwen.com"))
        assertTrue(success.contains("已尝试恢复"))
        for (value in listOf("private", "ticket", "secret", "token", "hidden", ":443")) assertFalse(success.contains(value))
        val denied = Chat2ApiCredentialRestore.pageStatus(profile, "https://account.example:8443/login?ticket=secret", true)
        assertTrue(denied.contains("https://account.example:8443"))
        assertTrue(denied.contains("已跳过凭证注入"))
        assertFalse(denied.contains("secret"))
        assertTrue(Chat2ApiCredentialRestore.pageStatus(profile, "about:blank", true).contains("未知来源"))
        assertTrue(Chat2ApiCredentialRestore.pageStatus(profile, "https://www.qianwen.com", false).contains("手动登录"))
    }

    @Test
    fun 只从允许域名和配置字段合并凭据() {
        val profile = Chat2ApiCaptureProfile(
            allowedOrigins = listOf("https://chat.example"),
            authorizationField = "token",
            cookieFields = mapOf("session" to "sessionToken"),
            localStorageFields = mapOf("userToken" to "token")
        )

        val captured = Chat2ApiCredentialCapture.merge(
            profile,
            url = "https://chat.example/app",
            authorization = "Bearer auth-token",
            cookies = "session=cookie-token; other=ignored",
            localStorage = mapOf("userToken" to "storage-token")
        )

        assertEquals("storage-token", captured["token"])
        assertEquals("cookie-token", captured["sessionToken"])
        assertFalse(Chat2ApiCredentialCapture.isAllowed(profile, "https://evil.example"))
    }

    @Test
    fun `恢复只生成 profile 白名单字段并安全编码 LocalStorage`() {
        val profile = Chat2ApiCaptureProfile(
            allowedOrigins = listOf("https://chat.example"),
            cookieFields = mapOf("session" to "sessionToken"),
            localStorageFields = mapOf("userToken" to "token")
        )
        val cookies = Chat2ApiCredentialRestore.cookieMappings(
            profile,
            "https://chat.example",
            mapOf("sessionToken" to "cookie-token", "other" to "ignored")
        )
        assertEquals(listOf(Chat2ApiRestoreCookie("https://chat.example", "session", "cookie-token")), cookies)
        val script = Chat2ApiCredentialRestore.localStorageScript(
            Chat2ApiCredentialRestore.localStorageMappings(
                profile,
                "https://chat.example",
                mapOf("token" to "storage-\"token")
            )
        )
        assertTrue(script.contains("storage-\\\"token"))
        assertFalse(script.contains("ignored"))
        assertTrue(Chat2ApiCredentialRestore.supportsAutomaticRestore(profile))
    }

    @Test
    fun `Authorization-only profile 回退手动登录`() {
        val profile = Chat2ApiCaptureProfile(
            allowedOrigins = listOf("https://chat.example"),
            authorizationField = "token"
        )
        assertFalse(Chat2ApiCredentialRestore.supportsAutomaticRestore(profile))
        assertTrue(Chat2ApiCredentialRestore.shouldUseManualLogin(profile))
    }
}
