package com.aasc.display

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Chat2API 登录页运行在独立进程，避免 Provider Cookie/LocalStorage 与显示页或控制页共享。
 * capture 模式只返回一次性凭据；account-web 模式只在原生内存恢复账号网页状态，不提交或更新账号。
 */
class Chat2ApiLoginActivity : Activity() {

    companion object {
        const val EXTRA_SESSION_JSON = "chat2api_session_json"
        const val EXTRA_MODE = "chat2api_mode"
        const val MODE_ACCOUNT_WEB = "account-web"
        const val EXTRA_SUCCESS = "chat2api_success"
        const val EXTRA_STATE = "chat2api_state"
        const val EXTRA_PROVIDER_ID = "chat2api_provider_id"
        const val EXTRA_CREDENTIALS_JSON = "chat2api_credentials_json"
        const val EXTRA_ERROR = "chat2api_error"
    }

    private data class AccountWebState(
        val loginUrl: String,
        val profile: Chat2ApiCaptureProfile,
        val cookies: List<Chat2ApiRestoreCookie>,
        val localStorage: List<Chat2ApiRestoreLocalStorage>
    )

    private var authWebView: Chat2ApiAuthWebView? = null
    private var session: JSONObject? = null
    private var statusText: TextView? = null
    private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) WebView.setDataDirectorySuffix("aasc_chat2api_login")
        super.onCreate(savedInstanceState)

        val sessionJson = intent?.getStringExtra(EXTRA_SESSION_JSON)
        val parsed = try { sessionJson?.let(::JSONObject) } catch (_: Exception) { null }
        if (parsed == null) {
            finishWithError("Android 登录会话缺少配置")
            return
        }
        session = parsed
        if (parsed.optString(EXTRA_MODE).trim() == MODE_ACCOUNT_WEB || parsed.optString("mode").trim() == MODE_ACCOUNT_WEB) {
            setupAccountWebShell(parsed)
        } else {
            setupCaptureMode(parsed)
        }
    }

    private fun setupCaptureMode(parsed: JSONObject) {
        val profileJson = parsed.optJSONObject("captureProfile")
        if (profileJson == null) {
            finishWithError("Android 登录会话缺少捕获配置")
            return
        }
        val profile = Chat2ApiCaptureProfile.fromJson(profileJson)
        val loginUrl = parsed.optString("loginUrl").trim()
        if (loginUrl.isEmpty() || profile.allowedOrigins.isEmpty()) {
            finishWithError("Android 登录地址或允许来源无效")
            return
        }
        val root = createRootLayout()
        val header = createHeader("${parsed.optString("providerName", parsed.optString("providerId"))} 登录")
        val webView = Chat2ApiAuthWebView(this, profile) { credentials -> finishWithSuccess(credentials) }
        authWebView = webView
        val complete = Button(this).apply {
            text = "完成"
            setOnClickListener {
                webView.completeCapture { message ->
                    Toast.makeText(this@Chat2ApiLoginActivity, message, Toast.LENGTH_SHORT).show()
                }
            }
        }
        val cancel = Button(this).apply {
            text = "取消"
            setOnClickListener { finishWithError("用户取消登录") }
        }
        header.addView(complete, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        header.addView(cancel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(header)
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        webView.start(loginUrl)
    }

    private fun setupAccountWebShell(parsed: JSONObject) {
        val root = createRootLayout()
        val header = createHeader("${parsed.optString("providerName", parsed.optString("providerId"))} 外部网页")
        val cancel = Button(this).apply {
            text = "关闭"
            setOnClickListener { finishWithError("用户关闭外部网页") }
        }
        header.addView(cancel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(header)
        statusText = TextView(this).apply {
            text = "正在准备隔离网页…"
            setTextColor(Color.DKGRAY)
            setPadding(24, 8, 24, 8)
        }
        root.addView(statusText, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val webContainer = FrameLayout(this)
        root.addView(webContainer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        Thread {
            try {
                val state = consumeAccountWebSession(parsed)
                runOnUiThread {
                    if (finished || isFinishing) return@runOnUiThread
                    val webView = Chat2ApiAuthWebView(this, state.profile) { }
                    authWebView = webView
                    webContainer.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                    webView.startRestore(state.loginUrl, state.cookies, state.localStorage) { message ->
                        statusText?.text = message
                    }
                }
            } catch (error: Exception) {
                runOnUiThread { finishWithError("打开外部网页失败：${error.message ?: "会话不可用"}") }
            }
        }.start()
    }

    private fun createRootLayout(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(Color.WHITE)
    }

    private fun createHeader(titleText: String): LinearLayout {
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(24, 18, 24, 18)
        }
        val title = TextView(this).apply {
            text = titleText
            textSize = 18f
            setTextColor(Color.BLACK)
        }
        header.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        return header
    }

    private fun consumeAccountWebSession(parsed: JSONObject): AccountWebState {
        val consumeUrl = parsed.optString("consumeUrl").trim()
        val sessionId = parsed.optString("sessionId").trim()
        if (consumeUrl.isEmpty() || sessionId.isEmpty()) throw IllegalArgumentException("网页会话缺少消费地址")
        val connection = (URL(consumeUrl).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 20_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Cache-Control", "no-store")
        }
        try {
            connection.outputStream.use { output ->
                output.write(JSONObject().put("sessionId", sessionId).toString().toByteArray(Charsets.UTF_8))
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val response = try { JSONObject(body) } catch (_: Exception) { JSONObject() }
            if (status !in 200..299) {
                val error = response.optJSONObject("error")?.optString("message")
                throw IllegalStateException(error?.takeIf { it.isNotBlank() } ?: "会话消费失败 ($status)")
            }
            return parseAccountWebState(response)
        } finally {
            connection.disconnect()
        }
    }

    private fun parseAccountWebState(response: JSONObject): AccountWebState {
        val loginUrl = response.optString("loginUrl").trim()
        if (loginUrl.isEmpty()) throw IllegalStateException("网页会话缺少登录地址")
        val origins = response.optJSONArray("allowedOrigins").toStringList()
        val profile = Chat2ApiCaptureProfile(allowedOrigins = origins)
        val cookies = response.optJSONArray("cookieMappings").toRestoreCookies()
        val localStorage = response.optJSONArray("localStorageMappings").toRestoreLocalStorage()
        return AccountWebState(loginUrl, profile, cookies, localStorage)
    }

    private fun JSONArray?.toStringList(): List<String> {
        if (this == null) return emptyList()
        return (0 until length()).mapNotNull { optString(it).trim().takeIf(String::isNotEmpty) }
    }

    private fun JSONArray?.toRestoreCookies(): List<Chat2ApiRestoreCookie> {
        if (this == null) return emptyList()
        return (0 until length()).mapNotNull { index ->
            val item = optJSONObject(index) ?: return@mapNotNull null
            val origin = item.optString("origin").trim()
            val name = item.optString("name").trim()
            val value = item.optString("value")
            if (origin.isEmpty() || name.isEmpty() || value.isEmpty()) null else Chat2ApiRestoreCookie(origin, name, value)
        }
    }

    private fun JSONArray?.toRestoreLocalStorage(): List<Chat2ApiRestoreLocalStorage> {
        if (this == null) return emptyList()
        return (0 until length()).mapNotNull { index ->
            val item = optJSONObject(index) ?: return@mapNotNull null
            val origin = item.optString("origin").trim()
            val key = item.optString("key").trim()
            val value = item.optString("value")
            if (origin.isEmpty() || key.isEmpty() || value.isEmpty()) null else Chat2ApiRestoreLocalStorage(origin, key, value)
        }
    }

    private fun finishWithSuccess(credentials: Map<String, String>) {
        if (finished) return
        val current = session
        if (current == null) {
            finishWithError("Android 登录会话已失效")
            return
        }
        finished = true
        val result = android.content.Intent()
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
        setResult(Activity.RESULT_CANCELED, android.content.Intent().putExtra(EXTRA_SUCCESS, false).putExtra(EXTRA_ERROR, message))
        finish()
    }

    override fun onDestroy() {
        authWebView?.clearLoginData()
        authWebView?.destroy()
        authWebView = null
        statusText = null
        super.onDestroy()
    }
}
