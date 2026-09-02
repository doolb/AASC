package com.aasc.rapidocr

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OcrHttpServerTest {
    @Test
    fun rootEndpointServesSelfContainedUploadPage() {
        val server = OcrHttpServer(RapidOcrEngine())
        try {
            val response = request(server, "GET", "/")

            assertEquals(200, response.code)
            assertTrue(response.body.contains("RapidOCR"))
            assertTrue(response.body.contains("type=\"file\""))
            assertTrue(response.body.contains("/api/ocr"))
            assertTrue(response.body.contains("/health"))
            assertTrue(response.body.contains("ArrayBuffer"))
            assertTrue(response.body.contains("canvas"))
            assertTrue(response.body.contains("elapsedMs"))
            assertTrue(response.body.contains("score"))
            assertTrue(response.body.contains("imageWidth"))
            assertTrue(response.body.contains("affinityStatus"))
            assertTrue(response.body.contains("resultText"))
            assertTrue(response.body.contains("boxesOverlay"))
            assertTrue(response.body.contains("image/jpeg"))
            assertTrue(response.body.contains("image/png"))
            assertTrue(response.body.contains("image/webp"))
            assertFalse(response.body.contains("https://"))
            assertFalse(response.body.contains("http://"))
        } finally {
            server.stop()
        }
    }

    @Test
    fun healthEndpointReportsUnloadedModelAndRunningHttp() {
        val server = OcrHttpServer(RapidOcrEngine())
        try {
            val response = request(server, "GET", "/health")

            assertEquals(200, response.code)
            assertTrue(response.body.contains("\"modelReady\":false"))
            assertTrue(response.body.contains("\"httpRunning\":true"))
        } finally {
            server.stop()
        }
    }

    @Test
    fun unsupportedContentTypeReturns415() {
        val server = OcrHttpServer(RapidOcrEngine())
        try {
            val response = request(server, "POST", "/api/ocr", "audio/wav", byteArrayOf(1, 2, 3))

            assertEquals(415, response.code)
            assertTrue(response.body.contains("Content-Type"))
        } finally {
            server.stop()
        }
    }

    @Test
    fun unsupportedMethodReturns405() {
        val server = OcrHttpServer(RapidOcrEngine())
        try {
            val response = request(server, "PUT", "/health")

            assertEquals(405, response.code)
        } finally {
            server.stop()
        }
    }

    @Test
    fun stoppingServerClosesListeningSocket() {
        val server = OcrHttpServer(RapidOcrEngine())
        val port = server.start(0).getOrThrow()
        server.stop()

        assertFalse(server.isRunning())
        try {
            URL("http://127.0.0.1:$port/health").openConnection().connect()
            throw AssertionError("停止服务后不应继续接受连接")
        } catch (_: IOException) {
            // 端口关闭后的连接失败是本测试的预期结果。
        }
    }

    private fun request(
        server: OcrHttpServer,
        method: String,
        path: String,
        contentType: String? = null,
        body: ByteArray = byteArrayOf()
    ): HttpResponse {
        val port = server.start(0).getOrThrow()
        val connection = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 2000
        connection.readTimeout = 2000
        if (contentType != null) connection.setRequestProperty("Content-Type", contentType)
        if (method == "POST" || method == "PUT") {
            connection.doOutput = true
            connection.outputStream.use { it.write(body) }
        }
        val stream = if (connection.responseCode >= 400) connection.errorStream else connection.inputStream
        val responseBody = stream?.bufferedReader()?.use { it.readText() } ?: ""
        return HttpResponse(connection.responseCode, responseBody)
    }

    private data class HttpResponse(val code: Int, val body: String)
}
