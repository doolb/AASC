package com.aasc.display

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.Locale

/**
 * 服务端下发的 Android 登录捕获配置，只描述字段映射，不包含可执行脚本。
 * 该数据类和解析器保持纯逻辑，便于在 Android JVM 单测中验证凭据边界。
 */
data class Chat2ApiCookieBundle(
    val field: String,
    val names: List<String>,
    val requiredNames: List<String> = emptyList(),
    val requiredAnyNames: List<String> = emptyList()
)

data class Chat2ApiCaptureProfile(
    val allowedOrigins: List<String>,
    val authorizationField: String? = null,
    val cookieFields: Map<String, String> = emptyMap(),
    val localStorageFields: Map<String, String> = emptyMap(),
    val requiredFields: List<String> = emptyList(),
    val cookieBundles: List<Chat2ApiCookieBundle> = emptyList(),
    val captureDoubaoNodeProfile: Boolean = false
) {
    companion object {
        fun fromJson(json: JSONObject): Chat2ApiCaptureProfile {
            val authorization = json.optJSONObject("authorization")
            val cookieFields = mutableMapOf<String, String>()
            val cookies = json.optJSONArray("cookies") ?: JSONArray()
            for (index in 0 until cookies.length()) {
                val item = cookies.optJSONObject(index) ?: continue
                val name = item.optString("name").trim()
                val field = item.optString("field").trim()
                if (name.isNotEmpty() && field.isNotEmpty()) cookieFields[name] = field
            }
            val localStorageFields = mutableMapOf<String, String>()
            val localStorage = json.optJSONArray("localStorage") ?: JSONArray()
            for (index in 0 until localStorage.length()) {
                val item = localStorage.optJSONObject(index) ?: continue
                val key = item.optString("key").trim()
                val field = item.optString("field").trim()
                if (key.isNotEmpty() && field.isNotEmpty()) localStorageFields[key] = field
            }
            val requiredFields = mutableListOf<String>()
            val required = json.optJSONArray("requiredFields") ?: JSONArray()
            for (index in 0 until required.length()) {
                val field = required.optString(index).trim()
                if (field.isNotEmpty()) requiredFields.add(field)
            }
            val cookieBundles = mutableListOf<Chat2ApiCookieBundle>()
            val bundles = json.optJSONArray("cookieBundles") ?: JSONArray()
            for (index in 0 until bundles.length()) {
                val item = bundles.optJSONObject(index) ?: continue
                val field = item.optString("field").trim()
                val names = item.optJSONArray("names").toStringList().distinct()
                val requiredNames = item.optJSONArray("requiredNames").toStringList().distinct()
                val requiredAnyNames = item.optJSONArray("requiredAnyNames").toStringList().distinct()
                if (field.isEmpty() || names.isEmpty() || names.size > 32) continue
                if ((requiredNames + requiredAnyNames).any { it !in names }) continue
                cookieBundles.add(Chat2ApiCookieBundle(field, names, requiredNames, requiredAnyNames))
            }
            return Chat2ApiCaptureProfile(
                allowedOrigins = json.optJSONArray("allowedOrigins").toStringList(),
                authorizationField = authorization?.optString("field")?.trim()?.takeIf { it.isNotEmpty() },
                cookieFields = cookieFields,
                localStorageFields = localStorageFields,
                requiredFields = requiredFields,
                cookieBundles = cookieBundles,
                captureDoubaoNodeProfile = json.optString("nodeProfile") == "doubao"
            )
        }

        private fun JSONArray?.toStringList(): List<String> {
            if (this == null) return emptyList()
            return (0 until length()).mapNotNull { optString(it).trim().takeIf(String::isNotEmpty) }
        }
    }
}

object Chat2ApiCredentialCapture {

    fun isAllowed(profile: Chat2ApiCaptureProfile, url: String): Boolean {
        val targetOrigin = normalizeOrigin(url) ?: return false
        return profile.allowedOrigins.any { normalizeOrigin(it) == targetOrigin }
    }

    fun extractAuthorization(headers: Map<String, String>?, profile: Chat2ApiCaptureProfile): String? {
        val field = profile.authorizationField ?: return null
        val header = headers?.entries?.firstOrNull { it.key.equals("Authorization", ignoreCase = true) }?.value ?: return null
        val value = header.trim()
        val token = Regex("^Bearer\\s+(.+)$", RegexOption.IGNORE_CASE).matchEntire(value)?.groupValues?.get(1)?.trim()
        return token?.takeIf { it.isNotEmpty() }?.let { "${field}=$it" }
    }

