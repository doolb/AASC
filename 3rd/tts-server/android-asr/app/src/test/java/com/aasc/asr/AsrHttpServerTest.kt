package com.aasc.asr

import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AsrHttpServerTest {
    @Test
    fun rootEndpointServesBrowserPage() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val voiceprintCoordinator = VoiceprintTestCoordinator(engine, SherpaVoiceprintEngine())
        val streamingEngine = StreamingAsrEngine()
        val server = AsrHttpServer(engine, coordinator, voiceprintCoordinator, streamingEngine, null) { CpuMode.AUTO }
        try {
            val port = server.start(0).getOrThrow()
            val connection = URL("http://127.0.0.1:$port/").openConnection() as HttpURLConnection
            connection.connectTimeout = 2000
            connection.readTimeout = 2000
            assertEquals(200, connection.responseCode)
            assertEquals("text/html", connection.contentType.substringBefore(';'))
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            assertTrue(body.contains("离线语音识别"))
            assertTrue(body.contains("/api/asr"))
            assertTrue(body.contains("SHERPA_SINGLE"))
            assertTrue(body.contains("SHERPA_MULTI"))
            assertTrue(body.contains("SHERPA_MULTI_FAST"))
            assertTrue(body.contains("speakerCount"))
            assertTrue(body.contains("denoise"))
            assertTrue(body.contains("currentAudio"))
            assertFalse(body.contains("id=\"languageMode\""))
            assertTrue(body.contains("language: 'zh'"))
        } finally {
            server.stop()
            coordinator.shutdown()
            voiceprintCoordinator.shutdown()
            streamingEngine.release()
        }
    }

    @Test
    fun healthEndpointReportsModelAndServiceState() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val voiceprintCoordinator = VoiceprintTestCoordinator(engine, SherpaVoiceprintEngine())
        val streamingEngine = StreamingAsrEngine()
        val server = AsrHttpServer(engine, coordinator, voiceprintCoordinator, streamingEngine, null) { CpuMode.AUTO }
        try {
            val port = server.start(0).getOrThrow()
            val connection = URL("http://127.0.0.1:$port/health").openConnection() as HttpURLConnection
            connection.connectTimeout = 2000
            connection.readTimeout = 2000
            assertEquals(200, connection.responseCode)
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            assertTrue(body.contains("\"modelReady\":false"))
            assertTrue(body.contains("\"httpRunning\":true"))
        } finally {
            server.stop()
            coordinator.shutdown()
            voiceprintCoordinator.shutdown()
            streamingEngine.release()
        }
    }

    @Test
    fun voiceprintStatusEndpointListsSherpaModesOnly() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val voiceprintCoordinator = VoiceprintTestCoordinator(engine, SherpaVoiceprintEngine())
        val streamingEngine = StreamingAsrEngine()
        val server = AsrHttpServer(engine, coordinator, voiceprintCoordinator, streamingEngine, null) { CpuMode.AUTO }
        try {
            val port = server.start(0).getOrThrow()
            val connection = URL("http://127.0.0.1:$port/api/voiceprint/status").openConnection() as HttpURLConnection
            assertEquals(200, connection.responseCode)
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            assertTrue(body.contains("SHERPA_SINGLE"))
            assertTrue(body.contains("SHERPA_MULTI"))
            assertTrue(body.contains("SHERPA_MULTI_FAST"))
        } finally {
            server.stop()
            coordinator.shutdown()
            voiceprintCoordinator.shutdown()
            streamingEngine.release()
        }
    }

    @Test
    fun invalidFastSpeakerCountReturnsBadRequestBeforeModelInference() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val voiceprintCoordinator = VoiceprintTestCoordinator(engine, SherpaVoiceprintEngine())
        val streamingEngine = StreamingAsrEngine()
        val server = AsrHttpServer(engine, coordinator, voiceprintCoordinator, streamingEngine, null) { CpuMode.AUTO }
        try {
            val port = server.start(0).getOrThrow()
            val connection = URL("http://127.0.0.1:$port/api/voiceprint/test?mode=SHERPA_MULTI_FAST&speakerCount=6")
                .openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "audio/wav")
            connection.outputStream.use { it.write(byteArrayOf()) }
            assertEquals(400, connection.responseCode)
        } finally {
            server.stop()
            coordinator.shutdown()
            voiceprintCoordinator.shutdown()
            streamingEngine.release()
        }
    }
}
