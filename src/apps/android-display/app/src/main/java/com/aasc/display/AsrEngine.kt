package com.aasc.display

import android.content.Context
import android.app.ActivityManager
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
    private var currentLanguageMode: AsrLanguageMode = AsrLanguageMode.AUTO
    private var applicationContext: Context? = null

    @Volatile
    var lastLoadWasMemoryError: Boolean = false
        private set

    val isLoaded: Boolean get() = synchronized(lock) { currentPool != null }

    // 返回当前已生效的 ASR CPU policy，供显示端向服务端回报实际槽位和 affinity。
    fun currentPolicy(): CpuPolicy = synchronized(lock) { currentPolicy }

    // 加载模型，失败返回 false 不抛异常（由调用方做损坏清理）
    // 模型和 tokens 位于 APK 私有目录并使用绝对路径，AssetManager 必须传 null。
    // 保留应用 Context，仅用于在创建 recognizer 前读取可用内存，不持有 Activity 引用。
    // 新池构造成功后再替换旧池；旧池只退休，正在识别的 slot 会在 finally 中自行释放。
    fun load(context: Context, modelFile: File, tokensFile: File): Boolean {
        lastLoadWasMemoryError = false
        val appContext = context.applicationContext
        val policy = synchronized(lock) {
            applicationContext = appContext
            currentPolicy
        }
        val language = synchronized(lock) { currentLanguageMode.engineLanguage }
        val slotCount = chooseSlotCount(appContext, policy.totalCoreCount)
        if (slotCount == 0) {
            lastLoadWasMemoryError = true
            android.util.Log.e("AsrEngine", "ASR 可用内存不足，无法创建单个 recognizer")
            return false
        }
        val newPool = createPool(policy, modelFile, tokensFile, language, slotCount) ?: return false
        synchronized(lock) {
            replacePool(newPool, modelFile, tokensFile)
            return true
        }
    }

    fun configurePolicy(policy: CpuPolicy): Boolean {
        val modelSnapshot: File
        val tokensSnapshot: File
        synchronized(lock) {
            if (currentPolicy == policy) {
                return true
            }
            val loadedModel = currentModelFile
            val loadedTokens = currentTokensFile
            if (currentPool == null || loadedModel == null || loadedTokens == null) {
                currentPolicy = policy
                return true
            }
            modelSnapshot = loadedModel
            tokensSnapshot = loadedTokens
        }

        val language = synchronized(lock) { currentLanguageMode.engineLanguage }
        val slotCount = chooseSlotCount(synchronized(lock) { applicationContext }, policy.totalCoreCount)
        if (slotCount == 0) {
            lastLoadWasMemoryError = true
            return false
        }
        val newPool = createPool(policy, modelSnapshot, tokensSnapshot, language, slotCount) ?: return false
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
        return recognizeRaw(samples)
    }

    // 按请求语言识别；语言变化时只保留一个当前 recognizer pool，避免重复常驻 SenseVoice 模型。
    @Throws(Exception::class)
    fun recognize(samples: FloatArray, languageMode: AsrLanguageMode): String {
        if (!configureLanguage(languageMode)) {
            throw IllegalStateException("ASR 语言配置应用失败")
        }
        return recognizeRaw(samples)
    }

    @Synchronized
    fun configureLanguage(languageMode: AsrLanguageMode): Boolean {
        val modelSnapshot: File
        val tokensSnapshot: File
        synchronized(lock) {
            if (currentLanguageMode == languageMode) return true
            val loadedModel = currentModelFile
            val loadedTokens = currentTokensFile
            if (currentPool == null || loadedModel == null || loadedTokens == null) {
                currentLanguageMode = languageMode
                return true
            }
            modelSnapshot = loadedModel
            tokensSnapshot = loadedTokens
        }
        val slotCount = chooseSlotCount(synchronized(lock) { applicationContext }, synchronized(lock) { currentPolicy }.totalCoreCount)
        if (slotCount == 0) {
            lastLoadWasMemoryError = true
            return false
        }
        val newPool = createPool(
            synchronized(lock) { currentPolicy },
            modelSnapshot,
            tokensSnapshot,
            languageMode.engineLanguage,
            slotCount
        ) ?: return false
        synchronized(lock) {
            currentLanguageMode = languageMode
            replacePool(newPool, modelSnapshot, tokensSnapshot)
        }
        return true
    }

    @Throws(Exception::class)
    private fun recognizeRaw(samples: FloatArray): String {
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

    private fun createPool(
        policy: CpuPolicy,
        modelFile: File,
        tokensFile: File,
        language: String,
        slotCount: Int
    ): AsrEnginePool? {
        return try {
            AsrEnginePool.configure(
                policy,
                modelFile,
                tokensFile,
                language = language,
                slotCountOverride = slotCount
            )
        } catch (e: OutOfMemoryError) {
            android.util.Log.e("AsrEngine", "ASR recognizer 构造发生内存不足，尝试回退到单实例", e)
            if (slotCount <= 1) {
                lastLoadWasMemoryError = true
                null
            } else {
                try {
                    AsrEnginePool.configure(
                        policy,
                        modelFile,
                        tokensFile,
                        language = language,
                        slotCountOverride = 1
                    )
                } catch (fallbackError: OutOfMemoryError) {
                    lastLoadWasMemoryError = true
                    android.util.Log.e("AsrEngine", "ASR 单实例 recognizer 仍然内存不足", fallbackError)
                    null
                } catch (fallbackError: Exception) {
                    android.util.Log.e("AsrEngine", "ASR 单实例回退构造失败: ${fallbackError.message}", fallbackError)
                    null
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("AsrEngine", "ASR pool 构造失败: ${e.message}", e)
            null
        }
    }

    private fun chooseSlotCount(context: Context?, requestedSlots: Int): Int {
        val availableBytes = try {
            val memoryContext = context ?: return requestedSlots.coerceAtLeast(1)
            val activityManager = memoryContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val memoryInfo = ActivityManager.MemoryInfo()
            activityManager.getMemoryInfo(memoryInfo)
            memoryInfo.availMem
        } catch (_: Exception) {
            // 查询失败时保留默认核心数策略，让 recognizer 构造本身决定是否需要 OOM 回退。
            return requestedSlots.coerceAtLeast(1)
        }
        return AsrMemoryPolicy.chooseSlots(availableBytes, requestedSlots)
    }

    private fun replacePool(newPool: AsrEnginePool, modelFile: File, tokensFile: File) {
        val oldPool = currentPool
        currentPool = newPool
        currentModelFile = modelFile
        currentTokensFile = tokensFile
        oldPool?.retire()
    }
}
