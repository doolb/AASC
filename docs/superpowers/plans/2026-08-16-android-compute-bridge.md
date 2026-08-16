# Android 显示端 GPU Compute 桥 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 android-display APK 的 NativeBridge 上新增 `compute()` 桥方法，用离屏 EGL 3.1 上下文执行 GLES compute shader，把结果（数值/图像）回传给 display.html 的 threejs。

**Architecture:** 把纯逻辑（JSON 协议解析、验证、binding 分配、dispatch 计算、格式枚举）抽成可 JVM 单元测试的 `ComputeProtocol`；GL 执行封装在 `ComputeEngine`（单线程 EGL 上下文）；`NativeBridge.compute()` 作为桥入口串起两者；JS 侧新增 `NativeCompute` 封装类对齐 threejs 风格。

**Tech Stack:** Kotlin（AGP 9 内置）+ `android.opengl`（EGL14/GLES31，纯 Kotlin 无 NDK）+ `org.json` + JUnit 4。

## Global Constraints

- 显示端设备 Android 7+（minSdk=24，GLES 3.1 需 API 21+ 已满足）
- shader 语言：GLSL ES 3.10（`#version 310 es`）
- 注释必须中文、详细（CLAUDE.md 规则）
- 不使用 `var`（用 `val`/`let`），异步用 CountDownLatch 同步返回（沿用现有 `takeScreenshot` 模式）
- 不产生一大段 if-else-else if（用 `when` / enum 映射替代）
- 现有桥方法（takeScreenshot/injectTouch/...）不得改动行为
- 纯逻辑单元测试放 `app/src/test/java/`；GL 执行靠真机冒烟验证

---

### Task 1: ComputeProtocol 纯逻辑（解析/验证/binding/dispatch/格式）+ JUnit

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/ComputeProtocol.kt`
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/ComputeProtocolTest.kt`
- Modify: `src/apps/android-display/app/build.gradle.kts`（加 JUnit 依赖）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces:
  - `ComputeProtocol.parse(json: String): ComputeRequest`（解析+验证，失败抛 `ComputeException`）
  - `ComputeProtocol.resolveDispatchSize(workgroupSize: IntArray, dispatchSize: IntArray?, count: Int?): IntArray`
  - `enum class ImageFormat(internalFormat: Int, imageFormat: Int, readbackFormat: Int, readbackType: Int)`，`ImageFormat.fromString(name): ImageFormat?`
  - `data class ComputeRequest(shader, dispatchSize: IntArray, buffers: List<ComputeBuffer>, images: List<ComputeImage>)`
  - `data class ComputeBuffer(binding: Int, data: FloatArray, readback: Boolean)`
  - `data class ComputeImage(binding: Int, width: Int, height: Int, readback: Boolean, format: ImageFormat)`
  - `class ComputeException(message: String) : Exception(message)`

- [ ] **Step 1: 加 JUnit 依赖**

`build.gradle.kts` 的 `dependencies` 块追加一行：

```kotlin
dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    testImplementation("junit:junit:4.13.2")
}
```

- [ ] **Step 2: 写失败测试**

创建 `src/apps/android-display/app/src/test/java/com/aasc/display/ComputeProtocolTest.kt`：

```kotlin
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
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd /mnt/AASC/src/apps/android-display && ./gradlew :app:testDebugUnitTest 2>&1 | tail -30`
Expected: 编译失败（`ComputeProtocol`、`ComputeException` 等符号不存在）

- [ ] **Step 4: 实现 ComputeProtocol**

创建 `src/apps/android-display/app/src/main/java/com/aasc/display/ComputeProtocol.kt`：

