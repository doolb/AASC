package com.aasc.yolo

import android.graphics.Bitmap
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
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Collections
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean

/** 面向局域网测试的极简 HTTP 服务，串行保护模型检测和五模型测速。 */
class YoloHttpServer(
    private val detector: YoloDetector,
    cpuModeProvider: () -> CpuMode = { CpuMode.AUTO }
) {
    private var clientExecutor: ExecutorService = Executors.newFixedThreadPool(2)
    private var inferenceExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val benchmark = YoloBenchmark(detector)
    private val inferenceBusy = AtomicBoolean(false)
    private val modeProvider = cpuModeProvider
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
            acceptThread = Thread(::acceptLoop, "yolo-http-accept").also { it.start() }
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
        awaitTermination(clientExecutor)
        if (awaitTermination(inferenceExecutor)) {
            inferenceBusy.set(false)
        }
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
                val query = parseQuery(request.path.substringAfter('?', ""))
                when {
                    request.method == "GET" && (route == "/" || route == "/index.html") ->
                        respondHtml(socket.getOutputStream(), 200, YoloWebPage.HTML)
                    request.method == "GET" && route == "/health" ->
                        respond(socket.getOutputStream(), 200, YoloHttpJson.health(detector.isReady, running, inferenceBusy.get(), detector.activeModel))
                    request.method == "GET" && route == "/api/models" ->
                        respond(socket.getOutputStream(), 200, YoloHttpJson.models(YoloModel.entries, detector.activeModel))
                    request.method == "POST" && route == "/api/yolo" ->
                        handleDetection(socket.getOutputStream(), request, query)
                    request.method == "POST" && route == "/api/benchmark" ->
                        handleBenchmark(socket.getOutputStream(), request, query)
                    request.method != "GET" && request.method != "POST" ->
                        respond(socket.getOutputStream(), 405, YoloHttpJson.error("不支持的 HTTP 方法"))
                    else -> respond(socket.getOutputStream(), 404, YoloHttpJson.error("接口不存在"))
                }
            } catch (error: HttpProtocolException) {
                respondSafely(socket.getOutputStream(), error.status, YoloHttpJson.error(error.message ?: "HTTP 请求无效"))
            } catch (error: Exception) {
                respondSafely(socket.getOutputStream(), 500, YoloHttpJson.error(error.message ?: "HTTP 服务异常"))
            }
        }
    }

    private fun handleDetection(output: OutputStream, request: HttpRequest, query: Map<String, String>) {
        try {
            YoloImagePolicy.validateContentType(request.headers["content-type"])
        } catch (error: IllegalArgumentException) {
            respond(output, 415, YoloHttpJson.error(error.message ?: "图片类型不支持"))
            return
        }
        if (!detector.isReady) {
            respond(output, 503, YoloHttpJson.error("YOLO11 模型资源尚未就绪"))
            return
        }
        val model = query["model"]?.let { YoloModel.fromId(it) }
            ?: query["model"]?.let { throw HttpProtocolException(400, "不支持的 YOLO11 模型: $it") }
            ?: detector.activeModel
            ?: YoloModel.N
        if (!inferenceBusy.compareAndSet(false, true)) {
            respond(output, 409, YoloHttpJson.error("检测服务忙，请稍后重试"))
            return
        }
        var bitmap: Bitmap? = null
        var submitted = false
        try {
            bitmap = YoloImagePolicy.decode(request.body)
            val image = bitmap
            val future: Future<YoloResult> = try {
                inferenceExecutor.submit<YoloResult> {
                    try {
                        detector.detect(image, model, modeProvider())
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
                respond(output, 200, YoloHttpJson.success(future.get(DETECTION_TIMEOUT_SECONDS, TimeUnit.SECONDS)))
            } catch (_: TimeoutException) {
                future.cancel(true)
                respond(output, 504, YoloHttpJson.error("检测超时"))
            } catch (error: Exception) {
                val cause = error.cause ?: error
                respond(output, 400, YoloHttpJson.error(cause.message ?: "图片检测失败"))
            }
        } catch (error: IllegalArgumentException) {
            respond(output, 400, YoloHttpJson.error(error.message ?: "图片无效"))
        } catch (error: Exception) {
            respond(output, 500, YoloHttpJson.error(error.message ?: "图片检测失败"))
        } finally {
            if (!submitted) {
                bitmap?.recycle()
                inferenceBusy.set(false)
            }
        }
    }

    private fun handleBenchmark(output: OutputStream, request: HttpRequest, query: Map<String, String>) {
        try {
            YoloImagePolicy.validateContentType(request.headers["content-type"])
        } catch (error: IllegalArgumentException) {
            respond(output, 415, YoloHttpJson.error(error.message ?: "图片类型不支持"))
            return
        }
        if (!detector.isReady) {
            respond(output, 503, YoloHttpJson.error("YOLO11 模型资源尚未就绪"))
            return
        }
        val models = try {
            parseModels(query["models"])
        } catch (error: IllegalArgumentException) {
            respond(output, 400, YoloHttpJson.error(error.message ?: "测速模型参数无效"))
            return
        }
        val warmup = query["warmup"]?.toIntOrNull() ?: DEFAULT_WARMUP
        val runs = query["runs"]?.toIntOrNull() ?: DEFAULT_RUNS
        try {
            YoloBenchmark.validateParameters(warmup, runs)
        } catch (error: IllegalArgumentException) {
            respond(output, 400, YoloHttpJson.error(error.message ?: "测速参数无效"))
            return
        }
        if (!inferenceBusy.compareAndSet(false, true)) {
            respond(output, 409, YoloHttpJson.error("检测服务忙，请稍后重试"))
            return
        }
        var bitmap: Bitmap? = null
        var submitted = false
        try {
            bitmap = YoloImagePolicy.decode(request.body)
            val image = bitmap
            val future: Future<YoloBenchmarkResult> = try {
                inferenceExecutor.submit<YoloBenchmarkResult> {
                    try {
                        benchmark.run(image, models, warmup, runs, modeProvider())
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
                respond(output, 200, YoloHttpJson.benchmark(future.get(BENCHMARK_TIMEOUT_SECONDS, TimeUnit.SECONDS)))
            } catch (_: TimeoutException) {
                future.cancel(true)
                respond(output, 504, YoloHttpJson.error("测速超时"))
            } catch (error: Exception) {
                val cause = error.cause ?: error
                respond(output, 400, YoloHttpJson.error(cause.message ?: "模型测速失败"))
            }
        } catch (error: IllegalArgumentException) {
            respond(output, 400, YoloHttpJson.error(error.message ?: "图片无效"))
        } catch (error: Exception) {
            respond(output, 500, YoloHttpJson.error(error.message ?: "模型测速失败"))
        } finally {
            if (!submitted) {
                bitmap?.recycle()
                inferenceBusy.set(false)
            }
        }
    }

    private fun parseModels(value: String?): List<YoloModel> {
        if (value == null || value == "all") return YoloModel.entries
        val models = value.split(',').map { item ->
            YoloModel.fromId(item.trim()) ?: throw IllegalArgumentException("不支持的 YOLO11 模型: $item")
        }.distinct()
        require(models.isNotEmpty()) { "测速模型不能为空" }
        return models
    }

    /**
     * 停止时给任务一个短暂的中断收尾窗口；若推理线程仍未退出，则保留 busy 状态，
     * 直到任务 finally 真正完成，避免重启服务后误以为旧任务已经结束。
     */
    private fun awaitTermination(executor: ExecutorService): Boolean = try {
        executor.awaitTermination(EXECUTOR_SHUTDOWN_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        false
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
        val length = headers["content-length"]?.toLongOrNull() ?: 0L
        if (length < 0) throw HttpProtocolException(400, "Content-Length 无效")
        if (length > YoloImagePolicy.MAX_BODY_BYTES) throw HttpProtocolException(413, "请求体不能超过 20 MiB")
        val body = ByteArray(length.toInt())
        var offset = 0
        while (offset < body.size) {
            val count = input.read(body, offset, body.size - offset)
            if (count < 0) throw HttpProtocolException(400, "请求体不完整")
            offset += count
        }
        return HttpRequest(requestLine[0], requestLine[1], headers, body)
    }

    private fun parseQuery(queryText: String): Map<String, String> {
        if (queryText.isBlank()) return emptyMap()
        return queryText.split('&').mapNotNull { item ->
            val separator = item.indexOf('=')
            if (separator < 0) item to "" else {
                decodeQueryPart(item.substring(0, separator)) to
                    decodeQueryPart(item.substring(separator + 1))
            }
        }.toMap()
    }

    /**
     * 使用 Android 低版本可用的 charset 名称重载；Charset 对象重载在 API 28 设备上会出现 NoSuchMethodError。
     */
    private fun decodeQueryPart(value: String): String = try {
        URLDecoder.decode(value, StandardCharsets.UTF_8.name())
    } catch (error: Exception) {
        throw HttpProtocolException(400, "查询参数编码无效")
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
        output.write(("HTTP/1.1 $status $reason\r\nContent-Type: $contentType\r\n" +
            "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray(StandardCharsets.US_ASCII))
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

    private companion object {
        const val DEFAULT_WARMUP = 2
        const val DEFAULT_RUNS = 10
        const val MAX_HEADER_BYTES = 16 * 1024
        const val SOCKET_TIMEOUT_MS = 65_000
        const val DETECTION_TIMEOUT_SECONDS = 60L
        const val BENCHMARK_TIMEOUT_SECONDS = 900L
        const val EXECUTOR_SHUTDOWN_TIMEOUT_MS = 2_000L
    }
}
