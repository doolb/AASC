package com.aasc.display

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import android.webkit.WebView
import kotlin.math.PI

/** 共享显示页的低频姿态输入；只有前台或实际可见壁纸需要时才注册传感器。 */
internal class HolographicSensorController(private val view: WebView) : SensorEventListener {
    private val manager = view.context.applicationContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val sensor = manager.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
        ?: manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private var requested = false
    private var listening = false
    @Volatile private var released = false
    private var lastMillis = 0L
    private val matrix = FloatArray(9)
    private val angles = FloatArray(3)

    fun setEnabled(value: Boolean): Boolean {
        if (released) return false
        view.post { if (!released) { requested = value; refreshVisibility() } }
        return !value || sensor != null
    }

    fun refreshVisibility() {
        if (released) return
        val wanted = requested && (WallpaperDisplayCoordinator.foreground || WallpaperDisplayCoordinator.wallpaperVisible)
        if (wanted == listening) return
        if (wanted && sensor != null) {
            listening = manager.registerListener(this, sensor, 33_333)
        } else {
            manager.unregisterListener(this)
            listening = false
        }
        lastMillis = 0L
        view.evaluateJavascript("window.dispatchEvent(new Event('aasc-hologram-visibility'));", null)
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (!listening || event.sensor != sensor) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastMillis < 33L) return
        lastMillis = now
        SensorManager.getRotationMatrixFromVector(matrix, event.values)
        SensorManager.getOrientation(matrix, angles)
        val beta = angles[1].toDouble() * 180.0 / PI
        val gamma = angles[2].toDouble() * 180.0 / PI
        if (!beta.isFinite() || !gamma.isFinite()) return
        view.evaluateJavascript("window.dispatchEvent(new CustomEvent('aasc-native-orientation',{detail:{beta:$beta,gamma:$gamma}}));", null)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    fun release() { released = true; requested = false; manager.unregisterListener(this); listening = false }
}