```kotlin
package com.aasc.display

import org.json.JSONObject

// image2D storage 格式：internalFormat/imageFormat/readbackFormat/readbackType
// 值为 OpenGL ES 3.1 标准常量（硬编码以便 JVM 单元测试，与 android.opengl.GLES31 一致）
enum class ImageFormat(
    val internalFormat: Int,
    val imageFormat: Int,
    val readbackFormat: Int,
    val readbackType: Int
) {
    RGBA32F(0x8814, 0x8814, 0x1908, 0x1406),   // float32 四通道
    RGBA16F(0x881A, 0x881A, 0x1908, 0x1406),   // half float 四通道
    R32F(0x822E, 0x822E, 0x1903, 0x1406),      // float32 单通道
    RGBA8(0x8058, 0x8058, 0x1908, 0x1401),     // 归一化 uint8 四通道
    RGBA8UI(0x8D7C, 0x8D7C, 0x8D99, 0x1401),   // uint8 整型四通道
    RGBA32UI(0x8D70, 0x8D70, 0x8D99, 0x1405);  // uint32 整型四通道

    companion object {
        fun fromString(name: String): ImageFormat? =
            entries.firstOrNull { it.name.equals(name, ignoreCase = true) }
    }
}

// 单个 SSBO 数据缓冲
data class ComputeBuffer(val binding: Int, val data: FloatArray, val readback: Boolean)

// 单个 image2D
data class ComputeImage(
    val binding: Int,
    val width: Int,
    val height: Int,
    val readback: Boolean,
    val format: ImageFormat
)

// 解析并验证后的计算请求，dispatchSize 已 resolve 为长度 3
data class ComputeRequest(
    val shader: String,
    val dispatchSize: IntArray,
    val buffers: List<ComputeBuffer>,
    val images: List<ComputeImage>
)

class ComputeException(message: String) : Exception(message)

object ComputeProtocol {

    // 解析请求 JSON：验证 + binding 分配 + dispatch 计算，失败抛 ComputeException
    fun parse(json: String): ComputeRequest {
        val obj = JSONObject(json)

        val shader = obj.optString("shader")
        if (shader.isBlank()) throw ComputeException("shader 不能为空")

        val workgroupSize = parseTriple(obj.optJSONArray("workgroupSize"), intArrayOf(64, 1, 1), "workgroupSize")
        val dispatchSize = if (obj.has("dispatchSize") && !obj.isNull("dispatchSize"))
            parseTriple(obj.optJSONArray("dispatchSize"), null, "dispatchSize") else null
        val count = if (obj.has("count") && !obj.isNull("count")) obj.getInt("count") else null

        if (count != null && dispatchSize != null) throw ComputeException("count 与 dispatchSize 互斥")

        val (buffers, images) = parseResources(obj)
        if (buffers.isEmpty() && images.isEmpty()) throw ComputeException("至少提供一个 buffer 或 image")

        val finalDispatch = resolveDispatchSize(workgroupSize, dispatchSize, count)

        return ComputeRequest(shader, finalDispatch, buffers, images)
    }

    // 计算最终 dispatch 尺寸（长度 3）：dispatchSize 优先，否则 count 按 1D 线程总数算
    fun resolveDispatchSize(workgroupSize: IntArray, dispatchSize: IntArray?, count: Int?): IntArray {
        if (dispatchSize != null) return dispatchSize
        if (count != null) {
            if (count <= 0) throw ComputeException("count 必须为正数")
            return intArrayOf(ceilDiv(count, workgroupSize[0]), 1, 1)
        }
        throw ComputeException("count 与 dispatchSize 至少提供一个")
    }

    // 解析 workgroupSize/dispatchSize：补全/裁剪到 3 维
    private fun parseTriple(arr: org.json.JSONArray?, default: IntArray?, name: String): IntArray {
        if (arr == null) return default ?: throw ComputeException("$name 不能为空")
        val out = intArrayOf(
            if (arr.length() > 0) arr.getInt(0) else 1,
            if (arr.length() > 1) arr.getInt(1) else 1,
            if (arr.length() > 2) arr.getInt(2) else 1
        )
        if (out.any { it <= 0 }) throw ComputeException("$name 必须为正整数")
        return out
    }

    // 解析 buffers/images，缺省 binding 按声明顺序从 0 起自动分配（显式 binding 保留并推高计数器）
    private fun parseResources(obj: JSONObject): Pair<List<ComputeBuffer>, List<ComputeImage>> {
        var nextBinding = 0
        val buffers = mutableListOf<ComputeBuffer>()
        val images = mutableListOf<ComputeImage>()

        obj.optJSONArray("buffers")?.let { arr ->
            for (i in 0 until arr.length()) {
                val b = arr.getJSONObject(i)
                val binding = resolveBinding(b, nextBinding)
                nextBinding = maxOf(nextBinding, binding + 1)
                val dataArr = b.getJSONArray("data")
                val data = FloatArray(dataArr.length()) { dataArr.getDouble(it).toFloat() }
                buffers.add(ComputeBuffer(binding, data, b.optBoolean("readback", false)))
            }
        }

        obj.optJSONArray("images")?.let { arr ->
            for (i in 0 until arr.length()) {
                val im = arr.getJSONObject(i)
                val binding = resolveBinding(im, nextBinding)
                nextBinding = maxOf(nextBinding, binding + 1)
                val formatName = im.optString("format", "rgba32f")
                val format = ImageFormat.fromString(formatName)
                    ?: throw ComputeException("不支持的 image 格式: $formatName")
                images.add(ComputeImage(
                    binding,
                    im.getInt("width"),
                    im.getInt("height"),
                    im.optBoolean("readback", false),
                    format
                ))
            }
        }
        return buffers to images
    }

    private fun resolveBinding(obj: JSONObject, nextBinding: Int): Int =
        if (obj.has("binding") && !obj.isNull("binding")) obj.getInt("binding") else nextBinding

    private fun ceilDiv(a: Int, b: Int): Int = (a + b - 1) / b
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd /mnt/AASC/src/apps/android-display && ./gradlew :app:testDebugUnitTest 2>&1 | tail -20`
Expected: `BUILD SUCCESSFUL`，测试全绿

