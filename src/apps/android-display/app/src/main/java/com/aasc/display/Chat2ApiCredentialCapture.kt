package com.aasc.display

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.Locale

/**
 * 服务端下发的 Android 登录捕获配置，只描述字段映射，不包含可执行脚本。
 * 该数据类和解析器保持纯逻辑，便于在 Android JVM 单测中验证凭据边界。
 */
data class Chat2ApiCaptureProfile(
    val allowedOrigins: List<String>,
    val authorizationField: String? = null,
    val cookieFields: Map<String, String> = emptyMap(),
    val localStorageFields: Map<String, String> = emptyMap(),
    val requiredFields: List<String> = emptyList()
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
            return Chat2ApiCaptureProfile(
                allowedOrigins = json.optJSONArray("allowedOrigins").toStringList(),
                authorizationField = authorization?.optString("field")?.trim()?.takeIf { it.isNotEmpty() },
                cookieFields = cookieFields,
                localStorageFields = localStorageFields,
                requiredFields = requiredFields
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
        val cookies = rawCookie.split(';').mapNotNull { part ->
            val separator = part.indexOf('=')
            if (separator <= 0) return@mapNotNull null
            val name = part.substring(0, separator).trim()
            val value = part.substring(separator + 1).trim()
            val field = profile.cookieFields[name]
            if (field.isNullOrEmpty() || value.isEmpty()) null else field to value
        }
        return cookies.toMap()
    }

    fun merge(
        profile: Chat2ApiCaptureProfile,
        url: String,
        authorization: String? = null,
        cookies: String? = null,
        localStorage: Map<String, String> = emptyMap()
    ): Map<String, String> {
        if (!isAllowed(profile, url)) return emptyMap()
        val merged = linkedMapOf<String, String>()
        parseAuthorizationValue(authorization, profile)?.let { (field, value) -> merged[field] = value }
        merged.putAll(extractCookies(cookies, profile))
        for ((key, field) in profile.localStorageFields) {
            val value = localStorage[key]?.trim()
            if (!value.isNullOrEmpty()) merged[field] = value
        }
        return merged
    }

    fun hasRequiredFields(profile: Chat2ApiCaptureProfile, credentials: Map<String, String>): Boolean {
        return profile.requiredFields.all { field -> credentials[field]?.isNotBlank() == true }
    }

    private fun parseAuthorizationValue(value: String?, profile: Chat2ApiCaptureProfile): Pair<String, String>? {
        if (value.isNullOrBlank()) return null
        val field = profile.authorizationField ?: return null
        val token = Regex("^Bearer\\s+(.+)$", RegexOption.IGNORE_CASE).matchEntire(value.trim())?.groupValues?.get(1)?.trim()
        return token?.takeIf { it.isNotEmpty() }?.let { field to it }
    }

    private fun normalizeOrigin(value: String): String? {
        return try {
            val uri = URI(value.trim())
            val scheme = uri.scheme?.lowercase(Locale.US) ?: return null
            val host = uri.host?.lowercase(Locale.US) ?: return null
            if (scheme !in listOf("http", "https")) return null
            val port = if (uri.port > 0) ":${uri.port}" else ""
            "$scheme://$host$port"
        } catch (_: Exception) {
            null
        }
    }
}
