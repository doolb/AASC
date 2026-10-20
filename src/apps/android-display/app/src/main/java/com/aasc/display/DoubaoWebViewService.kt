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
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

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
    private var webView: WebView? = null
    private var pageLoaded = CountDownLatch(1)

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
        webView?.destroy()
        webView = null
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
    private fun ensurePage(): WebView {
        webView?.let { return it }
        val view = WebView(this)
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
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
        webView = view
        pageLoaded = CountDownLatch(1)
        view.loadUrl("https://www.doubao.com/chat/")
        return view
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
            if (requestLine != "POST /fetch HTTP/1.1") {
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
            val url = java.net.URI(request.optString("url"))
            val allowed = setOf("/chat/completion", "/samantha/chat/completion",
                "/samantha/pages/upload_image", "/alice/message/get_file_url",
                "/alice/resource/prepare_upload", "/top/v1")
            if (url.scheme != "https" || url.host != "www.doubao.com" || !allowed.contains(url.path)
                || !validSession(request.optString("sessionId"))) {
                error(socket, 403, "doubao_webview_identity")
                return
            }
            val requestId = UUID.randomUUID().toString()
            val queue = LinkedBlockingQueue<JSONObject>()
            pending[requestId] = queue
            try {
                val latch = CountDownLatch(1)
                mainHandler.post { ensurePage(); latch.countDown() }
                if (!latch.await(15, TimeUnit.SECONDS) || !pageLoaded.await(30, TimeUnit.SECONDS)) {
                    error(socket, 503, "doubao_webview_page")
                    return
                }
                request.put("requestId", requestId)
                val script = PAGE_FETCH_SCRIPT.replace("__INPUT__", JSONObject.quote(request.toString()))
                mainHandler.post { webView?.evaluateJavascript(script, null) }
                val output = socket.getOutputStream()
                output.write("HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
                output.flush()
                val deadline = System.currentTimeMillis() + 180_000
                while (System.currentTimeMillis() < deadline) {
                    val packet = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue
                    output.write((packet.toString() + "\n").toByteArray(Charsets.UTF_8))
                    output.flush()
                    if (packet.optString("type") in setOf("end", "error")) return
                }
                output.write((JSONObject().put("type", "error").put("code", "timeout").toString() + "\n")
                    .toByteArray(Charsets.UTF_8))
            } finally { pending.remove(requestId) }
        } catch (_: Exception) { /* 本机请求断开或网页失败时，由 Node 的截止时间收敛。 */ }
    }

    private val PAGE_FETCH_SCRIPT = """
        (async input => {
          const arg = JSON.parse(input);
          const report = packet => AASCDoubaoRuntime.onPacket(JSON.stringify({requestId: arg.requestId, ...packet}));
          try {
            if (location.origin !== 'https://www.doubao.com') throw Error('invalid_origin');
            const url = new URL(arg.url);
            const allowed = ['/chat/completion','/samantha/chat/completion','/samantha/pages/upload_image',
              '/alice/message/get_file_url','/alice/resource/prepare_upload','/top/v1'];
            if (url.origin !== location.origin || !allowed.includes(url.pathname)) throw Error('invalid_url');
            url.searchParams.delete('a_bogus'); url.searchParams.delete('X-Bogus'); url.searchParams.sort();
            if (!['/samantha/chat/completion','/top/v1'].includes(url.pathname)) {
              const signed = await window.bdms?.frontierSign?.(url.searchParams.toString());
              const fields = typeof signed === 'string' ? {'X-Bogus': signed} : signed;
              if (!fields || typeof fields !== 'object') throw Error('signature_unavailable');
              for (const [key,value] of Object.entries(fields)) {
                if (['X-Bogus','a_bogus'].includes(key) && typeof value === 'string') url.searchParams.set(key,value);
              }
            }
            const headers = {'agw-js-conv':'str', ...(arg.customHeaders || {})};
            const csrf = document.cookie.match(/(?:^|;\s*)passport_csrf_token=([^;]+)/)?.[1];
            if (csrf) headers['x-tt-passport-csrf-token'] = csrf;
            let body;
            if (arg.bodyType === 'image-upload') {
              const raw = atob(arg.payload.base64), bytes = new Uint8Array(raw.length);
              for (let i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
              body = new FormData();
              body.append('data',new Blob([bytes],{type:'image/'+arg.payload.extension}),arg.payload.filename);
              body.append('file_type',arg.payload.extension);
            } else if (arg.bodyType === 'json') {
              headers['Content-Type']='application/json'; body=JSON.stringify(arg.payload);
            } else if (arg.bodyType !== 'none') throw Error('body_type');
            const response = await fetch(url.pathname+url.search, {method:arg.method || 'POST',
              headers,body,credentials:'include',redirect:'error'});
            report({type:'response',status:response.status,headers:Object.fromEntries(response.headers.entries())});
            const maxBytes = Math.min(Math.max(Number(arg.maxBytes) || 8388608, 1), 33554432);
            let received = 0;
            const sendChunk = chunk => {
              received += chunk.length;
              if (received > maxBytes) throw Error('response_too_large');
              report({type:'chunk',chunk});
            };
            const reader = response.body?.getReader();
            if (reader) {
              const decoder = new TextDecoder();
              while (true) { const next=await reader.read(); if(next.done) break;
                const chunk=decoder.decode(next.value,{stream:true}); if(chunk) sendChunk(chunk); }
              const rest=decoder.decode(); if(rest) sendChunk(rest);
            } else sendChunk(await response.text());
            report({type:'end'});
          } catch (_) { report({type:'error'}); }
        })(__INPUT__)
    """.trimIndent()
}
