package com.aasc.display

import android.annotation.SuppressLint
import android.app.Service
import android.content.Intent
import android.content.MutableContextWrapper
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** 网页媒体专用进程，仅接受同机随机令牌；所有 WebView 操作在主线程执行。 */
class BrowserMediaWebViewService : Service() {
    companion object {
        const val EXTRA_TOKEN = "browser_media_token"
        const val PORT = 19093
        private var initialized = false
        @Synchronized internal fun initializeDataDirectory() {
            if (!initialized && Build.VERSION.SDK_INT >= 28) {
                WebView.setDataDirectorySuffix("aasc_browser_media")
                initialized = true
            }
        }
    }
    private data class Page(val view: WebView, val defaultUserAgent: String, var origin: String = "", var loaded: CountDownLatch = CountDownLatch(1),
        @Volatile var status: Int = 200, @Volatile var failed: Boolean = false)
    private val pages = ConcurrentHashMap<String, Page>()
    private val callbacks = ConcurrentHashMap<String, (JSONObject) -> Unit>()
    private val handler = Handler(Looper.getMainLooper())
    private val workers = Executors.newCachedThreadPool()
    private var listener: ServerSocket? = null
    private var token = ""
    private val binder = Binder()

    override fun onCreate() { initializeDataDirectory(); super.onCreate() }
    override fun onBind(intent: Intent?): IBinder {
        val secret = intent?.getStringExtra(EXTRA_TOKEN).orEmpty()
        require(secret.length >= 32)
        if (listener == null) {
            token = secret
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
        listener?.close(); listener = null
        handler.post { pages.values.forEach { destroy(it) }; pages.clear() }
        callbacks.clear(); workers.shutdownNow(); super.onDestroy()
    }
    private fun origin(raw: String): String {
        val uri = URI(raw)
        require(uri.scheme == "https" && uri.host != null && uri.rawUserInfo == null && uri.port in -1..65535)
        return "https://${uri.host.lowercase()}${if (uri.port == -1 || uri.port == 443) "" else ":${uri.port}"}"
    }
    private fun <T> onMain(action: () -> T): T {
        val done = CountDownLatch(1)
        var result: Result<T>? = null
        handler.post { try { result = runCatching(action) } finally { done.countDown() } }
        check(done.await(10, TimeUnit.SECONDS)) { "网页操作超时" }
        return result!!.getOrThrow()
    }
    @SuppressLint("SetJavaScriptEnabled")
    private fun create(id: String) {
        require(id.matches(Regex("[a-f0-9]{32}")))
        check(pages.size < 4 && !pages.containsKey(id))
        onMain {
            val view = WebView(MutableContextWrapper(this))
            val page = Page(view, view.settings.userAgentString)
            view.settings.javaScriptEnabled = true
            view.settings.domStorageEnabled = true
            view.addJavascriptInterface(object {
                @JavascriptInterface fun complete(requestId: String, raw: String) {
                    if (raw.length > 3 * 1024 * 1024) return
                    try { callbacks.remove(requestId)?.invoke(JSONObject(raw)) } catch (_: Exception) { }
                }
            }, "AASCBrowserMedia")
            view.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.isForMainFrame && try { origin(request.url.toString()) != page.origin } catch (_: Exception) { true }
                override fun onPageFinished(view: WebView, url: String) {
                    if (try { origin(url) == page.origin } catch (_: Exception) { false }) page.loaded.countDown()
                }
                override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                    if (request.isForMainFrame) page.status = response.statusCode
                }
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) { page.failed = true; page.loaded.countDown() }
                }
            }
            pages[id] = page
            select(page)
        }
    }
    private fun select(page: Page) {
        BrowserMediaPageDisplay.show(page.view)
    }
    private fun destroy(page: Page) {
        if (BrowserMediaPageDisplay.current === page.view) BrowserMediaPageDisplay.show(null)
        (page.view.parent as? ViewGroup)?.removeView(page.view)
        (page.view.context as? MutableContextWrapper)?.baseContext = applicationContext
        page.view.destroy()
    }
    private fun command(input: JSONObject): Any {
        val operation = input.getString("operation")
        val id = input.getString("id")
        if (operation == "reset") {
            onMain { pages.values.forEach { destroy(it) }; pages.clear() }
            return true
        }
        if (operation == "create") { create(id); return true }
        val page = pages[id] ?: error("网页会话不存在")
        when (operation) {
            "navigate" -> {
                val url = input.getString("url")
                val expected = origin(url)
                onMain {
                    check(page.origin.isEmpty() || page.origin == expected) { "禁止跨站导航" }
                    // 精选卡片使用桌面布局；保留当前 WebView 的 Chromium 版本以避免伪造不兼容版本。
                    page.view.settings.userAgentString = BrowserMediaUserAgent.forOrigin(expected, page.defaultUserAgent)
                    select(page); page.origin = expected; page.status = 200; page.failed = false
                    page.loaded = CountDownLatch(1); page.view.loadUrl(url)
                }
                check(page.loaded.await(30, TimeUnit.SECONDS)) { "网页加载超时" }
                check(!page.failed) { "网页加载失败" }
                return page.status
            }
            "select" -> { onMain { select(page) }; return true }
            "close" -> { pages.remove(id); onMain { destroy(page) }; return true }
            "evaluate" -> {
                val script = input.getString("script")
                require(script.length <= 300 * 1024)
                val idempotency = UUID.randomUUID().toString()
                val ready = CountDownLatch(1)
                var response: JSONObject? = null
                callbacks[idempotency] = { response = it; ready.countDown() }
                try {
                    val escapedId = JSONObject.quote(idempotency)
                    val wrapped = "Promise.resolve().then(()=>($script)).then(v=>AASCBrowserMedia.complete($escapedId,JSON.stringify({ok:true,value:v}))).catch(e=>AASCBrowserMedia.complete($escapedId,JSON.stringify({ok:false,error:String(e)})))"
                    onMain { select(page); check(origin(page.view.url ?: "") == page.origin); page.view.evaluateJavascript(wrapped, null) }
                    check(ready.await(30, TimeUnit.SECONDS)) { "网页执行超时" }
                    val result = response ?: error("网页响应无效")
                    check(result.optBoolean("ok")) { result.optString("error", "网页执行失败") }
                    return result.opt("value") ?: JSONObject.NULL
                } finally { callbacks.remove(idempotency) }
            }
            else -> error("未知操作")
        }
    }
    private fun handleSocket(socket: Socket) {
        socket.soTimeout = 45000
        try {
            val stream = socket.getInputStream()
            val bytes = ByteArrayOutputStream()
            var tail = 0
            while (bytes.size() < 16384 && tail != 0x0d0a0d0a) {
                val next = stream.read(); check(next >= 0); bytes.write(next)
                tail = (tail shl 8) or next
            }
            check(tail == 0x0d0a0d0a)
            val lines = bytes.toString("US-ASCII").split("\r\n")
            require(lines.first() == "POST /command HTTP/1.1")
            val headers = mutableMapOf<String, String>()
            lines.drop(1).filter { it.isNotEmpty() }.forEach { line ->
                val index = line.indexOf(':'); require(index > 0)
                val key = line.substring(0, index).lowercase(); require(!headers.containsKey(key))
                headers[key] = line.substring(index + 1).trim()
            }
            require(MessageDigest.isEqual(headers["authorization"].orEmpty().toByteArray(), "Bearer $token".toByteArray()))
            require(!headers.containsKey("transfer-encoding"))
            val length = headers["content-length"]?.toInt() ?: error("缺少请求长度")
            require(length in 1..(400 * 1024))
            val body = ByteArray(length); var offset = 0
            while (offset < length) { val count = stream.read(body, offset, length - offset); check(count > 0); offset += count }
            respond(socket, 200, JSONObject().put("ok", true).put("value", command(JSONObject(String(body, Charsets.UTF_8)))))
        } catch (_: Exception) {
            runCatching { respond(socket, 400, JSONObject().put("ok", false).put("error", "网页操作失败，请检查页面或重试")) }
        }
    }
    private fun respond(socket: Socket, status: Int, data: JSONObject) {
        val body = data.toString().toByteArray(Charsets.UTF_8)
        socket.getOutputStream().write("HTTP/1.1 $status OK\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
        socket.getOutputStream().write(body)
    }
}