- [ ] **Step 6: Commit**

```bash
cd /mnt/AASC
git add src/apps/android-display/app/src/main/java/com/aasc/display/ComputeProtocol.kt \
        src/apps/android-display/app/src/test/java/com/aasc/display/ComputeProtocolTest.kt \
        src/apps/android-display/app/build.gradle.kts
git commit -m "feat(android-display): compute 桥协议解析与验证纯逻辑 + 单元测试"
```

---

### Task 2: ComputeEngine 离屏 EGL + shader 编译 + SSBO/image + dispatch + 读回

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/ComputeEngine.kt`

**Interfaces:**
- Consumes: `ComputeRequest`/`ComputeBuffer`/`ComputeImage`/`ImageFormat`（Task 1）
- Produces: `ComputeEngine.execute(request: ComputeRequest): String`（返回结果 JSON，与 design 文档响应协议一致）

- [ ] **Step 1: 实现 ComputeEngine**

创建 `src/apps/android-display/app/src/main/java/com/aasc/display/ComputeEngine.kt`：

```kotlin
package com.aasc.display

import android.graphics.Bitmap
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.GLES31
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// 离屏 EGL 3.1 compute 引擎：单 GL 线程串行执行，无 surface（纯计算不渲染到屏）
object ComputeEngine {

    private val glThread = HandlerThread("compute-gl").apply { start() }
    private val glHandler = Handler(glThread.looper)
    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var inited = false

    // 入口：提交到 GL 线程执行，同步等待结果（沿用 takeScreenshot 的同步模式）
    fun execute(request: ComputeRequest): String {
        val latch = CountDownLatch(1)
        var result = """{"error":"compute 超时"}"""
        glHandler.post {
            result = runCatching { run(request) }
                .getOrElse { """{"error":"${it.message}"}""" }
            latch.countDown()
        }
        latch.await(5, TimeUnit.SECONDS)
        return result
    }

    // 在 GL 线程上初始化离屏 EGL 3.1 上下文（懒初始化，仅一次）
    private fun ensureInit() {
        if (inited) return
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        if (display == EGL14.EGL_NO_DISPLAY) throw ComputeException("EGL 获取 display 失败")
        val version = IntArray(2)
        if (!EGL14.eglInitialize(display, version, 0, version, 1))
            throw ComputeException("EGL 初始化失败")

        val configAttribs = intArrayOf(
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
            EGL14.EGL_NONE
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val numConfigs = IntArray(1)
        if (!EGL14.eglChooseConfig(display, configAttribs, 0, configs, 0, 1, numConfigs, 0))
            throw ComputeException("EGL 选择 config 失败")

        val ctxAttribs = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE)
        context = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT, ctxAttribs, 0)
        if (context == EGL14.EGL_NO_CONTEXT) throw ComputeException("EGL 创建 GLES 3.1 上下文失败")

