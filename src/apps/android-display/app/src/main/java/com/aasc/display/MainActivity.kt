package com.aasc.display

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.graphics.drawable.ScaleDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.View
import android.view.Gravity
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.SslErrorHandler
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.File
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    companion object {
        private const val EXTRA_SERVER_URL = "server_url"
        private const val REQ_STORAGE_TREE = 1005
        private const val REQ_INSTALL_UNKNOWN_SOURCES = 1006
        private const val OFFLINE_DISPLAY_INFO_HIDE_DELAY_MS = 10_000L
        private const val OFFLINE_UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1_000L
        private const val OFFLINE_UPDATE_PANEL_COLLAPSE_DELAY_MS = 10_000L
    }

    private lateinit var configBar: View
    private lateinit var serverInput: EditText
    private lateinit var webContainer: FrameLayout
    private lateinit var controlToggleButton: Button
    private lateinit var offlineStartupPanel: View
    private lateinit var offlineStartupProgress: ProgressBar
    private lateinit var offlineStartupMessage: TextView
    private lateinit var offlineStartupRetry: Button
    private lateinit var offlineUpdatePanel: View
    private lateinit var offlineUpdateTitle: TextView
    private lateinit var offlineUpdateMessage: TextView
    private lateinit var offlineUpdateNotesTitle: TextView
    private lateinit var offlineUpdateNotes: TextView
    private lateinit var offlineUpdateProgress: ProgressBar
    private lateinit var offlineUpdateDownload: Button
    private lateinit var offlineUpdateLater: Button
    private lateinit var offlineUpdateCollapsedTab: TextView
    private lateinit var offlineDisplayInfo: TextView
    private var webView: DisplayWebView? = null
    private var controlWebView: DisplayWebView? = null
    private var nativeDisplayBridge: NativeBridge? = null
    private var offlineMode = false
    private var embeddedNode = true
    private var updateOnlyMode = false
    private var serviceUpdateCheckStarted = false
    private var serviceUpdateCandidate: ServiceUpdateResult? = null
    private var serviceUpdateStarted = false
    private var minApkUpdateCheckStarted = false
    private var pendingMinApkUpdate: MinApkUpdateResult? = null
    private var minApkUpdateCandidate: MinApkUpdateResult? = null
    private var minApkDownloadStarted = false
    private var offlineUpdatePanelCollapsed = false
    private var activityResumed = false
    private var unknownSourcesDialogVisible = false
    private var waitingForUnknownSourcesResult = false
    private val offlineUpdateManager by lazy { OfflineUpdateManager(this) }
    private val mainHandler = Handler(Looper.getMainLooper())
    private val offlineUpdateCheckRunnable = object : Runnable {
        override fun run() {
            if (!activityResumed) return
            if (!serviceUpdateStarted) serviceUpdateCheckStarted = false
            if (!minApkDownloadStarted) minApkUpdateCheckStarted = false
            runOfflineUpdateChecksIfReady()
            mainHandler.postDelayed(this, OFFLINE_UPDATE_CHECK_INTERVAL_MS.toLong())
        }
    }
    private val offlineUpdatePanelCollapseRunnable = Runnable {
        if (!activityResumed || !offlineMode) return@Runnable
        if (!::offlineUpdatePanel.isInitialized || offlineUpdatePanel.visibility != View.VISIBLE) return@Runnable
        collapseOfflineUpdatePanel()
    }
    private var offlineDisplayInfoHideAtElapsedRealtime = 0L
    private val hideOfflineDisplayInfoRunnable = Runnable {
        if (!::offlineDisplayInfo.isInitialized || !offlineMode) return@Runnable
        if (SystemClock.elapsedRealtime() >= offlineDisplayInfoHideAtElapsedRealtime) {
            offlineDisplayInfo.visibility = View.GONE
        }
    }
    private var controlPageAllowed = false
    private var controlButtonState = AndroidControlAccess.ButtonState.COLLAPSED
    private var offlineDisplayRetryCount = 0
    // WebView 连接失败后可能继续回调 onPageFinished；该标记阻止错误页误判为成功页。
    private var offlineDisplayLoadFailed = false
    // 整个 APK 只维护一个原生音频焦点；网页媒体不按 TTS/视频拆分申请焦点。
    private val audioFocusController by lazy {
        AudioFocusController(this) { change ->
            runOnUiThread {
                webView?.evaluateJavascript(
                    "window.onNativeAudioFocusChanged && window.onNativeAudioFocusChanged($change);",
                    null
                )
            }
        }
    }

    private val REQ_AUDIO_PERMISSION = 1001
    private val REQ_NOTIFICATION_PERMISSION = 1002
    private val REQ_STORAGE_PERMISSION = 1003
    private val REQ_CAMERA_PERMISSION = 1004
    private val REQ_BLUETOOTH_CONNECT_PERMISSION = 1007
    private var startupContinued = false
    private var startupPermissionIndex = 0
    private var permissionReloadRequired = false
    private val maxOfflineDisplayRetries = 300
    private var nodeStatusReceiverRegistered = false
    private val nodeStatusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (!embeddedNode || !offlineMode) return
            val status = intent?.getStringExtra(NodeServerService.EXTRA_STATUS).orEmpty()
            val detail = intent?.getStringExtra(NodeServerService.EXTRA_DETAIL)
            val phase = intent?.getStringExtra(NodeServerService.EXTRA_PHASE)
            val completedBytes = intent?.getLongExtra(NodeServerService.EXTRA_COMPLETED_BYTES, -1L)
                ?.takeIf { it >= 0L }
            val totalBytes = intent?.getLongExtra(NodeServerService.EXTRA_TOTAL_BYTES, -1L)
                ?.takeIf { it >= 0L }
            updateOfflineStartupStatus(status, detail, phase, completedBytes, totalBytes)
        }
    }

    private val minInstallStatusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (!offlineMode || intent?.action != OfflineApkInstallReceiver.ACTION_INSTALL_STATUS) return
            val status = intent.getIntExtra(
                OfflineApkInstallReceiver.EXTRA_INSTALL_STATUS,
                android.content.pm.PackageInstaller.STATUS_FAILURE
            )
            val detail = intent.getStringExtra(OfflineApkInstallReceiver.EXTRA_INSTALL_DETAIL).orEmpty()
            updateMinApkInstallStatus(status, detail)
        }
    }

    private fun requestAudioPermissionIfNeeded(): Boolean {
        if (Build.VERSION.SDK_INT >= 23 &&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_AUDIO_PERMISSION)
            return true
        }
        return false
    }

    private fun requestCameraPermissionIfNeeded(): Boolean {
        if (Build.VERSION.SDK_INT >= 23 &&
            checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), REQ_CAMERA_PERMISSION)
            return true
        }
        return false
    }

    private fun requestNotificationPermissionIfNeeded(): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATION_PERMISSION)
            return true
        }
        return false
    }

    private fun requestBluetoothConnectPermissionIfNeeded(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(
                arrayOf(Manifest.permission.BLUETOOTH_CONNECT),
                REQ_BLUETOOTH_CONNECT_PERMISSION
            )
            return true
        }
        return false
    }

    /** 按启动顺序逐项请求 Android 权限，等待当前权限回调后才会检查下一项。 */
    private fun requestNextStartupPermission() {
        while (startupPermissionIndex < 4) {
            val shouldWaitForResult = when (startupPermissionIndex++) {
                0 -> requestAudioPermissionIfNeeded()
                1 -> requestBluetoothConnectPermissionIfNeeded()
                2 -> requestCameraPermissionIfNeeded()
                else -> requestNotificationPermissionIfNeeded()
            }
            if (shouldWaitForResult) return
        }

        if (permissionReloadRequired) {
            permissionReloadRequired = false
            // 录音/摄像头权限统一在权限队列结束后刷新页面，避免打断后续系统权限弹窗。
            webView?.reload()
        }
    }

    /**
     * API 28 及以下申请旧版读写权限；API 29 及以上通过 SAF 选择并持久化一个目录。
     * 两种流程都完成后才进入统一启动流程，避免系统授权界面并发弹出。
     */
    private fun continueStartupAfterStoragePermission() {
        val missingPermissions = SharedStorageAccess.missingPermissions(Build.VERSION.SDK_INT) { permission ->
            ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
        }
        if (missingPermissions.isNotEmpty()) {
            requestPermissions(missingPermissions, REQ_STORAGE_PERMISSION)
            return
        }
        if (SharedStorageAccess.requiresTreeAccess(Build.VERSION.SDK_INT) &&
            !SharedStorageAccess.hasPersistedTreeUri(this)) {
            try {
                startActivityForResult(
                    SharedStorageAccess.createTreePickerIntent(),
                    REQ_STORAGE_TREE
                )
            } catch (error: Exception) {
                android.util.Log.w("MainActivity", "启动 SAF 目录选择器失败: ${error.message}")
                Toast.makeText(
                    this,
                    getString(R.string.shared_storage_tree_unavailable),
                    Toast.LENGTH_LONG
                ).show()
                continueStartup()
            }
            return
        }
        continueStartup()
    }

    /**
     * 存储权限允许或拒绝后都继续显示端启动，拒绝只影响共享存储媒体库请求。
     */
    private fun continueStartup() {
        if (startupContinued) return
        startupContinued = true

        if (offlineMode || serverInput.text.toString().trim().isNotEmpty()) {
            connect()
        }

        // APK 启动即申请全局焦点；后续视频、TTS 和普通音频共用，不在网页重复申请。
        try {
            if (!audioFocusController.request()) {
                android.util.Log.w("MainActivity", "启动时申请原生音频焦点未获授权")
            }
        } catch (error: Exception) {
            android.util.Log.w("MainActivity", "启动时申请原生音频焦点失败: ${error.message}")
        }
        requestNextStartupPermission()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            REQ_STORAGE_PERMISSION -> {
                val storageGranted = SharedStorageAccess.arePermissionsGranted(Build.VERSION.SDK_INT) { permission ->
                    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
                }
                if (!storageGranted) {
                    Toast.makeText(
                        this,
                        getString(R.string.shared_storage_permission_denied),
                        Toast.LENGTH_LONG
                    ).show()
                }
                continueStartup()
            }
            REQ_AUDIO_PERMISSION -> {
                if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                    permissionReloadRequired = true
                }
                requestNextStartupPermission()
            }
            REQ_CAMERA_PERMISSION -> {
                if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                    permissionReloadRequired = true
                }
                requestNextStartupPermission()
            }
            REQ_BLUETOOTH_CONNECT_PERMISSION -> requestNextStartupPermission()
            REQ_NOTIFICATION_PERMISSION -> requestNextStartupPermission()
        }
    }

    /**
     * 用户选择目录后立即申请持久授权；取消选择时仍允许 APK 启动，只有共享媒体库不可用。
     */
    @Deprecated("Activity Result API 迁移将在后续统一处理")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == Chat2ApiNativeBridge.LOGIN_REQUEST_CODE) {
            deliverChat2ApiLoginResult(resultCode, data)
            return
        }
        if (requestCode == REQ_INSTALL_UNKNOWN_SOURCES) {
            waitingForUnknownSourcesResult = false
            if (pendingMinApkUpdate != null && offlineUpdateManager.requiresUnknownSourcesApproval()) {
                deferMinApkInstall()
                Toast.makeText(this, "未授权此应用安装 Offline 更新", Toast.LENGTH_LONG).show()
            } else {
                submitPendingMinApkUpdateIfVisible()
            }
            return
        }
        if (requestCode != REQ_STORAGE_TREE) return

        val selectedUri = data?.data
        val persisted = selectedUri?.let { uri ->
            SharedStorageAccess.persistTreeUri(this, uri, data?.flags ?: 0)
        } ?: false
        if (!persisted) {
            Toast.makeText(
                this,
                getString(R.string.shared_storage_tree_unavailable),
                Toast.LENGTH_LONG
            ).show()
        }
        continueStartup()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // 启动即全屏（不等连接）；系统栏弹出时自动收回
        hideSystemUi()
        window.decorView.setOnSystemUiVisibilityChangeListener { hideSystemUi() }

        configBar = findViewById(R.id.configBar)
        serverInput = findViewById(R.id.serverInput)
        webContainer = findViewById(R.id.webContainer)
        controlToggleButton = findViewById(R.id.controlToggleButton)
        offlineStartupPanel = findViewById(R.id.offlineStartupPanel)
        offlineStartupProgress = findViewById(R.id.offlineStartupProgress)
        offlineStartupMessage = findViewById(R.id.offlineStartupMessage)
        offlineStartupRetry = findViewById(R.id.offlineStartupRetry)
        offlineUpdatePanel = findViewById(R.id.offlineUpdatePanel)
        offlineUpdateTitle = findViewById(R.id.offlineUpdateTitle)
        offlineUpdateMessage = findViewById(R.id.offlineUpdateMessage)
        offlineUpdateNotesTitle = findViewById(R.id.offlineUpdateNotesTitle)
        offlineUpdateNotes = findViewById(R.id.offlineUpdateNotes)
        offlineUpdateProgress = findViewById(R.id.offlineUpdateProgress)
        offlineUpdateDownload = findViewById(R.id.offlineUpdateDownload)
        offlineUpdateLater = findViewById(R.id.offlineUpdateLater)
        offlineUpdateCollapsedTab = findViewById(R.id.offlineUpdateCollapsedTab)
        offlineDisplayInfo = findViewById(R.id.offlineDisplayInfo)
        setControlButtonState(AndroidControlAccess.ButtonState.COLLAPSED)
        val connectBtn = findViewById<Button>(R.id.connectBtn)
        offlineMode = resources.getBoolean(R.bool.aasc_offline_mode)
        embeddedNode = resources.getBoolean(R.bool.aasc_embedded_node)
        updateOnlyMode = resources.getBoolean(R.bool.aasc_update_only_mode)
        refreshOfflineDisplayInfo()
        if (updateOnlyMode && !NodeRuntimeInstaller.hasFullOfflineInstall(
                File(filesDir, "aasc-server")
            )) {
            androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("需要完整 Offline APK")
                .setMessage("此安装包只更新原生运行库。请先安装完整 Offline APK 并启动一次，再安装此增量更新包。")
                .setCancelable(false)
                .setPositiveButton("知道了") { _, _ -> finish() }
                .show()
            return
        }
        if (embeddedNode && offlineMode) {
            // 离线 APK 的控制端与本地 Node 服务同包，启动即允许访问同源 /control。
            setControlPageAccess(true)
            showOfflineStartupMessage(getString(R.string.offline_startup_preparing), false)
        }

        val saved = getSharedPreferences("aasc_display", MODE_PRIVATE).getString("server_url", "")
        val selectedServerUrl = ServerConfig.chooseUrl(
            intent?.getStringExtra(EXTRA_SERVER_URL),
            saved,
            offlineMode
        )
        serverInput.setText(selectedServerUrl)
        connectBtn.setOnClickListener { connect() }
        serverInput.setOnEditorActionListener { _, _, _ -> connect(); true }
        controlToggleButton.setOnClickListener { handleControlButtonClick() }
        offlineStartupRetry.setOnClickListener { connect() }
        offlineUpdateDownload.setOnClickListener { startAvailableOfflineUpdate() }
        offlineUpdateLater.setOnClickListener { dismissAvailableOfflineUpdate() }
        offlineUpdateCollapsedTab.setOnClickListener { expandOfflineUpdatePanel() }
        offlineUpdatePanel.setOnTouchListener { _, event ->
            if (event.actionMasked == android.view.MotionEvent.ACTION_DOWN) {
                scheduleOfflineUpdatePanelCollapse()
            }
            false
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                handleBackNavigation()
            }
        })

        // 先完成共享存储权限流程，避免存储和录音权限授权框并发出现；拒绝后仍继续连接显示端。
        continueStartupAfterStoragePermission()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        refreshOfflineDisplayInfo()
    }

    override fun onStart() {
        super.onStart()
        registerNodeStatusReceiver()
        registerMinInstallStatusReceiver()
    }

    override fun onResume() {
        super.onResume()
        activityResumed = true
        runOfflineUpdateChecksIfReady()
        scheduleOfflineUpdateChecks()
        if (offlineUpdatePanel.visibility == View.VISIBLE) {
            scheduleOfflineUpdatePanelCollapse()
        }
        submitPendingMinApkUpdateIfVisible()
    }

    override fun onPause() {
        activityResumed = false
        mainHandler.removeCallbacks(offlineUpdateCheckRunnable)
        cancelOfflineUpdatePanelCollapse()
        super.onPause()
    }

    override fun onStop() {
        unregisterNodeStatusReceiver()
        unregisterMinInstallStatusReceiver()
        super.onStop()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(hideOfflineDisplayInfoRunnable)
        mainHandler.removeCallbacks(offlineUpdateCheckRunnable)
        cancelOfflineUpdatePanelCollapse()
        nativeDisplayBridge?.release()
        audioFocusController.abandon()
        super.onDestroy()
    }

    /** Offline 更新只在前台检查，避免页面不可见时持续占用网络和线程。 */
    private fun scheduleOfflineUpdateChecks() {
        mainHandler.removeCallbacks(offlineUpdateCheckRunnable)
        if (offlineMode && activityResumed) {
            mainHandler.postDelayed(offlineUpdateCheckRunnable, OFFLINE_UPDATE_CHECK_INTERVAL_MS.toLong())
        }
    }

    private fun runOfflineUpdateChecksIfReady() {
        if (!offlineMode || !activityResumed) return
        if (!NodeRuntimeInstaller.hasFullOfflineInstall(File(filesDir, "aasc-server"))) return
        checkForServiceUpdateOnce()
        checkForMinApkUpdateOnce()
    }

    /** 显示完整更新卡片并重新开始 10 秒无触摸收起计时。 */
    private fun showOfflineUpdatePanel() {
        cancelOfflineUpdatePanelCollapse()
        offlineUpdatePanelCollapsed = false
        offlineUpdatePanel.visibility = View.VISIBLE
        offlineUpdateCollapsedTab.visibility = View.GONE
        updateCollapsedUpdateTab(null)
        scheduleOfflineUpdatePanelCollapse()
    }

    private fun scheduleOfflineUpdatePanelCollapse() {
        cancelOfflineUpdatePanelCollapse()
        if (!activityResumed || !offlineMode) return
        if (offlineUpdatePanel.visibility != View.VISIBLE) return
        mainHandler.postDelayed(
            offlineUpdatePanelCollapseRunnable,
            OFFLINE_UPDATE_PANEL_COLLAPSE_DELAY_MS
        )
    }

    private fun cancelOfflineUpdatePanelCollapse() {
        mainHandler.removeCallbacks(offlineUpdatePanelCollapseRunnable)
    }

    private fun collapseOfflineUpdatePanel() {
        cancelOfflineUpdatePanelCollapse()
        offlineUpdatePanelCollapsed = true
        offlineUpdatePanel.visibility = View.GONE
        offlineUpdateCollapsedTab.visibility = View.VISIBLE
    }

    private fun expandOfflineUpdatePanel() {
        cancelOfflineUpdatePanelCollapse()
        offlineUpdatePanelCollapsed = false
        offlineUpdateCollapsedTab.visibility = View.GONE
        offlineUpdatePanel.visibility = View.VISIBLE
        scheduleOfflineUpdatePanelCollapse()
    }

    private fun hideOfflineUpdatePanel() {
        cancelOfflineUpdatePanelCollapse()
        offlineUpdatePanelCollapsed = false
        offlineUpdatePanel.visibility = View.GONE
        offlineUpdateCollapsedTab.visibility = View.GONE
    }

    /**
     * 更新右侧收起入口的状态背景。下载阶段按真实字节比例填充左侧，其他阶段使用状态色，
     * 这样入口即使收起也能反馈当前进度；总大小未知时只显示底色，不伪造百分比。
     */
    private fun updateCollapsedUpdateTab(
        phase: String?,
        completedBytes: Long? = null,
        totalBytes: Long? = null
    ) {
        if (!::offlineUpdateCollapsedTab.isInitialized) return
        val baseColor = Color.parseColor("#E68A00")
        val progressColor = when (phase) {
            "downloading" -> Color.parseColor("#1976D2")
            "verifying", "materializing" -> Color.parseColor("#7B1FA2")
            "ready", "installing", "switching" -> Color.parseColor("#00897B")
            "success" -> Color.parseColor("#2E7D32")
            "failed" -> Color.parseColor("#C62828")
            else -> baseColor
        }
        val level = when {
            phase == "downloading" && totalBytes != null && totalBytes > 0L && completedBytes != null -> {
                val boundedCompleted = completedBytes.coerceIn(0L, totalBytes)
                (boundedCompleted * 10_000L / totalBytes).coerceIn(0L, 10_000L).toInt()
            }
            phase in setOf("verifying", "materializing", "ready", "installing", "switching", "success", "failed") -> 10_000
            else -> 0
        }
        val cornerRadius = 8f * resources.displayMetrics.density
        val background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(baseColor)
            this.cornerRadius = cornerRadius
        }
        val progress = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(progressColor)
            this.cornerRadius = cornerRadius
        }
        val scaledProgress = ScaleDrawable(progress, Gravity.START, 1f, 0f).apply {
            setLevel(level)
        }
        offlineUpdateCollapsedTab.background = LayerDrawable(arrayOf(background, scaledProgress))
    }

    // singleTask Activity 被部署脚本再次启动时不会重新执行 onCreate，需要在新 Intent 中恢复配置。
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        val injectedServerUrl = intent?.getStringExtra(EXTRA_SERVER_URL)?.trim().orEmpty()
        if (injectedServerUrl.isEmpty()) return
        serverInput.setText(injectedServerUrl)
        connect()
    }

    // 焦点回归时重贴全屏（沉浸式在交互后系统栏可能重新出现）。
    // 仅请求 WebView 非破坏性重绘，不切换可见性；避免外部应用抢占焦点后重建视频
    // Surface/SurfaceTexture，导致视频画面停止而音频仍继续播放。
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hideSystemUi()
            webView?.postInvalidate()
            controlWebView?.postInvalidate()
            if (offlineMode && webView?.visibility == View.VISIBLE) restoreControlPageButton()
        }
    }

    private fun connect() {
        val input = serverInput.text.toString().trim()
        if (input.isEmpty()) {
            Toast.makeText(this, "请输入服务器地址", Toast.LENGTH_SHORT).show()
            return
        }
        val mainServerUrl = ServerConfig.baseUrl(input)
        if (mainServerUrl.isEmpty()) {
            Toast.makeText(this, "主服务器地址无效", Toast.LENGTH_SHORT).show()
            return
        }
        if (embeddedNode && offlineMode) {
            showOfflineStartupMessage(getString(R.string.offline_startup_preparing), false)
        }
        if (embeddedNode) {
            // 普通 APK 的 Node.js 是子服务器；离线 APK 的 Node.js 是本机 main 服务。
            val serviceIntent = Intent(this, NodeServerService::class.java)
                .putExtra(NodeServerService.EXTRA_MAIN_SERVER_URL, mainServerUrl)
                .putExtra(NodeServerService.EXTRA_OFFLINE_MODE, offlineMode)
            ContextCompat.startForegroundService(this, serviceIntent)
        }

        val displayId = if (offlineMode) ServerConfig.OFFLINE_DISPLAY_ID else null
        val displayPath = ServerConfig.pageUrl(mainServerUrl, displayId)
        // 时间戳参数强制绕过 WebView HTTP 缓存（display.html 更新后 APK 重启即加载最新版）
        val url = timestampedUrl(displayPath)
        getSharedPreferences("aasc_display", MODE_PRIVATE).edit().putString("server_url", mainServerUrl).apply()

        hideSystemUi()
        configBar.visibility = View.GONE
        offlineDisplayRetryCount = 0
        offlineDisplayLoadFailed = false
        setControlPageAccess(if (embeddedNode) offlineMode else false)
        if (webView == null) {
            setupWebView(url, mainServerUrl)
        } else {
            webView?.loadUrl(url)
        }
    }

    /**
     * 只在 offline APK 注册 Node 启动状态接收器；在线 APK 不增加广播监听和启动遮罩行为。
     */
    private fun registerNodeStatusReceiver() {
        if (!embeddedNode || !offlineMode || nodeStatusReceiverRegistered) return
        val filter = IntentFilter(NodeServerService.ACTION_STATUS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(nodeStatusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(nodeStatusReceiver, filter)
        }
        nodeStatusReceiverRegistered = true
    }

    private fun unregisterNodeStatusReceiver() {
        if (!nodeStatusReceiverRegistered) return
        try {
            unregisterReceiver(nodeStatusReceiver)
        } catch (error: Exception) {
            android.util.Log.w("MainActivity", "注销 Node 状态接收器失败: ${error.message}")
        } finally {
            nodeStatusReceiverRegistered = false
        }
    }

    private var minInstallStatusReceiverRegistered = false

    private fun registerMinInstallStatusReceiver() {
        if (!offlineMode || minInstallStatusReceiverRegistered) return
        val filter = IntentFilter(OfflineApkInstallReceiver.ACTION_INSTALL_STATUS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(minInstallStatusReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(minInstallStatusReceiver, filter)
        }
        minInstallStatusReceiverRegistered = true
    }

    private fun unregisterMinInstallStatusReceiver() {
        if (!minInstallStatusReceiverRegistered) return
        try {
            unregisterReceiver(minInstallStatusReceiver)
        } catch (error: Exception) {
            android.util.Log.w("MainActivity", "注销 min APK 安装状态接收器失败: ${error.message}")
        } finally {
            minInstallStatusReceiverRegistered = false
        }
    }

    private fun updateOfflineStartupStatus(
        status: String,
        detail: String?,
        phase: String? = null,
        completedBytes: Long? = null,
        totalBytes: Long? = null
    ) {
        if (!offlineMode) return
        when (status) {
            NodeServerService.STATUS_PREPARING -> {
                showOfflineStartupMessage(getString(R.string.offline_startup_preparing), false)
            }
            NodeServerService.STATUS_INSTALLING -> {
                val phaseMessage = startupPhaseMessage(phase)
                val progressMessage = formatProgressMessage(phaseMessage, detail, completedBytes, totalBytes)
                showOfflineStartupMessage(progressMessage, false, completedBytes, totalBytes)
            }
            NodeServerService.STATUS_STARTING -> {
                showOfflineStartupMessage(getString(R.string.offline_startup_starting), false)
                scheduleOfflineDisplayInfoHide()
                checkForServiceUpdateOnce()
                checkForMinApkUpdateOnce()
            }
            NodeServerService.STATUS_SERVICE_UPDATE_APPLYING,
            NodeServerService.STATUS_SERVICE_UPDATE_PROGRESS -> {
                updateServiceUpdateProgress(phase, detail, completedBytes, totalBytes)
            }
            NodeServerService.STATUS_SERVICE_UPDATE_APPLIED -> {
                handleServiceUpdateApplied(detail)
            }
            NodeServerService.STATUS_SERVICE_UPDATE_FAILED -> {
                handleServiceUpdateFailed(detail)
            }
            NodeServerService.STATUS_FAILED -> {
                val failure = detail?.trim()?.takeIf { it.isNotEmpty() }
                    ?: getString(R.string.offline_startup_unknown_error)
                showOfflineStartupMessage(getString(R.string.offline_startup_failed, failure), true)
            }
        }
    }

    private fun startupPhaseMessage(phase: String?): String = when (phase) {
        "reading_manifest" -> getString(R.string.offline_startup_reading_manifest)
        "runtime_libraries" -> getString(R.string.offline_startup_runtime_libraries)
        "server_source" -> getString(R.string.offline_startup_server_source)
        "node_dependencies" -> getString(R.string.offline_startup_node_dependencies)
        "config_and_metadata" -> getString(R.string.offline_startup_config_metadata)
        "verifying" -> getString(R.string.offline_startup_verifying)
        "starting_node" -> getString(R.string.offline_startup_starting)
        "reused" -> getString(R.string.offline_startup_reused)
        else -> getString(R.string.offline_startup_installing)
    }

    private fun formatProgressMessage(
        phaseMessage: String,
        detail: String?,
        completedBytes: Long?,
        totalBytes: Long?
    ): String {
        val progress = if (completedBytes != null && totalBytes != null && totalBytes > 0L) {
            val percent = (completedBytes * 100L / totalBytes).coerceIn(0L, 100L)
            " $percent%（${formatBytes(completedBytes)}/${formatBytes(totalBytes)}）"
        } else {
            ""
        }
        val fileDetail = detail?.trim()?.takeIf { it.isNotEmpty() }?.let { "\n$it" }.orEmpty()
        return "$phaseMessage$progress$fileDetail"
    }

    private fun formatBytes(bytes: Long): String {
        if (bytes < 1024L) return "${bytes}B"
        if (bytes < 1024L * 1024L) return "${bytes / 1024L}KB"
        return "${bytes / (1024L * 1024L)}MB"
    }

    /** 启动后只读取一次签名服务清单；真正下载必须经过用户确认。 */
    private fun checkForServiceUpdateOnce() {
        if (!offlineMode || serviceUpdateCheckStarted || serviceUpdateStarted) return
        serviceUpdateCheckStarted = true
        Thread({
            val result = offlineUpdateManager.checkForServerUpdate(
                File(filesDir, "aasc-server")
            )
            runOnUiThread {
                if (isFinishing || isDestroyed) {
                    serviceUpdateCheckStarted = false
                    return@runOnUiThread
                }
                if (!result.hasUpdate) {
                    android.util.Log.i("MainActivity", "Offline 服务更新检查: ${result.status}")
                    // 本轮无更新后释放检查闸门；如果检查线程在后台完成，下一次 onResume 仍可立即重试。
                    serviceUpdateCheckStarted = false
                    return@runOnUiThread
                }
                android.util.Log.i("MainActivity", "Offline 服务发现更新: ${result.status}")
                showServiceUpdatePrompt(result)
            }
        }, "aasc-service-update-check").apply {
            isDaemon = true
            start()
        }
    }

    /** 首次本地服务启动完成后只检查 update-only APK，不在用户确认前下载。 */
    private fun checkForMinApkUpdateOnce() {
        if (!offlineMode || minApkUpdateCheckStarted) return
        minApkUpdateCheckStarted = true
        Thread({
            val result = offlineUpdateManager.checkForMinApkUpdate(
                File(filesDir, "aasc-server")
            )
            runOnUiThread {
                if (isFinishing || isDestroyed) {
                    minApkUpdateCheckStarted = false
                    return@runOnUiThread
                }
                if (result.metadata == null) {
                    android.util.Log.i("MainActivity", "Offline min APK 更新检查: ${result.status}")
                    // 本轮无更新后释放检查闸门；后台完成后回到前台可立即重新检查。
                    minApkUpdateCheckStarted = false
                    return@runOnUiThread
                }
                android.util.Log.i("MainActivity", "Offline min APK 发现更新: ${result.status}")
                showMinApkUpdatePrompt(result)
            }
        }, "aasc-min-apk-update-check").apply {
            isDaemon = true
            start()
        }
    }

    private fun showServiceUpdatePrompt(result: ServiceUpdateResult) {
        val codeVersion = result.targetCodeVersion ?: return
        val dependencyVersion = result.targetDependencyVersion ?: return
        serviceUpdateCandidate = result
        serviceUpdateStarted = false
        showOfflineUpdatePanel()
        offlineUpdateTitle.text = getString(R.string.offline_service_update_title)
        offlineUpdateMessage.text = getString(
            R.string.offline_service_update_available,
            codeVersion,
            dependencyVersion,
            formatBytes(result.downloadBytes)
        )
        showMinApkReleaseNotes(null)
        offlineUpdateProgress.visibility = View.GONE
        offlineUpdateDownload.text = getString(R.string.offline_service_update_download)
        offlineUpdateDownload.isEnabled = true
        offlineUpdateDownload.visibility = View.VISIBLE
        offlineUpdateLater.visibility = View.VISIBLE
    }

    private fun showMinApkUpdatePrompt(result: MinApkUpdateResult) {
        val metadata = result.metadata ?: return
        minApkUpdateCandidate = result
        if (serviceUpdateCandidate != null) return
        minApkDownloadStarted = false
        showOfflineUpdatePanel()
        offlineUpdateTitle.text = getString(R.string.offline_update_title)
        offlineUpdateMessage.text = getString(
            R.string.offline_update_available,
            metadata.versionName,
            formatBytes(metadata.artifact.size)
        )
        showMinApkReleaseNotes(metadata.releaseNotes)
        offlineUpdateProgress.visibility = View.GONE
        offlineUpdateDownload.text = getString(R.string.offline_update_download)
        offlineUpdateDownload.isEnabled = true
        offlineUpdateDownload.visibility = View.VISIBLE
        offlineUpdateLater.visibility = View.VISIBLE
    }

    /** 更新卡片只显示签名清单中的纯文本日志，缺少日志时保持旧版紧凑布局。 */
    private fun showMinApkReleaseNotes(releaseNotes: String?) {
        val normalized = releaseNotes?.trim().orEmpty()
        val visibility = if (normalized.isEmpty()) View.GONE else View.VISIBLE
        offlineUpdateNotesTitle.visibility = visibility
        offlineUpdateNotes.visibility = visibility
        offlineUpdateNotes.text = normalized
    }

    private fun startAvailableOfflineUpdate() {
        if (serviceUpdateCandidate != null) {
            startServiceUpdate()
        } else {
            startMinApkDownload()
        }
    }

    private fun dismissAvailableOfflineUpdate() {
        if (serviceUpdateCandidate != null) {
            serviceUpdateCandidate = null
            if (minApkUpdateCandidate?.metadata != null) {
                showMinApkUpdatePrompt(minApkUpdateCandidate!!)
            } else {
                hideOfflineUpdatePanel()
            }
            return
        }
        minApkUpdateCandidate = null
        if (!minApkDownloadStarted) hideOfflineUpdatePanel()
    }

    /** 用户确认服务更新后交给 NodeServerService，确保停止旧进程再切换 active release。 */
    private fun startServiceUpdate() {
        if (serviceUpdateStarted || serviceUpdateCandidate == null) return
        cancelOfflineUpdatePanelCollapse()
        expandOfflineUpdatePanel()
        serviceUpdateStarted = true
        offlineUpdateDownload.isEnabled = false
        offlineUpdateDownload.visibility = View.GONE
        offlineUpdateLater.visibility = View.GONE
        offlineUpdateProgress.visibility = View.VISIBLE
        offlineUpdateProgress.isIndeterminate = true
        updateCollapsedUpdateTab("downloading")
        offlineUpdateMessage.text = getString(R.string.offline_service_update_downloading)
        val mainServerUrl = ServerConfig.baseUrl(serverInput.text.toString().trim())
        val serviceIntent = Intent(this, NodeServerService::class.java)
            .putExtra(NodeServerService.EXTRA_MAIN_SERVER_URL, mainServerUrl)
            .putExtra(NodeServerService.EXTRA_OFFLINE_MODE, true)
            .putExtra(NodeServerService.EXTRA_APPLY_SERVER_UPDATE, true)
        try {
            ContextCompat.startForegroundService(this, serviceIntent)
        } catch (error: Exception) {
            handleServiceUpdateFailed(error.message)
        }
    }

    private fun updateServiceUpdateProgress(
        phase: String?,
        detail: String?,
        completedBytes: Long?,
        totalBytes: Long?
    ) {
        offlineUpdateProgress.visibility = View.VISIBLE
        offlineUpdateDownload.visibility = View.GONE
        offlineUpdateLater.visibility = View.GONE
        if (totalBytes != null && totalBytes > 0L && completedBytes != null) {
            offlineUpdateProgress.isIndeterminate = false
            offlineUpdateProgress.max = 100
            offlineUpdateProgress.progress = (completedBytes * 100L / totalBytes)
                .coerceIn(0L, 100L)
                .toInt()
        } else {
            offlineUpdateProgress.isIndeterminate = true
        }
        updateCollapsedUpdateTab(phase, completedBytes, totalBytes)
        offlineUpdateMessage.text = when (phase) {
            "downloading" -> getString(
                R.string.offline_service_update_download_progress,
                formatBytes(completedBytes ?: 0L),
                formatBytes(totalBytes ?: 0L)
            )
            "verifying" -> getString(R.string.offline_service_update_verifying)
            "switching" -> getString(R.string.offline_service_update_switching)
            else -> detail ?: getString(R.string.offline_service_update_downloading)
        }
    }

    private fun handleServiceUpdateApplied(detail: String?) {
        serviceUpdateCandidate = null
        serviceUpdateStarted = false
        offlineUpdateProgress.visibility = View.VISIBLE
        offlineUpdateProgress.isIndeterminate = false
        offlineUpdateProgress.progress = 100
        updateCollapsedUpdateTab("success")
        offlineUpdateMessage.text = detail ?: getString(R.string.offline_service_update_success)
        offlineUpdateDownload.visibility = View.GONE
        offlineUpdateLater.visibility = View.GONE
        offlineUpdatePanel.postDelayed({
            if (minApkUpdateCandidate?.metadata != null) {
                showMinApkUpdatePrompt(minApkUpdateCandidate!!)
            } else {
                hideOfflineUpdatePanel()
            }
        }, 2_000L)
    }

    private fun handleServiceUpdateFailed(detail: String?) {
        serviceUpdateStarted = false
        showOfflineUpdatePanel()
        updateCollapsedUpdateTab("failed")
        offlineUpdateProgress.visibility = View.GONE
        offlineUpdateMessage.text = if (detail.isNullOrBlank()) {
            getString(R.string.offline_service_update_failed)
        } else {
            getString(R.string.offline_update_failed_detail, detail)
        }
        offlineUpdateDownload.text = getString(R.string.offline_service_update_download)
        offlineUpdateDownload.visibility = View.VISIBLE
        offlineUpdateDownload.isEnabled = true
        offlineUpdateLater.visibility = View.VISIBLE
    }

    /** 用户暂不授予安装权限时恢复更新卡片，保留已发现的版本供下次手动下载。 */
    private fun deferMinApkInstall() {
        pendingMinApkUpdate = null
        minApkDownloadStarted = false
        val candidate = minApkUpdateCandidate
        if (candidate?.metadata != null) {
            showMinApkUpdatePrompt(candidate)
        } else {
            hideOfflineUpdatePanel()
        }
    }

    /** 用户点击下载后才开始网络传输；进度回调切回主线程更新浮动卡片，卡片可在下载期间收起。 */
    private fun startMinApkDownload() {
        if (minApkDownloadStarted || minApkUpdateCandidate?.metadata == null) return
        cancelOfflineUpdatePanelCollapse()
        expandOfflineUpdatePanel()
        minApkDownloadStarted = true
        offlineUpdateDownload.isEnabled = false
        offlineUpdateDownload.visibility = View.GONE
        offlineUpdateLater.visibility = View.GONE
        offlineUpdateProgress.visibility = View.VISIBLE
        offlineUpdateProgress.isIndeterminate = true
        updateCollapsedUpdateTab("downloading")
        offlineUpdateMessage.text = getString(R.string.offline_update_downloading)
        Thread({
            val result = offlineUpdateManager.checkAndPrepareMinApkUpdate(
                File(filesDir, "aasc-server")
            ) { progress ->
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) updateMinApkProgress(progress)
                }
            }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (result.apkFile == null) {
                    minApkDownloadStarted = false
                    showOfflineUpdatePanel()
                    offlineUpdateDownload.visibility = View.VISIBLE
                    offlineUpdateDownload.isEnabled = true
                    offlineUpdateMessage.text = result.status
                    offlineUpdateProgress.visibility = View.GONE
                    offlineUpdateLater.visibility = View.VISIBLE
                    return@runOnUiThread
                }
                pendingMinApkUpdate = result
                offlineUpdateMessage.text = getString(R.string.offline_update_installing)
                submitPendingMinApkUpdateIfVisible()
            }
        }, "aasc-min-apk-download").apply {
            isDaemon = true
            start()
        }
    }

    private fun updateMinApkProgress(progress: OfflineUpdateProgress) {
        offlineUpdateProgress.visibility = View.VISIBLE
        if (progress.totalBytes > 0L) {
            offlineUpdateProgress.isIndeterminate = false
            offlineUpdateProgress.max = 100
            offlineUpdateProgress.progress = (progress.completedBytes * 100L / progress.totalBytes)
                .coerceIn(0L, 100L)
                .toInt()
        } else {
            offlineUpdateProgress.isIndeterminate = true
        }
        updateCollapsedUpdateTab(progress.phase, progress.completedBytes, progress.totalBytes)
        val detail = progress.detail?.trim()?.takeIf { it.isNotEmpty() }
        offlineUpdateMessage.text = when (progress.phase) {
            "downloading" -> getString(
                R.string.offline_update_download_progress,
                formatBytes(progress.completedBytes),
                formatBytes(progress.totalBytes)
            )
            "verifying" -> getString(R.string.offline_update_verifying)
            "materializing" -> detail ?: getString(R.string.offline_update_materializing)
            "ready" -> getString(R.string.offline_update_installing)
            else -> detail ?: getString(R.string.offline_update_downloading)
        }
    }

    private fun updateMinApkInstallStatus(status: Int, detail: String) {
        if (isFinishing || isDestroyed) return
        cancelOfflineUpdatePanelCollapse()
        expandOfflineUpdatePanel()
        offlineUpdateProgress.visibility = View.VISIBLE
        offlineUpdateProgress.isIndeterminate = false
        offlineUpdateProgress.max = 100
        when (status) {
            android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                offlineUpdateProgress.progress = 100
                updateCollapsedUpdateTab("installing")
                offlineUpdateMessage.text = getString(R.string.offline_update_confirm_install)
            }
            android.content.pm.PackageInstaller.STATUS_SUCCESS -> {
                offlineUpdateProgress.progress = 100
                updateCollapsedUpdateTab("success")
                offlineUpdateMessage.text = getString(R.string.offline_update_success)
                offlineUpdateDownload.visibility = View.GONE
                offlineUpdateLater.visibility = View.GONE
                offlineUpdatePanel.postDelayed({ hideOfflineUpdatePanel() }, 2_000L)
            }
            else -> {
                minApkDownloadStarted = false
                updateCollapsedUpdateTab("failed")
                offlineUpdateProgress.visibility = View.GONE
                offlineUpdateMessage.text = if (detail.isBlank()) {
                    getString(R.string.offline_update_failed)
                } else {
                    getString(R.string.offline_update_failed_detail, detail)
                }
                offlineUpdateDownload.visibility = View.VISIBLE
                offlineUpdateDownload.isEnabled = true
                offlineUpdateLater.visibility = View.VISIBLE
            }
        }
    }

    /** 待安装 APK 只在 Activity 前台处理，避免 Android 后台启动 Activity 限制。 */
    private fun submitPendingMinApkUpdateIfVisible() {
        if (!activityResumed || unknownSourcesDialogVisible || waitingForUnknownSourcesResult) return
        val update = pendingMinApkUpdate ?: return
        if (offlineUpdateManager.requiresUnknownSourcesApproval()) {
            requestUnknownSourcesApproval()
        } else {
            pendingMinApkUpdate = null
            submitPreparedMinApkUpdate(update)
        }
    }

    /** Android 将“允许此来源安装”和最终安装确认分成两步，均由用户显式确认。 */
    private fun requestUnknownSourcesApproval() {
        unknownSourcesDialogVisible = true
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("允许安装 Offline 更新")
            .setMessage("系统尚未允许 AASC 安装本应用的更新。是否打开系统设置授权？")
            .setNegativeButton("稍后") { _, _ ->
                unknownSourcesDialogVisible = false
                deferMinApkInstall()
            }
            .setPositiveButton("打开设置") { _, _ ->
                unknownSourcesDialogVisible = false
                waitingForUnknownSourcesResult = true
                try {
                    startActivityForResult(
                        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                            .setData(Uri.parse("package:$packageName")),
                        REQ_INSTALL_UNKNOWN_SOURCES
                    )
                } catch (error: Exception) {
                    waitingForUnknownSourcesResult = false
                    deferMinApkInstall()
                    Toast.makeText(this, "无法打开安装权限设置：${error.message}", Toast.LENGTH_LONG).show()
                }
            }
            .setOnCancelListener {
                unknownSourcesDialogVisible = false
                deferMinApkInstall()
            }
            .show()
    }

    /** 交给系统 PackageInstaller 后仍显示 Android 的标准更新确认页，不执行静默安装。 */
    private fun submitPreparedMinApkUpdate(update: MinApkUpdateResult) {
        try {
            if (offlineUpdateManager.installPreparedMinApk(update)) {
                Toast.makeText(this, "已请求系统安装 Offline 更新，请在系统提示中确认", Toast.LENGTH_LONG).show()
            }
        } catch (error: Exception) {
            android.util.Log.e("MainActivity", "提交 Offline min APK 安装失败", error)
            Toast.makeText(this, "Offline 更新安装失败：${error.message}", Toast.LENGTH_LONG).show()
        }
    }

    /**
     * 更新 Offline 右下角诊断信息；数据与 WebView 初始缩放使用同一组 Display metrics 和策略。
     * 该 TextView 设置为不可交互，避免现场诊断信息遮挡网页输入或控制按钮。
     */
    private fun refreshOfflineDisplayInfo() {
        if (!::offlineDisplayInfo.isInitialized) return
        if (!offlineMode) {
            mainHandler.removeCallbacks(hideOfflineDisplayInfoRunnable)
            offlineDisplayInfoHideAtElapsedRealtime = 0L
            offlineDisplayInfo.visibility = View.GONE
            return
        }

        val metrics = resources.displayMetrics
        val deviceClass = WebViewScalePolicy.deviceClass(resources.configuration.smallestScreenWidthDp)
        val scale = WebViewScalePolicy.initialScalePercent(
            offlineMode = true,
            widthPixels = metrics.widthPixels,
            heightPixels = metrics.heightPixels,
            densityDpi = metrics.densityDpi,
            deviceClass = deviceClass
        )
        offlineDisplayInfo.text = getString(
            R.string.offline_display_info,
            metrics.widthPixels,
            metrics.heightPixels,
            metrics.densityDpi,
            scale
        )
        offlineDisplayInfo.visibility = if (
            offlineDisplayInfoHideAtElapsedRealtime > 0L
                && SystemClock.elapsedRealtime() >= offlineDisplayInfoHideAtElapsedRealtime
        ) {
            View.GONE
        } else {
            View.VISIBLE
        }
    }

    /**
     * Offline Node launcher 成功启动后保留诊断信息 10 秒，随后只隐藏提示浮层。
     * WebView 的初始缩放已经在创建时确定，这里不重新加载页面或修改缩放比例。
     */
    private fun scheduleOfflineDisplayInfoHide() {
        if (!offlineMode || !::offlineDisplayInfo.isInitialized) return
        offlineDisplayInfoHideAtElapsedRealtime =
            SystemClock.elapsedRealtime() + OFFLINE_DISPLAY_INFO_HIDE_DELAY_MS
        offlineDisplayInfo.visibility = View.VISIBLE
        mainHandler.removeCallbacks(hideOfflineDisplayInfoRunnable)
        mainHandler.postDelayed(hideOfflineDisplayInfoRunnable, OFFLINE_DISPLAY_INFO_HIDE_DELAY_MS)
    }

    private fun showOfflineStartupMessage(
        message: String,
        failed: Boolean,
        completedBytes: Long? = null,
        totalBytes: Long? = null
    ) {
        if (!offlineMode) return
        offlineStartupPanel.visibility = View.VISIBLE
        offlineStartupProgress.visibility = if (failed) View.GONE else View.VISIBLE
        if (!failed && totalBytes != null && totalBytes > 0L && completedBytes != null) {
            offlineStartupProgress.isIndeterminate = false
            offlineStartupProgress.max = 100
            offlineStartupProgress.progress = (completedBytes * 100L / totalBytes)
                .coerceIn(0L, 100L)
                .toInt()
        } else if (!failed) {
            offlineStartupProgress.isIndeterminate = true
        }
        offlineStartupRetry.visibility = if (failed) View.VISIBLE else View.GONE
        offlineStartupMessage.text = message
    }

    private fun hideOfflineStartupPanel() {
        if (::offlineStartupPanel.isInitialized) {
            offlineStartupPanel.visibility = View.GONE
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(url: String, baseUrl: String) {
        val wv = DisplayWebView(this, offlineMode)
        val bridge = NativeBridge(wv, audioFocusController, offlineMode) { allowed -> setControlPageAccess(allowed) }
        nativeDisplayBridge = bridge
        bridge.updateServerOrigin(url)
        wv.addJavascriptInterface(bridge, "NativeDisplay")
        wv.webViewClient = createWebViewClient(bridge, baseUrl, true)
        // display WebView 先放到底层；XML 中的控制按钮和启动遮罩继续保持在它上方。
        webContainer.addView(wv, 0)
        webView = wv
        wv.loadUrl(url)

        val control = DisplayWebView(this, offlineMode, disableInputAutoZoom = offlineMode)
        control.visibility = View.GONE
        control.addJavascriptInterface(Chat2ApiNativeBridge(this), "NativeControl")
        control.webViewClient = createWebViewClient(null, baseUrl, false)
        // 插入到 display WebView 之上、控制按钮和启动遮罩之下，避免控制页被显示页覆盖。
        webContainer.addView(control, 1)
        controlWebView = control
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun toggleControlPage() {
        val control = controlWebView ?: return
        if (!controlPageAllowed) return
        if (control.visibility == View.VISIBLE) {
            control.visibility = View.GONE
            setControlButtonState(AndroidControlAccess.ButtonState.COLLAPSED)
            controlToggleButton.visibility = View.VISIBLE
            return
        }
        control.visibility = View.VISIBLE
        controlToggleButton.visibility = View.VISIBLE
        setControlButtonState(AndroidControlAccess.ButtonState.EXPANDED)
        controlToggleButton.text = getString(R.string.hide_control_page)
        if (control.url.isNullOrBlank()) {
            val mainServerUrl = ServerConfig.baseUrl(serverInput.text.toString())
            control.loadUrl(timestampedUrl(ServerConfig.controlPageUrl(mainServerUrl)))
        }
    }

    /** 收缩标签点击只展开完整入口，避免单次误触直接覆盖显示端页面。 */
    private fun handleControlButtonClick() {
        if (!controlPageAllowed) return
        val pageVisible = controlWebView?.visibility == View.VISIBLE
        when (AndroidControlAccess.clickAction(pageVisible, controlButtonState)) {
            AndroidControlAccess.ButtonClickAction.EXPAND -> {
                setControlButtonState(AndroidControlAccess.ButtonState.EXPANDED)
            }
            AndroidControlAccess.ButtonClickAction.TOGGLE_PAGE -> toggleControlPage()
        }
    }

    /** 更新原生入口的收缩/展开外观；入口固定在左上角并保留安全边距，避免落到屏幕垂直中部。 */
    private fun setControlButtonState(state: AndroidControlAccess.ButtonState) {
        controlButtonState = state
        if (!::controlToggleButton.isInitialized) return
        val collapsed = state == AndroidControlAccess.ButtonState.COLLAPSED
        val layoutParams = (controlToggleButton.layoutParams as? FrameLayout.LayoutParams)
            ?: FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            )
        layoutParams.gravity = Gravity.START or Gravity.TOP
        layoutParams.leftMargin = if (collapsed) 0 else dp(12)
        layoutParams.rightMargin = 0
        layoutParams.topMargin = if (collapsed) 0 else dp(12)
        layoutParams.bottomMargin = 0
        if (collapsed) {
            layoutParams.width = dp(42)
            layoutParams.height = dp(72)
            controlToggleButton.text = getString(R.string.control_page_handle)
            controlToggleButton.contentDescription = getString(R.string.control_page_expand)
            controlToggleButton.setPadding(dp(2), dp(4), dp(2), dp(4))
        } else {
            layoutParams.width = FrameLayout.LayoutParams.WRAP_CONTENT
            layoutParams.height = FrameLayout.LayoutParams.WRAP_CONTENT
            controlToggleButton.text = getString(R.string.control_page)
            controlToggleButton.contentDescription = getString(R.string.control_page)
            controlToggleButton.setPadding(dp(8), dp(4), dp(8), dp(4))
        }
        controlToggleButton.layoutParams = layoutParams
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    private fun setControlPageAccess(allowed: Boolean) {
        // offline APK 的控制端页面和本地服务同源，服务端初始化阶段的默认 false 不应挡住本地入口。
        val effectiveAllowed = embeddedNode && (offlineMode || allowed)
        controlPageAllowed = effectiveAllowed
        val controlVisible = controlWebView?.visibility == View.VISIBLE
        if (!effectiveAllowed && controlVisible) {
            controlWebView?.visibility = View.GONE
            setControlButtonState(AndroidControlAccess.ButtonState.COLLAPSED)
        }
        if (!effectiveAllowed) setControlButtonState(AndroidControlAccess.ButtonState.COLLAPSED)
        controlToggleButton.visibility = if (AndroidControlAccess.shouldShowButton(effectiveAllowed, controlVisible)) View.VISIBLE else View.GONE
    }

    private fun deliverChat2ApiLoginResult(resultCode: Int, data: Intent?) {
        val result = JSONObject()
            .put("success", resultCode == RESULT_OK && data?.getBooleanExtra(Chat2ApiLoginActivity.EXTRA_SUCCESS, false) == true)
        data?.getStringExtra(Chat2ApiLoginActivity.EXTRA_STATE)?.let { result.put("state", it) }
        data?.getStringExtra(Chat2ApiLoginActivity.EXTRA_PROVIDER_ID)?.let { result.put("providerId", it) }
        data?.getStringExtra(Chat2ApiLoginActivity.EXTRA_CREDENTIALS_JSON)?.let { credentials ->
            try {
                result.put("credentials", JSONObject(credentials))
            } catch (_: Exception) {
                result.put("success", false)
                result.put("error", "Android 登录结果格式无效")
            }
        }
        data?.getStringExtra(Chat2ApiLoginActivity.EXTRA_ERROR)?.let { result.put("error", it) }
        controlWebView?.post {
            controlWebView?.evaluateJavascript(
                "window.Chat2APIControl && window.Chat2APIControl.completeNativeLogin(${result});",
                null
            )
        }
    }

    private fun createWebViewClient(
        bridge: NativeBridge?,
        baseUrl: String,
        retryOfflinePage: Boolean
    ): WebViewClient {
        return object : WebViewClient() {
            // WebViewClient 回调运行在主线程，在这里缓存 URL，供 JavaScript bridge 线程安全读取。
            override fun onPageStarted(view: WebView, pageUrl: String, favicon: android.graphics.Bitmap?) {
                bridge?.updateServerOrigin(pageUrl)
                if (offlineMode && retryOfflinePage) {
                    // min APK 只替换原生代码，旧 Runtime 中的 display.html 也必须使用固定身份。
                    // 在页面脚本执行前预置 localStorage，兼容尚未热更服务代码的已安装 full APK。
                    view.evaluateJavascript(
                        "try { localStorage.setItem('displayId', '${ServerConfig.OFFLINE_DISPLAY_ID}'); } catch (_) {}",
                        null
                    )
                }
                if (retryOfflinePage) {
                    // 新一轮主页面请求开始，清除上一轮连接失败状态。
                    offlineDisplayLoadFailed = false
                }
                super.onPageStarted(view, pageUrl, favicon)
            }

            override fun onPageFinished(view: WebView, pageUrl: String) {
                bridge?.updateServerOrigin(pageUrl)
                if (view is DisplayWebView) {
                    view.applyInputAutoZoomPolicy()
                }
                if (retryOfflinePage &&
                    !offlineDisplayLoadFailed &&
                    isDisplayPageUrl(pageUrl, baseUrl)) {
                    offlineDisplayRetryCount = 0
                    hideOfflineStartupPanel()
                    restoreControlPageButton()
                }
                super.onPageFinished(view, pageUrl)
            }

            override fun onReceivedError(
                view: WebView,
                request: android.webkit.WebResourceRequest,
                error: android.webkit.WebResourceError
            ) {
                if (retryOfflinePage && request.isForMainFrame) {
                    offlineDisplayLoadFailed = true
                    showOfflineStartupMessage(getString(R.string.offline_startup_waiting), false)
                    scheduleOfflineDisplayRetry(view, baseUrl)
                }
                super.onReceivedError(view, request, error)
            }

            // Network Security Config 已绑定构建时主服务器证书；未知证书或主机名不匹配时必须拒绝。
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
                android.util.Log.e(
                    "MainActivity",
                    "WebView TLS 证书校验失败: url=${error.url}, primaryError=${error.primaryError}"
                )
                Toast.makeText(this@MainActivity, getString(R.string.ssl_error), Toast.LENGTH_LONG).show()
                handler.cancel()
            }
        }
    }

    /**
     * 只有预期的本地 display 页面才可以结束 offline 启动等待；错误页 URL 不能作为成功条件。
     */
    private fun isDisplayPageUrl(pageUrl: String, baseUrl: String): Boolean {
        val expectedUrl = ServerConfig.pageUrl(baseUrl).trimEnd('/')
        val actualUrl = pageUrl.substringBefore('?').trimEnd('/')
        return expectedUrl.isNotEmpty() && actualUrl == expectedUrl
    }

    private fun scheduleOfflineDisplayRetry(view: WebView, baseUrl: String) {
        if (!offlineMode || view !== webView || view.visibility != View.VISIBLE) return
        if (offlineDisplayRetryCount >= maxOfflineDisplayRetries) {
            showOfflineStartupMessage(getString(R.string.offline_startup_failed, getString(R.string.offline_startup_timeout)), true)
            return
        }
        offlineDisplayRetryCount += 1
        view.postDelayed({
            if (view === webView && view.visibility == View.VISIBLE) {
                val displayId = if (offlineMode) ServerConfig.OFFLINE_DISPLAY_ID else null
                view.loadUrl(timestampedUrl(ServerConfig.pageUrl(baseUrl, displayId)))
            }
        }, 1_000L)
    }

    private fun timestampedUrl(url: String): String {
        return url + (if (url.contains("?")) "&" else "?") + "v=" + System.currentTimeMillis()
    }

    private fun hideSystemUi() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.hide(WindowInsets.Type.systemBars())
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
        }
    }

    private fun handleBackNavigation() {
        if (controlWebView?.visibility == View.VISIBLE) {
            controlWebView?.visibility = View.GONE
            restoreControlPageButton()
            return
        }
        if (offlineMode && webView?.visibility == View.VISIBLE && controlPageAllowed) {
            // 显示页返回时保留当前页面和 WebSocket，不让 WebView 历史覆盖控制端入口。
            restoreControlPageButton()
            return
        }
        // 后退键回配置页（重新输入服务器地址）
        webView?.visibility = View.GONE
        controlWebView?.visibility = View.GONE
        setControlPageAccess(false)
        configBar.visibility = View.VISIBLE
    }

    private fun restoreControlPageButton() {
        setControlButtonState(AndroidControlAccess.ButtonState.COLLAPSED)
        controlToggleButton.visibility = if (controlPageAllowed && offlineMode) {
            View.VISIBLE
        } else {
            View.GONE
        }
    }
}
