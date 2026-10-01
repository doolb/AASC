package com.aasc.mmdartest

import android.content.res.AssetManager
import android.content.ContentResolver
import android.net.Uri
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
import java.util.concurrent.ConcurrentHashMap
import java.util.UUID

/**
 * APK 内的静态资源回环服务器。
 *
 * 服务器只绑定 IPv4 回环地址，不向局域网暴露；读取固定白名单assets与用户本次授权的随机文件令牌，
 * 不支持文件写入、目录列举、代理转发或任意本地文件访问。
 */
internal class LocalAssetHttpServer(
    private val assets: AssetManager,
    private val contentResolver: ContentResolver
) : AutoCloseable {
    companion object {
        private const val LOOPBACK = "127.0.0.1"
        private const val LOOPBACK_PORT = 17836
        private const val MAX_REQUEST_LINE_LENGTH = 8192
        private const val MAX_HEADER_LENGTH = 16384
        private const val STATIC_API_PREFIX = "/api/mmd/static/"
    }

    private val clients: ExecutorService = Executors.newFixedThreadPool(4)
    private data class PickedFile(val operation: String, val uri: Uri, val mimeType: String, val size: Long)
    private val pickedFiles = ConcurrentHashMap<String, PickedFile>()

    /** 仅注册系统选择器授权的文件；不可通过请求路径构造任意content URI。 */
    fun registerPickedFile(operation: String, uri: Uri, mimeType: String, size: Long): String {
        check(!closed) { "本地资源服务已关闭" }
        val token = UUID.randomUUID().toString()
        // 文档提供方的MIME也按规范过滤，避免异常元数据进入HTTP响应头。
        val safeMime = mimeType.takeIf { it.matches(Regex("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")) }
            ?: "application/octet-stream"
        pickedFiles[token] = PickedFile(operation, uri, safeMime, size)
        if (closed) {
            pickedFiles.remove(token)
            error("本地资源服务已关闭")
        }
        return "/picked-files/$token"
    }

    fun releasePickedFiles(operation: String) {
        pickedFiles.entries.removeIf { it.value.operation == operation }
    }

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
                if (decodedPath?.startsWith("/picked-files/") == true) {
                    servePickedFile(connection, decodedPath.removePrefix("/picked-files/"), method == "HEAD")
                    return
                }
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
            path.startsWith("/assets/") -> "www${path}"
            path == "/index.html" -> "www/index.html"
            else -> null
        }
    }

    /** 流式读取本次授权文件，避免在Android堆中再完整复制大PMX与贴图。 */
    private fun servePickedFile(client: Socket, token: String, headOnly: Boolean) {
        val file = pickedFiles[token]
        if (file == null) {
            writeResponse(client, 404, "text/plain; charset=utf-8", "选择已释放".toByteArray(), headOnly)
            return
        }
        val input = try { contentResolver.openInputStream(file.uri) }
        catch (_: Exception) { null }
        if (input == null) {
            writeResponse(client, 404, "text/plain; charset=utf-8", "所选文件无法读取".toByteArray(), headOnly)
            return
        }
        input.use { stream ->
            BufferedOutputStream(client.getOutputStream()).use { output ->
                val headers = buildString {
                    append("HTTP/1.1 200 OK\r\nContent-Type: ").append(file.mimeType).append("\r\n")
                    append("Transfer-Encoding: chunked\r\nConnection: close\r\nCache-Control: no-store\r\n")
                    append("X-Content-Type-Options: nosniff\r\n\r\n")
                }
                output.write(headers.toByteArray(StandardCharsets.ISO_8859_1))
                if (!headOnly) {
                    val buffer = ByteArray(65536)
                    while (true) {
                        val count = stream.read(buffer)
                        if (count < 0) break
                        if (count == 0) continue
                        output.write((count.toString(16) + "\r\n").toByteArray(StandardCharsets.US_ASCII))
                        output.write(buffer, 0, count)
                        output.write("\r\n".toByteArray(StandardCharsets.US_ASCII))
                    }
                    output.write("0\r\n\r\n".toByteArray(StandardCharsets.US_ASCII))
                }
                output.flush()
            }
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
        pickedFiles.clear()
        runCatching { socket?.close() }
        socket = null
        clients.shutdownNow()
    }
}
