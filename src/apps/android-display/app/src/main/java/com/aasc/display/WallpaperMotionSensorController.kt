package com.aasc.display

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import android.webkit.WebView

/** 只在用户开启镜头且真实壁纸可见时采集含重力加速度。 */
internal class WallpaperMotionSensorController(private val view: WebView) : SensorEventListener {
    private val manager = view.context.applicationContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val sensor = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    @Volatile private var released = false
    private var requested = false
    private var lastMillis = 0L
    private val lifecycle = WallpaperMotionLifecycle(
        start = {
            view.evaluateJavascript("window.dispatchEvent(new Event('aasc-native-motion-reset'));", null)
            val started = sensor != null && manager.registerListener(this, sensor, 33_333)
            if (!started) view.evaluateJavascript("window.dispatchEvent(new Event('aasc-native-motion-error'));", null)
            started
        },
        stop = {
            manager.unregisterListener(this)
            lastMillis = 0L
            view.evaluateJavascript("window.dispatchEvent(new Event('aasc-native-motion-reset'));", null)
        }
    )

    fun setEnabled(value: Boolean): Boolean {
        if (released) return false
        view.post { if (!released) { requested = value; refreshVisibility() } }
        return !value || sensor != null
    }

    fun refreshVisibility() {
        if (released) return
        lifecycle.update(requested, WallpaperDisplayCoordinator.wallpaperVisible, WallpaperDisplayCoordinator.foreground)
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (!lifecycle.listening || event.sensor != sensor || event.values.size < 3) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastMillis < 33L) return
        val (x, y, z) = event.values
        if (!x.isFinite() || !y.isFinite() || !z.isFinite()) return
        lastMillis = now
        // Android 和网页均采用设备坐标轴，直接传含重力加速度，不依赖陀螺仪。
        view.evaluateJavascript("window.dispatchEvent(new CustomEvent('aasc-native-motion',{detail:{x:$x,y:$y,z:$z}}));", null)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    fun release() { released = true; requested = false; lifecycle.release() }
}

/** 将开关、壁纸可见性与前台接管统一为可验证的注册状态。 */
internal class WallpaperMotionLifecycle(private val start: () -> Boolean, private val stop: () -> Unit) {
    var listening = false
        private set

    fun update(requested: Boolean, wallpaperVisible: Boolean, foreground: Boolean) {
        val wanted = requested && wallpaperVisible && !foreground
        if (wanted && !listening) listening = start()
        if (!wanted && listening) { stop(); listening = false }
    }

    fun release() { if (listening) { stop(); listening = false } }
}
