package com.aasc.imusender

import android.annotation.SuppressLint
import android.app.Activity
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque

/** 独立测试APK：只在前台采集原生六轴，并把样本交给本地页面的WebSocket客户端。 */
class MainActivity : Activity(), SensorEventListener {
    private data class TimedVector(val timestampNs: Long, val values: FloatArray)

    private companion object {
        const val MAX_GYRO_EVENTS = 128
        const val MAX_ACCEL_EVENTS = 16
        const val MAX_PENDING_SAMPLES = 128
        const val MAX_BRIDGE_BATCH = 8
        const val MAX_ACCEL_SPAN_NS = 100_000_000L
        const val SENSOR_PERIOD_US = 20_000
    }

    private lateinit var webView: WebView
    private lateinit var sensorManager: SensorManager
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var collecting = false
    private var originTimestampNs = 0L
    private val gyroEvents = ArrayDeque<TimedVector>()
    private val accelEvents = ArrayDeque<TimedVector>()
    private val dispatchLock = Any()
    private val pendingJavascriptSamples = ArrayDeque<JSONObject>()
    private var pairGapPending = false
    private var javascriptDispatchInFlight = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = false
            settings.allowFileAccess = true
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                    !url.startsWith("file:///android_asset/")
            }
            addJavascriptInterface(this@MainActivity, "NativeImu")
        }
        setContentView(webView)
        webView.loadUrl("file:///android_asset/index.html")
    }

    /** 由页面“开始采集”按钮调用；Android传感器读取不需要运行时权限弹窗。 */
    @JavascriptInterface
    fun startSensors(): Boolean {
        if (collecting) return true
        val gyro = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        val accel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (gyro == null || accel == null) {
            notifyPage("设备缺少陀螺仪或加速度计")
            return false
        }
        originTimestampNs = 0L
        gyroEvents.clear()
        accelEvents.clear()
        pairGapPending = false
        synchronized(dispatchLock) { pendingJavascriptSamples.clear() }
        val handler = mainHandler
        // 20毫秒是50Hz目标请求，Android可能因硬件或系统调度返回不同实际频率；仍以事件硬件时间戳积分。
        val gyroRegistered = sensorManager.registerListener(this, gyro, SENSOR_PERIOD_US, handler)
        val accelRegistered = sensorManager.registerListener(this, accel, SENSOR_PERIOD_US, handler)
        if (!gyroRegistered || !accelRegistered) {
            sensorManager.unregisterListener(this)
            notifyPage("传感器监听启动失败")
            return false
        }
        collecting = true
        notifyPage("原生陀螺仪和含重力加速度计已启动")
        return true
    }

    /** 页面停止、WebSocket断开或Activity暂停时统一释放传感器监听。 */
    @JavascriptInterface
    fun stopSensors() {
        mainHandler.post { stopSensorsInternal() }
    }

    private fun stopSensorsInternal() {
        if (collecting) sensorManager.unregisterListener(this)
        collecting = false
        gyroEvents.clear()
        accelEvents.clear()
        pairGapPending = false
        synchronized(dispatchLock) { pendingJavascriptSamples.clear() }
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (!collecting) return
        if (originTimestampNs == 0L) originTimestampNs = event.timestamp
        val measured = TimedVector(event.timestamp, event.values.copyOf())
        when (event.sensor.type) {
            Sensor.TYPE_GYROSCOPE -> {
                gyroEvents.addLast(measured)
                if (gyroEvents.size > MAX_GYRO_EVENTS) {
                    gyroEvents.removeFirst()
                    pairGapPending = true
                }
            }
            Sensor.TYPE_ACCELEROMETER -> {
                accelEvents.addLast(measured)
                if (accelEvents.size > MAX_ACCEL_EVENTS) accelEvents.removeFirst()
            }
            else -> return
        }
        drainPairedSamples()
    }

    /** 在陀螺仪实际测量时刻插值加速度；等待后一条加速度，不能拿旧读数伪装为同帧。 */
    private fun drainPairedSamples() {
        while (gyroEvents.isNotEmpty() && accelEvents.size >= 2) {
            val gyro = gyroEvents.first()
            while (accelEvents.size >= 2 && accelEvents.elementAt(1).timestampNs < gyro.timestampNs) {
                accelEvents.removeFirst()
            }
            if (accelEvents.size < 2) return
            val before = accelEvents.first()
            val after = accelEvents.elementAt(1)
            if (gyro.timestampNs > after.timestampNs) return
            gyroEvents.removeFirst()
            val span = after.timestampNs - before.timestampNs
            if (gyro.timestampNs < before.timestampNs || span <= 0L || span > MAX_ACCEL_SPAN_NS) {
                pairGapPending = true
                continue
            }
            val ratio = (gyro.timestampNs - before.timestampNs).toDouble() / span
            val acceleration = DoubleArray(3) { axis ->
                before.values[axis] + (after.values[axis] - before.values[axis]) * ratio
            }
            enqueuePairedSample(gyro, before, after, acceleration)
        }
    }

    private fun relativeSeconds(timestampNs: Long): Double =
        (timestampNs - originTimestampNs).coerceAtLeast(0L) / 1_000_000_000.0

    private fun enqueuePairedSample(gyro: TimedVector, before: TimedVector, after: TimedVector,
                                    acceleration: DoubleArray) {
        val sample = JSONObject()
            .put("time", relativeSeconds(gyro.timestampNs))
            .put("gyro", JSONArray(gyro.values.map { it.toDouble() }))
            .put("accel", JSONArray(acceleration.toList()))
            .put("accelBeforeTime", relativeSeconds(before.timestampNs))
            .put("accelAfterTime", relativeSeconds(after.timestampNs))
            .put("kind", "gravity")
        val shouldDispatch = synchronized(dispatchLock) {
            if (pairGapPending) {
                sample.put("gap", true)
                pairGapPending = false
            }
            if (pendingJavascriptSamples.size >= MAX_PENDING_SAMPLES) {
                pendingJavascriptSamples.removeFirst()
                (pendingJavascriptSamples.peekFirst() ?: sample).put("gap", true)
            }
            pendingJavascriptSamples.addLast(sample)
            if (javascriptDispatchInFlight) false else {
                javascriptDispatchInFlight = true
                true
            }
        }
        if (shouldDispatch) mainHandler.post { dispatchSampleBatch() }
    }

    /** WebView桥接每次发送有序小批次；仅在队列满时丢最旧数据，并把缺口传到估计器。 */
    private fun dispatchSampleBatch() {
        if (!collecting || !::webView.isInitialized) {
            synchronized(dispatchLock) { javascriptDispatchInFlight = false }
            return
        }
        val batch = synchronized(dispatchLock) {
            JSONArray().also { values ->
                repeat(minOf(MAX_BRIDGE_BATCH, pendingJavascriptSamples.size)) {
                    values.put(pendingJavascriptSamples.removeFirst())
                }
            }
        }
        if (batch.length() == 0) {
            synchronized(dispatchLock) { javascriptDispatchInFlight = false }
            return
        }
        val javascript = "window.onNativeImuSamples && window.onNativeImuSamples($batch);"
        webView.evaluateJavascript(javascript) {
            val hasNext = synchronized(dispatchLock) {
                if (collecting && pendingJavascriptSamples.isNotEmpty()) true else {
                    javascriptDispatchInFlight = false
                    false
                }
            }
            if (hasNext) dispatchSampleBatch()
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun notifyPage(message: String) {
        val quoted = JSONObject.quote(message)
        mainHandler.post {
            if (::webView.isInitialized) {
                webView.evaluateJavascript("window.onNativeSensorStatus && window.onNativeSensorStatus($quoted);", null)
            }
        }
    }

    override fun onPause() {
        stopSensorsInternal()
        if (!isFinishing && ::webView.isInitialized) {
            webView.evaluateJavascript("window.onNativePause && window.onNativePause();", null)
        }
        super.onPause()
    }

    override fun onDestroy() {
        stopSensorsInternal()
        webView.removeJavascriptInterface("NativeImu")
        webView.destroy()
        super.onDestroy()
    }
}
