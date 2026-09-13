package com.aasc.display

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import com.aasc.display.vision.VisionImageCodec
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

data class MnnLlmStatus(
    val supported: Boolean,
    val state: String,
    val ready: Boolean,
    val selectedModelId: String?,
    val selectedRevision: String?,
    val activeRequests: Int,
    val queueDepth: Int,
    val error: String?,
    val loadedModelId: String? = null,
    val loadedRevision: String? = null,
    val threadCount: Int = 1,
    val loadedThreadCount: Int = 0,
    val selectedCpus: List<Int> = emptyList(),
    val cpuMask: Long = 0L,
    val affinityFallback: Boolean = false
) {
    fun toJson(): JSONObject = JSONObject()
        .put("supported", supported)
        .put("engine", "mnn-llm")
        .put("state", state)
        .put("ready", ready)
        .put("selectedModelId", selectedModelId ?: JSONObject.NULL)
        .put("selectedRevision", selectedRevision ?: JSONObject.NULL)
        .put("activeRequests", activeRequests)
        .put("queueDepth", queueDepth)
        .put("loadedModelId", loadedModelId ?: JSONObject.NULL)
        .put("loadedRevision", loadedRevision ?: JSONObject.NULL)
        .put("threadCount", threadCount)
        .put("loadedThreadCount", loadedThreadCount)
        .put("selectedCpus", JSONArray(selectedCpus))
        .put("cpuMask", cpuMask)
        .put("affinityFallback", affinityFallback)
        .put("error", error ?: JSONObject.NULL)
}

/**
 * APK 的单模型管理器：选择、下载、hash 校验、加载和切换都串行进行；推理期间
 * 模型切换只等待，不中断当前 native 调用，也不向主服务器回退。
 */
