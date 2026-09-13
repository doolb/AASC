package com.aasc.display

import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * 阿里官方 MNN-LLM 的最小 Android 封装。
 *
 * CMake 在配置了 AASC_MNN_ROOT 时编译官方 MnnLlmChat 的 LlmSession；未配置
 * native 依赖时只加载不可用 stub，保证旧 APK 构建链路可以启动但不会虚报 LLM 能力。
 */
class MnnLlmEngine(
    private val cpuPolicyProvider: () -> CpuPolicy?
) {
    interface NativeProgressListener {
        fun onProgress(text: String?, endOfPrompt: Boolean): Boolean
    }

    companion object {
        private const val TAG = "MnnLlmEngine"
        val nativeAvailable: Boolean = try {
            System.loadLibrary("mnn_llm_bridge")
            nativeIsAvailable()
        } catch (error: Throwable) {
            Log.w(TAG, "MNN-LLM native 库不可用: ${error.message}")
            false
        }

        @JvmStatic
        private external fun nativeIsAvailable(): Boolean
    }

    @Volatile
    private var nativePointer: Long = 0L
    @Volatile
    private var configuredThreadCount: Int = 0

    @Synchronized
    fun load(modelDirectory: File, options: JSONObject = JSONObject()): Boolean {
        release()
        if (!nativeAvailable) return false
        val configFile = listOf("config.json", "llm_config.json")
            .map { File(modelDirectory, it) }
            .firstOrNull { it.isFile }
            ?: throw IllegalStateException("MNN 模型缺少 config.json")
        val policy = cpuPolicyProvider()
        policy?.let { CpuAffinity.applyCurrentThread(it.cpuMask) }
        val threadCount = policy?.totalCoreCount?.coerceAtLeast(1) ?: 1
        val mergedOptions = JSONObject(options.toString())
            .put("keep_history", false)
            // 不依赖模型目录或 MNN 默认值，LLM 线程数必须由当前 CPU policy 显式确定。
            .put("thread_num", threadCount)
            .put("mmap_dir", File(modelDirectory, ".mmap").absolutePath)
        nativePointer = nativeLoad(configFile.absolutePath, mergedOptions.toString())
        configuredThreadCount = if (nativePointer != 0L) threadCount else 0
        return nativePointer != 0L
    }

    fun isLoaded(): Boolean = nativePointer != 0L

    fun threadCount(): Int = configuredThreadCount

    fun generate(
        messagesJson: String,
        maxTokens: Int,
        generationOptions: JSONObject,
        listener: NativeProgressListener
    ): String {
        val pointer = nativePointer
        check(pointer != 0L) { "MNN-LLM 模型未加载" }
        cpuPolicyProvider()?.let { CpuAffinity.applyCurrentThread(it.cpuMask) }
        nativeResetCancel(pointer)
        return nativeGenerate(pointer, messagesJson, maxTokens, generationOptions.toString(), listener)
    }

    @Synchronized
    fun release() {
        val pointer = nativePointer
        if (pointer != 0L) {
            nativeRelease(pointer)
            nativePointer = 0L
        }
        configuredThreadCount = 0
    }

    /** 设置 native 取消标志；MNN 在下一个 token 回调边界安全停止。 */
    fun cancel() {
        val pointer = nativePointer
        if (pointer != 0L) nativeCancel(pointer)
    }

    private external fun nativeLoad(configPath: String, optionsJson: String): Long
    private external fun nativeGenerate(
        nativePointer: Long,
        messagesJson: String,
        maxTokens: Int,
        generationOptionsJson: String,
        listener: NativeProgressListener
    ): String
    private external fun nativeRelease(nativePointer: Long)
    private external fun nativeResetCancel(nativePointer: Long)
    private external fun nativeCancel(nativePointer: Long)
}
