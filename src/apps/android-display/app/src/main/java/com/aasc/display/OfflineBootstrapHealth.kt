package com.aasc.display

import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Base64
import javax.net.ssl.HttpsURLConnection

/** 首装页面与 WebSocket 检查只访问本机，并复用已通过 API 检查的 TLS 信任配置。 */
internal object OfflineBootstrapHealth {
    private const val WEBSOCKET_KEY = "dGhlIHNhbXBsZSBub25jZQ=="
    private const val WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    fun check(port: Int, trustedConnection: HttpsURLConnection): Boolean = runCatching {
        for (path in listOf("/control", "/display")) {
            val connection = URL("https://127.0.0.1:$port$path").openConnection() as HttpsURLConnection
            try {
                connection.sslSocketFactory = trustedConnection.sslSocketFactory
                connection.hostnameVerifier = trustedConnection.hostnameVerifier
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 500
                connection.readTimeout = 1000
                if (connection.responseCode != HttpURLConnection.HTTP_OK
                    || !connection.contentType.orEmpty().contains("text/html")) return false
            } finally { connection.disconnect() }
        }
        trustedConnection.sslSocketFactory.createSocket("127.0.0.1", port).use { socket ->
            socket.soTimeout = 1000
            // 使用未注册业务角色的路径，避免健康探测制造临时显示端或触发任务绑定。
            socket.getOutputStream().write(("GET /__aasc_bootstrap_health HTTP/1.1\r\nHost: 127.0.0.1:$port\r\n" +
                "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: $WEBSOCKET_KEY\r\n" +
                "Sec-WebSocket-Version: 13\r\n\r\n").toByteArray(Charsets.US_ASCII))
            val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.US_ASCII))
            val status = reader.readLine().orEmpty()
            val headers = mutableMapOf<String, String>()
            var bytes = status.length
            while (true) {
                val line = reader.readLine() ?: return false
                bytes += line.length
                require(bytes <= 8192) { "本机 WebSocket 响应头超过限制" }
                if (line.isEmpty()) break
                val colon = line.indexOf(':')
                if (colon > 0) headers[line.substring(0, colon).lowercase()] = line.substring(colon + 1).trim()
            }
            validUpgrade(status, headers)
        }
    }.getOrDefault(false)

    internal fun validUpgrade(status: String, headers: Map<String, String>): Boolean {
        val expected = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1")
            .digest((WEBSOCKET_KEY + WEBSOCKET_GUID).toByteArray(Charsets.US_ASCII)))
        return status.split(' ').getOrNull(1) == "101" && headers["upgrade"].equals("websocket", true)
            && headers["connection"].orEmpty().split(',').any { it.trim().equals("upgrade", true) }
            && headers["sec-websocket-accept"] == expected
    }
}
