package com.aasc.display

import java.net.URI

// 解析显示页面 URL 的服务器 origin，避免在 JavaBridge 线程访问 WebView 对象。
object ServerOrigin {

    fun fromUrl(rawUrl: String?): String {
        return try {
            val uri = URI(rawUrl ?: return "")
            val scheme = uri.scheme ?: return ""
            if (scheme != "http" && scheme != "https") return ""
            val host = uri.host ?: return ""
            val port = if (uri.port >= 0) ":${uri.port}" else ""
            "$scheme://$host$port"
        } catch (_: Exception) {
            ""
        }
    }
}
