package com.aasc.mmdartest

import android.content.res.AssetManager
import java.io.BufferedOutputStream
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * APK 内的静态资源回环服务器。
 *
 * 服务器只绑定 IPv4 回环地址，不向局域网暴露；只读取 APK assets 中的固定白名单路径，
 * 不支持文件写入、目录列举、代理转发或任意本地文件访问。
 */
internal class LocalAssetHttpServer(
    private val assets: AssetManager
) : AutoCloseable {
    companion object {
        private const val LOOPBACK = "127.0.0.1"
        private const val LOOPBACK_PORT = 17836
        private const val MAX_REQUEST_LINE_LENGTH = 8192
        private const val MAX_HEADER_LENGTH = 16384
        private const val STATIC_API_PREFIX = "/api/mmd/static/"
    }

    private val clients: ExecutorService = Executors.newFixedThreadPool(4)

    @Volatile
    private var socket: ServerSocket? = null

    @Volatile
    private var closed = false

    val isRunning: Boolean
        get() = socket?.isBound == true && socket?.isClosed == false

    fun start(): Int {
        check(!isRunning) { "本地静态服务器已经启动" }
        val server = ServerSocket()
        server.reuseAddress = true
        // 固定回环端口让 WebView origin 跨启动保持稳定，IndexedDB 和灯光设置才能复用。
        server.bind(InetSocketAddress(InetAddress.getByName(LOOPBACK), LOOPBACK_PORT), 8)
        socket = server
        closed = false
        Thread({ acceptClients(server) }, "mmd-ar-local-http").apply {
            isDaemon = true
            start()
        }
        return server.localPort
    }

    private fun acceptClients(server: ServerSocket) {
        while (!closed && !server.isClosed) {
            try {
                val client = server.accept()
                clients.execute { serveClient(client) }
            } catch (_: Exception) {
                if (!closed && !server.isClosed) Thread.sleep(50)
            }
        }
    }

    private fun serveClient(client: Socket) {
        client.use { connection ->
            try {
                connection.soTimeout = 8000
                val reader = BufferedReader(
                    InputStreamReader(connection.getInputStream(), StandardCharsets.ISO_8859_1)
                )
                val requestLine = reader.readLine()?.takeIf { it.length <= MAX_REQUEST_LINE_LENGTH }
                    ?: return
                var headerBytes = requestLine.length
                while (true) {
                    val header = reader.readLine() ?: return
                    headerBytes += header.length
                    if (headerBytes > MAX_HEADER_LENGTH) {
                        writeResponse(connection, 431, "text/plain; charset=utf-8", "请求头过大".toByteArray(), false)
                        return
                    }
                    if (header.isEmpty()) break
                }

                val requestParts = requestLine.split(' ', limit = 3)
                if (requestParts.size < 2) {
                    writeResponse(connection, 400, "text/plain; charset=utf-8", "请求格式无效".toByteArray(), false)
                    return
                }
                val method = requestParts[0].uppercase()
                if (method != "GET" && method != "HEAD") {
                    writeResponse(connection, 405, "text/plain; charset=utf-8", "仅支持 GET/HEAD".toByteArray(), false)
                    return
                }

                val uri = runCatching { URI(requestParts[1]) }.getOrNull()
                if (uri == null || uri.isAbsolute || uri.rawAuthority != null) {
                    writeResponse(connection, 400, "text/plain; charset=utf-8", "只允许本机相对路径".toByteArray(), method == "HEAD")
                    return
                }
                val decodedPath = runCatching {
                    URLDecoder.decode(uri.rawPath ?: "/", StandardCharsets.UTF_8.name())
                }.getOrNull()
                val assetPath = decodedPath?.let(::resolveAssetPath)
                if (assetPath == null) {
                    writeResponse(connection, 404, "text/plain; charset=utf-8", "资源不存在".toByteArray(), method == "HEAD")
                    return
                }

                val body = try {
                    assets.open(assetPath).use { input -> input.readBytes() }
                } catch (_: Exception) {
                    writeResponse(connection, 404, "text/plain; charset=utf-8", "资源不存在".toByteArray(), method == "HEAD")
                    return
                }
                writeResponse(connection, 200, contentType(assetPath), body, method == "HEAD")
            } catch (_: Exception) {
                // 客户端切页或退出时可能主动断开；不让单个请求异常影响本地服务循环。
            }
        }
    }

    private fun resolveAssetPath(path: String): String? {
        if (!path.startsWith('/') || path.contains('\\') || path.contains('\u0000')) return null
        if (path.split('/').any { it == "." || it == ".." }) return null

        return when {
            path == "/" -> "www/index.html"
            path == "/api/mmd/resources" -> "www/mmd-resources.json"
            path.startsWith(STATIC_API_PREFIX) -> {
                val relative = path.removePrefix(STATIC_API_PREFIX)
                if (!relative.startsWith("mmd/") || relative.split('/').any { it.isEmpty() }) null
                else "www/$relative"
            }
            path.startsWith("/js/") -> "www${path}"
            path.startsWith("/css/") -> "www${path}"
            path == "/index.html" -> "www/index.html"
            else -> null
        }
    }

    private fun contentType(assetPath: String): String = when (assetPath.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "js", "mjs" -> "text/javascript; charset=utf-8"
        "json" -> "application/json; charset=utf-8"
        "wasm" -> "application/wasm"
        "png" -> "image/png"
        "svg" -> "image/svg+xml"
        "ico" -> "image/x-icon"
        else -> "application/octet-stream"
    }

    private fun writeResponse(
        client: Socket,
        status: Int,
        mimeType: String,
        body: ByteArray,
        headOnly: Boolean
    ) {
        val reason = when (status) {
            200 -> "OK"
            400 -> "Bad Request"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            431 -> "Request Header Fields Too Large"
            else -> "Error"
        }
        val headers = buildString {
            append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n")
            append("Content-Type: ").append(mimeType).append("\r\n")
            append("Content-Length: ").append(body.size).append("\r\n")
            append("Connection: close\r\n")
            append("Cache-Control: no-store\r\n")
            append("X-Content-Type-Options: nosniff\r\n")
            append("Referrer-Policy: no-referrer\r\n")
            append("Permissions-Policy: camera=(self), microphone=()\r\n")
            append("\r\n")
        }.toByteArray(StandardCharsets.ISO_8859_1)
        BufferedOutputStream(client.getOutputStream()).use { output ->
            output.write(headers)
            if (!headOnly) output.write(body)
            output.flush()
        }
    }

    override fun close() {
        closed = true
        runCatching { socket?.close() }
        socket = null
        clients.shutdownNow()
    }
}
