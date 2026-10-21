package com.aasc.display

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DoubaoWebViewAccountTest {
    private val session = "mock_session_1234567890"
    private fun sample() = JSONObject()
        .put("cookieSnapshot", JSONObject().put(DoubaoWebViewAccount.ORIGIN,
            "sessionid=$session; s_v_web_id=verify_mock_123456"))
        .put("nodeProfile", JSONObject().put("deviceId", "123").put("webId", "456")
            .put("fp", "verify_mock_123456").put("userAgent", "Mozilla/5.0 Android WebView test"))

    @Test fun `运行时只恢复匹配账号的固定官网资料`() {
        val validated = DoubaoWebViewAccount.validate(sample(), session)
        val script = DoubaoWebViewAccount.storageScript(validated.getJSONObject("nodeProfile"))
        assertTrue(script.contains("samantha_web_web_id"))
        assertTrue(script.contains("__tea_cache_tokens_497858"))
        assertFalse(script.contains(session))
        for (bad in listOf(
            sample().put("cookieSnapshot", JSONObject().put("https://evil.test", "sessionid=$session")),
            sample().apply { getJSONObject("nodeProfile").put("fp", "verify_wrong_12345") },
            sample().apply { getJSONObject("nodeProfile").put("userAgent", "Mozilla/5.0 bad\r\nsecret") },
            sample().apply { getJSONObject("cookieSnapshot").put(DoubaoWebViewAccount.ORIGIN,
                "sessionid=other_session_123456; sessionid=$session; s_v_web_id=verify_mock_123456") }
        )) {
            try { DoubaoWebViewAccount.validate(bad, session); fail("必须拒绝混合身份或非法来源") }
            catch (_: IllegalArgumentException) { }
        }
    }

    @Test fun `登录与运行互斥且非持有者不能释放`() {
        try {
            assertTrue(Chat2ApiWebViewLease.acquire("login-test"))
            assertFalse(Chat2ApiWebViewLease.acquire("runtime-test"))
            Chat2ApiWebViewLease.release("runtime-test")
            assertFalse(Chat2ApiWebViewLease.acquire("runtime-test"))
            Chat2ApiWebViewLease.release("login-test")
            assertTrue(Chat2ApiWebViewLease.acquire("runtime-test"))
            assertFalse(Chat2ApiWebViewLease.acquire("login-test"))
        } finally { Chat2ApiWebViewLease.release("login-test"); Chat2ApiWebViewLease.release("runtime-test") }
    }
}
