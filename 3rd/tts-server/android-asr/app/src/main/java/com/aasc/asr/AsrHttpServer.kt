package com.aasc.asr

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.Collections
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

// APK 内置的极简局域网服务，根路径提供普通网页，页面内部使用识别接口。
class AsrHttpServer(
    private val engine: AsrEngine,
    private val coordinator: AsrCoordinator,
    private val cpuModeProvider: () -> CpuMode
) {
    private var clientExecutor: ExecutorService = Executors.newFixedThreadPool(2)
    @Volatile private var running = false
    @Volatile private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null
    private var port = 0

    fun start(requestedPort: Int): Result<Int> {
        if (running) return Result.success(port)
        return try {
            val socket = ServerSocket()
            if (clientExecutor.isShutdown) clientExecutor = Executors.newFixedThreadPool(2)
            socket.reuseAddress = true
            socket.bind(InetSocketAddress("0.0.0.0", requestedPort))
            serverSocket = socket
            port = socket.localPort
            running = true
            acceptThread = Thread(::acceptLoop, "asr-http-accept").also { it.start() }
            Result.success(port)
        } catch (error: Exception) {
            serverSocket?.close()
            serverSocket = null
            Result.failure(IllegalStateException("HTTP 端口不可用", error))
        }
    }

    fun stop() {
        running = false
        try { serverSocket?.close() } catch (_: Exception) { /* 关闭服务时忽略异常 */ }
        serverSocket = null
        try { acceptThread?.join(1000) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        acceptThread = null
        clientExecutor.shutdownNow()
    }

    fun isRunning(): Boolean = running

    fun addressText(): String = "http://${localAddress()}:$port"

    private fun acceptLoop() {
        while (running) {
            try {
                val client = serverSocket?.accept() ?: break
                clientExecutor.execute { handle(client) }
            } catch (_: Exception) {
                if (running) continue
                break
            }
        }
    }

    private fun handle(client: Socket) {
        client.use { socket ->
            try {
                socket.soTimeout = 65_000
                val request = readRequest(BufferedInputStream(socket.getInputStream()))
                if (request == null) {
                    respond(socket.getOutputStream(), 400, HttpJson.error("HTTP 请求无效"))
                    return
                }
                when {
                    request.method == "GET" && (request.path == "/" || request.path == "/index.html") ->
                        respondHtml(socket.getOutputStream(), 200, AsrWebPage.HTML)
                    request.method == "GET" && request.path == "/health" ->
                        respond(socket.getOutputStream(), 200, HttpJson.health(engine.isLoaded, running, cpuModeProvider()))
                    request.method == "POST" && request.path == "/api/asr" -> handleRecognition(socket.getOutputStream(), request)
                    request.method != "GET" && request.method != "POST" ->
                        respond(socket.getOutputStream(), 405, HttpJson.error("不支持的 HTTP 方法"))
                    else -> respond(socket.getOutputStream(), 404, HttpJson.error("接口不存在"))
                }
            } catch (error: Exception) {
                try { respond(socket.getOutputStream(), 500, HttpJson.error(error.message ?: "HTTP 服务异常")) } catch (_: Exception) { /* socket 已断开 */ }
            }
        }
    }

    private fun handleRecognition(output: OutputStream, request: HttpRequest) {
        if (!engine.isLoaded) {
            respond(output, 503, HttpJson.error("ASR 模型尚未就绪"))
            return
        }
        val contentType = request.headers["content-type"]?.substringBefore(';')?.trim()?.lowercase()
        if (contentType != "audio/wav" && contentType != "application/octet-stream") {
            respond(output, 415, HttpJson.error("Content-Type 必须是 audio/wav 或 application/octet-stream"))
            return
        }
        if (coordinator.isBusy()) {
            respond(output, 409, HttpJson.error("识别服务忙，请稍后重试"))
            return
        }
        try {
            val samples = if (contentType == "audio/wav") {
                AudioResampler.toMono16k(WavAudio.decode(request.body))
            } else {
                AsrPcm.decodeS16(request.body)
            }
            AsrCoordinator.validateSamples(samples)
            val result = coordinator.submit(samples, cpuModeProvider()).get(60, TimeUnit.SECONDS)
            respond(output, 200, HttpJson.success(result.text, result.elapsedMs))
        } catch (error: java.util.concurrent.TimeoutException) {
            respond(output, 504, HttpJson.error("识别超时"))
        } catch (error: AsrBusyException) {
            respond(output, 409, HttpJson.error(error.message ?: "识别服务忙"))
        } catch (error: Exception) {
            val cause = error.cause ?: error
            respond(output, 400, HttpJson.error(cause.message ?: "音频无效"))
        }
    }

    private fun readRequest(input: BufferedInputStream): HttpRequest? {
        val headerBytes = ByteArrayOutputStream()
        var previous = 0
        var current = -1
        while (headerBytes.size() < MAX_HEADER_BYTES && input.read().also { current = it } >= 0) {
            headerBytes.write(current)
            if (previous == '\r'.code && current == '\n'.code && headerBytes.toByteArray().takeLast(4).toByteArray().contentEquals(byteArrayOf(13, 10, 13, 10))) break
            previous = current
        }
        val headerText = headerBytes.toByteArray().toString(StandardCharsets.US_ASCII)
        if (!headerText.endsWith("\r\n\r\n")) return null
        val lines = headerText.trimEnd().split("\r\n")
        val requestLine = lines.firstOrNull()?.split(' ') ?: return null
        if (requestLine.size != 3) return null
        val headers = lines.drop(1).mapNotNull { line ->
            val separator = line.indexOf(':')
            if (separator <= 0) null else line.substring(0, separator).lowercase() to line.substring(separator + 1).trim()
        }.toMap()
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        if (length < 0 || length > MAX_BODY_BYTES) return null
        val body = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val count = input.read(body, offset, length - offset)
            if (count < 0) return null
            offset += count
        }
        return HttpRequest(requestLine[0], requestLine[1], headers, body)
    }

    private fun respond(output: OutputStream, status: Int, body: String) {
        respondBody(output, status, "application/json; charset=utf-8", body)
    }

    private fun respondHtml(output: OutputStream, status: Int, body: String) {
        respondBody(output, status, "text/html; charset=utf-8", body)
    }

    private fun respondBody(output: OutputStream, status: Int, contentType: String, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val reason = when (status) {
            200 -> "OK"
            400 -> "Bad Request"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            409 -> "Conflict"
            415 -> "Unsupported Media Type"
            503 -> "Service Unavailable"
            504 -> "Gateway Timeout"
            else -> "Internal Server Error"
        }
        output.write("HTTP/1.1 $status $reason\r\nContent-Type: $contentType\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
        output.write(bytes)
        output.flush()
    }

    private fun localAddress(): String {
        return try {
            Collections.list(NetworkInterface.getNetworkInterfaces()).asSequence()
                .flatMap { network -> Collections.list(network.inetAddresses).asSequence() }
                .filterIsInstance<Inet4Address>()
                .firstOrNull { !it.isLoopbackAddress }?.hostAddress ?: InetAddress.getLocalHost().hostAddress
        } catch (_: Exception) {
            "0.0.0.0"
        }
    }

    private data class HttpRequest(val method: String, val path: String, val headers: Map<String, String>, val body: ByteArray)

    companion object {
        const val DEFAULT_PORT = 18080
        private const val MAX_HEADER_BYTES = 16 * 1024
        private const val MAX_BODY_BYTES = 20 * 1024 * 1024
    }
}
