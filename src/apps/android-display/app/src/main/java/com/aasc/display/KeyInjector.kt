package com.aasc.display

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.KeyEvent
import android.webkit.WebView
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object KeyInjector {

    // 真实按键：WebView.dispatchKeyEvent → Chromium 按键路由到 iframe 内聚焦元素（跨域同样生效）
    // 必须在主线程派发；CountDownLatch 等待结果返回给 JS 桥线程
    fun injectKey(webView: WebView, keyCode: Int, meta: Int): Boolean {
        val latch = CountDownLatch(1)
        var ok = false
        webView.post {
            webView.requestFocus()
            val down = KeyEvent(0, 0, KeyEvent.ACTION_DOWN, keyCode, 0, meta)
            val up = KeyEvent(0, 0, KeyEvent.ACTION_UP, keyCode, 0, meta)
            ok = webView.dispatchKeyEvent(down) && webView.dispatchKeyEvent(up)
            latch.countDown()
        }
        return try {
            latch.await(1, TimeUnit.SECONDS)
            ok
        } catch (e: InterruptedException) {
            false
        }
    }

    // ASCII 逐字符按键；中文/其他走系统剪贴板 + Ctrl+V（聚焦输入框自动粘贴）
    fun injectText(webView: WebView, text: String): Boolean {
        if (text.all { it.code in 32..126 }) {
            text.forEach { c ->
                val entry = asciiKey(c) ?: return false
                val meta = if (entry.second) KeyEvent.META_SHIFT_ON else 0
                if (!injectKey(webView, entry.first, meta)) return false
            }
            return true
        }
        val latch = CountDownLatch(1)
        var ok = false
        webView.post {
            try {
                val cm = webView.context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("aasc", text))
                webView.requestFocus()
                ok = injectKey(webView, KeyEvent.KEYCODE_V, KeyEvent.META_CTRL_ON)
            } catch (e: Exception) {
                ok = false
            }
            latch.countDown()
        }
        return try {
            latch.await(1, TimeUnit.SECONDS)
            ok
        } catch (e: InterruptedException) {
            false
        }
    }

    // 字符 → (Android keyCode, 是否需 Shift)
    private fun asciiKey(c: Char): Pair<Int, Boolean>? = when {
        c in 'a'..'z' -> KeyEvent.KEYCODE_A + (c - 'a') to false
        c in 'A'..'Z' -> KeyEvent.KEYCODE_A + (c - 'A') to true
        c in '0'..'9' -> KeyEvent.KEYCODE_0 + (c - '0') to false
        c == ' ' -> KeyEvent.KEYCODE_SPACE to false
        c == '\n' -> KeyEvent.KEYCODE_ENTER to false
        c == '\t' -> KeyEvent.KEYCODE_TAB to false
        c == '.' -> KeyEvent.KEYCODE_PERIOD to false
        c == ',' -> KeyEvent.KEYCODE_COMMA to false
        c == '-' -> KeyEvent.KEYCODE_MINUS to false
        c == '=' -> KeyEvent.KEYCODE_EQUALS to false
        c == '/' -> KeyEvent.KEYCODE_SLASH to false
        c == '\\' -> KeyEvent.KEYCODE_BACKSLASH to false
        c == ';' -> KeyEvent.KEYCODE_SEMICOLON to false
        c == '\'' -> KeyEvent.KEYCODE_APOSTROPHE to false
        c == '[' -> KeyEvent.KEYCODE_LEFT_BRACKET to false
        c == ']' -> KeyEvent.KEYCODE_RIGHT_BRACKET to false
        c == '`' -> KeyEvent.KEYCODE_GRAVE to false
        else -> null
    }
}
