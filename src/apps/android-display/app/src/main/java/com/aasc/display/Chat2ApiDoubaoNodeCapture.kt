package com.aasc.display

import org.json.JSONObject

/** 豆包Node初始化资料只来自同一次官网登录；不生成或借用其他账号的设备身份。 */
object Chat2ApiDoubaoNodeCapture {
    val storageKeys = listOf("samantha_web_web_id", "__tea_cache_tokens_497858")

    fun build(cookie: String?, storage: Map<String, String>, userAgent: String?): String? {
        val agent = userAgent ?: return null
        if (agent.length > 512 || !Regex("^Mozilla/5\\.0 [\\x20-\\x7E]{10,}$").matches(agent)) return null
        val fp = cookie.orEmpty().split(';').map { it.trim() }
            .filter { it.startsWith("s_v_web_id=") }.singleOrNull()?.substringAfter('=') ?: return null
        if (!Regex("^[A-Za-z0-9_-]{8,256}$").matches(fp)) return null
        val deviceId = webId(storage[storageKeys[0]]) ?: return null
        val webId = webId(storage[storageKeys[1]]) ?: return null
        return JSONObject().put("deviceId", deviceId).put("webId", webId).put("fp", fp)
            .put("userAgent", agent).put("pcVersion", "3.41.0").toString()
    }

    /** 限制单项存储容量并保留十进制ID，拒绝缺失、截断或官网结构变化，不猜测替代字段。 */
    private fun webId(raw: String?): String? {
        if (raw == null || raw.length > 16 * 1024) return null
        return try {
            val value = JSONObject(raw).opt("web_id")
            if (value !is String && value !is Long && value !is Int) return null
            value.toString().takeIf { Regex("^[0-9]{1,32}$").matches(it) }
        } catch (_: Exception) { null }
    }
}
