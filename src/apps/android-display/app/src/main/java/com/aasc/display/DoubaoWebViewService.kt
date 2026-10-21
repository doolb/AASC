package com.aasc.display

import android.annotation.SuppressLint
import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebStorage
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock

/**
 * 豆包网页任务的 Android 侧运行时。服务与外部登录 Activity 同处隔离进程，Cookie 只在该
 * WebView 数据目录中使用；Node 只能通过同应用绑定后给出的本机端口与随机令牌请求固定官网路径。
 */
class DoubaoWebViewService : Service() {
    companion object {
        const val EXTRA_TOKEN = "doubao_webview_token"
        const val PORT = 19092
    }

    private val binder = Binder()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val workers = Executors.newCachedThreadPool()
    private val pending = ConcurrentHashMap<String, LinkedBlockingQueue<JSONObject>>()
    private var listener: ServerSocket? = null
    private var token = ""
    private val pages = DoubaoWebViewPageCache<WebView> { it.destroy() }
    private val webView: WebView? get() = pages.current
    private var pageLoaded = CountDownLatch(1)
    private val accountLock = ReentrantLock()
    private var accountFingerprint = ""
    private var pageScriptFingerprint = ""

    override fun onCreate() {
        Chat2ApiWebViewDataDirectory.initializer.initialize(Build.VERSION.SDK_INT) { suffix ->
            WebView.setDataDirectorySuffix(suffix)
        }
        super.onCreate()
    }

    override fun onBind(intent: Intent?): IBinder {
        val requestedToken = intent?.getStringExtra(EXTRA_TOKEN).orEmpty()
        require(requestedToken.length >= 32) { "豆包网页任务缺少授权令牌" }
        if (listener == null) {
            token = requestedToken
            listener = ServerSocket(PORT, 16, InetAddress.getByName("127.0.0.1"))
            workers.execute {
                while (true) {
                    val socket = try { listener?.accept() ?: break } catch (_: Exception) { break }
                    workers.execute { socket.use(::handleSocket) }
                }
            }
        }
        return binder
    }

    override fun onDestroy() {
        listener?.close()
        listener = null
        workers.shutdownNow()
        pending.clear()
        pages.clear()
        super.onDestroy()
    }

