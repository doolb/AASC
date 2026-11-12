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
    private val motionSensor = manager.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
    private var requested = false
    private var motionRequested = false
    private var listening = false
    private var motionListening = false
    @Volatile private var released = false
    private var lastMillis = 0L
    private var lastMotionMillis = 0L
    private val matrix = FloatArray(9)
    private val angles = FloatArray(3)

    fun setEnabled(value: Boolean): Boolean {
        if (released) return false
        view.post { if (!released) { requested = value; refreshVisibility() } }
        return !value || sensor != null
    }

    fun setMotionEnabled(value: Boolean): Boolean {
        if (released) return false
        view.post { if (!released) { motionRequested = value; refreshVisibility() } }
        return !value || motionSensor != null
    }

    fun refreshVisibility() {
        if (released) return
        val visible = WallpaperDisplayCoordinator.foreground || WallpaperDisplayCoordinator.wallpaperVisible
        val wanted = requested && visible && sensor != null
        val motionWanted = motionRequested && visible && motionSensor != null
        if (wanted == listening && motionWanted == motionListening) return
        manager.unregisterListener(this)
        listening = wanted && manager.registerListener(this, sensor, 33_333)
        motionListening = motionWanted && manager.registerListener(this, motionSensor, 33_333)
        lastMillis = 0L
        lastMotionMillis = 0L
        view.evaluateJavascript("window.dispatchEvent(new Event('aasc-hologram-visibility'));", null)
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (motionListening && event.sensor == motionSensor) {
            val now = SystemClock.elapsedRealtime()
            if (now - lastMotionMillis < 33L) return
            lastMotionMillis = now
            val x = event.values[0].toDouble()
            val y = event.values[1].toDouble()
            if (x.isFinite() && y.isFinite()) {
                view.evaluateJavascript("window.dispatchEvent(new CustomEvent('aasc-native-motion',{detail:{x:$x,y:$y}}));", null)
            }
            return
        }
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

    fun release() { released = true; requested = false; motionRequested = false; manager.unregisterListener(this); listening = false; motionListening = false }
}
