package com.aasc.mmdartest

import kotlin.math.max

/**
 * 相机原始像素与显示窗口的共同几何关系，不依赖Android，可直接做数值验证。
 * TextureView已经旋转传感器并拉伸到窗口；显示补偿不能再重复旋转传感器。
 * SLAM仍使用原始灰度帧，其投影则必须完整经过旋转、等比缩放和居中裁切。
 */
internal data class CameraPreviewGeometry(
    val rawWidth: Int,
    val rawHeight: Int,
    val sensorOrientation: Int,
    val displayRotation: Int,
    val viewWidth: Int,
    val viewHeight: Int
) {
    init {
        require(rawWidth > 0 && rawHeight > 0 && viewWidth > 0 && viewHeight > 0) { "相机/窗口尺寸必须为正" }
        require(sensorOrientation in setOf(0, 90, 180, 270) && displayRotation in setOf(0, 90, 180, 270)) {
            "相机/显示方向必须为四分之一圈"
        }
    }

    val rawRotation = (sensorOrientation - displayRotation + 360) % 360
    private val rotatedWidth = if (rawRotation % 180 == 0) rawWidth else rawHeight
    private val rotatedHeight = if (rawRotation % 180 == 0) rawHeight else rawWidth
    val scale = max(viewWidth.toDouble() / rotatedWidth, viewHeight.toDouble() / rotatedHeight)
    private val offsetX = (viewWidth - rotatedWidth * scale) / 2
    private val offsetY = (viewHeight - rotatedHeight * scale) / 2

    private fun rotate(x: Double, y: Double, degrees: Int): Pair<Double, Double> = when (degrees) {
        90 -> rawHeight - y to x
        180 -> rawWidth - x to rawHeight - y
        270 -> y to rawWidth - x
        else -> x to y
    }

    fun rawToView(x: Double, y: Double): Pair<Double, Double> {
        val (rx, ry) = rotate(x, y, rawRotation)
        return rx * scale + offsetX to ry * scale + offsetY
    }

    /** 原始四角在TextureView默认传感器变换和非等比拉伸之后的实际位置。 */
    fun textureSourceCorners(): FloatArray {
        val width = if (sensorOrientation % 180 == 0) rawWidth else rawHeight
        val height = if (sensorOrientation % 180 == 0) rawHeight else rawWidth
        return corners { x, y ->
            val (rx, ry) = rotate(x, y, sensorOrientation)
            rx * viewWidth / width to ry * viewHeight / height
        }
    }

    fun textureDestinationCorners(): FloatArray = corners(::rawToView)

    private fun corners(map: (Double, Double) -> Pair<Double, Double>): FloatArray {
        val raw = arrayOf(0.0 to 0.0, rawWidth.toDouble() to 0.0,
            rawWidth.toDouble() to rawHeight.toDouble(), 0.0 to rawHeight.toDouble())
        return FloatArray(8).also { result ->
            raw.forEachIndexed { index, (x, y) ->
                val (vx, vy) = map(x, y)
                result[index * 2] = vx.toFloat()
                result[index * 2 + 1] = vy.toFloat()
            }
        }
    }

    /** 将原始内参投影的NDC两行通过同一个像素仿射变换映射到窗口，深度行保持不变。 */
    fun projection(intrinsics: DoubleArray, near: Double = 1.0, far: Double = 1000.0): DoubleArray {
        require(intrinsics.size == 4 && intrinsics.all { it.isFinite() }
            && intrinsics[0] > 0 && intrinsics[1] > 0) { "相机内参无效" }
        require(near.isFinite() && far.isFinite() && near > 0 && far > near) { "相机裁剪范围无效" }
        val (fx, fy, cx, cy) = intrinsics
        val base = doubleArrayOf(2 * fx / rawWidth, 0.0, 0.0, 0.0,
            0.0, 2 * fy / rawHeight, 0.0, 0.0,
            1 - 2 * cx / rawWidth, 2 * cy / rawHeight - 1, -(far + near) / (far - near), -1.0,
            0.0, 0.0, -2 * far * near / (far - near), 0.0)
        val origin = rawToView(0.0, 0.0)
        val horizontal = rawToView(rawWidth.toDouble(), 0.0)
        val vertical = rawToView(0.0, rawHeight.toDouble())
        val ax = (horizontal.first - origin.first) / viewWidth
        val bx = -(vertical.first - origin.first) / viewWidth
        val tx = (horizontal.first + vertical.first) / viewWidth - 1
        val ay = -(horizontal.second - origin.second) / viewHeight
        val by = (vertical.second - origin.second) / viewHeight
        val ty = 1 - (horizontal.second + vertical.second) / viewHeight
        return base.copyOf().also { result ->
            for (column in 0..3) {
                val index = column * 4
                result[index] = ax * base[index] + bx * base[index + 1] + tx * base[index + 3]
                result[index + 1] = ay * base[index] + by * base[index + 1] + ty * base[index + 3]
            }
        }
    }
}
