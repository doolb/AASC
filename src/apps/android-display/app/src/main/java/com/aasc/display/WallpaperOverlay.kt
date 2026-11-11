package com.aasc.display

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import kotlin.math.abs

/** 桌面语音浮窗复用显示页的语音运行状态；不创建第二个显示连接。 */
class WallpaperOverlay(private val context: Context) {
    private val manager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val handler = Handler(Looper.getMainLooper())
    private var root: LinearLayout? = null
    private var page: WebView? = null
    private var params: WindowManager.LayoutParams? = null
    private var content: LinearLayout? = null
    private var handle: TextView? = null
    private var status: TextView? = null
    private var voice: VoiceCircle? = null
    private var mode: TextView? = null
    private var edge: Int = 0
    private var collapsed = false
    private var interacting = false
    private var configurationStamp = ""
    private val collapse = Runnable { if (edge != 0 && !interacting) setCollapsed(true) }
    private val refresh = object : Runnable {
        override fun run() {
            val currentPage = page ?: return
            if (root == null) return
            val stamp = "${screenWidth()}:${screenHeight()}:${context.resources.configuration.fontScale}"
            if (configurationStamp != stamp) { configurationStamp = stamp; onConfigurationChanged() }
            currentPage.evaluateJavascript("window.DisplayVoiceControls && typeof window.DisplayVoiceControls.overlaySnapshot === 'function' ? window.DisplayVoiceControls.overlaySnapshot() : null") { value ->
                if (root == null || page !== currentPage || value == "null") return@evaluateJavascript
                try { render(JSONObject(value)) } catch (error: Exception) { Log.w(TAG, "读取壁纸语音状态失败", error) }
            }
            handler.postDelayed(this, 400)
        }
    }

