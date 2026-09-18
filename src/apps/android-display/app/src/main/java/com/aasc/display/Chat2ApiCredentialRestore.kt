package com.aasc.display

import org.json.JSONObject

data class Chat2ApiRestoreCookie(
    val origin: String,
    val name: String,
    val value: String
)

data class Chat2ApiRestoreLocalStorage(
    val origin: String,
    val key: String,
    val value: String
)

/**
 * 外部网页恢复的纯逻辑边界：只把服务端 profile 声明的字段转换为 WebView 操作。
 * 这里不记录、不持久化凭证，便于 JVM 测试 origin、字段白名单和脚本编码。
 */
object Chat2ApiCredentialRestore {

    fun supportsAutomaticRestore(profile: Chat2ApiCaptureProfile): Boolean {
        return profile.cookieFields.isNotEmpty() || profile.localStorageFields.isNotEmpty()
    }

    fun shouldUseManualLogin(profile: Chat2ApiCaptureProfile): Boolean = !supportsAutomaticRestore(profile)

    fun cookieMappings(
        profile: Chat2ApiCaptureProfile,
        origin: String,
        credentials: Map<String, String>
    ): List<Chat2ApiRestoreCookie> {
        if (!Chat2ApiCredentialCapture.isAllowed(profile, origin)) return emptyList()
        return profile.cookieFields.mapNotNull { (cookieName, field) ->
            credentials[field]?.takeIf { it.isNotBlank() }?.let { value -> Chat2ApiRestoreCookie(origin, cookieName, value) }
        }
    }

    fun localStorageMappings(
        profile: Chat2ApiCaptureProfile,
        origin: String,
        credentials: Map<String, String>
    ): List<Chat2ApiRestoreLocalStorage> {
        if (!Chat2ApiCredentialCapture.isAllowed(profile, origin)) return emptyList()
        return profile.localStorageFields.mapNotNull { (key, field) ->
            credentials[field]?.takeIf { it.isNotBlank() }?.let { value -> Chat2ApiRestoreLocalStorage(origin, key, value) }
        }
    }

    fun localStorageScript(mappings: List<Chat2ApiRestoreLocalStorage>): String {
        if (mappings.isEmpty()) return ""
        val values = JSONObject()
        mappings.forEach { mapping -> values.put(mapping.key, mapping.value) }
        return "(function(){const values=${values};Object.keys(values).forEach(function(key){localStorage.setItem(key, values[key]);});})();"
    }
}
