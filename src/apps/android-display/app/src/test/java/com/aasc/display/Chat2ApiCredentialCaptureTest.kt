package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
}
