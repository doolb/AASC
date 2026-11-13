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
import java.lang.ref.WeakReference
import kotlin.math.abs

/** 桌面语音浮窗复用显示页的语音运行状态；不创建第二个显示连接。 */
class WallpaperOverlay(private val context: Context) {
    private val manager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val preferences = context.getSharedPreferences("aasc_wallpaper_overlay", Context.MODE_PRIVATE)
    private val handler = Handler(Looper.getMainLooper())
    private var root: LinearLayout? = null
    private var attached = false
    private var pendingAttach: Runnable? = null
    private var lastSnapshot: JSONObject? = null
    private var snapshotPage: WeakReference<WebView>? = null
    private var page: WebView? = null
    private var params: WindowManager.LayoutParams? = null
    private var content: LinearLayout? = null
    private var handle: VoiceCircle? = null
    private var status: TextView? = null
    private var voice: VoiceCircle? = null
    private var mode: TextView? = null
    private var voiceRow: FrameLayout? = null
    private var simplified = context.getSharedPreferences("aasc_display", Context.MODE_PRIVATE)
        .getBoolean("wallpaper_overlay_simplified", true)
    private var collapseSeconds = WallpaperOverlayCollapsePolicy.normalize(context.getSharedPreferences("aasc_display", Context.MODE_PRIVATE)
        .getInt("wallpaper_overlay_collapse_seconds", 2))
    private val transition = WallpaperOverlayTransition()
    private var edge: Int = 0
    private var collapsed = false
    private var interacting = false
    private var configurationStamp = ""
    private val collapse = Runnable { if (edge != 0 && !interacting) setCollapsed(true) }
    private val refresh = object : Runnable {
        override fun run() {
            val currentPage = page ?: return
            val currentRoot = root ?: return
            if (!attached) return
            val stamp = "${screenWidth()}:${screenHeight()}:${context.resources.configuration.fontScale}"
            if (configurationStamp != stamp) { configurationStamp = stamp; onConfigurationChanged() }
            currentPage.evaluateJavascript("window.DisplayVoiceControls && typeof window.DisplayVoiceControls.overlaySnapshot === 'function' ? window.DisplayVoiceControls.overlaySnapshot() : null") { value ->
                if (root !== currentRoot || page !== currentPage || !attached || value == "null") return@evaluateJavascript
                try {
                    val data = JSONObject(value)
                    lastSnapshot = data
                    snapshotPage = WeakReference(currentPage)
                    render(data)
                } catch (error: Exception) { Log.w(TAG, "读取壁纸语音状态失败", error) }
            }
            handler.postDelayed(this, 400)
        }
    }

