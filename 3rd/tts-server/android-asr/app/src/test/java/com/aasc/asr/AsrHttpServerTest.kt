package com.aasc.asr

import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AsrHttpServerTest {
    @Test
    fun refusesToStartWithoutTlsByDefault() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val voiceprintCoordinator = VoiceprintTestCoordinator(engine, SherpaVoiceprintEngine())
        val streamingEngine = StreamingAsrEngine()
        val server = AsrHttpServer(
            engine,
            coordinator,
            voiceprintCoordinator,
            streamingEngine,
            tlsContext = null,
            cpuModeProvider = { CpuMode.AUTO }
        )
        try {
            val result = server.start(0)
            assertFalse(result.isSuccess)
            assertTrue(result.exceptionOrNull()?.message?.contains("HTTPS") == true)
        } finally {
            server.stop()
            coordinator.shutdown()
            voiceprintCoordinator.shutdown()
            streamingEngine.release()
        }
    }

    @Test
    fun rootEndpointServesBrowserPage() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val voiceprintCoordinator = VoiceprintTestCoordinator(engine, SherpaVoiceprintEngine())
        val streamingEngine = StreamingAsrEngine()
        val server = AsrHttpServer(
            engine,
            coordinator,
            voiceprintCoordinator,
            streamingEngine,
            tlsContext = null,
            allowInsecureHttp = true,
            cpuModeProvider = { CpuMode.AUTO }
        )
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
            assertTrue(body.contains("voiceprintModel"))
            assertTrue(body.contains("eres2net-base"))
            assertTrue(body.contains("speakerCount"))
            assertTrue(body.contains("mode === 'SHERPA_MULTI' || mode === 'SHERPA_MULTI_FAST'"))
            assertTrue(body.contains("asrDenoise"))
            assertTrue(body.contains("voiceprintDenoise"))
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
        val server = AsrHttpServer(
            engine,
            coordinator,
            voiceprintCoordinator,
            streamingEngine,
            tlsContext = null,
            allowInsecureHttp = true,
            cpuModeProvider = { CpuMode.AUTO }
        )
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
        val server = AsrHttpServer(
            engine,
            coordinator,
            voiceprintCoordinator,
            streamingEngine,
            tlsContext = null,
            allowInsecureHttp = true,
            cpuModeProvider = { CpuMode.AUTO }
        )
        try {
            val port = server.start(0).getOrThrow()
            val connection = URL("http://127.0.0.1:$port/api/voiceprint/status").openConnection() as HttpURLConnection
            assertEquals(200, connection.responseCode)
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            assertTrue(body.contains("SHERPA_SINGLE"))
            assertTrue(body.contains("SHERPA_MULTI"))
            assertTrue(body.contains("SHERPA_MULTI_FAST"))
            assertTrue(body.contains("\"modelId\":\"eres2net-base\""))
            assertTrue(body.contains("\"id\":\"eres2net-base\""))
            assertFalse(body.contains("eres2net-large"))
            assertFalse(body.contains("eres2netv2"))
            assertTrue(body.contains("\"threshold\":0.5"))
        } finally {
            server.stop()
            coordinator.shutdown()
            voiceprintCoordinator.shutdown()
            streamingEngine.release()
        }
    }

    @Test
    fun voiceprintModelEndpointLoadsBaseFp32ByDefault() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val voiceprintCoordinator = VoiceprintTestCoordinator(engine, SherpaVoiceprintEngine())
        val streamingEngine = StreamingAsrEngine()
        var loadedVariant: VoiceprintModelVariant? = null
        val server = AsrHttpServer(
            engine,
            coordinator,
            voiceprintCoordinator,
            streamingEngine,
            null,
            allowInsecureHttp = true,
            voiceprintModelLoader = { variant -> loadedVariant = variant; true },
            cpuModeProvider = { CpuMode.AUTO }
        )
        try {
            val port = server.start(0).getOrThrow()
            val connection = URL("http://127.0.0.1:$port/api/voiceprint/model?model=eres2net-base")
                .openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.outputStream.use { }
            assertEquals(200, connection.responseCode)
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            assertEquals(VoiceprintModel.ERES2NET_BASE.variant(VoiceprintPrecision.FP32), loadedVariant)
            assertTrue(body.contains("\"success\":true"))
            assertTrue(body.contains("\"modelId\":\"eres2net-base\""))
        } finally {
            server.stop()
            coordinator.shutdown()
            voiceprintCoordinator.shutdown()
            streamingEngine.release()
        }
    }

    @Test
    fun voiceprintModelEndpointRejectsRemovedInt8Variant() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val voiceprintCoordinator = VoiceprintTestCoordinator(engine, SherpaVoiceprintEngine())
        val streamingEngine = StreamingAsrEngine()
        var loadedVariant: VoiceprintModelVariant? = null
        val server = AsrHttpServer(
            engine,
            coordinator,
            voiceprintCoordinator,
            streamingEngine,
            null,
            allowInsecureHttp = true,
            voiceprintModelLoader = { variant -> loadedVariant = variant; true },
            cpuModeProvider = { CpuMode.AUTO }
        )
        try {
            val port = server.start(0).getOrThrow()
            val connection = URL("http://127.0.0.1:$port/api/voiceprint/model?model=eres2net-base&precision=int8")
                .openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.outputStream.use { }
            assertEquals(400, connection.responseCode)
            assertEquals(null, loadedVariant)
        } finally {
            server.stop()
            coordinator.shutdown()
            voiceprintCoordinator.shutdown()
            streamingEngine.release()
        }
    }

    @Test
    fun invalidVoiceprintModelReturnsBadRequest() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val voiceprintCoordinator = VoiceprintTestCoordinator(engine, SherpaVoiceprintEngine())
        val streamingEngine = StreamingAsrEngine()
        val server = AsrHttpServer(
            engine,
            coordinator,
            voiceprintCoordinator,
            streamingEngine,
            null,
            allowInsecureHttp = true,
            voiceprintModelLoader = { true },
            cpuModeProvider = { CpuMode.AUTO }
        )
        try {
            val port = server.start(0).getOrThrow()
            val connection = URL("http://127.0.0.1:$port/api/voiceprint/model?model=unknown")
                .openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.outputStream.use { }
            assertEquals(400, connection.responseCode)
        } finally {
            server.stop()
            coordinator.shutdown()
            voiceprintCoordinator.shutdown()
            streamingEngine.release()
        }
    }

    @Test
    fun removedVoiceprintModelReturnsBadRequest() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val voiceprintCoordinator = VoiceprintTestCoordinator(engine, SherpaVoiceprintEngine())
        val streamingEngine = StreamingAsrEngine()
        val server = AsrHttpServer(
            engine,
            coordinator,
            voiceprintCoordinator,
            streamingEngine,
            null,
            allowInsecureHttp = true,
            voiceprintModelLoader = { true },
            cpuModeProvider = { CpuMode.AUTO }
        )
        try {
            val port = server.start(0).getOrThrow()
            val connection = URL("http://127.0.0.1:$port/api/voiceprint/model?model=eres2net-large")
                .openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.outputStream.use { }
            assertEquals(400, connection.responseCode)
        } finally {
            server.stop()
            coordinator.shutdown()
            voiceprintCoordinator.shutdown()
            streamingEngine.release()
        }
    }

    @Test
    fun invalidVoiceprintPrecisionReturnsBadRequest() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val voiceprintCoordinator = VoiceprintTestCoordinator(engine, SherpaVoiceprintEngine())
        val streamingEngine = StreamingAsrEngine()
        val server = AsrHttpServer(
            engine,
            coordinator,
            voiceprintCoordinator,
            streamingEngine,
            null,
            allowInsecureHttp = true,
            voiceprintModelLoader = { true },
            cpuModeProvider = { CpuMode.AUTO }
        )
        try {
            val port = server.start(0).getOrThrow()
            val connection = URL("http://127.0.0.1:$port/api/voiceprint/model?model=eres2net-base&precision=fp16")
                .openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.outputStream.use { }
            assertEquals(400, connection.responseCode)
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
        val server = AsrHttpServer(
            engine,
            coordinator,
            voiceprintCoordinator,
            streamingEngine,
            tlsContext = null,
            allowInsecureHttp = true,
            cpuModeProvider = { CpuMode.AUTO }
        )
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