        // 无 surface makeCurrent（依赖 EGL_KHR_surfaceless_context，Android 普遍支持）
        if (!EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, context))
            throw ComputeException("EGL makeCurrent 失败")
        inited = true
    }

    // 主执行流程（必须在 GL 线程上调用）
    private fun run(request: ComputeRequest): String {
        ensureInit()
        val startMs = System.currentTimeMillis()

        val program = buildProgram(request.shader)
        val bufferIds = mutableListOf<Int>()
        val imageIds = mutableListOf<Int>()

        try {
            // 1. 上传 SSBO（按 binding）
            for (b in request.buffers) {
                val id = IntArray(1)
                GLES31.glGenBuffers(1, id, 0)
                GLES31.glBindBuffer(GLES31.GL_SHADER_STORAGE_BUFFER, id[0])
                GLES31.glBufferData(
                    GLES31.GL_SHADER_STORAGE_BUFFER,
                    b.data.size * 4,
                    floatArrayToBuffer(b.data),
                    GLES31.GL_DYNAMIC_DRAW
                )
                GLES31.glBindBufferBase(GLES31.GL_SHADER_STORAGE_BUFFER, b.binding, id[0])
                bufferIds.add(id[0])
            }

            // 2. 分配 image2D（按 binding）
            for (im in request.images) {
                val id = IntArray(1)
                GLES31.glGenTextures(1, id, 0)
                GLES31.glBindTexture(GLES31.GL_TEXTURE_2D, id[0])
                GLES31.glTexStorage2D(GLES31.GL_TEXTURE_2D, 1, im.format.internalFormat, im.width, im.height)
                GLES31.glBindImageTexture(
                    im.binding, id[0], 0, false, 0,
                    GLES31.GL_READ_WRITE, im.format.imageFormat
                )
                imageIds.add(id[0])
            }

            // 3. 执行 compute
            GLES31.glUseProgram(program)
            GLES31.glDispatchCompute(request.dispatchSize[0], request.dispatchSize[1], request.dispatchSize[2])
            GLES31.glMemoryBarrier(
                GLES31.GL_SHADER_STORAGE_BARRIER_BIT or
                GLES31.GL_SHADER_IMAGE_ACCESS_BARRIER_BIT or
                GLES31.GL_BUFFER_UPDATE_BARRIER_BIT
            )

            // 4. 读回 readback:true 的资源
            val result = JSONObject()
            val buffersOut = org.json.JSONArray()
            for (b in request.buffers) {
                if (!b.readback) continue
                buffersOut.put(floatArrayToJson(readBackBuffer(b)))
            }
            val imagesOut = org.json.JSONArray()
            for (im in request.images) {
                if (!im.readback) continue
                val dataUrl = readBackImage(im)
                imagesOut.put(JSONObject()
                    .put("dataUrl", dataUrl)
                    .put("width", im.width)
                    .put("height", im.height)
                    .put("format", im.format.name.lowercase()))
            }
            result.put("buffers", buffersOut)
            result.put("images", imagesOut)
            result.put("ms", System.currentTimeMillis() - startMs)
            result.put("error", JSONObject.NULL)
            return result.toString()
        } finally {
            // 清理 GL 资源
            if (bufferIds.isNotEmpty()) {
                val ids = bufferIds.toIntArray()
                GLES31.glDeleteBuffers(ids.size, ids, 0)
            }
            if (imageIds.isNotEmpty()) {
                val ids = imageIds.toIntArray()
                GLES31.glDeleteTextures(ids.size, ids, 0)
            }
            GLES31.glDeleteProgram(program)
        }
    }

    // 编译 compute shader 并链接，失败返回错误信息（抛 ComputeException）
    private fun buildProgram(source: String): Int {
        val shader = GLES31.glCreateShader(GLES31.GL_COMPUTE_SHADER)
        if (shader == 0) throw ComputeException("创建 compute shader 失败")
        GLES31.glShaderSource(shader, source)
        GLES31.glCompileShader(shader)
        val compileStatus = IntArray(1)
        GLES31.glGetShaderiv(shader, GLES31.GL_COMPILE_STATUS, compileStatus, 0)
        if (compileStatus[0] == 0) {
            val log = GLES31.glGetShaderInfoLog(shader)
            GLES31.glDeleteShader(shader)
            throw ComputeException("shader 编译失败: $log")
        }

        val program = GLES31.glCreateProgram()
        GLES31.glAttachShader(program, shader)
        GLES31.glLinkProgram(program)
        val linkStatus = IntArray(1)
        GLES31.glGetProgramiv(program, GLES31.GL_LINK_STATUS, linkStatus, 0)
        GLES31.glDeleteShader(shader)
        if (linkStatus[0] == 0) {
            val log = GLES31.glGetProgramInfoLog(program)
            GLES31.glDeleteProgram(program)
            throw ComputeException("shader 链接失败: $log")
        }
        return program
    }

    // 读回 SSBO 为 FloatArray
    private fun readBackBuffer(b: ComputeBuffer): FloatArray {
        val id = IntArray(1)
        GLES31.glGetIntegeri_v(GLES31.GL_SHADER_STORAGE_BUFFER_BINDING, b.binding, id, 0)
        GLES31.glBindBuffer(GLES31.GL_SHADER_STORAGE_BUFFER, id[0])
        val buf = GLES31.glMapBufferRange(GLES31.GL_SHADER_STORAGE_BUFFER, 0, b.data.size * 4, GLES31.GL_MAP_READ_BIT)
        val out = FloatArray(b.data.size)
        if (buf != null) {
            buf.order(ByteOrder.nativeOrder()).asFloatBuffer().get(out)
            GLES31.glUnmapBuffer(GLES31.GL_SHADER_STORAGE_BUFFER)
        }
        return out
    }

    // 读回 image2D 为 PNG dataUrl（经 FBO glReadPixels → RGBA8 → Bitmap）
    private fun readBackImage(im: ComputeImage): String {
        val texId = imageTexId(im.binding)
        val fbo = IntArray(1)
        GLES31.glGenFramebuffers(1, fbo, 0)
        GLES31.glBindFramebuffer(GLES31.GL_FRAMEBUFFER, fbo[0])
        GLES31.glFramebufferTexture2D(
            GLES31.GL_FRAMEBUFFER, GLES31.GL_COLOR_ATTACHMENT0, GLES31.GL_TEXTURE_2D, texId, 0
        )

        val rgba = ByteBuffer.allocateDirect(im.width * im.height * 4).order(ByteOrder.nativeOrder())
        GLES31.glReadPixels(0, 0, im.width, im.height, im.format.readbackFormat, im.format.readbackType, rgba)
        GLES31.glBindFramebuffer(GLES31.GL_FRAMEBUFFER, 0)
        GLES31.glDeleteFramebuffers(1, fbo, 0)

        val bytes = toRgba8(rgba, im)
        val bitmap = Bitmap.createBitmap(im.width, im.height, Bitmap.Config.ARGB_8888)
        bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(bytes))
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    // 根据格式把 glReadPixels 原始数据转成 RGBA8 字节（含 float 缩放 / 整型转换 / 单通道复制）
    private fun toRgba8(raw: ByteBuffer, im: ComputeImage): ByteArray {
        val px = im.width * im.height
        val out = ByteArray(px * 4)
        raw.rewind()
        when (im.format) {
            ImageFormat.RGBA8 -> raw.get(out)
            ImageFormat.RGBA8UI -> raw.get(out)  // 整型字节与 rgba8 通道一致
            ImageFormat.RGBA32F, ImageFormat.RGBA16F -> {
                val floats = FloatArray(px * 4)
                raw.asFloatBuffer().get(floats)
                for (i in 0 until px) {
                    for (c in 0 until 4) {
                        out[i * 4 + c] = (floats[i * 4 + c].coerceIn(0f, 1f) * 255f).toInt().toByte()
                    }
                }
            }
            ImageFormat.R32F -> {
                val floats = FloatArray(px)
                raw.asFloatBuffer().get(floats)
                for (i in 0 until px) {
                    val v = (floats[i].coerceIn(0f, 1f) * 255f).toInt().toByte()
                    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = -1
                }
            }
            ImageFormat.RGBA32UI -> {
                val ints = IntArray(px * 4)
                raw.asIntBuffer().get(ints)
                for (i in 0 until px) {
                    for (c in 0 until 4) {
                        out[i * 4 + c] = (ints[i * 4 + c] and 0xFF).toByte()
                    }
                }
            }
        }
        return out
    }

    // 查询 binding 对应的 image 纹理 id（glBindImageTexture 后可通过 GL_SHADER_IMAGE_ACCESS 查询，这里用 GL_TEXTURE_BINDING_2D 近似取当前绑定）
    private fun imageTexId(binding: Int): Int {
        // glGetIntegeri_v(GL_SHADER_STORAGE_BUFFER_BINDING...) 不可用于 image；改为在执行阶段保存 id 映射
        // 简化：compute 阶段已 glBindImageTexture 绑定 texture 到 binding，读回时重新绑定同一纹理对象
        // 但这里需要 texture id —— 由 readBackImage 调用方传入
        throw ComputeException("内部错误：image 读回需绑定纹理 id")
    }

    private fun floatArrayToBuffer(arr: FloatArray): FloatBuffer =
        ByteBuffer.allocateDirect(arr.size * 4).order(ByteOrder.nativeOrder())
            .asFloatBuffer().apply { put(arr); position(0) }

    private fun floatArrayToJson(arr: FloatArray): org.json.JSONArray =
        org.json.JSONArray().apply { arr.forEach { put(it.toDouble()) } }
}
```

> ⚠️ 上面 `imageTexId` 是占位缺陷——image 读回需要知道 compute 阶段分配的纹理 id。Step 2 修正。

- [ ] **Step 2: 修正 image 读回的纹理 id 跟踪**

问题：`glBindImageTexture` 绑定后，读回 `glReadPixels` 需要知道纹理对象 id，但 GLES 没有直接查询 image binding→texture 的 API。修正方案：在 `run` 里维护 `binding → textureId` 的映射，读回时直接使用。

修改 `ComputeEngine.kt` 的 `run` 方法与 `readBackImage` 签名：

把 `imageIds` 从 `List<Int>` 改为 `MutableMap<Int, Int>`（binding → textureId），读回时传纹理 id：

```kotlin
    private fun run(request: ComputeRequest): String {
        ensureInit()
        val startMs = System.currentTimeMillis()
        val program = buildProgram(request.shader)
        val bufferIds = mutableListOf<Int>()
        val imageTexIds = mutableMapOf<Int, Int>()  // binding → texture id

        try {
            for (b in request.buffers) {
                val id = IntArray(1)
                GLES31.glGenBuffers(1, id, 0)
                GLES31.glBindBuffer(GLES31.GL_SHADER_STORAGE_BUFFER, id[0])
                GLES31.glBufferData(GLES31.GL_SHADER_STORAGE_BUFFER, b.data.size * 4, floatArrayToBuffer(b.data), GLES31.GL_DYNAMIC_DRAW)
                GLES31.glBindBufferBase(GLES31.GL_SHADER_STORAGE_BUFFER, b.binding, id[0])
                bufferIds.add(id[0])
            }

            for (im in request.images) {
                val id = IntArray(1)
                GLES31.glGenTextures(1, id, 0)
                GLES31.glBindTexture(GLES31.GL_TEXTURE_2D, id[0])
                GLES31.glTexStorage2D(GLES31.GL_TEXTURE_2D, 1, im.format.internalFormat, im.width, im.height)
                GLES31.glBindImageTexture(im.binding, id[0], 0, false, 0, GLES31.GL_READ_WRITE, im.format.imageFormat)
                imageTexIds[im.binding] = id[0]
            }

            GLES31.glUseProgram(program)
            GLES31.glDispatchCompute(request.dispatchSize[0], request.dispatchSize[1], request.dispatchSize[2])
            GLES31.glMemoryBarrier(
                GLES31.GL_SHADER_STORAGE_BARRIER_BIT or
                GLES31.GL_SHADER_IMAGE_ACCESS_BARRIER_BIT or
                GLES31.GL_BUFFER_UPDATE_BARRIER_BIT
            )

            val result = JSONObject()
            val buffersOut = org.json.JSONArray()
            for (b in request.buffers) {
                if (b.readback) buffersOut.put(floatArrayToJson(readBackBuffer(b)))
            }
            val imagesOut = org.json.JSONArray()
            for (im in request.images) {
                if (im.readback) {
                    val dataUrl = readBackImage(im, imageTexIds[im.binding]!!)
                    imagesOut.put(JSONObject()
                        .put("dataUrl", dataUrl)
                        .put("width", im.width)
                        .put("height", im.height)
                        .put("format", im.format.name.lowercase()))
                }
            }
            result.put("buffers", buffersOut)
            result.put("images", imagesOut)
            result.put("ms", System.currentTimeMillis() - startMs)
            result.put("error", JSONObject.NULL)
            return result.toString()
        } finally {
            if (bufferIds.isNotEmpty()) {
                val ids = bufferIds.toIntArray()
                GLES31.glDeleteBuffers(ids.size, ids, 0)
            }
            if (imageTexIds.isNotEmpty()) {
                val ids = imageTexIds.values.toIntArray()
                GLES31.glDeleteTextures(ids.size, ids, 0)
            }
            GLES31.glDeleteProgram(program)
        }
    }

    private fun readBackImage(im: ComputeImage, texId: Int): String {
        val fbo = IntArray(1)
        GLES31.glGenFramebuffers(1, fbo, 0)
        GLES31.glBindFramebuffer(GLES31.GL_FRAMEBUFFER, fbo[0])
        GLES31.glFramebufferTexture2D(GLES31.GL_FRAMEBUFFER, GLES31.GL_COLOR_ATTACHMENT0, GLES31.GL_TEXTURE_2D, texId, 0)

        val raw = ByteBuffer.allocateDirect(im.width * im.height * 4 * 4).order(ByteOrder.nativeOrder())
        GLES31.glReadPixels(0, 0, im.width, im.height, im.format.readbackFormat, im.format.readbackType, raw)
        GLES31.glBindFramebuffer(GLES31.GL_FRAMEBUFFER, 0)
        GLES31.glDeleteFramebuffers(1, fbo, 0)

        val bytes = toRgba8(raw, im)
        val bitmap = Bitmap.createBitmap(im.width, im.height, Bitmap.Config.ARGB_8888)
        bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(bytes))
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
```

删除 `imageTexId` 方法。

- [ ] **Step 3: 编译验证**

Run: `cd /mnt/AASC/src/apps/android-display && ./gradlew :app:assembleDebug 2>&1 | tail -20`
Expected: `BUILD SUCCESSFUL`，产出 `app/build/outputs/apk/debug/app-debug.apk`

- [ ] **Step 4: Commit**

```bash
cd /mnt/AASC
git add src/apps/android-display/app/src/main/java/com/aasc/display/ComputeEngine.kt
git commit -m "feat(android-display): ComputeEngine 离屏 EGL 3.1 compute 执行引擎"
```

---

### Task 3: NativeBridge.compute() 桥入口

**Files:**
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`

