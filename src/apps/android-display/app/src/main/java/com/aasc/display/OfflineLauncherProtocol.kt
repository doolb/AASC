package com.aasc.display

import org.json.JSONObject

/** 页面只调用固定业务命令；协议约束可脱离WebView单独验证。 */
internal object OfflineLauncherProtocol {
    val commands = setOf("state.get", "bootstrap.preview", "bootstrap.install", "bootstrap.cancel",
        "service.check", "service.apply", "service.restart", "apk.check", "models.catalog", "models.status",
        "models.prepareGroup", "models.cancel", "ui.firstRunShown", "native.ensureService", "native.openDisplay", "native.installApk")
    fun parse(raw: String): JSONObject {
        require(raw.toByteArray(Charsets.UTF_8).size <= 2 * 1024 * 1024) { "页面消息超限" }
        val request = JSONObject(raw)
        require(Regex("^ui-[A-Za-z0-9-]{1,96}$").matches(request.optString("requestId"))) { "页面请求ID无效" }
        require(request.optString("type") in commands) { "不支持的启动器操作" }
        require(!request.has("payload") || request.optJSONObject("payload") != null) { "页面请求参数无效" }
        return request
    }
}
