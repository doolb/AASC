package com.aasc.asr

import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.InputStream

enum class WebSocketOpcode(val value: Int) {
    CONTINUATION(0),
    TEXT(1),
    BINARY(2),
    CLOSE(8),
    PING(9),
    PONG(10);

    companion object {
        fun from(value: Int): WebSocketOpcode? = values().firstOrNull { it.value == value }
    }
}

data class WebSocketFrame(val fin: Boolean, val opcode: WebSocketOpcode, val payload: ByteArray)

// 最小 WebSocket RFC 6455 帧编解码器：服务端只发送未掩码帧，客户端帧必须支持掩码。
object WebSocketFrameCodec {
    private const val MAX_PAYLOAD_BYTES = 2 * 1024 * 1024

    fun read(input: InputStream): WebSocketFrame? {
        val first = input.read()
        if (first < 0) return null
        val second = readRequired(input)
        val opcode = WebSocketOpcode.from(first and 0x0F) ?: throw IllegalArgumentException("WebSocket opcode 无效")
        val lengthCode = second and 0x7F
        val length = when (lengthCode) {
            126 -> readUnsignedShort(input)
            127 -> readLongLength(input)
            else -> lengthCode.toLong()
        }
        require(length <= MAX_PAYLOAD_BYTES) { "WebSocket 帧过大" }
        val masked = second and 0x80 != 0
        val mask = if (masked) ByteArray(4).also { readFully(input, it) } else null
        val payload = ByteArray(length.toInt())
        readFully(input, payload)
        if (mask != null) payload.indices.forEach { index -> payload[index] = (payload[index].toInt() xor mask[index % 4].toInt()).toByte() }
        return WebSocketFrame(first and 0x80 != 0, opcode, payload)
    }

    fun encodeText(text: String): ByteArray = encode(WebSocketOpcode.TEXT, text.toByteArray(Charsets.UTF_8))

    fun encodeClose(): ByteArray = encode(WebSocketOpcode.CLOSE, ByteArray(0))

    fun encodePong(payload: ByteArray): ByteArray = encode(WebSocketOpcode.PONG, payload)

    private fun encode(opcode: WebSocketOpcode, payload: ByteArray): ByteArray {
        require(payload.size <= MAX_PAYLOAD_BYTES) { "WebSocket 帧过大" }
        val output = ByteArrayOutputStream(payload.size + 10)
        output.write(0x80 or opcode.value)
        when {
            payload.size < 126 -> output.write(payload.size)
            payload.size <= 0xFFFF -> {
                output.write(126)
                output.write((payload.size ushr 8) and 0xFF)
                output.write(payload.size and 0xFF)
            }
            else -> {
                output.write(127)
                repeat(8) { shift -> output.write((payload.size.toLong() ushr (56 - shift * 8)).toInt() and 0xFF) }
            }
        }
        output.write(payload)
        return output.toByteArray()
    }

    private fun readRequired(input: InputStream): Int = input.read().takeIf { it >= 0 } ?: throw EOFException("WebSocket 帧不完整")

    private fun readUnsignedShort(input: InputStream): Long = (readRequired(input).toLong() shl 8) or readRequired(input).toLong()

    private fun readLongLength(input: InputStream): Long {
        var result = 0L
        repeat(8) { result = (result shl 8) or readRequired(input).toLong() }
        require(result >= 0) { "WebSocket 帧长度无效" }
        return result
    }

    private fun readFully(input: InputStream, target: ByteArray) {
        var offset = 0
        while (offset < target.size) {
            val count = input.read(target, offset, target.size - offset)
            if (count < 0) throw EOFException("WebSocket 帧不完整")
            offset += count
        }
    }
}