**Interfaces:**
- Consumes: `ComputeProtocol.parse`、`ComputeEngine.execute`（Task 1/2）
- Produces: `NativeBridge.compute(requestJson: String): String`（`@JavascriptInterface`，JS 侧通过 `window.NativeDisplay.compute(json)` 调用）

- [ ] **Step 1: 新增 compute 方法**

在 `NativeBridge.kt` 末尾（`getSystemStats()` 方法后、类结束 `}` 前）新增：

```kotlin
    // GPU compute：JS 传请求 JSON（shader/buffers/images/dispatch），同步返回结果 JSON
    // 解析/验证在 ComputeProtocol（纯逻辑），执行在 ComputeEngine（离屏 EGL 3.1）
    @JavascriptInterface
    fun compute(requestJson: String): String {
        return try {
            val request = ComputeProtocol.parse(requestJson)
            ComputeEngine.execute(request)
        } catch (e: ComputeException) {
            """{"error": "${e.message}"}"""
        } catch (e: Exception) {
            """{"error": "compute 异常: ${e.message}"}"""
        }
    }
```

- [ ] **Step 2: 编译验证**

Run: `cd /mnt/AASC/src/apps/android-display && ./gradlew :app:assembleDebug 2>&1 | tail -20`
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: 真机冒烟（数值翻倍）**

