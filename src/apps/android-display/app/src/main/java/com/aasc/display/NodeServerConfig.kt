package com.aasc.display

import java.io.File
import java.net.URI
import java.util.UUID
import org.json.JSONObject

object NodeServerConfig {

    private const val CONFIG_RELATIVE_PATH = "config/config.json"
    private const val SERVER_PORT = 8081

    fun write(
        rootDir: File,
        mainServerUrl: String,
        nodeName: String,
        nodeId: String? = null,
        offlineMode: Boolean = false
    ): File {
        val normalizedUrl = normalizeMainServerUrl(mainServerUrl)
        val configFile = File(rootDir, CONFIG_RELATIVE_PATH)
        configFile.parentFile?.mkdirs()
        val config = readConfig(configFile)
        val stableNodeId = nodeId?.trim()?.takeIf { it.isNotEmpty() } ?: readOrCreateNodeId(rootDir, config)

        val server = config.optJSONObject("server") ?: JSONObject()
        // 普通 APK 的监听端口由远端配置持久化，冷启动不能覆盖用户已保存的值。
        // Offline 首装页面仍使用固定的回环 8081 地址，保持既有启动约定。
        server.put("port", if (offlineMode) SERVER_PORT else normalizeServerPort(server.opt("port")))
        config.put("server", server)

        val aasc = config.optJSONObject("aasc") ?: JSONObject()
        aasc.put("role", if (offlineMode) "main" else "subserver")
        aasc.put("mainServerUrl", normalizedUrl)
        aasc.put("nodeId", stableNodeId)
        aasc.put("nodeName", nodeName.trim().ifEmpty {
            if (offlineMode) "AASC 显示端 Offline" else "APK 子服务器"
        })
        aasc.put("advertisedUrl", aasc.optString("advertisedUrl", ""))
        config.put("aasc", aasc)

        val asr = config.optJSONObject("asr") ?: JSONObject()
        asr.put("serverEnabled", false)
        if (offlineMode) {
            asr.put("device", "display")
        }
        val isolateProcess = asr.optJSONObject("isolateProcess") ?: JSONObject()
        isolateProcess.put("enabled", false)
        asr.put("isolateProcess", isolateProcess)
        config.put("asr", asr)

        val tts = config.optJSONObject("tts") ?: JSONObject()
        tts.put("serverEnabled", false)
        tts.put("device", "display")
        config.put("tts", tts)

        val temporaryFile = File(configFile.parentFile, ".config.json.${System.currentTimeMillis()}.tmp")
        temporaryFile.writeText(config.toString(2) + "\n")
        if (!temporaryFile.renameTo(configFile)) {
            temporaryFile.delete()
            throw IllegalStateException("替换 APK 子服务器配置失败")
        }
        return configFile
    }

    /** 健康探测读取同一份监听配置，避免误连共存的另一个 APK。损坏 JSON 继续报错。 */
    fun readServerPort(rootDir: File): Int =
        normalizeServerPort(readConfig(File(rootDir, CONFIG_RELATIVE_PATH)).optJSONObject("server")?.opt("port"))

    private fun normalizeServerPort(value: Any?): Int {
        val number = value as? Number ?: return SERVER_PORT
        val port = number.toInt()
        return port.takeIf { it in 1..65535 && number.toDouble() == it.toDouble() } ?: SERVER_PORT
    }

    fun readOrCreateNodeId(rootDir: File): String {
        val configFile = File(rootDir, CONFIG_RELATIVE_PATH)
        return readOrCreateNodeId(rootDir, readConfig(configFile))
    }

    private fun readOrCreateNodeId(rootDir: File, config: JSONObject): String {
        val configured = config.optJSONObject("aasc")?.optString("nodeId")?.trim().orEmpty()
        if (configured.isNotEmpty()) return configured
        val generated = "apk-subserver-${UUID.randomUUID().toString().replace("-", "").take(16)}"
        val marker = File(rootDir, ".node-id")
        marker.parentFile?.mkdirs()
        if (marker.isFile) {
            val existing = marker.readText().trim()
            if (existing.isNotEmpty()) return existing
        }
        marker.writeText(generated + "\n")
        return generated
    }

    private fun readConfig(configFile: File): JSONObject {
        if (!configFile.isFile) return JSONObject()
        return try {
            JSONObject(configFile.readText())
        } catch (error: Exception) {
            throw IllegalStateException("读取 APK 子服务器配置失败: ${error.message}", error)
        }
    }

    private fun normalizeMainServerUrl(rawUrl: String): String {
        val value = rawUrl.trim().trimEnd('/')
        require(value.isNotEmpty()) { "主服务器地址不能为空" }
        val uri = URI(value)
        require(uri.scheme == "http" || uri.scheme == "https") { "主服务器地址必须使用 http 或 https" }
        require(!uri.host.isNullOrBlank()) { "主服务器地址缺少主机" }
        return value
    }
}
