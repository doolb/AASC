package com.aasc.display

import android.app.Presentation
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.service.wallpaper.WallpaperService
import android.util.Log
import android.view.SurfaceHolder
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebViewClient
import android.widget.FrameLayout

/** 壁纸和前台共用显示页；系统短暂隐藏壁纸时保留页面状态。 */
class DisplayWallpaperService : WallpaperService() {
    override fun onCreateEngine(): Engine = DisplayEngine()

    override fun onTaskRemoved(rootIntent: Intent?) {
        WallpaperDisplayCoordinator.suspendWallpaper(this)
        super.onTaskRemoved(rootIntent)
    }

    private inner class DisplayEngine : Engine() {
        private var display: VirtualDisplay? = null
        private var presentation: Presentation? = null
        private var container: FrameLayout? = null
        private var webView: DisplayWebView? = null
        private var visible = false
        private var surfaceWidth = 0
        private var surfaceHeight = 0
        private val overlay = WallpaperOverlay(this@DisplayWallpaperService)
        private val foregroundListener: (Boolean) -> Unit = { foreground ->
            if (foreground) releaseRenderer() else if (visible) ensureRenderer(surfaceHolder)
        }

        override fun onCreate(holder: SurfaceHolder) {
            super.onCreate(holder)
            setTouchEventsEnabled(true)
            WallpaperDisplayCoordinator.addListener(foregroundListener)
        }

        override fun onTouchEvent(event: MotionEvent) {
            super.onTouchEvent(event)
            if (webView?.parent !== container) return
            // 桌面允许转发触摸时交给同一 WebView；不拦截系统桌面的手势策略。
            val copy = MotionEvent.obtain(event)
            try { webView?.dispatchTouchEvent(copy) } finally { copy.recycle() }
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            surfaceWidth = width
            surfaceHeight = height
            if (width > 0 && height > 0 && holder.surface.isValid) {
                display?.resize(width, height, resources.displayMetrics.densityDpi)
                display?.setSurface(holder.surface)
            }
            if (visible) ensureRenderer(holder)
            if (container != null && webView?.parent === container) updateTopInset()
        }

        override fun onVisibilityChanged(visible: Boolean) {
            super.onVisibilityChanged(visible)
            this.visible = visible
            if (visible) ensureRenderer(surfaceHolder)
            else {
                overlay.hide()
                if (webView?.parent === container) webView?.onPause()
            }
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            overlay.hide()
            display?.setSurface(null)
            if (webView?.parent === container) webView?.onPause()
            surfaceWidth = 0
            surfaceHeight = 0
            super.onSurfaceDestroyed(holder)
        }

        override fun onDestroy() {
            releaseRenderer()
            WallpaperDisplayCoordinator.removeListener(foregroundListener)
            super.onDestroy()
        }

        private fun ensureRenderer(holder: SurfaceHolder) {
            if (WallpaperDisplayCoordinator.foreground || WallpaperDisplayCoordinator.wallpaperSuspended || surfaceWidth <= 0 || surfaceHeight <= 0 || !holder.surface.isValid) return
            val prefs = getSharedPreferences("aasc_display", Context.MODE_PRIVATE)
            val offlineMode = resources.getBoolean(R.bool.aasc_offline_mode)
            val address = ServerConfig.chooseUrl(null, prefs.getString("server_url", ""), offlineMode)
            if (address.isBlank()) {
                Log.w(TAG, "请先在显示端配置服务器地址")
                return
            }
            try {
                if (display == null) {
                    val manager = getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
                    val virtualDisplay = manager.createVirtualDisplay(
                        "AASC Wallpaper", surfaceWidth, surfaceHeight, resources.displayMetrics.densityDpi,
                        holder.surface, DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION or DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
                    ) ?: error("无法创建虚拟显示器")
                    display = virtualDisplay
                    val targetPresentation = Presentation(this@DisplayWallpaperService, virtualDisplay.display ?: error("虚拟显示器不可用"))
                    presentation = targetPresentation
                    targetPresentation.window?.setType(WindowManager.LayoutParams.TYPE_PRIVATE_PRESENTATION)
                    targetPresentation.window?.decorView?.systemUiVisibility = (
                        View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        )
                    val root = FrameLayout(targetPresentation.context)
                    container = root
                    targetPresentation.setContentView(root)
                    targetPresentation.show()
                }
                val root = checkNotNull(container)
                if (webView?.parent !== root) {
                    val (shared, created) = WallpaperDisplayCoordinator.obtain(checkNotNull(presentation).context, offlineMode)
                    webView = shared
                    updateTopInset()
                    shared.setBackgroundColor(Color.BLACK)
                    shared.webViewClient = WebViewClient()
                    root.addView(shared, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
                    WallpaperDisplayCoordinator.setWallpaperActive(true)
                    if (created || shared.url.isNullOrBlank() || shared.url == "about:blank") {
                        shared.loadUrl(ServerConfig.pageUrl(address, if (offlineMode) ServerConfig.OFFLINE_DISPLAY_ID else null))
                    }
                } else {
                    webView?.onResume()
                }
                if (!isPreview) webView?.let { overlay.show(it) }
            } catch (error: Exception) {
                Log.e(TAG, "动态壁纸显示端启动失败", error)
                releaseRenderer()
            }
        }

        // 虚拟显示器的系统栏不能代表桌面状态栏，使用物理设备的系统尺寸。
        private fun updateTopInset() {
            val resourceId = resources.getIdentifier("status_bar_height", "dimen", "android")
            val height = if (resourceId != 0) resources.getDimensionPixelSize(resourceId) / resources.displayMetrics.density else 24f
            WallpaperDisplayCoordinator.setWallpaperTopInset(height.toDouble())
        }

        private fun releaseRenderer() {
            overlay.hide()
            if (container != null && webView?.parent === container) {
                WallpaperDisplayCoordinator.setWallpaperActive(false)
                WallpaperDisplayCoordinator.setWallpaperTopInset(0.0)
                webView?.onPause()
                container?.removeView(webView)
            }
            webView = null
            container = null
            presentation?.dismiss()
            presentation = null
            display?.release()
            display = null
        }
    }

    private companion object { const val TAG = "AASCWallpaper" }
}
