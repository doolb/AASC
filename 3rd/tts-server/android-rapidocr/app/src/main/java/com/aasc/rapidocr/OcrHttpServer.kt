package com.aasc.rapidocr

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
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
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * 面向局域网测试的明文 HTTP 服务。只实现图片上传所需的四个路由，
 * 请求头和请求体均有上限，服务停止时会主动关闭监听和工作线程。
 */
class OcrHttpServer(
    private val engine: RapidOcrEngine,
    cpuModeProvider: () -> CpuMode = { CpuMode.AUTO },
    affinityApplier: (CpuMode) -> String = CpuAffinity::apply
) {
    private var clientExecutor: ExecutorService = Executors.newFixedThreadPool(2)
    private var inferenceExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val lastAffinityStatus = AtomicReference("未执行")
    private val inferenceRunner = OcrInferenceRunner(
        modeProvider = cpuModeProvider,
        affinityApplier = { mode ->
            affinityApplier(mode).also { status -> lastAffinityStatus.set(status) }
        }
    )
    private val inferenceBusy = AtomicBoolean(false)
    @Volatile private var running = false
    @Volatile private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null
    private var port = 0

    @Synchronized
    fun start(requestedPort: Int): Result<Int> {
        if (running) return Result.success(port)
        return try {
            if (clientExecutor.isShutdown) clientExecutor = Executors.newFixedThreadPool(2)
            if (inferenceExecutor.isShutdown) inferenceExecutor = Executors.newSingleThreadExecutor()
            val socket = ServerSocket()
            socket.reuseAddress = true
            socket.bind(InetSocketAddress("0.0.0.0", requestedPort))
            serverSocket = socket
            port = socket.localPort
            running = true
            acceptThread = Thread(::acceptLoop, "rapidocr-http-accept").also { it.start() }
            Result.success(port)
        } catch (error: Exception) {
            try { serverSocket?.close() } catch (_: Exception) { /* 启动失败时关闭半成品 socket。 */ }
            serverSocket = null
            Result.failure(IllegalStateException("HTTP 端口不可用", error))
        }
    }

    @Synchronized
    fun stop() {
        running = false
        try { serverSocket?.close() } catch (_: Exception) { /* 关闭服务时忽略重复 close。 */ }
        serverSocket = null
        try { acceptThread?.join(1000) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        acceptThread = null
        clientExecutor.shutdownNow()
        inferenceExecutor.shutdownNow()
        inferenceBusy.set(false)
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
                socket.soTimeout = SOCKET_TIMEOUT_MS
                val request = readRequest(BufferedInputStream(socket.getInputStream()))
                val route = request.path.substringBefore('?')
                when {
                    request.method == "GET" && (route == "/" || route == "/index.html") ->
                        respondHtml(socket.getOutputStream(), 200, OcrWebPage.HTML)
                    request.method == "GET" && route == "/health" ->
                        respond(socket.getOutputStream(), 200, OcrHttpJson.health(engine.isReady, running, inferenceBusy.get()))
                    request.method == "POST" && route == "/api/ocr" ->
                        handleRecognition(socket.getOutputStream(), request)
                    request.method != "GET" && request.method != "POST" ->
                        respond(socket.getOutputStream(), 405, OcrHttpJson.error("不支持的 HTTP 方法"))
                    else -> respond(socket.getOutputStream(), 404, OcrHttpJson.error("接口不存在"))
                }
            } catch (error: HttpProtocolException) {
                respondSafely(socket.getOutputStream(), error.status, OcrHttpJson.error(error.message ?: "HTTP 请求无效"))
            } catch (error: Exception) {
                respondSafely(socket.getOutputStream(), 500, OcrHttpJson.error(error.message ?: "HTTP 服务异常"))
            }
        }
    }

    private fun handleRecognition(output: OutputStream, request: HttpRequest) {
        try {
            OcrImagePolicy.validateContentType(request.headers["content-type"])
        } catch (error: IllegalArgumentException) {
            respond(output, 415, OcrHttpJson.error(error.message ?: "图片类型不支持"))
            return
        }
        if (!engine.isReady) {
            respond(output, 503, OcrHttpJson.error("RapidOCR 模型尚未就绪"))
            return
        }
        if (!inferenceBusy.compareAndSet(false, true)) {
            respond(output, 409, OcrHttpJson.error("识别服务忙，请稍后重试"))
            return
        }

        var decoded: DecodedImage? = null
        var submitted = false
        try {
            decoded = OcrImagePolicy.decode(request.body)
            val image = decoded.bitmap
            val future: Future<OcrResult> = try {
                inferenceExecutor.submit<OcrResult> {
                    try {
                        inferenceRunner.runWithMode { mode -> engine.recognize(image, mode) }
                    } finally {
                        image.recycle()
                        inferenceBusy.set(false)
                    }
                }
            } catch (error: Exception) {
                image.recycle()
                inferenceBusy.set(false)
                throw error
            }
            submitted = true
            try {
                respond(
                    output,
                    200,
                    OcrHttpJson.success(
                        future.get(INFERENCE_TIMEOUT_SECONDS, TimeUnit.SECONDS),
                        lastAffinityStatus.get()
                    )
                )
            } catch (_: TimeoutException) {
                future.cancel(true)
                respond(output, 504, OcrHttpJson.error("识别超时"))
            } catch (error: Exception) {
                val cause = error.cause ?: error
                respond(output, 400, OcrHttpJson.error(cause.message ?: "图片识别失败"))
            }
        } catch (error: IllegalArgumentException) {
            respond(output, 400, OcrHttpJson.error(error.message ?: "图片无效"))
        } catch (error: Exception) {
            respond(output, 500, OcrHttpJson.error(error.message ?: "图片识别失败"))
        } finally {
            if (!submitted) {
                decoded?.bitmap?.recycle()
                inferenceBusy.set(false)
            }
        }
    }

    private fun readRequest(input: BufferedInputStream): HttpRequest {
        val headerBytes = ByteArrayOutputStream()
        while (headerBytes.size() < MAX_HEADER_BYTES) {
            val value = input.read()
            if (value < 0) break
            headerBytes.write(value)
            val bytes = headerBytes.toByteArray()
            if (bytes.size >= 4 && bytes.takeLast(4).toByteArray().contentEquals(byteArrayOf(13, 10, 13, 10))) break
        }
        val headerText = headerBytes.toByteArray().toString(StandardCharsets.US_ASCII)
        if (!headerText.endsWith("\r\n\r\n")) throw HttpProtocolException(400, "HTTP 请求头无效")
        val lines = headerText.trimEnd().split("\r\n")
        val requestLine = lines.firstOrNull()?.split(' ') ?: throw HttpProtocolException(400, "HTTP 请求行无效")
        if (requestLine.size != 3) throw HttpProtocolException(400, "HTTP 请求行无效")
        val headers = lines.drop(1).mapNotNull { line ->
            val separator = line.indexOf(':')
            if (separator <= 0) null else line.substring(0, separator).lowercase() to line.substring(separator + 1).trim()
        }.toMap()
        if (headers["transfer-encoding"] != null) throw HttpProtocolException(400, "不支持 Transfer-Encoding")
        val lengthHeader = headers["content-length"]
        val length = if (lengthHeader == null) {
            0L
        } else {
            lengthHeader.toLongOrNull() ?: throw HttpProtocolException(400, "Content-Length 无效")
        }
        if (length < 0) throw HttpProtocolException(400, "Content-Length 无效")
        if (length > OcrImagePolicy.MAX_BODY_BYTES) throw HttpProtocolException(413, "请求体不能超过 20 MiB")
        val body = ByteArray(length.toInt())
        var offset = 0
        while (offset < body.size) {
            val count = input.read(body, offset, body.size - offset)
            if (count < 0) throw HttpProtocolException(400, "请求体不完整")
            offset += count
        }
        return HttpRequest(requestLine[0], requestLine[1], headers, body)
    }

    private fun respond(output: OutputStream, status: Int, body: String) =
        respondBody(output, status, "application/json; charset=utf-8", body)

    private fun respondHtml(output: OutputStream, status: Int, body: String) =
        respondBody(output, status, "text/html; charset=utf-8", body)

    private fun respondBody(output: OutputStream, status: Int, contentType: String, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val reason = when (status) {
            200 -> "OK"
            400 -> "Bad Request"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            409 -> "Conflict"
            413 -> "Payload Too Large"
            415 -> "Unsupported Media Type"
            503 -> "Service Unavailable"
            504 -> "Gateway Timeout"
            else -> "Internal Server Error"
        }
        output.write(
            (
                "HTTP/1.1 $status $reason\r\nContent-Type: $contentType\r\n" +
                    "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
            ).toByteArray(StandardCharsets.US_ASCII)
        )
        output.write(bytes)
        output.flush()
    }

    private fun respondSafely(output: OutputStream, status: Int, body: String) {
        try { respond(output, status, body) } catch (_: Exception) { /* 客户端断开时无需再次写回。 */ }
    }

    private fun localAddress(): String = try {
        Collections.list(NetworkInterface.getNetworkInterfaces()).asSequence()
            .flatMap { network -> Collections.list(network.inetAddresses).asSequence() }
            .filterIsInstance<Inet4Address>()
            .firstOrNull { !it.isLoopbackAddress }?.hostAddress ?: InetAddress.getLocalHost().hostAddress
    } catch (_: Exception) {
        "0.0.0.0"
    }

    private data class HttpRequest(
        val method: String,
        val path: String,
        val headers: Map<String, String>,
        val body: ByteArray
    )

    private class HttpProtocolException(val status: Int, message: String) : IOException(message)

    companion object {
        const val DEFAULT_PORT = 18080
        private const val MAX_HEADER_BYTES = 16 * 1024
        private const val SOCKET_TIMEOUT_MS = 65_000
        private const val INFERENCE_TIMEOUT_SECONDS = 60L
    }
}
