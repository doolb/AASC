package com.aasc.mmdartest

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.display.DisplayManager
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.Log
import android.util.Size
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** 单一原生摄像头同时供图片首定位、SLAM和背景预览使用。 */
internal class NativeSlamController(
    private val activity: Activity,
    private val preview: TextureView,
    private val requestPermission: () -> Unit,
    private val emitToPage: (JSONObject) -> Unit
) : SensorEventListener, AutoCloseable {
    private data class Session(val id: String, val generation: Int, val options: JSONObject) {
        val initializing = AtomicBoolean()
        @Volatile var prepared = false
        var rawSize: Size? = null
        var sensorOrientation = 0
        @Volatile var geometry: CameraPreviewGeometry? = null
        // 以下缓存只在worker上读取和修改，不跨线程访问View或JSON投影对象。
        var intrinsics: DoubleArray? = null
        var projectionGeometry: CameraPreviewGeometry? = null
        var projection = JSONArray()
    }
    private val worker = Executors.newSingleThreadExecutor()
    private val epoch = AtomicInteger()
    private val frameBusy = AtomicBoolean()
    private val sensorManager = activity.getSystemService(SensorManager::class.java)
    private val cameraManager = activity.getSystemService(CameraManager::class.java)
    private val displayManager = activity.getSystemService(DisplayManager::class.java)
    @Volatile private var active: Session? = null
    @Volatile private var closed = false
    @Volatile private var camera: CameraDevice? = null
    @Volatile private var capture: CameraCaptureSession? = null
    @Volatile private var reader: ImageReader? = null
    private var cameraThread: HandlerThread? = null
    private var previewSurface: Surface? = null
    // 句柄、时间与投影只在worker上读写，停止也排到相同执行器。
    private var handle = 0L
    private var lastFrameTimestamp = -1.0
    private var mode = "monocular"
    private var calibrationQuality = "estimated"
    @Volatile private var imuEnabled = false
    private var imuTimeOffsetSeconds = 0.0
    private val imuLock = Any()
    private val imuSamples = ArrayDeque<DoubleArray>()
    private var acceleration: DoubleArray? = null
    private var accelerationTimestamp = 0L
    private val layoutListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
        active?.let { session ->
            if (session.rawSize == null) initialize(session) else updatePreviewGeometry(session)
        }
    }
    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) {}
        override fun onDisplayRemoved(displayId: Int) {}
        override fun onDisplayChanged(displayId: Int) {
            // 180度旋转不一定触发布局变化；只处理预览所在显示器，避免外接屏影响手机。
            if (preview.display?.displayId == displayId) active?.let(::updatePreviewGeometry)
        }
    }

    @JavascriptInterface
    fun getCapabilities(): String {
        val vocabularyAvailable = try { activity.assets.open("orb-slam3/ORBvoc.txt").close(); true }
            catch (_: Exception) { false }
        return JSONObject().put("protocolVersion", 1).put("engine", "orb-slam3")
            .put("available", !closed && NativeSlamBindings.loadError == null && vocabularyAvailable)
            .put("reason", NativeSlamBindings.loadError ?: if (!vocabularyAvailable) "词袋资源未安装" else "")
            .put("imageInitialization", true).put("imuRequiresCalibration", true).toString()
    }

    @Synchronized
    @JavascriptInterface
    fun start(json: String): String {
        if (closed) return JSONObject().put("error", "页面已关闭").toString()
        if (!JSONObject(getCapabilities()).optBoolean("available")) return JSONObject().put("error", "原生引擎不可用").toString()
        if (json.length > 8 * 1024 * 1024) return JSONObject().put("error", "定位图数据过大").toString()
        return try {
            val options = JSONObject(json)
            if (options.optString("referenceImageBase64").isEmpty()) throw IllegalArgumentException("未提供定位图")
            val next = Session(UUID.randomUUID().toString(), epoch.incrementAndGet(), options)
            active = next
            activity.runOnUiThread {
                if (!isCurrent(next)) return@runOnUiThread
                stopResources()
                worker.execute { destroyEngine() }
                next.prepared = true
                if (activity.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    requestPermission()
                } else begin(next)
            }
            JSONObject().put("sessionId", next.id).put("generation", next.generation).toString()
        } catch (error: Exception) { JSONObject().put("error", error.message).toString() }
    }

    @Synchronized
    @JavascriptInterface
    fun stop(sessionId: String) {
        val session = active ?: return
        if (session.id != sessionId) return
        stopCurrent()
    }

    @Synchronized
    @JavascriptInterface
    fun reset(sessionId: String): String {
        val session = active ?: return JSONObject().put("error", "定位未启动").toString()
        if (session.id != sessionId) return JSONObject().put("error", "定位会话已失效").toString()
        return start(session.options.toString())
    }

    fun onCameraPermissionResult(granted: Boolean) {
        val session = active ?: return
        if (granted) begin(session) else failure(session, "摄像头权限未允许")
    }

    private fun isCurrent(session: Session) = !closed && active === session && epoch.get() == session.generation
    private fun emit(session: Session, type: String, message: String? = null, details: JSONObject = JSONObject(),
        expectedGeometry: CameraPreviewGeometry? = null) {
        if (!isCurrent(session)) return
        details.put("type", type).put("sessionId", session.id).put("generation", session.generation)
        if (message != null) details.put("message", message)
        activity.runOnUiThread {
            if ((isCurrent(session) || type == "error")
                && (expectedGeometry == null || session.geometry == expectedGeometry)) emitToPage(details)
        }
    }

    private fun begin(session: Session) {
        if (!isCurrent(session) || !session.prepared) return
        preview.visibility = View.VISIBLE
        preview.addOnLayoutChangeListener(layoutListener)
        displayManager.registerDisplayListener(displayListener, Handler(activity.mainLooper))
        preview.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) { initialize(session) }
                override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {
                    updatePreviewGeometry(session)
                }
                override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean { if (isCurrent(session)) stopCurrent(); return true }
                override fun onSurfaceTextureUpdated(texture: SurfaceTexture) {}
            }
        if (preview.isAvailable) initialize(session)
    }

    private fun initialize(session: Session) {
        if (!isCurrent(session) || !preview.isAvailable || preview.width <= 0 || preview.height <= 0
            || !session.initializing.compareAndSet(false, true)) return
        try {
        val cameraId = cameraManager.cameraIdList.firstOrNull {
            cameraManager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
        } ?: run { failure(session, "未找到后置摄像头"); return }
        val characteristics = cameraManager.getCameraCharacteristics(cameraId)
        val sizes = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?.getOutputSizes(android.graphics.ImageFormat.YUV_420_888)?.toList().orEmpty()
        val size = sizes.filter { it.width <= 960 && it.height <= 720 }.minByOrNull {
            kotlin.math.abs(it.width - 640) + kotlin.math.abs(it.height - 480)
        } ?: run { failure(session, "摄像头没有可用的低分辨率YUV流"); return }
        session.rawSize = size
        session.sensorOrientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
        preview.surfaceTexture?.setDefaultBufferSize(size.width, size.height)
        updatePreviewGeometry(session)
        emit(session, "status", "正在载入 ORB-SLAM3 词袋和定位图…")
        worker.execute {
            try {
                if (!isCurrent(session)) return@execute
                val directory = File(activity.filesDir, "native-slam").apply { mkdirs() }
                val vocabulary = File(directory, "ORBvoc.txt")
                if (!vocabulary.exists()) {
                    val temporary = File(directory, "ORBvoc.tmp")
                    activity.assets.open("orb-slam3/ORBvoc.txt").use { source -> temporary.outputStream().use { source.copyTo(it) } }
                    check(temporary.renameTo(vocabulary)) { "词袋资源保存失败" }
                }
                val target = File(directory, "target.jpg")
                val targetBytes = Base64.decode(session.options.getString("referenceImageBase64"), Base64.DEFAULT)
                require(targetBytes.size <= 6 * 1024 * 1024) { "定位图超过6MiB上限" }
                target.writeBytes(targetBytes)
                val profile = cameraProfile(session.options.optJSONObject("calibration"), characteristics, size)
                val settings = File(directory, "camera.yaml").apply { writeText(profile.first) }
                session.intrinsics = profile.second
                val quadJson = session.options.getJSONArray("selectedQuad")
                require(quadJson.length() == 8) { "定位图框选数据无效" }
                val quad = DoubleArray(8) { quadJson.getDouble(it).also { value ->
                    require(value.isFinite() && value in 0.0..1.0) { "定位图框选超出边界" }
                } }
                handle = NativeSlamBindings.create(vocabulary.path, settings.path, target.path, quad)
                lastFrameTimestamp = -1.0
                if (!isCurrent(session)) { destroyEngine(); return@execute }
                activity.runOnUiThread { if (isCurrent(session)) openCamera(session, cameraId, size) }
            } catch (error: Exception) { failure(session, error.message ?: "原生定位初始化失败") }
        }
        } catch (error: Exception) { failure(session, error.message ?: "摄像头配置读取失败") }
    }

    @Suppress("DEPRECATION")
    private fun displayDegrees() = (preview.display ?: activity.windowManager.defaultDisplay).rotation * 90

    private fun updatePreviewGeometry(session: Session) {
        if (!isCurrent(session) || !preview.isAvailable || preview.width <= 0 || preview.height <= 0) return
        val size = session.rawSize ?: return
        val geometry = CameraPreviewGeometry(size.width, size.height, session.sensorOrientation,
            displayDegrees(), preview.width, preview.height)
        if (geometry == session.geometry) return
        val matrix = Matrix()
        check(matrix.setPolyToPoly(geometry.textureSourceCorners(), 0, geometry.textureDestinationCorners(), 0, 4)) {
            "摄像头预览变换无效"
        }
        preview.setTransform(matrix)
        session.geometry = geometry
        Log.i("MmdArTest", "[camera-preview] sensor=${geometry.sensorOrientation} display=${geometry.displayRotation} " +
            "raw=${size.width}x${size.height} view=${geometry.viewWidth}x${geometry.viewHeight} rotation=${geometry.rawRotation}")
    }

    private fun cameraProfile(calibration: JSONObject?, cameraInfo: CameraCharacteristics, size: Size): Pair<String, DoubleArray> {
        var fx: Double; var fy: Double; var cx: Double; var cy: Double
        var distortion = DoubleArray(4)
        calibrationQuality = "estimated"
        if (calibration != null) {
            require(calibration.getInt("width") == size.width && calibration.getInt("height") == size.height) { "标定分辨率必须为${size.width}×${size.height}（当前采集）" }
            fx = calibration.getDouble("fx"); fy = calibration.getDouble("fy")
            cx = calibration.getDouble("cx"); cy = calibration.getDouble("cy")
            val d = calibration.getJSONArray("distortion")
            require(d.length() == 4) { "畸变参数需要k1/k2/p1/p2四项" }
            distortion = DoubleArray(4) { d.getDouble(it) }
            calibrationQuality = "calibrated"
        } else {
            val sensor = cameraInfo.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
            val focal = cameraInfo.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull()
            require(sensor != null && focal != null && focal > 0) { "无法估算相机内参，请导入标定" }
            fx = focal / sensor.width * size.width.toDouble()
            fy = focal / sensor.height * size.height.toDouble()
            cx = size.width / 2.0; cy = size.height / 2.0
        }
        require(listOf(fx,fy,cx,cy).all { it.isFinite() } && fx > 0 && fy > 0
            && distortion.all { it.isFinite() }) { "相机标定参数无效" }
        val imu = calibration?.optJSONObject("imu")
        imuEnabled = imu != null
        imuTimeOffsetSeconds = imu?.getDouble("timeOffsetSeconds") ?: 0.0
        require(imuTimeOffsetSeconds.isFinite() && kotlin.math.abs(imuTimeOffsetSeconds) <= 0.5) { "IMU时间偏移无效" }
        mode = if (imuEnabled) "monocular-inertial" else "monocular"
        val yaml = StringBuilder("%YAML:1.0\nFile.version: \"1.0\"\nCamera.type: \"PinHole\"\n")
        for ((key, value) in mapOf("fx" to fx, "fy" to fy, "cx" to cx, "cy" to cy,
            "k1" to distortion[0], "k2" to distortion[1], "p1" to distortion[2], "p2" to distortion[3]))
            yaml.append("Camera1.$key: $value\n")
        yaml.append("Camera.width: ${size.width}\nCamera.height: ${size.height}\nCamera.fps: 30\nCamera.RGB: 0\n")
        yaml.append("ORBextractor.nFeatures: 1200\nORBextractor.scaleFactor: 1.2\nORBextractor.nLevels: 8\nORBextractor.iniThFAST: 20\nORBextractor.minThFAST: 7\n")
        yaml.append("AASC.inertial: ${if (imuEnabled) 1 else 0}\n")
        // 上游Settings仍解析Viewer参数；headless不绘制，但配置须包含正确浮点类型。
        yaml.append("Viewer.KeyFrameSize: 0.05\nViewer.KeyFrameLineWidth: 1.0\nViewer.GraphLineWidth: 0.9\nViewer.PointSize: 2.0\nViewer.CameraSize: 0.08\nViewer.CameraLineWidth: 3.0\nViewer.ViewpointX: 0.0\nViewer.ViewpointY: -0.7\nViewer.ViewpointZ: -1.8\nViewer.ViewpointF: 500.0\n")
        if (imu != null) {
            require(cameraInfo.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE) == CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME) {
                "相机时间戳无法与IMU直接同步，暂不能开启惯性模式"
            }
            val transform = imu.getJSONArray("Tbc")
            require(transform.length() == 16) { "相机至IMU外参必须为行优先4×4矩阵" }
            val values = DoubleArray(16) { transform.getDouble(it).also { value -> require(value.isFinite()) } }
            require(kotlin.math.abs(values[15] - 1) < 1e-6 && (12..14).all { kotlin.math.abs(values[it]) < 1e-6 }) { "IMU外参最后一行无效" }
            for (row in 0..2) for (other in 0..2) {
                val dot = (0..2).sumOf { values[row*4+it] * values[other*4+it] }
                require(kotlin.math.abs(dot - if (row == other) 1 else 0) < .001) { "IMU外参旋转必须正交" }
            }
            val determinant = values[0]*(values[5]*values[10]-values[6]*values[9]) -
                values[1]*(values[4]*values[10]-values[6]*values[8]) +
                values[2]*(values[4]*values[9]-values[5]*values[8])
            require(kotlin.math.abs(determinant - 1.0) < .001) { "IMU外参必须为旋转矩阵，不能镜像" }
            yaml.append("IMU.T_b_c1: !!opencv-matrix\n   rows: 4\n   cols: 4\n   dt: f\n   data: [${values.joinToString(", ")}]\n")
            for (key in listOf("NoiseGyro", "NoiseAcc", "GyroWalk", "AccWalk", "Frequency")) {
                val value = imu.getDouble(key)
                require(value.isFinite() && value > 0) { "IMU噪声/频率参数无效" }
                yaml.append("IMU.$key: $value\n")
            }
            yaml.append("IMU.InsertKFsWhenLost: 0\n")
        }
        return Pair(yaml.toString(), doubleArrayOf(fx,fy,cx,cy))
    }

    @Suppress("MissingPermission", "DEPRECATION")
    private fun openCamera(session: Session, cameraId: String, size: Size) {
        if (!isCurrent(session)) return
        try {
            cameraThread = HandlerThread("mmd-slam-camera").apply { start() }
            val handler = Handler(cameraThread!!.looper)
            // Camera2生命周期回调和资源释放都在主线程，检查会话后不会交叉写入新相机。
            val lifecycleHandler = Handler(activity.mainLooper)
            val frames = ImageReader.newInstance(size.width, size.height, android.graphics.ImageFormat.YUV_420_888, 3)
            reader = frames
            frames.setOnImageAvailableListener({ source ->
                val image = try { source.acquireLatestImage() } catch (_: IllegalStateException) { null } ?: return@setOnImageAvailableListener
                try {
                    if (!isCurrent(session) || !frameBusy.compareAndSet(false, true)) return@setOnImageAvailableListener
                    val gray = ByteArray(image.width * image.height)
                    val plane = image.planes[0]; val buffer = plane.buffer.duplicate()
                    for (row in 0 until image.height) for (column in 0 until image.width)
                        gray[row*image.width+column] = buffer.get(row*plane.rowStride+column*plane.pixelStride)
                    val timestamp = image.timestamp / 1e9
                    worker.execute {
                        try { if (isCurrent(session)) processFrame(session, gray, size, timestamp) }
                        catch (error: Exception) { failure(session, error.message ?: "定位帧处理失败") }
                        finally { frameBusy.set(false) }
                    }
                } catch (error: Exception) { frameBusy.set(false); failure(session, error.message ?: "相机帧读取失败") }
                finally { image.close() }
            }, handler)
            if (imuEnabled) {
                val acc = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
                val gyro = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE_UNCALIBRATED)
                    ?: sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
                require(acc != null && gyro != null) { "没有完整的加速度/陀螺仪传感器" }
                require(sensorManager.registerListener(this, acc, 5000, handler)) { "加速度计无法启动" }
                require(sensorManager.registerListener(this, gyro, 5000, handler)) { "陀螺仪无法启动" }
            }
            cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    if (!isCurrent(session)) { device.close(); return }
                    try {
                    camera = device
                    val texture = preview.surfaceTexture ?: run { device.close(); failure(session, "预览表面已释放"); return }
                    val surface = Surface(texture); previewSurface = surface
                    device.createCaptureSession(listOf(surface, frames.surface), object : CameraCaptureSession.StateCallback() {
                        override fun onConfigured(next: CameraCaptureSession) {
                            if (!isCurrent(session)) { next.close(); return }
                            try {
                            capture = next
                            val request = device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                                addTarget(surface); addTarget(frames.surface)
                                set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
                                set(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE, CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE_OFF)
                                set(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE, CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE_OFF)
                            }
                            next.setRepeatingRequest(request.build(), null, handler)
                            emit(session, "ready", details = JSONObject().put("mode", mode).put("calibrationQuality", calibrationQuality)
                                .put("width", size.width).put("height", size.height).put("cameraId", cameraId))
                            } catch (error: Exception) { failure(session, error.message ?: "相机采集启动失败") }
                        }
                        override fun onConfigureFailed(next: CameraCaptureSession) { next.close(); failure(session, "相机采集配置失败") }
                    }, lifecycleHandler)
                    } catch (error: Exception) { device.close(); failure(session, error.message ?: "相机预览启动失败") }
                }
                override fun onDisconnected(device: CameraDevice) { device.close(); failure(session, "摄像头已断开") }
                override fun onError(device: CameraDevice, error: Int) { device.close(); failure(session, "摄像头错误：$error") }
            }, lifecycleHandler)
        } catch (error: Exception) { failure(session, error.message ?: "相机启动失败") }
    }

    private fun processFrame(session: Session, gray: ByteArray, size: Size, timestamp: Double) {
        if (handle == 0L) return
        val values = synchronized(imuLock) {
            val batch = mutableListOf<Double>()
            while (imuSamples.isNotEmpty() && imuSamples.first()[0] <= timestamp) {
                val sample = imuSamples.removeFirst()
                if (sample[0] > lastFrameTimestamp) batch.addAll(sample.toList())
            }
            batch.toDoubleArray()
        }
        if (imuEnabled && values.isEmpty()) return
        val result = NativeSlamBindings.track(handle, gray, size.width, size.height, timestamp, values) ?: return
        lastFrameTimestamp = timestamp
        val geometry = session.geometry ?: return
        if (session.projectionGeometry != geometry) {
            session.projection = JSONArray(geometry.projection(session.intrinsics ?: return).toList())
            session.projectionGeometry = geometry
        }
        val detail = JSONObject().put("timestamp", timestamp).put("trackingState", result[0].toInt())
            .put("mapId", result[1].toLong()).put("anchored", result[2] == 1f)
            .put("trackedPoints", result[3].toInt()).put("imageMatches", result[4].toInt())
            .put("imuInitialized", result[5] == 1f).put("poseValid", result[6] == 1f)
            .put("mode", mode).put("calibrationQuality", calibrationQuality).put("projectionMatrix", session.projection)
        if (result[6] == 1f) detail.put("anchorMatrix", JSONArray(result.slice(7..22)))
        emit(session, "pose", details = detail, expectedGeometry = geometry)
    }

    override fun onSensorChanged(event: SensorEvent) {
        synchronized(imuLock) {
            if (event.sensor.type == Sensor.TYPE_ACCELEROMETER) {
                acceleration = DoubleArray(3) { event.values[it].toDouble() }; accelerationTimestamp = event.timestamp
                return
            }
            val acc = acceleration ?: return
            if (kotlin.math.abs(event.timestamp - accelerationTimestamp) > 50000000L) return
            imuSamples.addLast(doubleArrayOf(event.timestamp/1e9 + imuTimeOffsetSeconds, acc[0], acc[1], acc[2],
                event.values[0].toDouble(), event.values[1].toDouble(), event.values[2].toDouble()))
            while (imuSamples.size > 1200) imuSamples.removeFirst()
        }
    }
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    @Synchronized
    private fun failure(session: Session, reason: String) {
        emit(session, "error", reason)
        if (isCurrent(session)) stopCurrent()
    }

    @Synchronized
    fun stopCurrent() {
        active = null
        val stoppedGeneration = epoch.incrementAndGet()
        activity.runOnUiThread {
            // 新启动会自行清理旧资源；迟到的停止不能再关闭新会话。
            if (epoch.get() == stoppedGeneration || active == null) stopResources()
        }
        if (!closed) worker.execute { destroyEngine() }
    }

    private fun stopResources() {
        displayManager.unregisterDisplayListener(displayListener)
        preview.removeOnLayoutChangeListener(layoutListener)
        sensorManager.unregisterListener(this)
        runCatching { capture?.close() }; capture = null
        runCatching { camera?.close() }; camera = null
        runCatching { reader?.close() }; reader = null
        runCatching { previewSurface?.release() }; previewSurface = null
        cameraThread?.quitSafely(); cameraThread = null
        synchronized(imuLock) { imuSamples.clear(); acceleration = null }
        activity.runOnUiThread { preview.visibility = View.GONE; preview.surfaceTextureListener = null }
    }

    private fun destroyEngine() {
        if (handle != 0L) { NativeSlamBindings.destroy(handle); handle = 0L }
        frameBusy.set(false); lastFrameTimestamp = -1.0
    }

    override fun close() {
        stopCurrent(); closed = true
        worker.shutdown()
    }
}
