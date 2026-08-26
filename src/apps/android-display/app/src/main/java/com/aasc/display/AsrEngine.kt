package com.aasc.display

import android.content.Context
import java.io.File

// sherpa-onnx OfflineRecognizer 封装（SenseVoice int8，与服务器 asr-service.js 同配置对齐）
// 注意：AAR 的真实构造签名与最初计划有出入，已按 javap 实测调整（详见 task-4-report.md）：
//   1) 外部私有目录使用绝对路径加载模型时，AssetManager 必须传 null；load 保留 Context 参数以兼容现有调用接口
//   2) 特征配置类名是 FeatureConfig（不是 FeatureExtractorConfig）
//   3) useInverseTextNormalization 是 boolean（不是 int 1）
//   4) decode(stream) 返回 void，结果用 getResult(stream).text 取
//   5) OfflineStream 没有 inputFinished()；stream 有 release()，识别完显式释放
object AsrEngine {
    private val lock = Any()
    private var currentPool: AsrEnginePool? = null
    private var currentPolicy: CpuPolicy = CpuCluster.detect().policy(bigCoreCount = 1, littleCoreCount = 1)
    private var currentModelFile: File? = null
    private var currentTokensFile: File? = null

    val isLoaded: Boolean get() = synchronized(lock) { currentPool != null }

    // 加载模型，失败返回 false 不抛异常（由调用方做损坏清理）
    // 模型和 tokens 位于 APK 私有目录并使用绝对路径，AssetManager 必须传 null。
    // 保留 context 参数是为了兼容现有 AsrModelManager 调用接口，不持有 Context 引用。
    // 新池构造成功后再替换旧池；旧池只退休，正在识别的 slot 会在 finally 中自行释放。
    @Suppress("UNUSED_PARAMETER")
    fun load(context: Context, modelFile: File, tokensFile: File): Boolean {
        val policy = synchronized(lock) { currentPolicy }
        val newPool = createPool(policy, modelFile, tokensFile) ?: return false
        synchronized(lock) {
            replacePool(newPool, modelFile, tokensFile)
            return true
        }
    }

    fun configurePolicy(policy: CpuPolicy): Boolean {
        val modelSnapshot: File
        val tokensSnapshot: File
        synchronized(lock) {
            currentPolicy = policy
            val loadedModel = currentModelFile
            val loadedTokens = currentTokensFile
            if (currentPool == null || loadedModel == null || loadedTokens == null) {
                return true
            }
            modelSnapshot = loadedModel
            tokensSnapshot = loadedTokens
        }

        val newPool = createPool(policy, modelSnapshot, tokensSnapshot) ?: return false
        synchronized(lock) {
            currentPolicy = policy
            replacePool(newPool, modelSnapshot, tokensSnapshot)
        }
        return true
    }

    // 一次性识别：输入 16kHz mono Float32 样本，输出文本（空输入/未加载抛异常）
    // 并发上限由 AsrEnginePool 的 slot 队列控制；超过槽位的请求阻塞排队。
    @Throws(Exception::class)
    fun recognize(samples: FloatArray): String {
        if (samples.isEmpty()) throw IllegalArgumentException("音频数据为空")
        val pool = synchronized(lock) {
            (currentPool ?: throw IllegalStateException("ASR 引擎未加载")).retain()
        }
        return try {
            pool.recognizeRetained(samples)
        } finally {
            pool.releaseRetain()
        }
    }

    private fun createPool(policy: CpuPolicy, modelFile: File, tokensFile: File): AsrEnginePool? {
        return try {
            AsrEnginePool.configure(policy, modelFile, tokensFile)
        } catch (e: Exception) {
            android.util.Log.e("AsrEngine", "ASR pool 构造失败: ${e.message}", e)
            null
        }
    }

    private fun replacePool(newPool: AsrEnginePool, modelFile: File, tokensFile: File) {
        val oldPool = currentPool
        currentPool = newPool
        currentModelFile = modelFile
        currentTokensFile = tokensFile
        oldPool?.retire()
    }
}
