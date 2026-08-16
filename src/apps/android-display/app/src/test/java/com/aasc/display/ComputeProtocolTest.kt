package com.aasc.display

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ComputeProtocolTest {

    @Test
    fun parse_默认workgroupSize和binding分配() {
        val json = """
        {
          "shader": "#version 310 es\nvoid main(){}",
          "count": 100,
          "buffers": [
            {"data": [1,2,3], "readback": true},
            {"data": [4,5], "readback": false}
          ],
          "images": [
            {"width": 8, "height": 8, "readback": true}
          ]
        }
        """
        val req = ComputeProtocol.parse(json)

        // workgroupSize 缺省 [64,1,1]，count=100 → dispatch.x = ceil(100/64)=2
        assertArrayEquals(intArrayOf(2, 1, 1), req.dispatchSize)
        // buffers 缺省 binding 从 0 起：0、1；images 接续：2
        assertEquals(2, req.buffers.size)
        assertEquals(0, req.buffers[0].binding)
        assertEquals(1, req.buffers[1].binding)
        assertEquals(2, req.images[0].binding)
        assertTrue(req.buffers[0].readback)
    }

    @Test
    fun parse_count与dispatchSize互斥抛异常() {
        val json = """
        {
          "shader": "#version 310 es\nvoid main(){}",
          "count": 10,
          "dispatchSize": [2, 1, 1],
          "buffers": [{"data": [1], "readback": true}]
        }
        """
        try {
            ComputeProtocol.parse(json)
            throw AssertionError("应抛 ComputeException")
        } catch (e: ComputeException) {
            assertTrue(e.message!!.contains("互斥"))
        }
    }

    @Test
    fun parse_显式binding覆盖自动分配() {
        val json = """
        {
          "shader": "#version 310 es\nvoid main(){}",
          "dispatchSize": [1,1,1],
          "buffers": [
            {"binding": 5, "data": [1], "readback": true},
            {"data": [2], "readback": true}
          ]
        }
        """
        val req = ComputeProtocol.parse(json)
        assertEquals(5, req.buffers[0].binding)
        // 第二个缺省 binding 分配为 max(5,0)+1 = 6
        assertEquals(6, req.buffers[1].binding)
    }

    @Test
    fun parse_不支持的image格式抛异常() {
        val json = """
        {
          "shader": "#version 310 es\nvoid main(){}",
          "dispatchSize": [1,1,1],
          "images": [{"width": 2, "height": 2, "readback": true, "format": "bogus"}]
        }
        """
        try {
            ComputeProtocol.parse(json)
            throw AssertionError("应抛 ComputeException")
        } catch (e: ComputeException) {
            assertTrue(e.message!!.contains("格式"))
        }
    }

    @Test
    fun parse_空资源抛异常() {
        val json = """
        {"shader": "#version 310 es\nvoid main(){}", "dispatchSize": [1,1,1]}
        """
        try {
            ComputeProtocol.parse(json)
            throw AssertionError("应抛 ComputeException")
        } catch (e: ComputeException) {
            assertTrue(e.message!!.contains("至少"))
        }
    }

    @Test
    fun imageFormat_fromString与GL常量值() {
        // rgba32f = GL_RGBA32F 0x8814, 读回 GL_RGBA 0x1908 + GL_FLOAT 0x1406
        val f = ImageFormat.fromString("rgba32f")
        assertEquals(0x8814, f!!.internalFormat)
        assertEquals(0x8814, f.imageFormat)
        assertEquals(0x1908, f.readbackFormat)
        assertEquals(0x1406, f.readbackType)
        // rgba8ui = 读回 GL_RGBA_INTEGER 0x8D99 + GL_UNSIGNED_BYTE 0x1401
        val ui = ImageFormat.fromString("rgba8ui")
        assertEquals(0x8D99, ui!!.readbackFormat)
        assertEquals(0x1401, ui.readbackType)
        // 大小写不敏感
        assertEquals(ImageFormat.R32F, ImageFormat.fromString("R32F"))
    }

    @Test
    fun resolveDispatchSize_count计算() {
        assertArrayEquals(
            intArrayOf(16, 1, 1),
            ComputeProtocol.resolveDispatchSize(intArrayOf(64, 1, 1), null, 1000)
        )
    }

    @Test
    fun resolveDispatchSize_dispatchSize补全3维() {
        assertArrayEquals(
            intArrayOf(2, 1, 1),
            ComputeProtocol.resolveDispatchSize(intArrayOf(64, 1, 1), intArrayOf(2), null)
        )
    }
}
