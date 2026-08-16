package com.aasc.display

import android.graphics.Bitmap
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
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

// 离屏 EGL 3.1 compute 引擎：单 GL 线程串行执行，无 surface（纯计算，不渲染到屏）
object ComputeEngine {

    private val glThread = HandlerThread("compute-gl").apply { start() }
    private val glHandler = Handler(glThread.looper)
    // 懒初始化状态：首次执行时在 GL 线程上建立离屏 EGL 上下文（这些字段只在 ensureInit 里赋值一次）
    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var inited = false

    // 入口：提交到 GL 线程执行，同步等待结果（沿用 takeScreenshot 的同步模式）
    fun execute(request: ComputeRequest): String {
        val latch = CountDownLatch(1)
        var result = """{"error":"compute 超时"}"""
        glHandler.post {
            result = runCatching { run(request) }
                .getOrElse { JSONObject().put("error", it.message ?: it.javaClass.simpleName).toString() }
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
        if (!EGL14.eglChooseConfig(display, configAttribs, 0, configs, 0, 1, numConfigs, 0) || numConfigs[0] == 0)
            throw ComputeException("EGL 选择 config 失败")

        // 用 EGL_KHR_create_context 的 MAJOR/MINOR 显式请求 GLES 3.1（EGL_CONTEXT_CLIENT_VERSION 只能到 3.0）
        val ctxAttribs = intArrayOf(
            EGLExt.EGL_CONTEXT_MAJOR_VERSION_KHR, 3,
            EGLExt.EGL_CONTEXT_MINOR_VERSION_KHR, 1,
            EGL14.EGL_NONE
        )
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
        val imageTexIds = mutableMapOf<Int, Int>()  // binding → texture id

        try {
            // 1. 上传 SSBO（按 binding）
            for (b in request.buffers) {
                val id = IntArray(1)
                GLES31.glGenBuffers(1, id, 0)
                GLES31.glBindBuffer(GLES31.GL_SHADER_STORAGE_BUFFER, id[0])
                GLES31.glBufferData(
                    GLES31.GL_SHADER_STORAGE_BUFFER, b.data.size * 4,
                    floatArrayToBuffer(b.data), GLES31.GL_DYNAMIC_DRAW
                )
                GLES31.glBindBufferBase(GLES31.GL_SHADER_STORAGE_BUFFER, b.binding, id[0])
                bufferIds.add(id[0])
            }

            // 2. 分配 image2D（按 binding），同时记录 binding→textureId 供读回使用
            for (im in request.images) {
                val id = IntArray(1)
                GLES31.glGenTextures(1, id, 0)
                GLES31.glBindTexture(GLES31.GL_TEXTURE_2D, id[0])
                GLES31.glTexStorage2D(GLES31.GL_TEXTURE_2D, 1, im.format.internalFormat, im.width, im.height)
                GLES31.glBindImageTexture(
                    im.binding, id[0], 0, false, 0,
                    GLES31.GL_READ_WRITE, im.format.imageFormat
                )
                imageTexIds[im.binding] = id[0]
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
            // 清理 GL 资源（无论成败都释放本次分配的 buffer / texture / program）
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

    // 编译 compute shader 并链接，失败抛 ComputeException（携带 GL 日志）
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

    // 读回 SSBO 为 FloatArray：按 binding 索引查绑定点 → map → 复制浮点数据
    private fun readBackBuffer(b: ComputeBuffer): FloatArray {
        val id = IntArray(1)
        GLES31.glGetIntegeri_v(GLES31.GL_SHADER_STORAGE_BUFFER_BINDING, b.binding, id, 0)
        GLES31.glBindBuffer(GLES31.GL_SHADER_STORAGE_BUFFER, id[0])
        // glMapBufferRange 返回 java.nio.Buffer，需转成 ByteBuffer 才能按字节序读浮点
        val buf = GLES31.glMapBufferRange(
            GLES31.GL_SHADER_STORAGE_BUFFER, 0, b.data.size * 4, GLES31.GL_MAP_READ_BIT
        )
        val out = FloatArray(b.data.size)
        if (buf != null) {
            (buf as ByteBuffer).order(ByteOrder.nativeOrder()).asFloatBuffer().get(out)
            GLES31.glUnmapBuffer(GLES31.GL_SHADER_STORAGE_BUFFER)
        }
        return out
    }

    // 读回 image2D 为 PNG dataUrl（经 FBO glReadPixels → 原始格式 → ComputePixels 转 ARGB → Bitmap）
    private fun readBackImage(im: ComputeImage, texId: Int): String {
        val fbo = IntArray(1)
        GLES31.glGenFramebuffers(1, fbo, 0)
        GLES31.glBindFramebuffer(GLES31.GL_FRAMEBUFFER, fbo[0])
        GLES31.glFramebufferTexture2D(
            GLES31.GL_FRAMEBUFFER, GLES31.GL_COLOR_ATTACHMENT0, GLES31.GL_TEXTURE_2D, texId, 0
        )

        // 按最宽格式（RGBA32F / RGBA32UI = 每像素 16 字节）分配，覆盖所有格式的读回需求
        val raw = ByteBuffer.allocateDirect(im.width * im.height * 4 * 4).order(ByteOrder.nativeOrder())
        GLES31.glReadPixels(0, 0, im.width, im.height, im.format.readbackFormat, im.format.readbackType, raw)
        GLES31.glBindFramebuffer(GLES31.GL_FRAMEBUFFER, 0)
        GLES31.glDeleteFramebuffers(1, fbo, 0)

        // ComputePixels.toArgb 已做行翻转 + 各格式归一化，返回自顶向下 0xAARRGGBB 像素
        val argb = ComputePixels.toArgb(raw, im.format, im.width, im.height)
        val bitmap = Bitmap.createBitmap(im.width, im.height, Bitmap.Config.ARGB_8888)
        bitmap.setPixels(argb, 0, im.width, 0, 0, im.width, im.height)
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    // FloatArray → 直接缓冲（用于 glBufferData 上传）
    private fun floatArrayToBuffer(arr: FloatArray): FloatBuffer =
        ByteBuffer.allocateDirect(arr.size * 4).order(ByteOrder.nativeOrder())
            .asFloatBuffer().apply { put(arr); position(0) }

    // FloatArray → JSON 数组（readback 输出）
    private fun floatArrayToJson(arr: FloatArray): org.json.JSONArray =
        org.json.JSONArray().apply { arr.forEach { put(it.toDouble()) } }
}
