package com.aasc.display

import android.content.Context
import android.content.MutableContextWrapper
import android.net.Uri
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebViewClient
import java.lang.ref.WeakReference

/** 同一进程只持有一个显示页；前台和壁纸交接视图，不重新加载页面。 */
object WallpaperDisplayCoordinator {
    var foreground = false
        private set
    @Volatile
    var wallpaperTopInset = 0.0
        private set
    @Volatile
    var wallpaperActive = false
        private set
    var wallpaperSuspended = false
        private set

    /** 桌面与前台共享页面，通过桥接状态通知页面切换专用布局。 */
    fun setWallpaperActive(value: Boolean) {
        if (wallpaperActive == value) return
        wallpaperActive = value
        view?.evaluateJavascript("window.dispatchEvent(new Event('aasc-wallpaper-mode'));", null)
    }

    fun suspendWallpaper() {
        wallpaperSuspended = true
        listeners.toList().forEach { it(true) }
        releaseIfUnused()
    }

    // 状态属于共享页面，不依赖页面是否已经加载完成。
    fun setWallpaperTopInset(value: Double) {
        wallpaperTopInset = value.coerceAtLeast(0.0)
        view?.evaluateJavascript("window.dispatchEvent(new Event('aasc-wallpaper-inset'));", null)
    }

    private val listeners = mutableSetOf<(Boolean) -> Unit>()
    private var activity = WeakReference<MainActivity>(null)
    private var context: MutableContextWrapper? = null
    private var view: DisplayWebView? = null
    private var bridge: NativeBridge? = null
    private var audioFocus: AudioFocusController? = null
    private var engines = 0

    fun setForeground(value: Boolean) {
        if (value) wallpaperSuspended = false
        if (foreground == value) return
        foreground = value
        listeners.toList().forEach { it(value) }
    }

    fun addListener(listener: (Boolean) -> Unit) { listeners.add(listener); engines++ }
    fun removeListener(listener: (Boolean) -> Unit) {
        if (listeners.remove(listener)) engines--
        releaseIfUnused()
    }

    fun bindActivity(value: MainActivity) { activity = WeakReference(value) }

    fun unbindActivity(value: MainActivity) {
        if (activity.get() !== value) return
        activity.clear()
        view?.webViewClient = WebViewClient()
        if (context?.baseContext === value) context?.baseContext = value.applicationContext
        releaseIfUnused()
    }

    fun audioFocus(context: Context): AudioFocusController {
        return audioFocus ?: AudioFocusController(context.applicationContext) { change ->
            view?.post { view?.evaluateJavascript("window.onNativeAudioFocusChanged && window.onNativeAudioFocusChanged($change);", null) }
        }.also { audioFocus = it }
    }

    fun obtain(nextContext: Context, offlineMode: Boolean): Pair<DisplayWebView, Boolean> {
        val existing = view
        if (existing != null) {
            (existing.parent as? ViewGroup)?.removeView(existing)
            context?.baseContext = nextContext
            existing.onResume()
            return existing to false
        }
        val wrapper = MutableContextWrapper(nextContext)
        context = wrapper
        val created = DisplayWebView(wrapper, offlineMode, isMediaCaptureAllowed = { foreground }) { callback, params ->
            requestFileChooser(callback, params)
        }
        view = created
        val native = NativeBridge(created, audioFocus(nextContext), offlineMode,
            displayWebViewInitialScalePercent = created.initialScalePercent) { allowed ->
            activity.get()?.updateSharedControlAccess(allowed)
        }
        bridge = native
        created.addJavascriptInterface(native, "NativeDisplay")
        return created to true
    }

    fun nativeBridge(): NativeBridge? = bridge

    private fun requestFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        val host = activity.get()
        if (host != null && foreground) return host.requestSharedFileChooser(callback, params)
        callback.onReceiveValue(null)
        return true
    }

    private fun releaseIfUnused() {
        if ((engines > 0 && !wallpaperSuspended) || activity.get() != null) return
        val old = view
        (old?.parent as? ViewGroup)?.removeView(old)
        bridge?.release()
        audioFocus?.abandon()
        old?.destroy()
        bridge = null; audioFocus = null; view = null; context = null
    }
}
