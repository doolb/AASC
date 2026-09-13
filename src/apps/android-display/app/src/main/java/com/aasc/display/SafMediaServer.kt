package com.aasc.display

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

/**
 * 为 APK 内置 Node 提供受控的 SAF 文件网关。
 *
 * 网关不尝试把 content:// URI 映射成 Unix 路径，而是把用户选择的文档树映射为虚拟 `/`。
 * 服务仅监听回环地址，并要求随机 Bearer token，避免把 SAF 读写能力暴露给局域网。
 */
class SafMediaServer(private val context: Context) {

    data class ConnectionInfo(
        val baseUrl: String,
        val token: String
    )

    private companion object {
        const val MAX_HEADER_BYTES = 32 * 1024
        const val COPY_BUFFER_SIZE = 64 * 1024
        const val AUTHORIZATION_HEADER = "authorization"
        val HTTP_DATE_FORMAT = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss z", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("GMT")
        }
    }

    private val lifecycleLock = Any()
    private var serverSocket: ServerSocket? = null
    private var clientExecutor: ExecutorService? = null
    private var acceptThread: Thread? = null
    private var connectionInfo: ConnectionInfo? = null

    fun start(): ConnectionInfo {
        synchronized(lifecycleLock) {
            connectionInfo?.let { return it }
            val token = UUID.randomUUID().toString().replace("-", "")
            val socket = ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"))
            val executor = Executors.newCachedThreadPool { runnable ->
                Thread(runnable, "aasc-saf-client").apply { isDaemon = true }
            }
            serverSocket = socket
            clientExecutor = executor
            val info = ConnectionInfo("http://127.0.0.1:${socket.localPort}", token)
            connectionInfo = info
            acceptThread = Thread({ acceptClients(socket, executor) }, "aasc-saf-accept").apply {
                isDaemon = true
                start()
            }
            return info
        }
    }

    fun connectionInfo(): ConnectionInfo? = synchronized(lifecycleLock) { connectionInfo }

    fun stop() {
        synchronized(lifecycleLock) {
            try {
                serverSocket?.close()
            } catch (error: IOException) {
                android.util.Log.w("AASC-SAF", "关闭 SAF 网关失败: ${error.message}")
            }
            clientExecutor?.shutdownNow()
            serverSocket = null
            clientExecutor = null
            acceptThread = null
            connectionInfo = null
        }
    }

    private fun acceptClients(socket: ServerSocket, executor: ExecutorService) {
        while (!socket.isClosed) {
            try {
                val client = socket.accept()
                executor.execute { handleClient(client) }
            } catch (_: SocketException) {
                if (!socket.isClosed) {
                    android.util.Log.w("AASC-SAF", "接受 SAF 网关连接失败")
                }
                return
            } catch (error: IOException) {
                android.util.Log.w("AASC-SAF", "接受 SAF 网关连接失败: ${error.message}")
                return
            }
        }
    }

    private fun handleClient(socket: Socket) {
        socket.use { client ->
            client.soTimeout = 30_000
            val input = BufferedInputStream(client.getInputStream())
            val output = BufferedOutputStream(client.getOutputStream())
            try {
                val request = readRequest(input) ?: return
                val info = connectionInfo ?: return
                if (!isAuthorized(request.headers[AUTHORIZATION_HEADER], info.token)) {
                    writeJson(output, 401, JSONObject().put("error", "未授权的 SAF 网关请求"))
                    return
                }
                routeRequest(request, input, output)
            } catch (error: IllegalArgumentException) {
                android.util.Log.w("AASC-SAF", "SAF 请求路径无效: ${error.message}")
                try {
                    writeJson(output, 400, JSONObject().put("error", "SAF 路径无效"))
                } catch (_: Exception) {
                    // 客户端可能已经断开，无法再写入错误响应。
                }
            } catch (error: Exception) {
                android.util.Log.w("AASC-SAF", "处理 SAF 网关请求失败: ${error.message}")
                try {
                    writeJson(output, 500, JSONObject().put("error", "SAF 请求处理失败"))
                } catch (_: Exception) {
                    // 客户端可能已经断开，无法再写入错误响应。
                }
            }
        }
    }

    private fun routeRequest(request: HttpRequest, input: InputStream, output: BufferedOutputStream) {
        val target = Uri.parse(request.target)
        when {
            request.method == "GET" && target.path == "/v1/status" -> writeStatus(output)
            request.method == "GET" && target.path == "/v1/list" -> listDirectory(target, output)
            (request.method == "GET" || request.method == "HEAD") && target.path == "/v1/file" -> {
                readFile(target, request, output)
            }
            request.method == "POST" && target.path == "/v1/file" -> uploadFile(target, request, input, output)
            request.method == "DELETE" && target.path == "/v1/file" -> deleteFile(target, output)
            request.method == "POST" && target.path == "/v1/folder" -> createFolder(target, output)
            request.method == "DELETE" && target.path == "/v1/folder" -> deleteFolder(target, output)
            else -> writeJson(output, 404, JSONObject().put("error", "SAF 网关路径不存在"))
        }
    }

    private fun writeStatus(output: BufferedOutputStream) {
        val uri = SharedStorageAccess.persistedTreeUri(context)
        if (uri == null || !SharedStorageAccess.hasPersistedTreeUri(context)) {
            writeJson(output, 503, JSONObject().put("ok", false).put("ready", false))
            return
        }
        writeJson(output, 200, JSONObject().put("ok", true).put("ready", true))
    }

    private fun listDirectory(target: Uri, output: BufferedOutputStream) {
        val directory = resolveDocument(target.queryParameter("path"))
        if (directory == null || !directory.isDirectory) {
            writeJson(output, 404, JSONObject().put("error", "目录不存在"))
            return
        }
        val items = JSONArray()
        directory.listFiles()
            .filter { file -> !file.name.orEmpty().startsWith('.') }
            .sortedWith(compareBy<DocumentFile>({ !it.isDirectory }, { it.name.orEmpty() }))
            .forEach { file ->
                val name = file.name.orEmpty()
                val itemPath = joinPath(target.queryParameter("path"), name)
                val mediaType = if (file.isDirectory) "folder" else detectMediaType(name)
                val item = JSONObject()
                    .put("name", name)
                    .put("path", itemPath)
                    .put("type", if (file.isDirectory) "folder" else "file")
                    .put("mediaType", mediaType)
                    .put("size", if (file.isDirectory) 0L else file.length())
                    .put("modifiedTime", file.lastModified())
                if (mediaType == "text") {
                    item.put("format", if (name.lowercase(Locale.ROOT).endsWith(".md")) "markdown" else "plain")
                }
                items.put(item)
            }
        writeJson(output, 200, JSONObject().put("items", items))
    }

    private fun readFile(target: Uri, request: HttpRequest, output: BufferedOutputStream) {
        val document = resolveDocument(target.queryParameter("path"))
        if (document == null || !document.isFile) {
            writeJson(output, 404, JSONObject().put("error", "文件不存在"))
            return
        }
        val totalSize = document.length().coerceAtLeast(0L)
        val range = SafMediaPath.parseRange(request.headers["range"], totalSize)
        val contentType = document.type?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
        val headers = linkedMapOf(
            "Content-Type" to contentType,
            "Accept-Ranges" to "bytes",
            "Content-Length" to (if (range == null) totalSize else range.end - range.start + 1L).toString()
        )
        if (document.lastModified() > 0L) {
            headers["Last-Modified"] = formatHttpDate(document.lastModified())
        }
        if (range != null) {
            headers["Content-Range"] = "bytes ${range.start}-${range.end}/$totalSize"
        }
        writeHeaders(output, if (range == null) 200 else 206, headers)
        if (request.method == "HEAD") {
            output.flush()
            return
        }

        context.contentResolver.openInputStream(document.uri)?.use { stream ->
            if (range != null) skipFully(stream, range.start)
            copyBytes(
                stream,
                output,
                if (range == null) totalSize else range.end - range.start + 1L
            )
        } ?: throw IOException("无法打开 SAF 文件")
        output.flush()
    }

    private fun uploadFile(
        target: Uri,
        request: HttpRequest,
        input: InputStream,
        output: BufferedOutputStream
    ) {
        val parent = resolveDocument(target.queryParameter("path"))
        val name = target.queryParameter("name").orEmpty()
        if (parent == null || !parent.isDirectory || !isSingleName(name)) {
            writeJson(output, 400, JSONObject().put("error", "上传路径或文件名无效"))
            return
        }
        if (request.contentLength < 0L) {
            writeJson(output, 411, JSONObject().put("error", "上传必须包含 Content-Length"))
            return
        }
        val mimeType = target.queryParameter("mime")?.takeIf { it.isNotBlank() }
            ?: "application/octet-stream"
        val document = parent.createFile(mimeType, name)
            ?: throw IOException("无法创建 SAF 文件")
        try {
            context.contentResolver.openOutputStream(document.uri)?.use { stream ->
                copyBytes(input, stream, request.contentLength)
            } ?: throw IOException("无法打开 SAF 输出流")
            writeJson(output, 200, JSONObject().put("name", name).put("path", joinPath(target.queryParameter("path"), name)))
        } catch (error: Exception) {
            document.delete()
            throw error
        }
    }

    private fun deleteFile(target: Uri, output: BufferedOutputStream) {
        val document = resolveDocument(target.queryParameter("path"))
        if (document == null || !document.isFile || !document.delete()) {
            writeJson(output, 404, JSONObject().put("error", "文件不存在或删除失败"))
            return
        }
        writeJson(output, 200, JSONObject().put("ok", true))
    }

    private fun createFolder(target: Uri, output: BufferedOutputStream) {
        val parent = resolveDocument(target.queryParameter("path"))
        val name = target.queryParameter("name").orEmpty()
        if (parent == null || !parent.isDirectory || !isSingleName(name)) {
            writeJson(output, 400, JSONObject().put("error", "目录路径或名称无效"))
            return
        }
        val folder = parent.createDirectory(name)
            ?: throw IOException("无法创建 SAF 目录")
        writeJson(output, 200, JSONObject().put("name", name).put("path", joinPath(target.queryParameter("path"), folder.name.orEmpty())))
    }

    private fun deleteFolder(target: Uri, output: BufferedOutputStream) {
        val folder = resolveDocument(target.queryParameter("path"))
        if (folder == null || !folder.isDirectory || !deleteRecursively(folder)) {
            writeJson(output, 404, JSONObject().put("error", "目录不存在或删除失败"))
            return
        }
        writeJson(output, 200, JSONObject().put("ok", true))
    }

    private fun resolveDocument(rawPath: String?): DocumentFile? {
        val path = SafMediaPath.normalize(rawPath.orEmpty())
        val treeUri = SharedStorageAccess.persistedTreeUri(context)
            ?.takeIf { SharedStorageAccess.hasPersistedTreeUri(context) }
            ?: return null
        var current = DocumentFile.fromTreeUri(context, treeUri) ?: return null
        if (path == "/") return current
        for (segment in path.removePrefix("/").split('/')) {
            current = current.findFile(segment) ?: return null
        }
        return current
    }

    private fun deleteRecursively(document: DocumentFile): Boolean {
        if (document.isDirectory) {
            document.listFiles().forEach { child ->
                if (!deleteRecursively(child)) return false
            }
        }
        return document.delete()
    }

    private fun isSingleName(name: String): Boolean {
        if (name.isEmpty() || name == "." || name == "..") return false
        return try {
            SafMediaPath.normalize("/$name") == "/$name" &&
                !name.contains('/') && !name.contains('\\') && !name.contains('\u0000')
        } catch (_: IllegalArgumentException) {
            false
        }
    }

    private fun joinPath(rawDirectory: String?, name: String): String {
        val directory = SafMediaPath.normalize(rawDirectory.orEmpty())
        return SafMediaPath.normalize(if (directory == "/") "/$name" else "$directory/$name")
    }

    private fun detectMediaType(name: String): String {
        return when (name.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
            "gif" -> "gif"
            "mp4", "webm", "mov", "avi", "mkv" -> "video"
            "wav", "ogg", "mp3" -> "audio"
            "html", "htm", "mhtml" -> "html"
            "txt", "md" -> "text"
            else -> "image"
        }
    }

    private fun readRequest(input: InputStream): HttpRequest? {
        val requestLine = readLine(input) ?: return null
        val requestParts = requestLine.split(' ', limit = 3)
        if (requestParts.size != 3) throw IOException("HTTP 请求行无效")
        val headers = linkedMapOf<String, String>()
        var headerBytes = requestLine.length
        while (true) {
            val line = readLine(input) ?: throw IOException("HTTP 请求头不完整")
            headerBytes += line.length
            if (headerBytes > MAX_HEADER_BYTES) throw IOException("HTTP 请求头过大")
            if (line.isEmpty()) break
            val separator = line.indexOf(':')
            if (separator <= 0) throw IOException("HTTP 请求头无效")
            headers[line.substring(0, separator).lowercase(Locale.ROOT)] = line.substring(separator + 1).trim()
        }
        val contentLengthHeader = headers["content-length"]
        val contentLength = when {
            contentLengthHeader == null -> 0L
            else -> contentLengthHeader.toLongOrNull()
                ?: throw IOException("Content-Length 无效")
        }
        if (contentLength < 0L) throw IOException("Content-Length 无效")
        return HttpRequest(requestParts[0].uppercase(Locale.ROOT), requestParts[1], headers, contentLength)
    }

    private fun readLine(input: InputStream): String? {
        val bytes = ByteArrayOutputStream()
        while (true) {
            val value = input.read()
            if (value < 0) return if (bytes.size() == 0) null else bytes.toString(Charsets.UTF_8.name())
            if (value == '\n'.code) return bytes.toString(Charsets.UTF_8.name()).removeSuffix("\r")
            bytes.write(value)
            if (bytes.size() > MAX_HEADER_BYTES) throw IOException("HTTP 行过长")
        }
    }

    private fun isAuthorized(header: String?, token: String): Boolean {
        val expected = "Bearer $token".toByteArray(Charsets.UTF_8)
        val actual = header.orEmpty().toByteArray(Charsets.UTF_8)
        return MessageDigest.isEqual(actual, expected)
    }

    private fun copyBytes(input: InputStream, output: java.io.OutputStream, byteCount: Long) {
        var remaining = byteCount
        val buffer = ByteArray(COPY_BUFFER_SIZE)
        while (remaining > 0L) {
            val count = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
            if (count < 0) throw IOException("HTTP 请求体提前结束")
            output.write(buffer, 0, count)
            remaining -= count
        }
    }

    private fun skipFully(input: InputStream, byteCount: Long) {
        var remaining = byteCount
        while (remaining > 0L) {
            val skipped = input.skip(remaining)
            if (skipped > 0L) {
                remaining -= skipped
                continue
            }
            if (input.read() < 0) throw IOException("SAF 文件读取位置无效")
            remaining -= 1L
        }
    }

    private fun writeJson(output: BufferedOutputStream, status: Int, body: JSONObject) {
        val bytes = body.toString().toByteArray(Charsets.UTF_8)
        writeHeaders(
            output,
            status,
            linkedMapOf(
                "Content-Type" to "application/json; charset=utf-8",
                "Content-Length" to bytes.size.toString()
            )
        )
        output.write(bytes)
        output.flush()
    }

    private fun writeHeaders(output: BufferedOutputStream, status: Int, headers: Map<String, String>) {
        output.write("HTTP/1.1 $status ${statusText(status)}\r\n".toByteArray(Charsets.US_ASCII))
        headers.forEach { (name, value) ->
            output.write("$name: $value\r\n".toByteArray(Charsets.US_ASCII))
        }
        output.write("Connection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
    }

    private fun statusText(status: Int): String = when (status) {
        200 -> "OK"
        206 -> "Partial Content"
        400 -> "Bad Request"
        401 -> "Unauthorized"
        404 -> "Not Found"
        411 -> "Length Required"
        503 -> "Service Unavailable"
        else -> "Internal Server Error"
    }

    private fun formatHttpDate(timestamp: Long): String = synchronized(HTTP_DATE_FORMAT) {
        HTTP_DATE_FORMAT.format(Date(timestamp))
    }

    private data class HttpRequest(
        val method: String,
        val target: String,
        val headers: Map<String, String>,
        val contentLength: Long
    )
}

private fun Uri.queryParameter(name: String): String? = getQueryParameter(name)