安装 APK 到真机，连接后通过 display.html 控制台执行（或临时测试页）：

```js
const r = JSON.parse(window.NativeDisplay.compute(JSON.stringify({
  shader: `#version 310 es
    layout(local_size_x = 64) in;
    layout(std430, binding = 0) buffer Data { float v[]; } data;
    void main() { uint i = gl_GlobalInvocationID.x; data.v[i] = data.v[i] * 2.0; }`,
  count: 4,
  buffers: [{ data: [1,2,3,4], readback: true }]
})));
// 期望 r.buffers[0] == [2,4,6,8]，r.error == null
```

Expected: `r.buffers[0]` 为 `[2,4,6,8]`，`r.error` 为 null

- [ ] **Step 4: Commit**

```bash
cd /mnt/AASC
git add src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt
git commit -m "feat(android-display): NativeBridge 新增 compute 桥方法"
```

---

### Task 4: JS 封装 NativeCompute + display.html 引入 + 测试入口

**Files:**
- Create: `src/apps/web-mediacenter/ui/public/js/native-compute.js`
- Modify: `src/apps/web-mediacenter/ui/public/display.html`（加一行 `<script>` 引入）

**Interfaces:**
- Consumes: `window.NativeDisplay.compute`（Task 3）
- Produces: `window.NativeCompute`（类，`dispatch()` 方法返回 Promise）

