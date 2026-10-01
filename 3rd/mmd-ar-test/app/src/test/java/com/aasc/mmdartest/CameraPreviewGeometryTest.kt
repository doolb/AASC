package com.aasc.mmdartest

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.hypot

/** 对生产几何直接做像素/投影数值验证，无相机或Android模拟对象依赖。 */
class CameraPreviewGeometryTest {
    private fun close(expected: Double, actual: Double, tolerance: Double = 1e-6) {
        assertEquals(expected, actual, tolerance)
    }

    private fun cases(): List<CameraPreviewGeometry> = listOf(0, 90, 180, 270).flatMap { sensor ->
        listOf(0, 90, 180, 270).flatMap { display ->
            listOf(720 to 1480, 1480 to 720, 800 to 800, 1920 to 1080).map { (width, height) ->
                CameraPreviewGeometry(640, 480, sensor, display, width, height)
            }
        }
    }

    @Test fun portraitDoesNotRotateTextureSensorAgain() {
        val geometry = CameraPreviewGeometry(640, 480, 90, 0, 720, 1480)
        val source = geometry.textureSourceCorners()
        val target = geometry.textureDestinationCorners()
        // 系统已将原始横向边显示为向下；应用补偿后仍向下，不能再次转为横向。
        close(0.0, (source[2] - source[0]).toDouble())
        close(0.0, (target[2] - target[0]).toDouble())
        close(1480.0, (target[3] - target[1]).toDouble())
        close(-195.0, target[4].toDouble())
        close(915.0, target[0].toDouble())
        assertTrue(target[3] > target[1])
    }

    @Test fun allOrientationsCoverWindowWithoutStretchOrOffCenter() {
        for (geometry in cases()) {
            val center = geometry.rawToView(320.0, 240.0)
            close(geometry.viewWidth / 2.0, center.first)
            close(geometry.viewHeight / 2.0, center.second)
            val x = geometry.rawToView(321.0, 240.0)
            val y = geometry.rawToView(320.0, 241.0)
            val dx = x.first - center.first to x.second - center.second
            val dy = y.first - center.first to y.second - center.second
            close(geometry.scale, hypot(dx.first, dx.second))
            close(geometry.scale, hypot(dy.first, dy.second))
            close(0.0, dx.first * dy.first + dx.second * dy.second)
            val corners = geometry.textureDestinationCorners()
            val xs = (0..3).map { corners[it * 2].toDouble() }
            val ys = (0..3).map { corners[it * 2 + 1].toDouble() }
            assertTrue(xs.min() <= 1e-4 && xs.max() >= geometry.viewWidth - 1e-4)
            assertTrue(ys.min() <= 1e-4 && ys.max() >= geometry.viewHeight - 1e-4)
            close(geometry.viewWidth.toDouble(), xs.min() + xs.max(), 1e-3)
            close(geometry.viewHeight.toDouble(), ys.min() + ys.max(), 1e-3)
        }
    }

    @Test fun projectionMatchesPreviewPixelsForOffCenterIntrinsicsAndRays() {
        val k = doubleArrayOf(713.0, 527.0, 311.0, 219.0)
        val points = listOf(0.0 to 0.0, 640.0 to 480.0, 320.0 to 240.0, 57.3 to 392.8)
        for (geometry in cases()) for ((u, v) in points) for (depth in listOf(2.0, 17.0, 250.0)) {
            val matrix = geometry.projection(k)
            // 独立由像素和内参反推GL相机射线，然后经过生产投影，必须返回预览中的同一点。
            val ray = doubleArrayOf((u - k[2]) * depth / k[0], -(v - k[3]) * depth / k[1], -depth, 1.0)
            val clip = DoubleArray(4) { row -> (0..3).sumOf { column -> matrix[column * 4 + row] * ray[column] } }
            val pixelX = (clip[0] / clip[3] + 1) * geometry.viewWidth / 2
            val pixelY = (1 - clip[1] / clip[3]) * geometry.viewHeight / 2
            val expected = geometry.rawToView(u, v)
            close(expected.first, pixelX)
            close(expected.second, pixelY)
        }
    }

    @Test fun textureCompensationAndRawProjectionUseSamePixelMap() {
        for (geometry in cases()) {
            val source = geometry.textureSourceCorners()
            val target = geometry.textureDestinationCorners()
            // 用三个四角对应点独立解仿射系数，再验证内部点与第四角，覆盖补偿矩阵实际输入。
            val ux = source[2] - source[0]; val uy = source[3] - source[1]
            val vx = source[6] - source[0]; val vy = source[7] - source[1]
            val determinant = ux * vy - uy * vx
            for ((u, v) in listOf(193.0 to 375.0, 640.0 to 480.0)) {
                val fractionU = u / 640; val fractionV = v / 480
                val sx = source[0] + fractionU * ux + fractionV * vx
                val sy = source[1] + fractionU * uy + fractionV * vy
                val alpha = ((sx - source[0]) * vy - (sy - source[1]) * vx) / determinant
                val beta = (ux * (sy - source[1]) - uy * (sx - source[0])) / determinant
                val x = target[0] + alpha * (target[2] - target[0]) + beta * (target[6] - target[0])
                val y = target[1] + alpha * (target[3] - target[1]) + beta * (target[7] - target[1])
                val expected = geometry.rawToView(u, v)
                close(expected.first, x, 1e-3)
                close(expected.second, y, 1e-3)
            }
        }
    }

    @Test fun sameSizeHalfTurnChangesBothPreviewAndProjection() {
        val upright = CameraPreviewGeometry(640, 480, 90, 0, 720, 1480)
        val inverted = upright.copy(displayRotation = 180)
        assertNotEquals(upright, inverted)
        val before = upright.rawToView(125.0, 316.0)
        val after = inverted.rawToView(125.0, 316.0)
        close(720.0, before.first + after.first)
        close(1480.0, before.second + after.second)
        val k = doubleArrayOf(500.0, 500.0, 320.0, 240.0)
        val a = upright.projection(k); val b = inverted.projection(k)
        for (column in 0..3) {
            close(-a[column * 4], b[column * 4])
            close(-a[column * 4 + 1], b[column * 4 + 1])
        }
    }

    @Test fun depthRangePreservedAndInvalidInputsRejected() {
        val geometry = CameraPreviewGeometry(640, 480, 270, 90, 720, 1480)
        val k = doubleArrayOf(500.0, 500.0, 320.0, 240.0)
        val matrix = geometry.projection(k)
        close(-1.0, (-matrix[10] + matrix[14]))
        close(1.0, (-1000 * matrix[10] + matrix[14]) / 1000)
        assertThrows(IllegalArgumentException::class.java) { geometry.copy(viewWidth = 0) }
        assertThrows(IllegalArgumentException::class.java) { geometry.copy(sensorOrientation = 45) }
        assertThrows(IllegalArgumentException::class.java) { geometry.projection(doubleArrayOf(Double.NaN, 1.0, 0.0, 0.0)) }
        assertThrows(IllegalArgumentException::class.java) { geometry.projection(k, near = 1.0, far = 1.0) }
    }
}