    fun show(webView: WebView) {
        page = webView
        if (root != null || !Settings.canDrawOverlays(context)) return
        val windowParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (screenWidth() / 2 - dp(70)).coerceAtLeast(0)
            y = (screenHeight() - dp(230)).coerceAtLeast(0)
        }
        params = windowParams
        val outer = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        val expanded = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        val label = TextView(context).apply {
            text = "语音 · 连接中"; setTextSize(TypedValue.COMPLEX_UNIT_PX, scaledText(14)); gravity = Gravity.CENTER
            maxLines = 1; ellipsize = TextUtils.TruncateAt.END
            maxWidth = (screenWidth() - dp(24)).coerceAtLeast(dp(80))
            setPadding(dp(10), dp(4), dp(10), dp(4))
            contentDescription = "拖动语音浮窗"
        }
        val row = FrameLayout(context)
        val circle = VoiceCircle(context).apply { contentDescription = "语音操作"; setOnClickListener { invoke("voice") } }
        row.addView(circle, FrameLayout.LayoutParams(dp(64), dp(64), Gravity.CENTER))
        val modeDot = TextView(context).apply { contentDescription = "监听模式" }
        row.addView(modeDot, FrameLayout.LayoutParams(dp(20), dp(20), Gravity.RIGHT or Gravity.BOTTOM).apply { bottomMargin = dp(5) })
        expanded.addView(label)
        expanded.addView(row, LinearLayout.LayoutParams(dp(108), dp(72)))
        val tab = TextView(context).apply {
            text = "语"; setTextSize(TypedValue.COMPLEX_UNIT_PX, scaledText(12)); gravity = Gravity.CENTER; contentDescription = "展开语音浮窗"
            includeFontPadding = false
            visibility = View.GONE
            setOnClickListener { setCollapsed(false) }
        }
        outer.addView(expanded)
        outer.addView(tab, LinearLayout.LayoutParams(dp(28), dp(30)))
        root = outer; content = expanded; handle = tab; status = label; voice = circle; mode = modeDot
        outer.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
            if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) constrainPosition()
        }
        attachDrag(label, outer, windowParams)
        attachDrag(circle, outer, windowParams)
        modeDot.setOnClickListener { restartCollapse(); invoke("mode") }
        try {
            manager.addView(outer, windowParams)
            handler.post(refresh)
        } catch (error: Exception) {
            Log.e(TAG, "显示壁纸语音浮窗失败", error)
            root = null; content = null; handle = null; status = null; voice = null; mode = null; params = null; page = null
        }
    }

    private fun invoke(action: String) {
        restartCollapse()
        val currentPage = page ?: return
        currentPage.evaluateJavascript("window.DisplayVoiceControls && typeof window.DisplayVoiceControls.overlayAction === 'function' && window.DisplayVoiceControls.overlayAction(${JSONObject.quote(action)})") { result ->
            if (root != null && page === currentPage && result != "true") {
                Toast.makeText(context, "语音暂不可用，请检查显示端连接和录音权限", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun render(data: JSONObject) {
        val theme = data.optJSONObject("theme") ?: JSONObject()
        val panelColor = parseColor(theme.optString("panel"), 0xff273548.toInt())
        val textColor = parseColor(theme.optString("text"), Color.WHITE)
        val primary = parseColor(theme.optString("background"), 0xff1a1a2e.toInt())
        val accent = parseColor(theme.optString("accent"), 0xff00d2ff.toInt())
        val secondary = parseColor(theme.optString("secondary"), accent)
        status?.apply {
            text = data.optString("label", "语音 · 已停止")
            contentDescription = text
            setTextColor(textColor)
            background = rounded(panelColor, dp(20).toFloat())
        }
        handle?.apply { setTextColor(textColor); background = rounded(panelColor, dp(12).toFloat()) }
        voice?.apply {
            state = data.optString("state", "stopped")
            baseColor = primary
            vadActive = data.optBoolean("vadActive")
            vadRms = data.optDouble("vadRms", 0.0).toFloat().coerceIn(0f, 1f)
            vadThreshold = data.optDouble("vadThreshold", 0.0).toFloat().coerceIn(0f, 1f)
            contentDescription = data.optString("actionLabel", "语音操作")
            isEnabled = true
            invalidate()
        }
        mode?.apply {
            val available = data.optBoolean("modeEnabled")
            alpha = if (available) 1f else 0.5f
            contentDescription = data.optString("modeLabel", "切换监听模式") + if (available) "" else "，暂不可用"
            background = if (data.optBoolean("continuous")) GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(secondary, accent)).apply { shape = GradientDrawable.OVAL }
                else rounded(panelColor, dp(20).toFloat())
        }
    }

    private fun attachDrag(target: View, outer: View, windowParams: WindowManager.LayoutParams) {
        var startX = 0; var startY = 0; var downX = 0f; var downY = 0f; var moved = false
        target.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    interacting = true; handler.removeCallbacks(collapse)
                    startX = windowParams.x; startY = windowParams.y; downX = event.rawX; downY = event.rawY; moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX; val dy = event.rawY - downY
                    if (abs(dx) + abs(dy) > dp(6)) moved = true
                    if (moved) {
                        edge = 0
                        windowParams.x = (startX + dx.toInt()).coerceIn(0, (screenWidth() - outer.width).coerceAtLeast(0))
                        windowParams.y = (startY + dy.toInt()).coerceIn(0, (screenHeight() - outer.height).coerceAtLeast(0))
                        updateWindow()
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    interacting = false
                    if (moved) snapToEdge() else if (target.isEnabled && target.isClickable) target.performClick()
                    restartCollapse(); true
                }
                MotionEvent.ACTION_CANCEL -> { interacting = false; restartCollapse(); true }
                else -> false
            }
        }
    }

    private fun snapToEdge() {
        val current = params ?: return
        val width = root?.width ?: return
        val right = (screenWidth() - width).coerceAtLeast(0)
        edge = when {
            current.x <= dp(32) -> -1
            current.x >= right - dp(32) -> 1
            else -> 0
        }
        if (edge != 0) { current.x = if (edge < 0) 0 else right; updateWindow() }
    }

    private fun restartCollapse() {
        handler.removeCallbacks(collapse)
        if (edge != 0 && !collapsed && root != null) handler.postDelayed(collapse, 5000)
    }

    private fun setCollapsed(value: Boolean) {
        if (root == null || edge == 0) return
        handler.removeCallbacks(collapse)
        collapsed = value
        content?.visibility = if (value) View.GONE else View.VISIBLE
        handle?.visibility = if (value) View.VISIBLE else View.GONE
        root?.post {
            val current = params ?: return@post
            val view = root ?: return@post
            view.measure(View.MeasureSpec.makeMeasureSpec(screenWidth(), View.MeasureSpec.AT_MOST), View.MeasureSpec.makeMeasureSpec(screenHeight(), View.MeasureSpec.AT_MOST))
            val width = view.measuredWidth
            current.x = if (edge < 0) 0 else (screenWidth() - width).coerceAtLeast(0)
            updateWindow()
            if (!value) restartCollapse()
        }
    }

    private fun updateWindow() {
        val current = root ?: return
        val layout = params ?: return
        try { manager.updateViewLayout(current, layout) } catch (error: Exception) { Log.w(TAG, "更新壁纸语音浮窗失败", error) }
    }

    /** 设备缩放、旋转和状态文字宽度变化后，继续约束浮窗在可见屏幕内。 */
    fun onConfigurationChanged() {
        status?.apply {
            setTextSize(TypedValue.COMPLEX_UNIT_PX, scaledText(14))
            maxWidth = (screenWidth() - dp(24)).coerceAtLeast(dp(80))
        }
        handle?.setTextSize(TypedValue.COMPLEX_UNIT_PX, scaledText(12))
        root?.post { constrainPosition() }
    }

    private fun constrainPosition() {
        val current = params ?: return
        val currentRoot = root ?: return
        val maxX = (screenWidth() - currentRoot.width).coerceAtLeast(0)
        val maxY = (screenHeight() - currentRoot.height).coerceAtLeast(0)
        val nextX = if (edge > 0) maxX else current.x.coerceIn(0, maxX)
        val nextY = current.y.coerceIn(0, maxY)
        if (current.x != nextX || current.y != nextY) {
            current.x = nextX; current.y = nextY
            updateWindow()
        }
    }

    fun hide() {
        handler.removeCallbacks(refresh); handler.removeCallbacks(collapse)
        val current = root
        root = null; page = null; params = null; content = null; handle = null; status = null; voice = null; mode = null
        edge = 0; collapsed = false; interacting = false; configurationStamp = ""
        if (current != null) try { manager.removeView(current) } catch (error: Exception) { Log.w(TAG, "移除壁纸语音浮窗失败", error) }
    }

    private fun parseColor(value: String, fallback: Int): Int = try { Color.parseColor(value) } catch (_: Exception) { fallback }
    private fun rounded(color: Int, radius: Float) = GradientDrawable().apply { setColor(color); cornerRadius = radius }
    private fun screenWidth(): Int = context.resources.displayMetrics.widthPixels
    private fun screenHeight(): Int = context.resources.displayMetrics.heightPixels
    private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()
    private fun scaledText(value: Int): Float = dp(value) * context.resources.configuration.fontScale.coerceIn(1f, 1.3f)
    private companion object { const val TAG = "AASCWallpaperOverlay" }

    /** 与网页语音圆钮使用同一状态颜色，内圈显示语音活动及阈值。 */
    private class VoiceCircle(context: Context) : View(context) {
        var state = "stopped"; var baseColor = Color.BLACK
        var vadActive = false; var vadRms = 0f; var vadThreshold = 0f
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val colors = mapOf("stopped" to 0xff64748b.toInt(), "idle" to 0xff3b82f6.toInt(), "listening" to 0xff16a34a.toInt(), "recognizing" to 0xfff59e0b.toInt(), "thinking" to 0xff8b5cf6.toInt(), "speaking" to 0xff06b6d4.toInt())
            val color = colors[state] ?: colors.getValue("stopped")
            val radius = width.coerceAtMost(height) / 2f
            paint.color = color; canvas.drawCircle(width / 2f, height / 2f, radius, paint)
            paint.color = blend(color, baseColor, 0.22f); canvas.drawCircle(width / 2f, height / 2f, radius * 0.78f, paint)
            if (vadActive) {
                canvas.save(); val inner = radius * 0.74f
                val path = android.graphics.Path().apply { addCircle(width / 2f, height / 2f, inner, android.graphics.Path.Direction.CW) }
                canvas.clipPath(path)
                paint.color = blend(color, Color.WHITE, 0.45f)
                val bottom = height / 2f + inner
                canvas.drawRect(width / 2f - inner, bottom - inner * 2 * vadRms, width / 2f + inner, bottom, paint)
                paint.color = 0xffef4444.toInt()
                val threshold = bottom - inner * 2 * vadThreshold
                canvas.drawRect(width / 2f - inner, threshold - 1, width / 2f + inner, threshold + 1, paint)
                canvas.restore()
            }
        }
        private fun blend(first: Int, second: Int, amount: Float): Int = Color.rgb(
            (Color.red(first) * (1 - amount) + Color.red(second) * amount).toInt(),
            (Color.green(first) * (1 - amount) + Color.green(second) * amount).toInt(),
            (Color.blue(first) * (1 - amount) + Color.blue(second) * amount).toInt()
        )
    }
}
