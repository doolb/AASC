package com.aasc.display

import android.app.Activity
import android.content.Intent
import android.os.Looper
import android.webkit.JavascriptInterface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** 控制 WebView 的原生桥：只负责启动/关闭隔离登录 Activity，不读取或记录凭据。 */
class Chat2ApiNativeBridge(private val activity: Activity) {

    companion object {
        const val LOGIN_REQUEST_CODE = 1006
        const val ACCOUNT_WEB_REQUEST_CODE = 1007
    }

    @JavascriptInterface
    fun openChat2ApiLogin(sessionJson: String): Boolean {
        return openLoginActivity(sessionJson, LOGIN_REQUEST_CODE)
    }

    /**
     * 打开指定账号的隔离外部网页。sessionJson 只包含一次性 sessionId/consumeUrl，原生桥不读取或记录凭证。
     */
    @JavascriptInterface
    fun openChat2ApiAccountWeb(sessionJson: String): Boolean {
        return openLoginActivity(sessionJson, ACCOUNT_WEB_REQUEST_CODE)
    }

    private fun openLoginActivity(sessionJson: String, requestCode: Int): Boolean {
        if (sessionJson.isBlank() || activity.isFinishing || activity.isDestroyed) return false
        val opened = AtomicBoolean(false)
        val completed = CountDownLatch(1)
        val open = {
            try {
                activity.startActivityForResult(
                        Intent(activity, Chat2ApiLoginActivity::class.java)
                        .putExtra(Chat2ApiLoginActivity.EXTRA_SESSION_JSON, sessionJson),
                    requestCode
                )
                opened.set(true)
            } catch (_: Exception) {
                // JavaScript 侧会在返回 false 时回退手工登录；这里不输出 sessionJson，避免凭据配置误入日志。
            } finally {
                completed.countDown()
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            open()
        } else {
            activity.runOnUiThread(open)
            completed.await(2, TimeUnit.SECONDS)
        }
        return opened.get()
    }

    @JavascriptInterface
    fun closeChat2ApiLogin() {
        // 登录成功后 Activity 已经通过 RESULT_OK 关闭，此方法保留作版本兼容的无操作确认接口。
    }
}
