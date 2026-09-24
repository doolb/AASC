package com.aasc.mmdartest

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.Uri
import java.io.ByteArrayInputStream
import java.util.Locale

/** 仅用于验证内置米娅 PMX、图片定位 AR、灯光和布料物理的独立测试 Activity。 */
class MainActivity : Activity() {
    companion object {
        private const val TAG = "MmdArTest"
        private const val CAMERA_PERMISSION_REQUEST = 501
        private const val LOCAL_HOST = "127.0.0.1"
    }

    private lateinit var webView: WebView
    private lateinit var assetServer: LocalAssetHttpServer
    private var localPort: Int = 0
    private var pendingCameraRequest: PermissionRequest? = null
    private var cameraPermissionDialogPending = false
    private var webPageLoaded = false
    private var cssSafeInsets = CssSafeInsets(0f, 0f, 0f, 0f)

    private data class CssSafeInsets(
        val top: Float,
        val right: Float,
        val bottom: Float,
        val left: Float
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        var startupStage = "初始化窗口"
        try {
            Log.i(TAG, "启动阶段：$startupStage")
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            window.statusBarColor = Color.rgb(17, 19, 24)
            window.navigationBarColor = Color.rgb(17, 19, 24)

            startupStage = "启动本地资源服务"
            Log.i(TAG, "启动阶段：$startupStage")
            assetServer = LocalAssetHttpServer(assets)
            localPort = assetServer.start()

            startupStage = "创建 WebView"
            Log.i(TAG, "启动阶段：$startupStage")
            createWebView()

            startupStage = "加载本地测试页面"
            Log.i(TAG, "启动阶段：$startupStage，地址=${localUrl("/")}")
            webView.loadUrl(localUrl("/"))
        } catch (error: Exception) {
            Log.e(TAG, "启动失败，阶段：$startupStage", error)
            showFatalError(startupStage, error)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || !::webView.isInitialized) return
        webView.post { applyImmersiveModeSafely("窗口获得焦点") }
    }