    private fun error(socket: Socket, status: Int, code: String) {
        val body = JSONObject().put("error", code).toString().toByteArray(Charsets.UTF_8)
        socket.getOutputStream().write(("HTTP/1.1 $status Error\r\nContent-Type: application/json\r\n" +
            "Content-Length: ${body.size}\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII))
        socket.getOutputStream().write(body)
    }

    private fun readHeader(socket: Socket): Pair<Map<String, String>, String> {
        val input = socket.getInputStream()
        val bytes = ByteArrayOutputStream()
        while (bytes.size() < 16 * 1024) {
            val next = input.read()
            if (next < 0) throw IllegalArgumentException("连接已关闭")
            bytes.write(next)
            val data = bytes.toByteArray()
            if (data.size >= 4 && data.takeLast(4) == listOf(13.toByte(), 10.toByte(), 13.toByte(), 10.toByte())) break
        }
        if (bytes.size() >= 16 * 1024) throw IllegalArgumentException("请求头过大")
        val lines = bytes.toString(Charsets.US_ASCII.name()).split("\r\n")
        val headers = lines.drop(1).takeWhile { it.isNotEmpty() }.mapNotNull { line ->
            val index = line.indexOf(':')
            if (index < 1) null else line.substring(0, index).lowercase() to line.substring(index + 1).trim()
        }.toMap()
        return headers to lines.first()
    }

    private fun validSession(expected: String): Boolean {
        if (expected.length < 16 || expected.length > 512) return false
        val cookie = CookieManager.getInstance().getCookie("https://www.doubao.com/chat/").orEmpty()
        val current = cookie.split(';').map { it.trim() }
            .firstOrNull { it.startsWith("sessionid=") }?.substringAfter('=') ?: return false
        return MessageDigest.isEqual(expected.toByteArray(), current.toByteArray())
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensurePage(profile: JSONObject, bootstrapScript: String): WebView {
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(bootstrapScript.toByteArray())
            .joinToString("") { "%02x".format(it) }
        // 服务JS升级时重建页面，确保文档开始注入点与本次调用使用同一个运行时。
        if (fingerprint != pageScriptFingerprint) { pages.clear(); pageScriptFingerprint = fingerprint }
        return pages.getOrCreate {
            val view = WebView(this)
            view.settings.javaScriptEnabled = true
            view.settings.domStorageEnabled = true
            view.settings.userAgentString = profile.getString("userAgent")
            require(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
            WebViewCompat.addDocumentStartJavaScript(view, DoubaoWebViewAccount.storageScript(profile),
                setOf(DoubaoWebViewAccount.ORIGIN))
            WebViewCompat.addDocumentStartJavaScript(view, bootstrapScript,
                setOf(DoubaoWebViewAccount.ORIGIN))
            view.addJavascriptInterface(object {
                @JavascriptInterface fun onPacket(raw: String) {
                    try {
                        val packet = JSONObject(raw)
                        pending[packet.optString("requestId")]?.offer(packet)
                    } catch (_: Exception) { /* 网页发来的损坏包只影响该次请求超时。 */ }
                }
            }, "AASCDoubaoRuntime")
            view.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.scheme != "https" || request.url.host != "www.doubao.com"

                override fun onPageFinished(view: WebView, url: String) {
                    if (url.startsWith("https://www.doubao.com/chat")) pageLoaded.countDown()
                }
            }
            pageLoaded = CountDownLatch(1)
            view.loadUrl("https://www.doubao.com/chat/")
            view
        }
    }

    /** 工作者等待Cookie回调，主线程只执行WebView操作，避免阻塞CookieManager和网页加载。 */
    private fun restoreAccount(input: JSONObject, session: String): Boolean {
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(input.toString().toByteArray())
            .joinToString("") { "%02x".format(it) }
        if (fingerprint == accountFingerprint && validSession(session)) return true
        val ready = CountDownLatch(1)
        mainHandler.post {
            pages.clear()
            WebStorage.getInstance().deleteAllData()
            val manager = CookieManager.getInstance()
            manager.setAcceptCookie(true)
            manager.removeAllCookies {
                val mappings = mutableListOf<Pair<String, String>>()
                val snapshot = input.getJSONObject("cookieSnapshot")
                for (origin in snapshot.keys()) {
                    val seen = mutableSetOf<String>()
                    for (part in snapshot.getString(origin).split(';')) {
                        val pair = part.trim().split('=', limit = 2)
                        if (seen.add(pair[0])) mappings.add(origin to "${pair[0]}=${pair[1]}; Path=/; Secure")
                    }
                }
                var remaining = mappings.size
                for ((origin, value) in mappings) manager.setCookie(origin, value) {
                    remaining -= 1
                    if (remaining == 0) { manager.flush(); ready.countDown() }
                }
            }
        }
        if (!ready.await(15, TimeUnit.SECONDS) || !validSession(session)) return false
        accountFingerprint = fingerprint
        return true
    }

    /** 在账号锁和租约内等待主线程销毁完成；不删除Cookie或设备存储。 */
    private fun closePreparedPage(): Boolean {
        val expectedPage = webView ?: return false
        val latch = CountDownLatch(1)
        var closed = false
        mainHandler.post {
            try {
                closed = pages.clear(expectedPage)
                if (closed) pageLoaded = CountDownLatch(1)
            } catch (_: Exception) { /* 关闭失败必须回报调用方，不能伪造释放成功。 */ }
            finally { latch.countDown() }
        }
        return latch.await(15, TimeUnit.SECONDS) && closed
    }

    private fun handleSocket(socket: Socket) {
        try {
            socket.soTimeout = 30_000
            val (headers, requestLine) = readHeader(socket)
            val expected = "Bearer $token"
            val provided = headers["authorization"].orEmpty()
            if (!MessageDigest.isEqual(expected.toByteArray(), provided.toByteArray())) {
                error(socket, 401, "unauthorized")
                return
            }
            if (requestLine != "POST /execute HTTP/1.1") {
                error(socket, 404, "not_found")
                return
            }
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            if (length < 2 || length > 30 * 1024 * 1024) {
                error(socket, 413, "request_too_large")
                return
            }
            val body = ByteArray(length)
            var offset = 0
            while (offset < body.size) {
                val count = socket.getInputStream().read(body, offset, body.size - offset)
                if (count < 0) throw IllegalArgumentException("请求体不完整")
                offset += count
            }
            val request = JSONObject(String(body, Charsets.UTF_8))
            // 原生仅提供版本化的受信JS执行通道，豆包签名和请求流程由服务JS维护。
            if (request.optInt("runtimeVersion", 0) != 3) {
                error(socket, 409, "doubao_webview_runtime_version"); return
            }
            val bootstrapScript = request.optString("bootstrapScript")
            val executeScript = request.optString("executeScript")
            val requestId = request.optString("requestId")
            if (bootstrapScript.length !in 1..131072 || executeScript.length !in 1..(25 * 1024 * 1024)
                || !Regex("^[a-f0-9-]{36}$").matches(requestId) || request.opt("prepareOnly") !is Boolean) {
                error(socket, 400, "doubao_webview_runtime_script"); return
            }
            val prepareOnly = request.getBoolean("prepareOnly")
            val url = java.net.URI(request.optString("url"))
            val allowed = setOf("/chat/completion", "/samantha/chat/completion",
                "/samantha/pages/upload_image", "/alice/message/get_file_url",
                "/alice/resource/prepare_upload", "/top/v1")
            if (url.scheme != "https" || url.host != "www.doubao.com" || url.port != -1
                || url.rawUserInfo != null || url.fragment != null || !allowed.contains(url.path)) {
                error(socket, 403, "doubao_webview_identity")
                return
            }
            if (prepareOnly && url.path != "/chat/completion") { error(socket, 403, "doubao_webview_prepare"); return }
            if (request.has("closeAfterPrepare") && request.opt("closeAfterPrepare") !is Boolean) {
                error(socket, 400, "doubao_webview_close_config"); return
            }
            val closeAfterPrepare = prepareOnly && request.optBoolean("closeAfterPrepare", false)
            val restore = try { DoubaoWebViewAccount.validate(request.getJSONObject("restore"), request.optString("sessionId")) }
            catch (_: Exception) { error(socket, 403, "doubao_webview_identity"); return }
            if (!accountLock.tryLock(30, TimeUnit.SECONDS)) { error(socket, 409, "doubao_webview_busy"); return }
            val queue = LinkedBlockingQueue<JSONObject>()
            var leased = false
            try {
                leased = Chat2ApiWebViewLease.acquire(requestId)
                if (!leased) { error(socket, 409, "doubao_webview_login_active"); return }
                if (!restoreAccount(restore, request.optString("sessionId"))) {
                    error(socket, 403, "doubao_webview_identity"); return
                }
                pending[requestId] = queue
                val latch = CountDownLatch(1)
                var prepared = false
                mainHandler.post {
                    try { ensurePage(restore.getJSONObject("nodeProfile"), bootstrapScript); prepared = true }
                    catch (_: Exception) { /* 能力不支持时向调用方返回错误，不崩溃隔离进程。 */ }
                    finally { latch.countDown() }
                }
                if (!latch.await(15, TimeUnit.SECONDS) || !prepared || !pageLoaded.await(30, TimeUnit.SECONDS)) {
                    error(socket, 503, "doubao_webview_page")
                    return
                }
                // Cookie只交给系统API；页面业务脚本由已鉴权的Node生成，不再在Kotlin拼接另一套逻辑。
                val script = executeScript
                mainHandler.post { webView?.evaluateJavascript(script, null) }
                val output = socket.getOutputStream()
                output.write("HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
                output.flush()
                var signaturePrepared = false
                val deadline = System.currentTimeMillis() + 180_000
                while (System.currentTimeMillis() < deadline) {
                    val packet = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue
                    if (packet.optString("type") == "prepared") {
                        signaturePrepared = true
                        // 平台API的结果覆盖网页同名字段，不向页面暴露HttpOnly Cookie。
                        packet.put("platformCookie", CookieManager.getInstance().getCookie("https://www.doubao.com/chat/").orEmpty())
                    }
                    if (packet.optString("type") == "end" && closeAfterPrepare) {
                        if (!signaturePrepared || !closePreparedPage()) {
                            output.write((JSONObject().put("type", "error").put("code", "page_close_failed").toString() + "\n")
                                .toByteArray(Charsets.UTF_8))
                            output.flush()
                            return
                        }
                        packet.put("webViewClosed", true)
                    }
                    output.write((packet.toString() + "\n").toByteArray(Charsets.UTF_8))
                    output.flush()
                    if (packet.optString("type") in setOf("end", "error")) return
                }
                output.write((JSONObject().put("type", "error").put("code", "timeout").toString() + "\n")
                    .toByteArray(Charsets.UTF_8))
            } finally {
                pending.remove(requestId)
                // Socket断开、超时和正常结束均中止该请求，禁止旧网页请求继续占用账号上下文。
                mainHandler.post { webView?.evaluateJavascript(
                    "window.__aascDoubaoAborts?.[${JSONObject.quote(requestId)}]?.abort()", null) }
                if (leased) Chat2ApiWebViewLease.release(requestId)
                accountLock.unlock()
            }
        } catch (_: Exception) { /* 本机请求断开或网页失败时，由 Node 的截止时间收敛。 */ }
    }

}
