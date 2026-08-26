package com.aasc.asr

import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AsrHttpServerTest {
    @Test
    fun healthEndpointReportsModelAndServiceState() {
        val engine = AsrEngine()
        val coordinator = AsrCoordinator(engine)
        val server = AsrHttpServer(engine, coordinator) { CpuMode.AUTO }
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
        }
    }
}