    private fun createWebView() {
        webView = WebView(this)
        webView.setBackgroundColor(Color.TRANSPARENT)
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.setOnTouchListener { view, event ->
            val isDiagnosticArea = event.x >= view.width * 0.55f && event.y <= view.height * 0.5f
            if (isDiagnosticArea && (event.actionMasked == android.view.MotionEvent.ACTION_DOWN
                    || event.actionMasked == android.view.MotionEvent.ACTION_UP)) {
                Log.d(
                    TAG,
                    "[touch-native] action=${event.actionMasked} local=${event.x},${event.y} " +
                        "raw=${event.rawX},${event.rawY} view=${view.width}x${view.height}"
                )
            }
            false
        }
        webView.setOnApplyWindowInsetsListener { _, insets ->
            updateCssSafeInsets(insets)
            insets
        }
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
        }
        WebView.setWebContentsDebuggingEnabled(false)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                webPageLoaded = false
            }

            override fun onPageFinished(view: WebView, url: String) {
                webPageLoaded = true
                applyCssSafeInsets()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return !isAllowedLocalUrl(request.url)
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (isAllowedLocalUrl(request.url)) return null
                return WebResourceResponse(
                    "text/plain",
                    "utf-8",
                    403,
                    "Forbidden",
                    mapOf("Cache-Control" to "no-store"),
                    ByteArrayInputStream("外部资源已禁用".toByteArray())
                )
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: android.webkit.WebResourceError
            ) {
                if (request.isForMainFrame) Log.e(TAG, "本地网页加载失败：${error.description}")
            }

            override fun onRenderProcessGone(
                view: WebView,
                detail: android.webkit.RenderProcessGoneDetail
            ): Boolean {
                val reason = if (detail.didCrash()) "WebView 渲染进程崩溃" else "WebView 渲染进程被系统回收"
                Log.e(TAG, reason)
                showFatalError("WebView 渲染进程", IllegalStateException(reason))
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { handleWebPermissionRequest(request) }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingCameraRequest === request) pendingCameraRequest = null
            }

            override fun onConsoleMessage(message: android.webkit.ConsoleMessage): Boolean {
                val level = when (message.messageLevel()) {
                    android.webkit.ConsoleMessage.MessageLevel.ERROR -> Log.ERROR
                    android.webkit.ConsoleMessage.MessageLevel.WARNING -> Log.WARN
                    else -> Log.DEBUG
                }
                Log.println(level, TAG, "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }
        setContentView(webView)
        webView.requestApplyInsets()
    }

    @Suppress("DEPRECATION")
    private fun updateCssSafeInsets(insets: WindowInsets) {
        val density = resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        val next = CssSafeInsets(
            top = maxOf(insets.systemWindowInsetTop, insets.stableInsetTop) / density,
            right = maxOf(insets.systemWindowInsetRight, insets.stableInsetRight) / density,
            bottom = maxOf(insets.systemWindowInsetBottom, insets.stableInsetBottom) / density,
            left = maxOf(insets.systemWindowInsetLeft, insets.stableInsetLeft) / density
        )
        if (next == cssSafeInsets) return

        cssSafeInsets = next
        Log.i(
            TAG,
            "WebView 安全 Insets（CSS px）：top=${formatCssPixels(next.top)}, " +
                "right=${formatCssPixels(next.right)}, bottom=${formatCssPixels(next.bottom)}, " +
                "left=${formatCssPixels(next.left)}"
        )
        if (webPageLoaded) webView.post { applyCssSafeInsets() }
    }

    private fun applyCssSafeInsets() {
        if (!::webView.isInitialized || !webPageLoaded) return
        val insets = cssSafeInsets
        val script = """
            (() => {
              const style = document.documentElement.style;
              style.setProperty('--mmd-ar-safe-inset-top', '${formatCssPixels(insets.top)}px');
              style.setProperty('--mmd-ar-safe-inset-right', '${formatCssPixels(insets.right)}px');
              style.setProperty('--mmd-ar-safe-inset-bottom', '${formatCssPixels(insets.bottom)}px');
              style.setProperty('--mmd-ar-safe-inset-left', '${formatCssPixels(insets.left)}px');
            })();
        """.trimIndent()
        webView.evaluateJavascript(script, null)
    }

    private fun formatCssPixels(value: Float): String = String.format(Locale.US, "%.2f", value)

    private fun handleWebPermissionRequest(request: PermissionRequest) {
        val requestedResources = request.resources.toSet()
        val onlyCamera = requestedResources.isNotEmpty()
            && requestedResources.all { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
        if (!isLocalOrigin(request.origin) || !onlyCamera) {
            request.deny()
            return
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            return
        }
        pendingCameraRequest?.deny()
        pendingCameraRequest = request
        cameraPermissionDialogPending = true
        requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST)
    }

    private fun isLocalOrigin(origin: Uri): Boolean =
        origin.scheme == "http" && origin.host == LOCAL_HOST && origin.port == localPort

    private fun isAllowedLocalUrl(uri: Uri): Boolean =
        uri.scheme == "http" && uri.host == LOCAL_HOST && uri.port == localPort

    private fun localUrl(path: String): String = "http://$LOCAL_HOST:$localPort$path"

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CAMERA_PERMISSION_REQUEST) return
        cameraPermissionDialogPending = false
        val request = pendingCameraRequest
        pendingCameraRequest = null
        if (request == null) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            && isLocalOrigin(request.origin)) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        } else {
            request.deny()
        }
    }

    override fun onPause() {
        if (::webView.isInitialized && !cameraPermissionDialogPending) {
            webView.evaluateJavascript("window.DisplayMmdAr?.stop?.()", null)
            webView.onPause()
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            try {
                webView.onResume()
            } catch (error: Exception) {
                Log.e(TAG, "恢复 WebView 失败", error)
                showFatalError("恢复 WebView", error)
                return
            }
        }
        if (hasWindowFocus()) applyImmersiveModeSafely("Activity 恢复")
    }

    override fun onDestroy() {
        pendingCameraRequest?.deny()
        pendingCameraRequest = null
        if (::webView.isInitialized) {
            webView.evaluateJavascript("window.DisplayMmdAr?.stop?.()", null)
            webView.stopLoading()
            webView.webChromeClient = null
            webView.webViewClient = WebViewClient()
            webView.removeAllViews()
            webView.destroy()
        }
        if (::assetServer.isInitialized) assetServer.close()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onDestroy()
    }

    private fun applyImmersiveModeSafely(trigger: String) {
        try {
            if (!enterImmersiveMode()) {
                Log.w(TAG, "$trigger 时 window.insetsController 为空，保留系统栏并继续运行")
                restoreSystemBars()
            }
        } catch (error: Exception) {
            // 沉浸式模式属于可选显示效果；厂商窗口 API 失败时恢复普通系统栏并继续运行。
            Log.w(TAG, "$trigger 时沉浸式显示不可用，保留系统栏并继续运行", error)
            restoreSystemBars()
        }
    }

    private fun enterImmersiveMode(): Boolean {
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val controller = window.insetsController ?: return false
            window.setDecorFitsSystemWindows(false)
            controller.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                )
        }
        return true
    }

    @Suppress("DEPRECATION")
    private fun restoreSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                window.insetsController?.show(
                    android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars()
                )
            } catch (error: Exception) {
                Log.w(TAG, "恢复系统栏可见状态失败", error)
            }
            try {
                window.setDecorFitsSystemWindows(true)
            } catch (error: Exception) {
                Log.w(TAG, "恢复窗口默认内容布局失败", error)
            }
        } else {
            try {
                window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
            } catch (error: Exception) {
                Log.w(TAG, "恢复旧版系统栏可见状态失败", error)
            }
        }
    }

    private fun showFatalError(stage: String, error: Throwable) {
        if (::assetServer.isInitialized) {
            try {
                assetServer.close()
            } catch (cleanupError: Exception) {
                Log.w(TAG, "关闭启动失败后的本地资源服务失败", cleanupError)
            }
        }

        val message = android.widget.TextView(this).apply {
            setBackgroundColor(Color.rgb(17, 19, 24))
            setTextColor(Color.WHITE)
            textSize = 16f
            setPadding(32, 32, 32, 32)
            setTextIsSelectable(true)
            text = "MMD AR 测试页启动失败\n阶段：$stage\n异常：${error.javaClass.simpleName}\n详情：${error.message ?: "无详细信息"}\n\n请截图此页面，或提供日志中的 MmdArTest 错误。"
        }
        val report = android.widget.ScrollView(this).apply {
            addView(message)
        }
        setContentView(report)
    }
}
