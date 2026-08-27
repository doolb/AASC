package com.aasc.asr

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64

// 计算 RFC 6455 服务端握手响应中的 Sec-WebSocket-Accept。
object WebSocketHandshake {
    private const val GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    fun acceptKey(clientKey: String): String {
        val digest = MessageDigest.getInstance("SHA-1")
            .digest((clientKey.trim() + GUID).toByteArray(StandardCharsets.US_ASCII))
        return Base64.getEncoder().encodeToString(digest)
    }
}