class MnnLlmModelManager(
    context: Context,
    private val cpuPolicyProvider: () -> CpuPolicy?
) {
    private val modelRoot = File(context.filesDir, "models/llm")
    private val activeDirectory = File(modelRoot, "active")
    private val stateFile = File(modelRoot, "state.json")
    private val imageRoot = File(context.cacheDir, "llm-images")
    private val remoteModelManager = RemoteModelManager()
    private val switchExecutor = Executors.newSingleThreadExecutor()
    private val inferenceExecutor = Executors.newSingleThreadExecutor()
    private val stateLock = Object()
    private var pendingModelId: String? = null
    private var pendingBaseUrl: String? = null
    private var switching = false
    private var enabled = true
    private var releaseRequested = false
    private var activeRequests = 0
    private var queueDepth = 0
    private var activeRequestId: String? = null
    private val pendingInferenceIds = mutableSetOf<String>()
    private val cancelledRequestIds = mutableSetOf<String>()
    private var selectedModelId: String? = null
    private var selectedRevision: String? = null
    // selected 表示目标模型，loaded 表示当前 native engine 实际完成加载的模型。
    private var loadedModelId: String? = null
    private var loadedRevision: String? = null
    private var lastError: String? = null
    private var currentEngine: MnnLlmEngine? = null
    // CPU policy 更新不直接释放当前引擎，而是用代数标记让下一条推理安全换代。
    private var cpuPolicyGeneration = 0L
    private var loadedCpuPolicyGeneration = -1L
    // 推理结束后的 runtime 预检查期间，模型切换线程必须等待，避免并发替换 native engine。
    private var runtimePreparationInProgress = false
    private val stateListeners = mutableListOf<(MnnLlmStatus) -> Unit>()

    init {
        readSavedState()
    }

    fun addStatusListener(listener: (MnnLlmStatus) -> Unit) {
        synchronized(stateLock) { stateListeners += listener }
    }

    /**
     * 标记 CPU policy 已变化。当前 native 推理继续使用旧引擎，避免配置回调打断生成；
     * 下一条已接受的请求会在调用 generate 前检查代数并重载同一份本地模型缓存。
     */
    fun onCpuPolicyChanged() {
        synchronized(stateLock) {
            cpuPolicyGeneration += 1L
            publishStatusLocked()
        }
    }

    fun status(): MnnLlmStatus = synchronized(stateLock) {
        val cpuPolicy = cpuPolicyProvider()
        MnnLlmStatus(
            supported = MnnLlmEngine.nativeAvailable,
            state = when {
                !enabled -> "disabled"
                switching -> "switching"
                currentEngine?.isLoaded() == true -> "ready"
                lastError != null -> "error"
                selectedModelId == null -> "no_model"
                else -> "not_ready"
            },
            ready = currentEngine?.isLoaded() == true && !switching,
            selectedModelId = selectedModelId,
            selectedRevision = selectedRevision,
            activeRequests = activeRequests,
            queueDepth = queueDepth,
            error = lastError,
            loadedModelId = loadedModelId,
            loadedRevision = loadedRevision,
            threadCount = cpuPolicy?.totalCoreCount?.coerceAtLeast(1) ?: 1,
            loadedThreadCount = currentEngine?.threadCount() ?: 0,
            selectedCpus = cpuPolicy?.selectedCpus ?: emptyList(),
            cpuMask = cpuPolicy?.cpuMask ?: 0L,
            affinityFallback = cpuPolicy?.fallback ?: true
        )
    }

    fun selectModel(
        baseUrl: String,
        modelId: String,
        onStatus: (MnnLlmStatus) -> Unit = {}
    ): JSONObject {
        val normalizedModelId = modelId.trim()
        require(normalizedModelId.isNotEmpty()) { "模型 ID 不能为空" }
        require(baseUrl.isNotBlank()) { "服务器地址为空，无法下载模型" }
        var rejectedByDisabled = false
        synchronized(stateLock) {
            if (!enabled) {
                rejectedByDisabled = true
            } else {
                pendingModelId = normalizedModelId
                pendingBaseUrl = baseUrl
                if (!switching) {
                    switching = true
                    publishStatusLocked()
                    switchExecutor.execute { drainSwitchQueue() }
                }
            }
        }
        if (rejectedByDisabled) {
            onStatus(status())
            return JSONObject()
                .put("accepted", false)
                .put("modelId", normalizedModelId)
                .put("state", "disabled")
                .put("error", "LLM 能力已禁用")
        }
        onStatus(status())
        return JSONObject()
            .put("accepted", true)
            .put("modelId", normalizedModelId)
            .put("state", "switching")
    }

    fun inferAsync(
        requestId: String,
        payload: JSONObject,
        onChunk: (String) -> Unit,
        onCompleted: (String) -> Unit,
        onError: (String, String) -> Unit,
        onStatus: (MnnLlmStatus) -> Unit = {}
    ): JSONObject {
        synchronized(stateLock) {
            if (!enabled) {
                return JSONObject().put("accepted", false).put("error", "LLM 能力已禁用")
            }
            if (!status().ready) {
                return JSONObject().put("accepted", false).put("error", "模型未就绪")
            }
            if (switching) {
                return JSONObject().put("accepted", false).put("error", "模型正在切换")
            }
            if (currentEngine?.isLoaded() != true) {
                return JSONObject().put("accepted", false).put("error", "模型未就绪")
            }
            queueDepth += 1
            pendingInferenceIds += requestId
            publishStatusLocked()
        }
        onStatus(status())
        inferenceExecutor.execute {
            synchronized(stateLock) {
                pendingInferenceIds.remove(requestId)
                queueDepth = (queueDepth - 1).coerceAtLeast(0)
                activeRequests += 1
                activeRequestId = requestId
                publishStatusLocked()
            }
            val imageStore = LlmImageFileStore(imageRoot, requestId)
            try {
                if (isRequestCancelled(requestId)) return@execute
                val engine = ensureEngineForCurrentCpuPolicy()
                if (isRequestCancelled(requestId)) return@execute
                val messages = messagesFromPayload(payload, imageStore)
                val thinkingDisabled = payload.has("enable_thinking")
                    && !payload.isNull("enable_thinking")
                    && !payload.optBoolean("enable_thinking", true)
                val thinkingFilter = if (thinkingDisabled) ThinkOutputFilter() else null
                val generationOptions = JSONObject()
                if (payload.has("enable_thinking") && !payload.isNull("enable_thinking")) {
                    generationOptions.put("enable_thinking", payload.optBoolean("enable_thinking"))
                }
                val maxTokens = payload.optInt(
                    if (payload.optString("protocol") == "responses") "max_output_tokens" else "max_tokens",
                    1024
                ).coerceIn(1, 131072)
                val result = engine.generate(
                    messages.toString(),
                    maxTokens,
                    generationOptions,
                    object : MnnLlmEngine.NativeProgressListener {
                        override fun onProgress(text: String?, endOfPrompt: Boolean): Boolean {
                            if (isRequestCancelled(requestId)) return true
                            if (!text.isNullOrEmpty() && !endOfPrompt) {
                                val output = thinkingFilter?.push(text) ?: text
                                if (output.isNotEmpty()) onChunk(output)
                            }
                            return isRequestCancelled(requestId)
                        }
                    }
                )
                val cancelledAfterGenerate = synchronized(stateLock) {
                    cancelledRequestIds.remove(requestId)
                }
                if (cancelledAfterGenerate) return@execute
                if (thinkingFilter != null) {
                    val pendingOutput = thinkingFilter.finish()
                    if (pendingOutput.isNotEmpty()) onChunk(pendingOutput)
                }
                onCompleted(if (thinkingDisabled) stripThinkBlocks(result) else result)
            } catch (error: Exception) {
                if (!isRequestCancelled(requestId)) {
                    onError(
                        (error as? LlmImageException)?.code ?: "LLM_INFERENCE_FAILED",
                        error.message ?: "MNN-LLM 推理失败"
                    )
                }
            } finally {
                imageStore.cleanup()
                var shouldReconcileRuntime = false
                synchronized(stateLock) {
                    activeRequests = (activeRequests - 1).coerceAtLeast(0)
                    if (activeRequestId == requestId) activeRequestId = null
                    pendingInferenceIds.remove(requestId)
                    cancelledRequestIds.remove(requestId)
                    // 当前 inference executor 是单线程；设置准备标志后再做预检查，
                    // 模型切换线程会等待该标志，避免释放或替换当前 native engine。
                    shouldReconcileRuntime = activeRequests == 0
                        && !switching
                        && pendingModelId == null
                        && currentEngine?.isLoaded() == true
                    runtimePreparationInProgress = shouldReconcileRuntime
                    stateLock.notifyAll()
                    publishStatusLocked()
                }
                if (shouldReconcileRuntime) reconcileRuntimeAfterInference()
            }
        }
        return JSONObject().put("accepted", true).put("requestId", requestId)
    }

    /**
     * 只释放 LLM native 运行时，不删除已经下载的模型文件。
     * 重新启用时优先复用 active 目录，避免重复下载大模型权重。
     */
    fun setEnabled(baseUrl: String, requestedEnabled: Boolean): JSONObject {
        var shouldStartSwitchExecutor = false
        synchronized(stateLock) {
            enabled = requestedEnabled
            if (!requestedEnabled) {
                pendingModelId = null
                pendingBaseUrl = null
                releaseRequested = true
                if (!switching) {
                    switching = true
                    shouldStartSwitchExecutor = true
                }
            } else {
                releaseRequested = false
                val cachedModelId = selectedModelId
                if (cachedModelId != null
                    && currentEngine?.isLoaded() != true
                    && baseUrl.isNotBlank()) {
                    // 释放线程尚未结束时也写入待加载模型，重新启用能够接续本地缓存加载。
                    if (pendingModelId == null) {
                        pendingModelId = cachedModelId
                        pendingBaseUrl = baseUrl
                    }
                    if (!switching) {
                        switching = true
                        shouldStartSwitchExecutor = true
                    }
                }
            }
            publishStatusLocked()
        }
        if (shouldStartSwitchExecutor) {
            switchExecutor.execute { drainSwitchQueue() }
        }
        return JSONObject()
            .put("ok", true)
            .put("enabled", requestedEnabled)
            .put("state", status().state)
            .put("ready", status().ready)
    }

    fun cancel(requestId: String): Boolean {
        synchronized(stateLock) {
            val knownRequest = activeRequestId == requestId || pendingInferenceIds.contains(requestId)
            if (!knownRequest) return false
            cancelledRequestIds += requestId
            if (activeRequestId == requestId) currentEngine?.cancel()
            stateLock.notifyAll()
        }
        return true
    }

    private fun isRequestCancelled(requestId: String): Boolean = synchronized(stateLock) {
        cancelledRequestIds.contains(requestId)
    }

    private fun drainSwitchQueue() {
        try {
            while (true) {
                var action = 0
                var modelId: String? = null
                var baseUrl: String? = null
                synchronized(stateLock) {
                    if (releaseRequested && !enabled) {
                        action = 1
                    } else if (enabled && pendingModelId != null && pendingBaseUrl != null) {
                        action = 2
                        modelId = pendingModelId
                        baseUrl = pendingBaseUrl
                        pendingModelId = null
                        pendingBaseUrl = null
                    }
                }
                if (action == 0) break
                if (action == 1) {
                    releaseEngineWhenIdle()
                } else {
                    switchModel(baseUrl ?: break, modelId ?: break)
                }
            }
        } finally {
            synchronized(stateLock) {
                switching = false
                publishStatusLocked()
            }
        }
    }

    private fun switchModel(baseUrl: String, modelId: String) {
        synchronized(stateLock) {
            if (!enabled) return
            lastError = null
            publishStatusLocked()
            while (activeRequests > 0 || queueDepth > 0 || runtimePreparationInProgress) {
                try {
                    stateLock.wait(250L)
                } catch (error: InterruptedException) {
                    Thread.currentThread().interrupt()
                    lastError = "模型切换等待被中断"
                    publishStatusLocked()
                    return
                }
            }
            if (!enabled) return
            // 重复选择当前已加载模型不重新下载或重载，避免误删仍被旧 engine 使用的 active 目录。
            if (selectedModelId == modelId
                && loadedModelId == modelId
                && currentEngine?.isLoaded() == true) {
                publishStatusLocked()
                return
            }
        }
        var install: RemoteModelInstall? = null
        var candidate: MnnLlmEngine? = null
        try {
            publishState("downloading", false, modelId)
            install = remoteModelManager.ensureModel(
                baseUrl = baseUrl,
                manifestPath = "/api/llm/model-manifest",
                downloadPath = "/api/llm/model",
                modelId = modelId,
                directory = activeDirectory,
                includeModelId = true,
                onProgress = { progress -> publishState("downloading", false, modelId, progress) }
            )
            if (!isEnabled()) {
                if (install.changed) restoreInstall(install)
                install = null
                return
            }
            publishState("loading", false, modelId)
            val loadGeneration = synchronized(stateLock) { cpuPolicyGeneration }
            candidate = MnnLlmEngine(cpuPolicyProvider)
            check(candidate.load(install.directory)) { "MNN-LLM 模型加载失败" }
            if (!isEnabled()) {
                candidate.release()
                candidate = null
                if (install.changed) restoreInstall(install)
                install = null
                return
            }
            val oldEngine: MnnLlmEngine?
            synchronized(stateLock) {
                oldEngine = currentEngine
                currentEngine = candidate
                loadedCpuPolicyGeneration = loadGeneration
                selectedModelId = modelId
                selectedRevision = install.model.revision.ifBlank { install.model.id }
                loadedModelId = modelId
                loadedRevision = selectedRevision
                lastError = null
                writeSavedStateLocked()
                publishStatusLocked()
            }
            oldEngine?.release()
            remoteModelManager.finalizeInstall(install)
            candidate = null
        } catch (error: Exception) {
            candidate?.release()
            install?.let { restoreInstall(it) }
            synchronized(stateLock) {
                lastError = error.message ?: "模型切换失败"
                publishStatusLocked()
            }
        }
    }

    private fun restoreInstall(install: RemoteModelInstall) {
        if (!install.changed) return
        try {
            val restored = remoteModelManager.rollbackInstall(install)
            if (restored != null && currentEngine == null) {
                synchronized(stateLock) {
                    selectedModelId = null
                    selectedRevision = null
                    loadedModelId = null
                    loadedRevision = null
                }
            }
        } catch (error: Exception) {
            synchronized(stateLock) { lastError = "模型回滚失败: ${error.message}" }
        }
    }

    private fun isEnabled(): Boolean = synchronized(stateLock) { enabled }

    /**
     * 在推理执行器中检查模型身份、CPU policy 代数和 MNN engine 实际线程数；发生变化时只重建
     * native runtime，复用 active 目录，因而不会重新下载模型。调用方已将请求计入 activeRequests，
     * 且推理结束后的预检查由 runtimePreparationInProgress 保护，模型切换线程不会并发替换目录。
     */
    private fun ensureEngineForCurrentCpuPolicy(): MnnLlmEngine {
        val modelDirectory: File
        val loadGeneration: Long
        val expectedModelId: String
        val expectedRevision: String?
        val expectedThreadCount: Int
        synchronized(stateLock) {
            val current = currentEngine
            if (current?.isLoaded() != true) {
                throw IllegalStateException("MNN-LLM 模型未就绪")
            }
            expectedModelId = selectedModelId
                ?: throw IllegalStateException("MNN-LLM 模型未选择")
            expectedRevision = selectedRevision
            expectedThreadCount = cpuPolicyProvider()?.totalCoreCount?.coerceAtLeast(1) ?: 1
            val runtimeMatches = loadedCpuPolicyGeneration == cpuPolicyGeneration
                && loadedModelId == expectedModelId
                && loadedRevision == expectedRevision
                && current.threadCount() == expectedThreadCount
            if (runtimeMatches) {
                return current
            }
            if (!enabled) {
                throw IllegalStateException("LLM 能力已禁用")
            }
            if (loadedModelId != expectedModelId || loadedRevision != expectedRevision) {
                throw IllegalStateException("MNN-LLM 当前引擎模型与选中模型不一致")
            }
            modelDirectory = activeDirectory
            loadGeneration = cpuPolicyGeneration
            lastError = null
            publishStatusLocked()
        }

        var reloadedEngine: MnnLlmEngine? = null
        try {
            val candidate = MnnLlmEngine(cpuPolicyProvider)
            reloadedEngine = candidate
            check(candidate.load(modelDirectory)) { "MNN-LLM CPU 配置变更后模型重载失败" }
            check(candidate.threadCount() == expectedThreadCount) {
                "MNN-LLM runtime 线程数不匹配: expected=$expectedThreadCount actual=${candidate.threadCount()}"
            }
            val oldEngine: MnnLlmEngine?
            synchronized(stateLock) {
                if (!enabled) {
                    throw IllegalStateException("LLM 能力已禁用")
                }
                if (selectedModelId != expectedModelId
                    || selectedRevision != expectedRevision
                    || cpuPolicyGeneration != loadGeneration) {
                    throw IllegalStateException("MNN-LLM runtime 配置在重载期间发生变化")
                }
                oldEngine = currentEngine
                currentEngine = candidate
                loadedCpuPolicyGeneration = loadGeneration
                loadedModelId = expectedModelId
                loadedRevision = expectedRevision
                lastError = null
                publishStatusLocked()
            }
            oldEngine?.release()
            reloadedEngine = null
            return candidate
        } catch (error: Exception) {
            reloadedEngine?.release()
            synchronized(stateLock) {
                lastError = error.message ?: "MNN-LLM CPU 配置变更后模型重载失败"
                publishStatusLocked()
            }
            throw error
        }
    }

    /**
     * 当前请求已经完成后，提前准备下一次推理需要的 runtime。模型切换仍由既有切换队列负责；
     * 这里只对同一个已加载模型执行线程数/代数校验，失败不影响刚完成的请求，下一次推理会重试。
     */
    private fun reconcileRuntimeAfterInference() {
        try {
            val shouldCheck = synchronized(stateLock) {
                activeRequests == 0
                    && !switching
                    && pendingModelId == null
                    && currentEngine?.isLoaded() == true
            }
            if (shouldCheck) ensureEngineForCurrentCpuPolicy()
        } catch (error: Exception) {
            synchronized(stateLock) {
                if (lastError.isNullOrBlank()) {
                    lastError = "推理结束后运行时校验失败: ${error.message}"
                }
                publishStatusLocked()
            }
        } finally {
            synchronized(stateLock) {
                runtimePreparationInProgress = false
                stateLock.notifyAll()
                publishStatusLocked()
            }
        }
    }

    /** 在模型切换线程中等待在途推理完成后释放当前 native engine。 */
    private fun releaseEngineWhenIdle() {
        var engineToRelease: MnnLlmEngine? = null
        synchronized(stateLock) {
            while (releaseRequested && !enabled
                && (activeRequests > 0 || queueDepth > 0 || runtimePreparationInProgress)) {
                try {
                    stateLock.wait(250L)
                } catch (error: InterruptedException) {
                    Thread.currentThread().interrupt()
                    lastError = "LLM 内存释放等待被中断"
                    releaseRequested = false
                    publishStatusLocked()
                    return
                }
            }
            if (!releaseRequested || enabled) return
            engineToRelease = currentEngine
            currentEngine = null
            loadedCpuPolicyGeneration = -1L
            loadedModelId = null
            loadedRevision = null
            releaseRequested = false
            lastError = null
        }
        try {
            engineToRelease?.release()
        } catch (error: Exception) {
            synchronized(stateLock) { lastError = "LLM 引擎释放失败: ${error.message}" }
        }
        synchronized(stateLock) { publishStatusLocked() }
    }

    private fun messagesFromPayload(payload: JSONObject, imageStore: LlmImageFileStore): JSONArray {
        val protocol = payload.optString("protocol")
        val messages = if (protocol == "chat.completions") {
            val source = payload.optJSONArray("messages") ?: JSONArray()
            normalizeMessageArray(source, imageStore, "chat.completions")
        } else {
            val input = payload.opt("input")
            normalizeResponsesInput(input, imageStore)
        }
        return messages
    }

    private fun normalizeMessageArray(
        source: JSONArray,
        imageStore: LlmImageFileStore,
        protocol: String
    ): JSONArray {
        val normalized = JSONArray()
        for (index in 0 until source.length()) {
            val message = source.optJSONObject(index)
                ?: throw IllegalArgumentException("LLM 消息无效")
            normalized.put(normalizeMessage(message, imageStore, protocol))
        }
        return normalized
    }

    private fun normalizeMessage(
        message: JSONObject,
        imageStore: LlmImageFileStore,
        protocol: String
    ): JSONObject {
        val role = message.optString("role", "user")
        return JSONObject()
            .put("role", role)
            .put("content", normalizeContent(message.opt("content"), imageStore, protocol))
    }

    private fun normalizeResponsesInput(input: Any?, imageStore: LlmImageFileStore): JSONArray {
        if (input is String) {
            return JSONArray().put(JSONObject().put("role", "user").put("content", sanitizePromptText(input)))
        }
        if (input is JSONObject) {
            return JSONArray().put(normalizeMessage(input, imageStore, "responses"))
        }
        val source = input as? JSONArray ?: throw IllegalArgumentException("Responses input 无效")
        val normalized = JSONArray()
        val directParts = JSONArray()
        for (index in 0 until source.length()) {
            val item = source.optJSONObject(index)
                ?: throw IllegalArgumentException("Responses input item 无效")
            val type = item.optString("type")
            if (type == "message" || item.has("role")) {
                normalized.put(normalizeMessage(item, imageStore, "responses"))
            } else if (type == "input_text" || type == "input_image" || type == "output_text") {
                directParts.put(item)
            } else {
                throw IllegalArgumentException("不支持的 Responses input 类型: ${type.ifBlank { "unknown" }}")
            }
        }
        if (directParts.length() > 0) {
            normalized.put(
                JSONObject()
                    .put("role", "user")
                    .put("content", normalizeContent(directParts, imageStore, "responses"))
            )
        }
        return normalized
    }

    private fun normalizeContent(content: Any?, imageStore: LlmImageFileStore, protocol: String): String {
        if (content == null || content == JSONObject.NULL) return ""
        if (content is String) return sanitizePromptText(content)
        val parts = content as? JSONArray ?: throw IllegalArgumentException("LLM content 无效")
        return buildString {
            for (index in 0 until parts.length()) {
                val part = parts.opt(index)
                if (part is String) {
                    append(sanitizePromptText(part))
                    continue
                }
                val partObject = part as? JSONObject
                    ?: throw IllegalArgumentException("LLM content 片段无效")
                val type = partObject.optString("type")
                when (type) {
                    "text", "input_text", "output_text" -> {
                        append(sanitizePromptText(partObject.optString("text")))
                    }
                    "image_url", "input_image" -> {
                        if (protocol == "chat.completions" && type != "image_url") {
                            throw IllegalArgumentException("Chat Completions 图片类型必须是 image_url")
                        }
                        if (protocol == "responses" && type != "input_image") {
                            throw IllegalArgumentException("Responses 图片类型必须是 input_image")
                        }
                        val imageUrl = extractImageUrl(partObject.opt("image_url"))
                        append("<img>")
                        append(imageStore.materialize(imageUrl))
                        append("</img>")
                    }
                    else -> throw IllegalArgumentException(
                        "不支持的 LLM 内容类型: ${type.ifBlank { "unknown" }}"
                    )
                }
            }
        }
    }

    private fun extractImageUrl(value: Any?): String {
        return when (value) {
            is String -> value
            is JSONObject -> value.optString("url")
            else -> ""
        }.trim().also {
            if (!it.startsWith("data:", ignoreCase = true)) {
                throw LlmImageException("LLM_IMAGE_UNSUPPORTED", "本地 LLM 图片只支持 data URL")
            }
        }
    }

    private fun sanitizePromptText(value: String): String {
        // 只有本地生成的 <img>path</img> 才能触发视觉加载，避免用户文本注入任意文件路径。
        return value.replace("<img>", "<image-tag>", ignoreCase = true)
            .replace("</img>", "</image-tag>", ignoreCase = true)
    }

    private fun stripThinkBlocks(value: String): String {
        return Regex("(?is)<think(?:ing)?>.*?</think(?:ing)?>").replace(value, "")
            .replace(Regex("(?is)<think(?:ing)?>.*$"), "")
            .trimStart()
    }

    private fun publishState(state: String, ready: Boolean, modelId: String, progress: Int? = null) {
        synchronized(stateLock) {
            lastError = null
            val status = status().toJson().put("state", state).put("ready", ready).put("selectedModelId", modelId)
            progress?.let { status.put("progress", it) }
            publishStatusJsonLocked(status)
        }
    }

    private fun publishStatusLocked() {
        publishStatusJsonLocked(status().toJson())
    }

    private fun publishStatusJsonLocked(status: JSONObject) {
        val snapshot = MnnLlmStatus(
            supported = status.optBoolean("supported", false),
            state = status.optString("state", "not_ready"),
            ready = status.optBoolean("ready", false),
            selectedModelId = status.optString("selectedModelId").takeIf { it.isNotBlank() && it != "null" },
            selectedRevision = status.optString("selectedRevision").takeIf { it.isNotBlank() && it != "null" },
            activeRequests = status.optInt("activeRequests", 0),
            queueDepth = status.optInt("queueDepth", 0),
            error = status.optString("error").takeIf { it.isNotBlank() && it != "null" },
            loadedModelId = status.optString("loadedModelId").takeIf { it.isNotBlank() && it != "null" },
            loadedRevision = status.optString("loadedRevision").takeIf { it.isNotBlank() && it != "null" },
            threadCount = status.optInt("threadCount", 1).coerceAtLeast(1),
            loadedThreadCount = status.optInt("loadedThreadCount", 0).coerceAtLeast(0),
            selectedCpus = status.optJSONArray("selectedCpus")?.let(::readIntArray) ?: emptyList(),
            cpuMask = status.optLong("cpuMask", 0L),
            affinityFallback = status.optBoolean("affinityFallback", false)
        )
        stateListeners.toList().forEach { listener -> listener(snapshot) }
    }

    private fun readIntArray(values: org.json.JSONArray): List<Int> {
        return buildList {
            for (index in 0 until values.length()) {
                if (values.opt(index) is Number) add(values.optInt(index))
            }
        }
    }

    private fun readSavedState() {
        if (!stateFile.isFile) return
        try {
            val state = JSONObject(stateFile.readText())
            selectedModelId = state.optString("selectedModelId").takeIf { it.isNotBlank() }
            selectedRevision = state.optString("selectedRevision").takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            selectedModelId = null
            selectedRevision = null
        }
    }

    private fun writeSavedStateLocked() {
        modelRoot.mkdirs()
        val temporary = File(modelRoot, "state.json.tmp")
        temporary.writeText(JSONObject()
            .put("selectedModelId", selectedModelId ?: JSONObject.NULL)
            .put("selectedRevision", selectedRevision ?: JSONObject.NULL)
            .toString())
        check(temporary.renameTo(stateFile)) { "模型状态原子保存失败" }
    }

    fun shutdown() {
        currentEngine?.release()
        switchExecutor.shutdownNow()
        inferenceExecutor.shutdownNow()
        switchExecutor.awaitTermination(1, TimeUnit.SECONDS)
        inferenceExecutor.awaitTermination(1, TimeUnit.SECONDS)
    }
}

