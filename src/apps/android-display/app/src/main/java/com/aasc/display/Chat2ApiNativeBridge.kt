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
    }

    @JavascriptInterface
    fun openChat2ApiLogin(sessionJson: String): Boolean {
        if (sessionJson.isBlank() || activity.isFinishing || activity.isDestroyed) return false
        val opened = AtomicBoolean(false)
        val completed = CountDownLatch(1)
        val open = {
            try {
                activity.startActivityForResult(
                    Intent(activity, Chat2ApiLoginActivity::class.java)
                        .putExtra(Chat2ApiLoginActivity.EXTRA_SESSION_JSON, sessionJson),
                    LOGIN_REQUEST_CODE
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
