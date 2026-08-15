package com.aasc.display

import android.annotation.SuppressLint
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

class MainActivity : AppCompatActivity() {

    private lateinit var configBar: View
    private lateinit var serverInput: EditText
    private lateinit var webContainer: FrameLayout
    private var webView: DisplayWebView? = null
    private var trustedSsl = false

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
        val connectBtn = findViewById<Button>(R.id.connectBtn)

        val saved = getSharedPreferences("aasc_display", MODE_PRIVATE).getString("server_url", "")
        serverInput.setText(saved)
        connectBtn.setOnClickListener { connect() }
        serverInput.setOnEditorActionListener { _, _, _ -> connect(); true }

        if (!saved.isNullOrEmpty()) {
            connect()
        }
    }

    // 焦点回归时重贴全屏（沉浸式在交互后系统栏可能重新出现）
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    private fun connect() {
        val input = serverInput.text.toString().trim()
        if (input.isEmpty()) {
            Toast.makeText(this, "请输入服务器地址", Toast.LENGTH_SHORT).show()
            return
        }
        val base = if (input.startsWith("http://") || input.startsWith("https://")) input else "https://$input"
        val displayPath = if (base.endsWith("/display")) base else "$base/display"
        // 时间戳参数强制绕过 WebView HTTP 缓存（display.html 更新后 APK 重启即加载最新版）
        val url = displayPath + (if (displayPath.contains("?")) "&" else "?") + "v=" + System.currentTimeMillis()
        getSharedPreferences("aasc_display", MODE_PRIVATE).edit().putString("server_url", input).apply()

        hideSystemUi()
        configBar.visibility = View.GONE
        if (webView == null) {
            setupWebView(url)
        } else {
            webView?.loadUrl(url)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(url: String) {
        val wv = DisplayWebView(this)
        wv.addJavascriptInterface(NativeBridge(wv), "NativeDisplay")
        wv.webViewClient = object : WebViewClient() {
            // 自签名证书：本设备专属信任（首次提示，不持久化）
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
                if (!trustedSsl) {
                    trustedSsl = true
                    Toast.makeText(this@MainActivity, getString(R.string.ssl_warn), Toast.LENGTH_LONG).show()
                }
                handler.proceed()
            }
        }
        webContainer.addView(wv)
        webView = wv
        wv.loadUrl(url)
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
        // 后退键回配置页（重新输入服务器地址）
        webView?.visibility = View.GONE
        configBar.visibility = View.VISIBLE
    }
}