private class LlmImageException(
    val code: String,
    message: String
) : IllegalArgumentException(message)

/** 将受信任的 data URL 转成 MNN imgcodecs 可读取的 PNG 临时文件。 */
private class LlmImageFileStore(
    private val root: File,
    requestId: String
) {
    private val directory = File(root, requestId.replace(Regex("[^A-Za-z0-9._-]"), "_"))
    private var sequence = 0

    fun materialize(dataUrl: String): String {
        val bitmap = try {
            VisionImageCodec.decode(dataUrl)
        } catch (error: Exception) {
            throw LlmImageException("LLM_IMAGE_INVALID", error.message ?: "LLM 图片无法解码")
        }
        val target = File(directory, "image-${sequence++}.png")
        try {
            directory.mkdirs()
            FileOutputStream(target).use { output ->
                check(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)) {
                    "LLM 图片转换失败"
                }
            }
            return target.absolutePath
        } catch (error: Exception) {
            target.delete()
            if (error is LlmImageException) throw error
            throw LlmImageException("LLM_IMAGE_INVALID", error.message ?: "LLM 图片转换失败")
        } finally {
            bitmap.recycle()
        }
    }

    fun cleanup() {
        directory.deleteRecursively()
    }
}

/** 流式过滤思考标记，保留跨 chunk 的半截 <think> 标签处理能力。 */
private class ThinkOutputFilter {
    private var pending = ""
    private var insideThink = false

