package com.aasc.display

import android.app.Activity
import android.content.MutableContextWrapper
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/** 只展示Service已有的运行页面，不创建登录页、不发送消息，也不改变后台服务生命周期。 */
class BrowserMediaWebViewActivity : Activity() {
    private lateinit var content: FrameLayout
    private lateinit var empty: TextView
    private var attachedPage: WebView? = null
    private val viewer = Any()

    override fun onCreate(savedInstanceState: Bundle?) {
        BrowserMediaWebViewService.initializeDataDirectory()
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val toolbar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        toolbar.addView(TextView(this).apply {
            text = "网页媒体运行页面"
            textSize = 18f
            setPadding(16, 12, 8, 12)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        toolbar.addView(Button(this).apply {
            text = "关闭"
            setOnClickListener { finish() }
        })
        root.addView(toolbar)
        root.addView(TextView(this).apply {
            text = "关闭后页面继续在后台运行。"
            setPadding(16, 0, 16, 8)
        })
        content = FrameLayout(this)
        empty = TextView(this).apply {
            text = "运行页面尚未加载或已释放。请启动网页媒体任务，并打开网站后查看。"
            setPadding(24, 32, 24, 24)
        }
        content.addView(empty)
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
    }

    override fun onStart() {
        super.onStart()
        BrowserMediaPageDisplay.observe(viewer, ::showPage)
    }

    override fun onStop() {
        // 不调用WebView.onPause/pauseTimers/destroy，后台JS及流式请求必须继续运行。
        BrowserMediaPageDisplay.stopObserving(viewer)
        super.onStop()
    }

    private fun showPage(page: WebView?) {
        attachedPage?.let { previous ->
            (previous.parent as? ViewGroup)?.removeView(previous)
            (previous.context as? MutableContextWrapper)?.baseContext = applicationContext
        }
        attachedPage = page
        empty.visibility = if (page == null) View.VISIBLE else View.GONE
        page ?: return
        (page.parent as? ViewGroup)?.removeView(page)
        (page.context as? MutableContextWrapper)?.baseContext = this
        content.addView(page, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }
}
