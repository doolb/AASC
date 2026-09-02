package com.aasc.display

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class RemoteModelManagerTest {
    @Test
    fun cacheHitAndSameSizeCorruptionRedownloads() {
        val root = Files.createTempDirectory("aasc-remote-model-").toFile()
        val state = ModelServerState("model-v1")
        val server = startServer(state)
        try {
            val manager = RemoteModelManager()
            val directory = File(root, "yolo11n")
            val first = ensure(manager, server, directory)
            assertTrue(first.changed)

            val modelFile = File(directory, "yolo11n.onnx")
            modelFile.writeText("damaged")
            val second = ensure(manager, server, directory)

            assertTrue(second.changed)
            assertEquals("model-v1", modelFile.readText())
            assertEquals(2, state.downloadCount.get())
        } finally {
            server.stop(0)
            root.deleteRecursively()
        }
    }

    @Test
    fun failedUpdateKeepsPreviousCompleteCache() {
        val root = Files.createTempDirectory("aasc-remote-model-").toFile()
        val state = ModelServerState("model-v1")
        val server = startServer(state)
        try {
            val manager = RemoteModelManager()
            val directory = File(root, "yolo11n")
            ensure(manager, server, directory)
            state.body = "model-v2"
            state.failDownloads.set(true)

            assertThrows(Exception::class.java) {
                ensure(manager, server, directory)
            }

            assertEquals("model-v1", File(directory, "yolo11n.onnx").readText())
            assertTrue(File(directory, ".manifest.json").readText().contains(state.sha256("model-v1")))
        } finally {
            server.stop(0)
            root.deleteRecursively()
        }
    }

    private fun ensure(manager: RemoteModelManager, server: HttpServer, directory: File): RemoteModelInstall =
        manager.ensureModel(
            baseUrl = "http://127.0.0.1:${server.address.port}",
            manifestPath = "/manifest",
            downloadPath = "/model",
            modelId = "yolo11n",
            directory = directory
        )

    private fun startServer(state: ModelServerState): HttpServer {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange -> handle(exchange, state) }
        server.start()
        return server
    }

    private fun handle(exchange: HttpExchange, state: ModelServerState) {
        val requestPath = exchange.requestURI.path
        val isManifest = requestPath == "/manifest"
        val isModel = requestPath == "/model/yolo11n/yolo11n.onnx"
        if (isModel) state.downloadCount.incrementAndGet()
        val status = if (isModel && state.failDownloads.get()) 503 else if (isManifest || isModel) 200 else 404
        val body = when {
            status != 200 -> ByteArray(0)
            isManifest -> state.manifest().toByteArray()
            else -> state.body.toByteArray()
        }
        exchange.sendResponseHeaders(status, body.size.toLong())
        exchange.responseBody.use { it.write(body) }
    }

    private class ModelServerState(var body: String) {
        val failDownloads = AtomicBoolean(false)
        val downloadCount = AtomicInteger(0)

        fun sha256(value: String): String {
            val file = Files.createTempFile("aasc-model-hash-", ".onnx").toFile()
            return try {
                file.writeText(value)
                ModelHash.sha256(file)
            } finally {
                file.delete()
            }
        }

        fun manifest(): String {
            val value = body
            return """
                {"status":"success","models":[{"id":"yolo11n","files":[{"name":"yolo11n.onnx","size":${value.toByteArray().size},"sha256":"${sha256(value)}"}]}]}
            """.trimIndent()
        }
    }
}