    fun show(webView: WebView) {
        if (root != null) {
            if (attached && page === webView) {
                if (transition.hiding) {
                    transition.show()
                    root?.animate()?.cancel()
                    params?.let { it.flags = it.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv() }
                    updateWindow()
                    root?.animate()?.alpha(1f)?.setDuration(FADE_DURATION_MS)?.withEndAction(null)?.start()
                    handler.post(refresh)
                    restartCollapse()
                }
                return
            }
            removeImmediately()
        }
        if (!Settings.canDrawOverlays(context)) return
        page = webView
        val windowParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (screenWidth() / 2 - dp(70)).coerceAtLeast(0)
            y = (screenHeight() - dp(230)).coerceAtLeast(0)
        }
        val saved = loadPosition()
        edge = saved?.edge ?: 0
        collapsed = saved?.collapsed == true && edge != 0 && collapseSeconds > 0
        params = windowParams
        val outer = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        val expanded = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER }
        val label = TextView(context).apply {
            text = "语音 连接中"; setTextSize(TypedValue.COMPLEX_UNIT_PX, scaledText(14)); gravity = Gravity.CENTER
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
        val tab = VoiceCircle(context).apply {
            halfEdge = edge
            contentDescription = "展开语音浮窗"
            visibility = View.GONE
            setOnClickListener { setCollapsed(false) }
        }
        outer.addView(expanded)
        outer.addView(tab, LinearLayout.LayoutParams(dp(16), dp(32)))
        expanded.visibility = if (collapsed) View.GONE else View.VISIBLE
        tab.visibility = if (collapsed) View.VISIBLE else View.GONE
        root = outer; content = expanded; handle = tab; status = label; voice = circle; mode = modeDot; voiceRow = row
        setSimplified(simplified)
        outer.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
            if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) constrainPosition()
        }
        attachDrag(label, outer, windowParams)
        attachDrag(circle, outer, windowParams)
        modeDot.setOnClickListener { restartCollapse(); invoke("mode") }
        val attach = Runnable {
            // 离开桌面、页面切换或已经显示后，过期回调不能添加系统窗口。
            if (root !== outer || page !== webView || attached) return@Runnable
            pendingAttach?.let(handler::removeCallbacks)
            pendingAttach = null
            if (saved != null) {
                // 样式和文字已经就绪，按实际测量尺寸恢复，避免首次布局再跳动。
                outer.measure(View.MeasureSpec.makeMeasureSpec(screenWidth(), View.MeasureSpec.AT_MOST), View.MeasureSpec.makeMeasureSpec(screenHeight(), View.MeasureSpec.AT_MOST))
                val (x, y) = saved.resolve(screenWidth(), screenHeight(), outer.measuredWidth, outer.measuredHeight)
                windowParams.x = x; windowParams.y = y
            }
            try {
                outer.alpha = 0f
                manager.addView(outer, windowParams)
                attached = true
                outer.animate().alpha(1f).setDuration(FADE_DURATION_MS).start()
                handler.post(refresh)
                restartCollapse()
            } catch (error: Exception) {
                Log.e(TAG, "显示壁纸语音浮窗失败", error)
                root = null; content = null; handle = null; status = null; voice = null; mode = null; params = null; page = null
            }
        }
        val cached = lastSnapshot?.takeIf { snapshotPage?.get() === webView }
        if (cached != null) {
            render(cached)
            attach.run()
        } else {
            // 初次没有缓存时先绘制默认样式，等待网页快照但不无限阻塞浮窗。
            render(JSONObject().put("label", "语音 连接中"))
            pendingAttach = attach
            handler.postDelayed(attach, 400L)
            try {
                webView.evaluateJavascript("window.DisplayVoiceControls && typeof window.DisplayVoiceControls.overlaySnapshot === 'function' ? window.DisplayVoiceControls.overlaySnapshot() : null") { value ->
                    if (root !== outer || page !== webView || attached) return@evaluateJavascript
                    try {
                        if (value != "null") {
                            val data = JSONObject(value)
                            lastSnapshot = data
                            snapshotPage = WeakReference(webView)
                            render(data)
                        }
                    } catch (error: Exception) { Log.w(TAG, "读取壁纸语音状态失败", error) }
                    attach.run()
                }
            } catch (error: Exception) {
                Log.w(TAG, "准备壁纸语音状态失败", error)
                attach.run()
            }
        }
    }

    private fun invoke(action: String) {
        if (transition.hiding) return
        restartCollapse()
        val currentPage = page ?: return
        currentPage.evaluateJavascript("window.DisplayVoiceControls && typeof window.DisplayVoiceControls.overlayAction === 'function' && window.DisplayVoiceControls.overlayAction(${JSONObject.quote(action)})") { result ->
            if (root != null && page === currentPage && result != "true") {
                Toast.makeText(context, "语音暂不可用，请检查显示端连接和录音权限", Toast.LENGTH_SHORT).show()
            }
        }
    }

    /** 简略样式收紧窗口到圆钮边界，同时保留位置与贴边收起状态。 */
    fun setSimplified(value: Boolean) {
        simplified = value
        status?.visibility = if (value) View.GONE else View.VISIBLE
        mode?.visibility = if (value) View.GONE else View.VISIBLE
        val row = voiceRow ?: return
        row.layoutParams = LinearLayout.LayoutParams(dp(if (value) 32 else 108), dp(if (value) 32 else 72))
        voice?.layoutParams = FrameLayout.LayoutParams(dp(if (value) 32 else 64), dp(if (value) 32 else 64), Gravity.CENTER)
        row.requestLayout()
    }

    fun setCollapseSeconds(value: Int) {
        collapseSeconds = WallpaperOverlayCollapsePolicy.normalize(value)
        if (collapseSeconds == 0 && collapsed) setCollapsed(false) else restartCollapse()
    }

    private fun render(data: JSONObject) {
        val theme = data.optJSONObject("theme") ?: JSONObject()
        val panelColor = parseColor(theme.optString("panel"), 0xff273548.toInt())
        val textColor = parseColor(theme.optString("text"), Color.WHITE)
        val primary = parseColor(theme.optString("background"), 0xff1a1a2e.toInt())
        val accent = parseColor(theme.optString("accent"), 0xff00d2ff.toInt())
        val secondary = parseColor(theme.optString("secondary"), accent)
        status?.apply {
            text = data.optString("label", "语音 已停止")
            contentDescription = text
            setTextColor(textColor)
            background = rounded(panelColor, dp(20).toFloat())
        }
        for (circle in listOfNotNull(voice, handle)) circle.apply {
            state = data.optString("state", "stopped")
            baseColor = primary
            accentColor = accent
            vadActive = data.optBoolean("vadActive")
            vadRms = data.optDouble("vadRms", 0.0).toFloat().coerceIn(0f, 1f)
            vadThreshold = data.optDouble("vadThreshold", 0.0).toFloat().coerceIn(0f, 1f)
            contentDescription = if (this === handle) "展开语音浮窗" else data.optString("actionLabel", "语音操作")
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
                    if (simplified && target === voice) {
                        if (!WallpaperOverlayHitTest.contains(target.width, target.height, event.x, event.y)) return@setOnTouchListener false
                    }
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
                    if (moved) { snapToEdge(); savePosition() } else if (target.isEnabled && target.isClickable) target.performClick()
                    restartCollapse(); true
                }
                MotionEvent.ACTION_CANCEL -> { interacting = false; if (moved) savePosition(); restartCollapse(); true }
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
        val delay = WallpaperOverlayCollapsePolicy.delayMillis(collapseSeconds) ?: return
        if (edge != 0 && !collapsed && root != null) handler.postDelayed(collapse, delay)
    }

    private fun setCollapsed(value: Boolean) {
        if (root == null || edge == 0) return
        handler.removeCallbacks(collapse)
        collapsed = value
        handle?.apply { halfEdge = edge; invalidate() }
        savePosition()
        content?.visibility = if (value) View.GONE else View.VISIBLE
        handle?.visibility = if (value) View.VISIBLE else View.GONE
        val originalView = root ?: return
        originalView.post {
            if (root !== originalView) return@post
            val current = params ?: return@post
            val view = originalView
            view.measure(View.MeasureSpec.makeMeasureSpec(screenWidth(), View.MeasureSpec.AT_MOST), View.MeasureSpec.makeMeasureSpec(screenHeight(), View.MeasureSpec.AT_MOST))
            val width = view.measuredWidth
            current.x = if (edge < 0) 0 else (screenWidth() - width).coerceAtLeast(0)
            updateWindow()
            savePosition(view.measuredWidth, view.measuredHeight)
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
        val originalView = root ?: return
        if (!attached) return
        originalView.post { if (root === originalView && attached) { constrainPosition(); savePosition() } }
    }

    private fun constrainPosition() {
        val current = params ?: return
        val currentRoot = root ?: return
        val maxX = (screenWidth() - currentRoot.width).coerceAtLeast(0)
        val maxY = (screenHeight() - currentRoot.height).coerceAtLeast(0)
        val nextX = when { edge > 0 -> maxX; edge < 0 -> 0; else -> current.x.coerceIn(0, maxX) }
        val nextY = current.y.coerceIn(0, maxY)
        if (current.x != nextX || current.y != nextY) {
            current.x = nextX; current.y = nextY
            updateWindow()
        }
    }

    private fun loadPosition(): WallpaperOverlayPosition? {
        if (!preferences.contains("saved")) return null
        return try {
            val savedEdge = preferences.getInt("edge", 0).coerceIn(-1, 1)
            WallpaperOverlayPosition(
                preferences.getFloat("x", 0f), preferences.getFloat("y", 0f), savedEdge,
                preferences.getBoolean("collapsed", false) && savedEdge != 0
            )
        } catch (error: ClassCastException) {
            Log.w(TAG, "读取浮窗位置失败，使用默认位置", error)
            null
        }
    }

    private fun savePosition(width: Int? = null, height: Int? = null) {
        val current = params ?: return
        val view = root ?: return
        val measuredWidth = width ?: view.width
        val measuredHeight = height ?: view.height
        if (measuredWidth <= 0 || measuredHeight <= 0) return
        val saved = WallpaperOverlayPosition.capture(current.x, current.y, screenWidth(), screenHeight(), measuredWidth, measuredHeight, edge, collapsed)
        preferences.edit().putBoolean("saved", true).putFloat("x", saved.xFraction).putFloat("y", saved.yFraction)
            .putInt("edge", saved.edge).putBoolean("collapsed", saved.collapsed).apply()
    }

    fun hide() {
        val current = root ?: return
        if (transition.hiding) return
        savePosition()
        pendingAttach?.let(handler::removeCallbacks)
        pendingAttach = null
        handler.removeCallbacks(refresh); handler.removeCallbacks(collapse)
        if (!attached) { removeImmediately(); return }
        val token = transition.beginHide() ?: return
        params?.let { it.flags = it.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE }
        updateWindow()
        current.animate().cancel()
        current.animate().alpha(0f).setDuration(FADE_DURATION_MS).withEndAction {
            if (root === current && transition.mayRemove(token)) removeImmediately()
        }.start()
    }

    fun removeImmediately() {
        savePosition()
        pendingAttach?.let(handler::removeCallbacks)
        pendingAttach = null
        handler.removeCallbacks(refresh); handler.removeCallbacks(collapse)
        val current = root
        transition.show()
        current?.animate()?.cancel()
        val wasAttached = attached
        attached = false
        root = null; page = null; params = null; content = null; handle = null; status = null; voice = null; mode = null; voiceRow = null
        edge = 0; collapsed = false; interacting = false; configurationStamp = ""
        if (current != null && wasAttached) try { manager.removeView(current) } catch (error: Exception) { Log.w(TAG, "移除壁纸语音浮窗失败", error) }
    }

    private fun parseColor(value: String, fallback: Int): Int = try { Color.parseColor(value) } catch (_: Exception) { fallback }
    private fun rounded(color: Int, radius: Float) = GradientDrawable().apply { setColor(color); cornerRadius = radius }
    private fun screenWidth(): Int = context.resources.displayMetrics.widthPixels
    private fun screenHeight(): Int = context.resources.displayMetrics.heightPixels
    private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()
    private fun scaledText(value: Int): Float = dp(value) * context.resources.configuration.fontScale.coerceIn(1f, 1.3f)
    private companion object { const val TAG = "AASCWallpaperOverlay"; const val FADE_DURATION_MS = 120L }

    /** 与网页语音圆钮使用同一状态颜色，内圈显示语音活动及阈值。 */
    private class VoiceCircle(context: Context) : View(context) {
        var state = "stopped"; var baseColor = Color.BLACK; var accentColor = 0xff00d2ff.toInt()
        var halfEdge = 0
        var vadActive = false; var vadRms = 0f; var vadThreshold = 0f
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        override fun onTouchEvent(event: MotionEvent): Boolean {
            if (event.actionMasked == MotionEvent.ACTION_DOWN && halfEdge != 0 &&
                !WallpaperOverlayHitTest.containsHalf(width, height, event.x, event.y, halfEdge)) return false
            return super.onTouchEvent(event)
        }
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val colors = mapOf("stopped" to 0xff64748b.toInt(), "idle" to 0xff3b82f6.toInt(), "listening" to 0xff16a34a.toInt(), "recognizing" to 0xfff59e0b.toInt(), "thinking" to 0xff8b5cf6.toInt(), "speaking" to 0xff06b6d4.toInt())
            val color = colors[state] ?: colors.getValue("stopped")
            val radius = if (halfEdge == 0) width.coerceAtMost(height) / 2f else height / 2f
            val centerX = when { halfEdge < 0 -> 0f; halfEdge > 0 -> width.toFloat(); else -> width / 2f }
            val centerY = height / 2f
            paint.color = accentColor; canvas.drawCircle(centerX, centerY, radius, paint)
            paint.color = blend(color, baseColor, 0.22f); canvas.drawCircle(centerX, centerY, radius * 0.78f, paint)
            if (vadActive) {
                canvas.save(); val inner = radius * 0.74f
                val path = android.graphics.Path().apply { addCircle(centerX, centerY, inner, android.graphics.Path.Direction.CW) }
                canvas.clipPath(path)
                paint.color = blend(color, Color.WHITE, 0.45f)
                val bottom = centerY + inner
                canvas.drawRect(centerX - inner, bottom - inner * 2 * vadRms, centerX + inner, bottom, paint)
                paint.color = 0xffef4444.toInt()
                val threshold = bottom - inner * 2 * vadThreshold
                canvas.drawRect(centerX - inner, threshold - 1, centerX + inner, threshold + 1, paint)
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