- [ ] **Step 1: 写 NativeCompute 封装**

创建 `src/apps/web-mediacenter/ui/public/js/native-compute.js`：

```js
// GPU compute 桥封装：对齐 threejs WebGPU compute 风格
// 底层调 window.NativeDisplay.compute（APK 离屏 EGL 3.1），结果回传
(function () {
  'use strict';

  class NativeCompute {
    // params: { shader, workgroupSize=[64], count, dispatchSize, buffers, images }
    constructor(params) {
      this.shader = params.shader;
      this.workgroupSize = params.workgroupSize || [64];
      this.count = params.count;
      this.dispatchSize = params.dispatchSize;
      this.buffers = params.buffers || [];
      this.images = params.images || [];
      this.available = !!(window.NativeDisplay && window.NativeDisplay.compute);
    }

    // 执行计算，返回 Promise<{buffers, images, ms, error}>
    async dispatch() {
      if (!this.available) throw new Error('compute 桥不可用');
      if (this.count != null && this.dispatchSize != null) {
        throw new Error('count 与 dispatchSize 互斥');
      }
      const request = {
        shader: this.shader,
        workgroupSize: this.workgroupSize,
        buffers: this.buffers,
        images: this.images
      };
      if (this.count != null) request.count = this.count;
      if (this.dispatchSize != null) request.dispatchSize = this.dispatchSize;

      const raw = window.NativeDisplay.compute(JSON.stringify(request));
      const result = JSON.parse(raw);
      if (result.error) throw new Error(result.error);
      return result;
    }
  }

  window.NativeCompute = NativeCompute;
})();
```