    private val openingTags = listOf("<think>", "<thinking>")
    private val closingTags = listOf("</think>", "</thinking>")

    private fun findTag(value: String, tags: List<String>): Pair<Int, String>? {
        return tags.mapNotNull { tag ->
            val index = value.indexOf(tag, ignoreCase = true)
            if (index >= 0) index to tag else null
        }.minByOrNull { it.first }
    }

    fun push(chunk: String): String {
        pending += chunk
        val output = StringBuilder()
        while (pending.isNotEmpty()) {
            if (insideThink) {
                val endTag = findTag(pending, closingTags)
                if (endTag == null) {
                    pending = pending.takeLast(11)
                    break
                }
                pending = pending.substring(endTag.first + endTag.second.length)
                insideThink = false
                continue
            }
            val startTag = findTag(pending, openingTags)
            if (startTag == null) {
                if (pending.length <= 11) break
                output.append(pending.dropLast(11))
                pending = pending.takeLast(11)
                break
            }
            output.append(pending.substring(0, startTag.first))
            pending = pending.substring(startTag.first + startTag.second.length)
            insideThink = true
        }
        return output.toString()
    }

    fun finish(): String {
        if (insideThink) {
            pending = ""
            return ""
        }
        val output = pending
        pending = ""
        return output
    }
}
