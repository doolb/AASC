package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class Chat2ApiCredentialCaptureTest {

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