    fun extractCookies(rawCookie: String?, profile: Chat2ApiCaptureProfile): Map<String, String> {
        if (rawCookie.isNullOrBlank()) return emptyMap()
        val parsed = rawCookie.split(';').mapNotNull { part ->
            val separator = part.indexOf('=')
            if (separator <= 0) return@mapNotNull null
            val name = part.substring(0, separator).trim()
            val value = part.substring(separator + 1).trim()
            if (name.isEmpty() || value.isEmpty()) null else name to value
        }
        val cookies = parsed.toMap()
        val credentials = linkedMapOf<String, String>()
        cookies.forEach { (name, value) ->
            profile.cookieFields[name]?.let { credentials[it] = value }
        }
        // 单字段映射沿用既有行为；Cookie集合必须满足声明的完整条件，才允许触发完成回调。
        profile.cookieBundles.forEach { bundle ->
            if (bundle.requiredNames.any { it !in cookies }) return@forEach
            if (bundle.requiredAnyNames.isNotEmpty() && bundle.requiredAnyNames.none { it in cookies }) return@forEach
            val selected = bundle.names.mapNotNull { name -> cookies[name]?.let { name to it } }
            if (selected.any { (name, value) ->
                    parsed.count { it.first == name } != 1 || value.length > 4096 ||
                        !Regex("^[\\x21\\x23-\\x2B\\x2D-\\x3A\\x3C-\\x5B\\x5D-\\x7E]+$").matches(value)
                }) return@forEach
            val packed = selected.joinToString("; ") { (name, value) -> "$name=$value" }
            if (packed.isNotEmpty() && packed.length <= 16 * 1024) credentials[bundle.field] = packed
        }
        return credentials
    }

    fun merge(
        profile: Chat2ApiCaptureProfile,
        url: String,
        authorization: String? = null,
        cookies: String? = null,
        localStorage: Map<String, String> = emptyMap(),
        userAgent: String? = null
    ): Map<String, String> {
        if (!isAllowed(profile, url)) return emptyMap()
        val merged = linkedMapOf<String, String>()
        parseAuthorizationValue(authorization, profile)?.let { (field, value) -> merged[field] = value }
        merged.putAll(extractCookies(cookies, profile))
        for ((key, field) in profile.localStorageFields) {
            val value = localStorage[key]?.trim()
            if (!value.isNullOrEmpty()) merged[field] = value
        }
        if (profile.captureDoubaoNodeProfile && normalizeOrigin(url) == "https://www.doubao.com") {
            Chat2ApiDoubaoNodeCapture.build(merged["cookie"], localStorage, userAgent)?.let { merged["nodeProfile"] = it }
        }
        return merged
    }

    fun hasRequiredFields(profile: Chat2ApiCaptureProfile, credentials: Map<String, String>): Boolean {
        return profile.requiredFields.all { field -> credentials[field]?.isNotBlank() == true }
    }

    /** 内部字符串快照便于串行捕获；回传服务端时profile必须是嵌套对象，不能作为JSON字符串保存。 */
    fun credentialsJson(credentials: Map<String, String>): JSONObject {
        val result = JSONObject(credentials)
        credentials["nodeProfile"]?.let { result.put("nodeProfile", JSONObject(it)) }
        return result
    }

    private fun parseAuthorizationValue(value: String?, profile: Chat2ApiCaptureProfile): Pair<String, String>? {
        if (value.isNullOrBlank()) return null
        val field = profile.authorizationField ?: return null
        val token = Regex("^Bearer\\s+(.+)$", RegexOption.IGNORE_CASE).matchEntire(value.trim())?.groupValues?.get(1)?.trim()
        return token?.takeIf { it.isNotEmpty() }?.let { field to it }
    }

    // 对应.src/framework/qwen-chat-restore-and-model.md，匹配与展示共用规范化来源，不显示URL中的凭证。
    fun normalizeOrigin(value: String): String? {
        return try {
            val uri = URI(value.trim())
            val scheme = uri.scheme?.lowercase(Locale.US) ?: return null
            val host = uri.host?.lowercase(Locale.US) ?: return null
            if (scheme !in listOf("http", "https") || uri.rawUserInfo != null) return null
            if (uri.port != -1 && uri.port !in 1..65535) return null
            val defaultPort = if (scheme == "https") 443 else 80
            val port = if (uri.port == -1 || uri.port == defaultPort) "" else ":${uri.port}"
            "$scheme://$host$port"
        } catch (_: Exception) {
            null
        }
    }
}
