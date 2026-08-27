package com.aasc.asr

import java.io.ByteArrayInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StreamingAsrProtocolTest {
    @Test
    fun parsesEndCommandOnly() {
        assertEquals(StreamingCommand.END, StreamingCommand.parse("{\"type\":\"end\"}"))
        assertEquals(StreamingCommand.END, StreamingCommand.parse("{ \"type\" : \"end\" }"))
        assertNull(StreamingCommand.parse("{\"type\":\"unknown\"}"))
        assertNull(StreamingCommand.parse(""))
    }

    @Test
    fun decodesMaskedBinaryFrame() {
        val payload = byteArrayOf(1, 2, 3, 4)
        val frame = WebSocketFrameCodec.read(ByteArrayInputStream(maskedFrame(2, payload)))

        assertEquals(WebSocketOpcode.BINARY, frame?.opcode)
        assertArrayEquals(payload, frame?.payload)
    }

    @Test
    fun encodesUnmaskedTextFrame() {
        val frame = WebSocketFrameCodec.encodeText("你好")

        assertEquals(1, frame[0].toInt() and 0x0F)
        assertEquals(0, frame[1].toInt() and 0x80)
        assertArrayEquals("你好".toByteArray(Charsets.UTF_8), frame.copyOfRange(2, frame.size))
    }

    @Test
    fun computesRfc6455AcceptKey() {
        assertEquals(
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
            WebSocketHandshake.acceptKey("dGhlIHNhbXBsZSBub25jZQ==")
        )
    }

    private fun maskedFrame(opcode: Int, payload: ByteArray): ByteArray {
        val mask = byteArrayOf(9, 8, 7, 6)
        val masked = payload.mapIndexed { index, value -> (value.toInt() xor mask[index % 4].toInt()).toByte() }
        return byteArrayOf((0x80 or opcode).toByte(), (0x80 or payload.size).toByte()) + mask + masked.toByteArray()
    }
}