- [ ] **Step 2: display.html 引入**

在 `display.html` 第 40 行 `ort.min.js` 引入之后、第 41 行内联 `<script>` 之前，加一行：

```html
    <script src="js/native-compute.js"></script>
```

- [ ] **Step 3: 真机冒烟（经 JS 封装）**

在 display.html 控制台执行：

```js
const nc = new NativeCompute({
  shader: `#version 310 es
    layout(local_size_x = 64) in;
    layout(std430, binding = 0) buffer Data { float v[]; } data;
    void main() { uint i = gl_GlobalInvocationID.x; data.v[i] = data.v[i] * 2.0; }`,
  count: 4,
  buffers: [{ data: [1,2,3,4], readback: true }]
});
const r = await nc.dispatch();
// 期望 r.buffers[0] == [2,4,6,8]
```

Expected: `r.buffers[0]` 为 `[2,4,6,8]`，无异常

- [ ] **Step 4: Commit**

```bash
cd /mnt/AASC
git add src/apps/web-mediacenter/ui/public/js/native-compute.js \
        src/apps/web-mediacenter/ui/public/display.html
git commit -m "feat(display): NativeCompute JS 封装 + display.html 引入"
```

---

## Self-Review 结果

- **Spec 覆盖**：协议解析/验证/binding/dispatch/格式（Task 1）、离屏 EGL + shader + SSBO/image + dispatch + 读回（Task 2）、桥入口（Task 3）、JS 封装 + 引入（Task 4）——spec 全部章节均有对应任务。
- **占位符扫描**：Task 2 Step 1 的 `imageTexId` 占位缺陷已在 Step 2 修正为 `imageTexIds` map 方案，无残留 placeholder。
- **类型一致性**：`ComputeRequest`/`ComputeBuffer`/`ComputeImage`/`ImageFormat`/`ComputeProtocol.parse`/`ComputeEngine.execute`/`NativeBridge.compute` 命名贯穿 Task 1-3 一致。
- **已知待办**（真机验证时重点观察）：image 读回 `glReadPixels` 的 FBO 附件对整型格式（rgba8ui/rgba32ui）需验证可读性；r32f 单通道读回转 RGBA 的视觉正确性。
