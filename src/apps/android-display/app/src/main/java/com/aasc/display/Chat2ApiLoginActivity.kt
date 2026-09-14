package com.aasc.display

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.content.Intent
import android.graphics.Color
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * Chat2API 登录页运行在独立进程，避免 Provider Cookie/LocalStorage 与显示页或控制页共享。
 * 登录成功只返回一次性 Activity Result，由控制页提交给服务端验证；Activity 本身不保存账号。
 */
class Chat2ApiLoginActivity : Activity() {

    companion object {
        const val EXTRA_SESSION_JSON = "chat2api_session_json"
        const val EXTRA_SUCCESS = "chat2api_success"
        const val EXTRA_STATE = "chat2api_state"
        const val EXTRA_PROVIDER_ID = "chat2api_provider_id"
        const val EXTRA_CREDENTIALS_JSON = "chat2api_credentials_json"
        const val EXTRA_ERROR = "chat2api_error"
    }

    private var authWebView: Chat2ApiAuthWebView? = null
    private var session: JSONObject? = null
    private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        // 独立进程中首次创建 WebView 前必须先设置 data directory suffix。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) WebView.setDataDirectorySuffix("aasc_chat2api_login")
        super.onCreate(savedInstanceState)

        val sessionJson = intent?.getStringExtra(EXTRA_SESSION_JSON)
        val parsed = try { sessionJson?.let(::JSONObject) } catch (_: Exception) { null }
        val profileJson = parsed?.optJSONObject("captureProfile")
        if (parsed == null || profileJson == null) {
            finishWithError("Android 登录会话缺少捕获配置")
            return
        }
        session = parsed
        val profile = Chat2ApiCaptureProfile.fromJson(profileJson)
        val loginUrl = parsed.optString("loginUrl").trim()
        if (loginUrl.isEmpty() || profile.allowedOrigins.isEmpty()) {
            finishWithError("Android 登录地址或允许来源无效")
            return
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(24, 18, 24, 18)
        }
        val title = TextView(this).apply {
            text = "${parsed.optString("providerName", parsed.optString("providerId"))} 登录"
            textSize = 18f
            setTextColor(Color.BLACK)
        }
        val cancel = Button(this).apply {
            text = "取消"
            setOnClickListener { finishWithError("用户取消登录") }
        }
        header.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(cancel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(header)

        val webView = Chat2ApiAuthWebView(this, profile) { credentials -> finishWithSuccess(credentials) }
        authWebView = webView
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        webView.start(loginUrl)
    }

    private fun finishWithSuccess(credentials: Map<String, String>) {
        if (finished) return
        val current = session
        if (current == null) {
            finishWithError("Android 登录会话已失效")
            return
        }
        finished = true
        val result = Intent()
            .putExtra(EXTRA_SUCCESS, true)
            .putExtra(EXTRA_STATE, current.optString("state"))
            .putExtra(EXTRA_PROVIDER_ID, current.optString("providerId"))
            .putExtra(EXTRA_CREDENTIALS_JSON, JSONObject(credentials).toString())
        setResult(RESULT_OK, result)
        finish()
    }

    private fun finishWithError(message: String) {
        if (finished) return
        finished = true
        setResult(Activity.RESULT_CANCELED, Intent().putExtra(EXTRA_SUCCESS, false).putExtra(EXTRA_ERROR, message))
        finish()
    }

    override fun onDestroy() {
        authWebView?.stopCapture()
        authWebView?.destroy()
        authWebView = null
        super.onDestroy()
    }
}
