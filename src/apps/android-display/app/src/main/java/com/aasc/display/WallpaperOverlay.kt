package com.aasc.display

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import org.json.JSONObject
import kotlin.math.abs

/** 真实桌面上的系统浮窗；偏好由共享壁纸页面维护，不额外创建显示连接。 */
class WallpaperOverlay(private val context: Context) {
    private val manager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val handler = Handler(Looper.getMainLooper())
    private var root: LinearLayout? = null
    private var page: WebView? = null
    private var syncing = false
    private val checks = mutableMapOf<String, CheckBox>()
    private var status: TextView? = null
    private val refresh = object : Runnable {
        override fun run() {
            if (root == null) return
            page?.evaluateJavascript("window.WallpaperControls ? window.WallpaperControls.snapshot() : null") { value ->
                if (root == null || value == "null") return@evaluateJavascript
                try {
                    val data = JSONObject(value)
                    syncing = true
                    checks.forEach { (key, input) -> input.isChecked = data.optBoolean(key, true) }
                    syncing = false
                    status?.text = data.optString("status", "暂无状态")
                } catch (error: Exception) {
                    syncing = false
                    Log.w(TAG, "读取壁纸控件状态失败", error)
                }
            }
            handler.postDelayed(this, 1500)
        }
    }

    fun show(webView: WebView) {
        page = webView
        if (root != null || !Settings.canDrawOverlays(context)) return
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (context.resources.displayMetrics.widthPixels - dp(60)).coerceAtLeast(0)
            y = dp(180)
        }
        val outer = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(8), dp(8), dp(8), dp(8))
            background = GradientDrawable().apply { setColor(0xEE202B39.toInt()); cornerRadius = dp(12).toFloat() }
        }
        val toggle = Button(context).apply { text = "控"; contentDescription = "展开壁纸控制" }
        val panel = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        val title = TextView(context).apply { text = "壁纸控制（拖动）"; setTextColor(Color.WHITE); setPadding(dp(8), dp(8), dp(8), dp(8)) }
        val collapse = Button(context).apply { text = "收起" }
        panel.addView(title)
        panel.addView(collapse)
        val volumeLabel = TextView(context).apply { text = "系统媒体音量"; setTextColor(Color.WHITE) }
        panel.addView(volumeLabel)
        val maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        panel.addView(SeekBar(context).apply {
            max = maximum
            progress = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
                    if (fromUser) audio.setStreamVolume(AudioManager.STREAM_MUSIC, value, 0)
                }
                override fun onStartTrackingTouch(bar: SeekBar?) = Unit
                override fun onStopTrackingTouch(bar: SeekBar?) = Unit
            })
        }, LinearLayout.LayoutParams(dp(210), LinearLayout.LayoutParams.WRAP_CONTENT))
        status = TextView(context).apply { text = "暂无状态"; setTextColor(Color.WHITE) }
        panel.addView(status)
        for ((key, label) in listOf("fps" to "显示 FPS", "time" to "显示时间", "contentInteraction" to "壁纸内容响应触摸")) {
            val input = CheckBox(context).apply { text = label; setTextColor(Color.WHITE); isChecked = true }
            input.setOnCheckedChangeListener { _, checked ->
                if (!syncing) page?.evaluateJavascript("window.WallpaperControls && window.WallpaperControls.setOption(${JSONObject.quote(key)}, $checked)", null)
            }
            checks[key] = input
            panel.addView(input)
        }
        toggle.setOnClickListener {
            params.x = params.x.coerceAtMost((context.resources.displayMetrics.widthPixels - dp(240)).coerceAtLeast(0))
            try { manager.updateViewLayout(outer, params) } catch (error: Exception) { Log.w(TAG, "调整壁纸浮窗位置失败", error) }
            toggle.visibility = View.GONE
            panel.visibility = View.VISIBLE
        }
        collapse.setOnClickListener { panel.visibility = View.GONE; toggle.visibility = View.VISIBLE }
        outer.addView(toggle)
        outer.addView(panel)
        attachDrag(title, outer, params)
        attachDrag(toggle, outer, params)
        try {
            manager.addView(outer, params)
            root = outer
            handler.post(refresh)
        } catch (error: Exception) {
            checks.clear()
            status = null
            Log.e(TAG, "显示壁纸系统浮窗失败", error)
        }
    }

    private fun attachDrag(handle: View, outer: View, params: WindowManager.LayoutParams) {
        var startX = 0
        var startY = 0
        var downX = 0f
        var downY = 0f
        var moved = false
        handle.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { startX = params.x; startY = params.y; downX = event.rawX; downY = event.rawY; moved = false; true }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (abs(dx) + abs(dy) > dp(6)) moved = true
                    if (moved) {
                        params.x = (startX + dx.toInt()).coerceIn(0, (context.resources.displayMetrics.widthPixels - dp(32)).coerceAtLeast(0))
                        params.y = (startY + dy.toInt()).coerceAtLeast(0)
                        try { manager.updateViewLayout(outer, params) } catch (error: Exception) { Log.w(TAG, "移动壁纸浮窗失败", error) }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> { if (!moved && handle is Button) handle.performClick(); true }
                MotionEvent.ACTION_CANCEL -> true
                else -> false
            }
        }
    }

    fun hide() {
        handler.removeCallbacks(refresh)
        val current = root
        root = null
        page = null
        checks.clear()
        status = null
        if (current != null) try { manager.removeView(current) } catch (error: Exception) { Log.w(TAG, "移除壁纸浮窗失败", error) }
    }

    private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()
    private companion object { const val TAG = "AASCWallpaperOverlay" }
}
