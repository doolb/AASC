package com.aasc.display

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class Chat2ApiDoubaoNodeCaptureTest {
    private val cookie = "sessionid=mock_session_123456789; passport_csrf_token=mock_csrf_123456789; s_v_web_id=verify_mock_123456789"
    private val agent = "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 Chrome/138.0.0.0"
    private val storage = mapOf("samantha_web_web_id" to "{\"web_id\":\"1234567890123456789\"}",
        "__tea_cache_tokens_497858" to "{\"web_id\":\"9876543210123456789\",\"token\":\"must-not-export\"}")
    private val profile = Chat2ApiCaptureProfile(allowedOrigins = listOf("https://www.doubao.com"),
        cookieBundles = listOf(Chat2ApiCookieBundle("cookie", listOf("sessionid", "passport_csrf_token", "s_v_web_id"), listOf("sessionid", "passport_csrf_token"))),
        requiredFields = listOf("cookie", "nodeProfile"), captureDoubaoNodeProfile = true)

    @Test fun `同账号真实来源资料组成嵌套对象_不导出多余存储`() {
        val captured = Chat2ApiCredentialCapture.merge(profile, "https://www.doubao.com/chat", cookies = cookie, localStorage = storage, userAgent = agent)
        assertTrue(Chat2ApiCredentialCapture.hasRequiredFields(profile, captured))
        val result = Chat2ApiCredentialCapture.credentialsJson(captured)
        val node = result.getJSONObject("nodeProfile")
        assertEquals("1234567890123456789", node.getString("deviceId"))
        assertEquals("9876543210123456789", node.getString("webId"))
        assertEquals("verify_mock_123456789", node.getString("fp"))
        assertEquals(agent, node.getString("userAgent")); assertEquals("3.41.0", node.getString("pcVersion"))
        assertFalse(result.toString().contains("must-not-export"))
        assertEquals(setOf("cookie", "nodeProfile"), result.keys().asSequence().toSet())
    }

    @Test fun `Cookie齐全而设备资料缺失不能提前完成_不生成身份`() {
        val captured = Chat2ApiCredentialCapture.merge(profile, "https://www.doubao.com", cookies = cookie)
        assertEquals(cookie, captured["cookie"])
        assertFalse(Chat2ApiCredentialCapture.hasRequiredFields(profile, captured))
        assertFalse(captured.containsKey("nodeProfile"))
        for (missing in storage.keys) assertNull(Chat2ApiDoubaoNodeCapture.build(cookie, storage - missing, agent))
        assertNull(Chat2ApiDoubaoNodeCapture.build(cookie.substringBefore("; s_v_web_id"), storage, agent))
    }

    @Test fun `存储结构错误_大字段_非法ID_UA_fp不产生profile`() {
        for (raw in listOf("{}", "not-json", "{\"web_id\":\"12e3\"}", "{\"web_id\":12.5}", "{\"web_id\":true}", "{\"web_id\":\"${"1".repeat(33)}\"}", " ".repeat(16385))) {
            assertNull(Chat2ApiDoubaoNodeCapture.build(cookie, storage + ("samantha_web_web_id" to raw), agent))
        }
        for (bad in listOf(null, "bad", "$agent\r\nCookie:secret", "$agent${"x".repeat(512)}")) assertNull(Chat2ApiDoubaoNodeCapture.build(cookie, storage, bad))
        assertNull(Chat2ApiDoubaoNodeCapture.build(cookie.replace("verify_mock_123456789", "bad"), storage, agent))
        assertNull(Chat2ApiDoubaoNodeCapture.build("$cookie; s_v_web_id=verify_mock_123456789", storage, agent))
    }

    @Test fun `整数存储ID精确读取不经过浮点转换`() {
        val raw = storage + ("samantha_web_web_id" to "{\"web_id\":1234567890123456789}")
        assertEquals("1234567890123456789", JSONObject(Chat2ApiDoubaoNodeCapture.build(cookie, raw, agent)!!).getString("deviceId"))
    }

    @Test fun `来源白名单不能扩大豆包设备采集范围`() {
        for (url in listOf("https://www.doubao.com.evil.example", "http://www.doubao.com", "https://www.doubao.com:444")) {
            assertTrue(Chat2ApiCredentialCapture.merge(profile, url, cookies = cookie, localStorage = storage, userAgent = agent).isEmpty())
        }
        val other = profile.copy(allowedOrigins = listOf("https://chat.example"))
        assertFalse(Chat2ApiCredentialCapture.merge(other, "https://chat.example", cookies = cookie, localStorage = storage, userAgent = agent).containsKey("nodeProfile"))
    }

    @Test fun `服务端标记启用固定采集_旧Provider序列化保持字符串`() {
        val parsed = Chat2ApiCaptureProfile.fromJson(JSONObject("""{"allowedOrigins":["https://www.doubao.com"],"nodeProfile":"doubao","requiredFields":["cookie","nodeProfile"]}"""))
        assertTrue(parsed.captureDoubaoNodeProfile); assertEquals(listOf("cookie", "nodeProfile"), parsed.requiredFields)
        assertFalse(Chat2ApiCaptureProfile.fromJson(JSONObject("""{"nodeProfile":"unknown"}""")).captureDoubaoNodeProfile)
        assertEquals("old-token", Chat2ApiCredentialCapture.credentialsJson(mapOf("token" to "old-token")).getString("token"))
    }
}
