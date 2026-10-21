package com.aasc.display

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class Chat2ApiDoubaoRequestCaptureTest {
    private fun sample(): JSONObject {
        val body = JSONObject().put("client_meta", JSONObject().put("conversation_id", "")
            .put("local_conversation_id", "old-local"))
            .put("messages", JSONArray().put(JSONObject().put("local_message_id", "old-message")
                .put("content_block", JSONArray().put(JSONObject().put("block_id", "old-block")
                    .put("content", JSONObject().put("text_block", JSONObject().put("text", "私人原话")))))))
            .put("option", JSONObject().put("need_create_conversation", true)
                .put("unique_key", "old-unique").put("create_time_ms", 1))
            .put("ext", JSONObject().put("use_deep_think", "0"))
        return JSONObject().put("url", "https://www.doubao.com/chat/completion?aid=497858&device_id=123&web_id=456&fp=mock_fp_12345678")
            .put("method", "POST").put("headers", JSONObject().put("content-type", "application/json")
                .put("cookie", "secret-cookie"))
            .put("body", body.toString()).put("verified", true)
    }

    @Test fun `官网成功首轮请求只导出模板`() {
        val profile = Chat2ApiDoubaoRequestCapture.normalize(sample().toString())!!
        val packed = profile.toString()
        for (secret in listOf("私人原话", "old-local", "old-message", "old-block", "old-unique", "secret-cookie")) {
            assertFalse(packed.contains(secret))
        }
        assertEquals(1, profile.getInt("version"))
        assertEquals("", profile.getJSONObject("body").getJSONObject("client_meta").getString("conversation_id"))
        assertFalse(profile.getJSONObject("body").has("messages"))
        assertTrue(profile.has("browserVerifiedAt"))
        val encoded = Chat2ApiCredentialCapture.credentialsJson(mapOf("requestProfile" to packed))
        assertTrue(encoded.opt("requestProfile") is JSONObject)
    }

    @Test fun `跨来源和未完成聊天不能被当成验证登录`() {
        val source = sample()
        assertNull(Chat2ApiDoubaoRequestCapture.normalize(JSONObject(source.toString())
            .put("url", "https://www.doubao.com.evil.test/chat/completion").toString()))
        assertNull(Chat2ApiDoubaoRequestCapture.normalize(JSONObject(source.toString())
            .put("verified", false).toString()))
        val oldConversation = JSONObject(source.getString("body"))
        oldConversation.getJSONObject("client_meta").put("conversation_id", "old-remote")
        assertNull(Chat2ApiDoubaoRequestCapture.normalize(JSONObject(source.toString())
            .put("body", oldConversation.toString()).toString()))
    }
}
