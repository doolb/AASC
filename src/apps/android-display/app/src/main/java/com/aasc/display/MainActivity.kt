package com.aasc.display

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.SslErrorHandler
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    companion object {
        private const val EXTRA_SERVER_URL = "server_url"
    }

    private lateinit var configBar: View
    private lateinit var serverInput: EditText
    private lateinit var webContainer: FrameLayout
    private lateinit var controlToggleButton: Button
    private var webView: DisplayWebView? = null
    private var controlWebView: DisplayWebView? = null
    private var offlineMode = false
    private var offlineDisplayRetryCount = 0
    // 整个 APK 只维护一个原生音频焦点；网页媒体不按 TTS/视频拆分申请焦点。
    private val audioFocusController by lazy {
        AudioFocusController(this) { change ->
            runOnUiThread {
                webView?.evaluateJavascript(
                    "window.onNativeAudioFocusChanged && window.onNativeAudioFocusChanged($change);",
                    null
                )
            }
        }
    }

    private val REQ_AUDIO_PERMISSION = 1001
    private val REQ_NOTIFICATION_PERMISSION = 1002
    private val REQ_STORAGE_PERMISSION = 1003
    private val REQ_CAMERA_PERMISSION = 1004
    private var startupContinued = false
    private val maxOfflineDisplayRetries = 20

    private fun requestAudioPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 23 &&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_AUDIO_PERMISSION)
        }
    }

    private fun requestCameraPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 23 &&
            checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), REQ_CAMERA_PERMISSION)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATION_PERMISSION)
        }
    }

    /**
     * 只在 Android 9/API 28 及以下申请旧版共享存储权限；Android 10+ 不申请特殊的全盘权限。
     * 权限检查完成后再进入统一启动流程，避免在同一生命周期内并发弹出多个权限框。
     */
    private fun continueStartupAfterStoragePermission() {
        val missingPermissions = SharedStorageAccess.missingPermissions(Build.VERSION.SDK_INT) { permission ->
            ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
        }
        if (missingPermissions.isNotEmpty()) {
            requestPermissions(missingPermissions, REQ_STORAGE_PERMISSION)
            return
        }
        continueStartup()
    }

    /**
     * 存储权限允许或拒绝后都继续显示端启动，拒绝只影响共享存储媒体库请求。
     */
    private fun continueStartup() {
        if (startupContinued) return
        startupContinued = true

        if (offlineMode || serverInput.text.toString().trim().isNotEmpty()) {
            connect()
        }

        // APK 启动即申请全局焦点；后续视频、TTS 和普通音频共用，不在网页重复申请。
        try {
            if (!audioFocusController.request()) {
                android.util.Log.w("MainActivity", "启动时申请原生音频焦点未获授权")
            }
        } catch (error: Exception) {
            android.util.Log.w("MainActivity", "启动时申请原生音频焦点失败: ${error.message}")
        }
        requestAudioPermissionIfNeeded()
        requestCameraPermissionIfNeeded()
        requestNotificationPermissionIfNeeded()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            REQ_STORAGE_PERMISSION -> {
                val storageGranted = SharedStorageAccess.arePermissionsGranted(Build.VERSION.SDK_INT) { permission ->
                    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
                }
                if (!storageGranted) {
                    Toast.makeText(
                        this,
                        getString(R.string.shared_storage_permission_denied),
                        Toast.LENGTH_LONG
                    ).show()
                }
                continueStartup()
            }
            REQ_AUDIO_PERMISSION -> if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                // 授权成功即重载页面，让 display.html 的 getUserMedia 能力探测通过
                webView?.reload()
            }
            REQ_CAMERA_PERMISSION -> if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                // 摄像头授权后重载页面，让控制端收到最新的 cameraCapture 能力。
                webView?.reload()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // 启动即全屏（不等连接）；系统栏弹出时自动收回
        hideSystemUi()
        window.decorView.setOnSystemUiVisibilityChangeListener { hideSystemUi() }

        configBar = findViewById(R.id.configBar)
        serverInput = findViewById(R.id.serverInput)
        webContainer = findViewById(R.id.webContainer)
        controlToggleButton = findViewById(R.id.controlToggleButton)
        val connectBtn = findViewById<Button>(R.id.connectBtn)
        offlineMode = resources.getBoolean(R.bool.aasc_offline_mode)

        val saved = getSharedPreferences("aasc_display", MODE_PRIVATE).getString("server_url", "")
        val selectedServerUrl = ServerConfig.chooseUrl(
            intent?.getStringExtra(EXTRA_SERVER_URL),
            saved,
            offlineMode
        )
        serverInput.setText(selectedServerUrl)
        connectBtn.setOnClickListener { connect() }
        serverInput.setOnEditorActionListener { _, _, _ -> connect(); true }
        controlToggleButton.setOnClickListener { toggleControlPage() }

        // 先完成共享存储权限流程，避免存储和录音权限授权框并发出现；拒绝后仍继续连接显示端。
        continueStartupAfterStoragePermission()
    }

    override fun onDestroy() {
        audioFocusController.abandon()
        super.onDestroy()
    }

    // singleTask Activity 被部署脚本再次启动时不会重新执行 onCreate，需要在新 Intent 中恢复配置。
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        val injectedServerUrl = intent?.getStringExtra(EXTRA_SERVER_URL)?.trim().orEmpty()
        if (injectedServerUrl.isEmpty()) return
        serverInput.setText(injectedServerUrl)
        connect()
    }

    // 焦点回归时重贴全屏（沉浸式在交互后系统栏可能重新出现）。
    // 仅请求 WebView 非破坏性重绘，不切换可见性；避免外部应用抢占焦点后重建视频
    // Surface/SurfaceTexture，导致视频画面停止而音频仍继续播放。
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hideSystemUi()
            webView?.postInvalidate()
            controlWebView?.postInvalidate()
        }
    }

    private fun connect() {
        val input = serverInput.text.toString().trim()
        if (input.isEmpty()) {
            Toast.makeText(this, "请输入服务器地址", Toast.LENGTH_SHORT).show()
            return
        }
        val mainServerUrl = ServerConfig.baseUrl(input)
        if (mainServerUrl.isEmpty()) {
            Toast.makeText(this, "主服务器地址无效", Toast.LENGTH_SHORT).show()
            return
        }
        // 普通 APK 的 Node.js 是子服务器；离线 APK 的 Node.js 是本机 main 服务。
        val serviceIntent = Intent(this, NodeServerService::class.java)
            .putExtra(NodeServerService.EXTRA_MAIN_SERVER_URL, mainServerUrl)
            .putExtra(NodeServerService.EXTRA_OFFLINE_MODE, offlineMode)
        ContextCompat.startForegroundService(this, serviceIntent)

        val displayPath = ServerConfig.pageUrl(mainServerUrl)
        // 时间戳参数强制绕过 WebView HTTP 缓存（display.html 更新后 APK 重启即加载最新版）
        val url = timestampedUrl(displayPath)
        getSharedPreferences("aasc_display", MODE_PRIVATE).edit().putString("server_url", mainServerUrl).apply()

        hideSystemUi()
        configBar.visibility = View.GONE
        offlineDisplayRetryCount = 0
        controlToggleButton.visibility = if (offlineMode) View.VISIBLE else View.GONE
        controlToggleButton.text = getString(R.string.control_page)
        if (webView == null) {
            setupWebView(url, mainServerUrl)
        } else {
            webView?.loadUrl(url)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(url: String, baseUrl: String) {
        val wv = DisplayWebView(this)
        val bridge = NativeBridge(wv, audioFocusController)
        bridge.updateServerOrigin(url)
        wv.addJavascriptInterface(bridge, "NativeDisplay")
        wv.webViewClient = createWebViewClient(bridge, baseUrl, true)
        // 控制按钮由 XML 作为容器的顶层子项加入；WebView 从 index=0 插入，确保按钮永远在最上层。
        webContainer.addView(wv, 0)
        webView = wv
        wv.loadUrl(url)

        val control = DisplayWebView(this)
        control.visibility = View.GONE
        control.webViewClient = createWebViewClient(null, baseUrl, false)
        webContainer.addView(control, 0)
        controlWebView = control
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun toggleControlPage() {
        val control = controlWebView ?: return
        if (control.visibility == View.VISIBLE) {
            control.visibility = View.GONE
            controlToggleButton.text = getString(R.string.control_page)
            return
        }
        control.visibility = View.VISIBLE
        controlToggleButton.text = getString(R.string.hide_control_page)
        if (control.url.isNullOrBlank()) {
            val mainServerUrl = ServerConfig.baseUrl(serverInput.text.toString())
            control.loadUrl(timestampedUrl(ServerConfig.controlPageUrl(mainServerUrl)))
        }
    }

    private fun createWebViewClient(
        bridge: NativeBridge?,
        baseUrl: String,
        retryOfflinePage: Boolean
    ): WebViewClient {
        return object : WebViewClient() {
            // WebViewClient 回调运行在主线程，在这里缓存 URL，供 JavaScript bridge 线程安全读取。
            override fun onPageStarted(view: WebView, pageUrl: String, favicon: android.graphics.Bitmap?) {
                bridge?.updateServerOrigin(pageUrl)
                super.onPageStarted(view, pageUrl, favicon)
            }

            override fun onPageFinished(view: WebView, pageUrl: String) {
                bridge?.updateServerOrigin(pageUrl)
                if (retryOfflinePage) offlineDisplayRetryCount = 0
                super.onPageFinished(view, pageUrl)
            }

            override fun onReceivedError(
                view: WebView,
                request: android.webkit.WebResourceRequest,
                error: android.webkit.WebResourceError
            ) {
                if (retryOfflinePage && request.isForMainFrame) {
                    scheduleOfflineDisplayRetry(view, baseUrl)
                }
                super.onReceivedError(view, request, error)
            }

            // Network Security Config 已绑定构建时主服务器证书；未知证书或主机名不匹配时必须拒绝。
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
                android.util.Log.e(
                    "MainActivity",
                    "WebView TLS 证书校验失败: url=${error.url}, primaryError=${error.primaryError}"
                )
                Toast.makeText(this@MainActivity, getString(R.string.ssl_error), Toast.LENGTH_LONG).show()
                handler.cancel()
            }
        }
    }

    private fun scheduleOfflineDisplayRetry(view: WebView, baseUrl: String) {
        if (!offlineMode || offlineDisplayRetryCount >= maxOfflineDisplayRetries) return
        offlineDisplayRetryCount += 1
        view.postDelayed({
            if (view === webView && view.visibility == View.VISIBLE) {
                view.loadUrl(timestampedUrl(ServerConfig.pageUrl(baseUrl)))
            }
        }, 1_000L)
    }

    private fun timestampedUrl(url: String): String {
        return url + (if (url.contains("?")) "&" else "?") + "v=" + System.currentTimeMillis()
    }

    private fun hideSystemUi() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.hide(WindowInsets.Type.systemBars())
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (controlWebView?.visibility == View.VISIBLE) {
            controlWebView?.visibility = View.GONE
            controlToggleButton.text = getString(R.string.control_page)
            return
        }
        // 后退键回配置页（重新输入服务器地址）
        webView?.visibility = View.GONE
        controlWebView?.visibility = View.GONE
        controlToggleButton.visibility = View.GONE
        configBar.visibility = View.VISIBLE
    }
}
