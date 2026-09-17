package com.aasc.display

import android.content.Context
import android.content.res.AssetManager
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
    private val cpuPolicyProvider: () -> CpuPolicy?,
    private val bundledModelId: String? = null,
    private val bundledModelRevision: String? = null
) {
    private val modelRoot = File(context.filesDir, "models/llm")
    private val activeDirectory = File(modelRoot, "active")
    // LLM 权重属于显示端推理资产：Node Runtime 不解包它们，首次加载时才物化到这里。
    // 逻辑路径：files/models/llm/bundled/<modelId>，与 server Runtime 完全分离。
    private val bundledModelRoot = File(modelRoot, "bundled")
    private val assetManager: AssetManager = context.assets
    private val offlineModelMetadataAsset = "offline-model-manifest.json"
    private val displayModelAssetPrefix = "display-models"
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
    // 记录当前 native engine 实际加载的目录；CPU runtime 换代必须复用 bundled 或 active 原目录。
    private var currentModelDirectory: File? = null
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
     * offline APK 首次查询状态时自动排队固定 bundled 模型；已有其他模型选择绝不被覆盖。
     * 状态查询可能被页面多次调用，因此只有没有切换/排队任务时才会创建一次切换任务。
     */
    fun ensureDefaultModel() {
        val defaultModelId = bundledModelId ?: return
        var shouldStartSwitchExecutor = false
        synchronized(stateLock) {
            val shouldLoadSavedDefault = selectedModelId == defaultModelId && currentEngine?.isLoaded() != true
            val shouldSelectDefault = selectedModelId == null
            if (!enabled || (!shouldLoadSavedDefault && !shouldSelectDefault)
                || pendingModelId != null || switching) {
                return
            }
            pendingModelId = defaultModelId
            pendingBaseUrl = ""
            switching = true
            shouldStartSwitchExecutor = true
            publishStatusLocked()
        }
        if (shouldStartSwitchExecutor) switchExecutor.execute { drainSwitchQueue() }
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
        require(baseUrl.isNotBlank() || isBundledModelId(normalizedModelId)) { "服务器地址为空，无法下载模型" }
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
                    && (baseUrl.isNotBlank() || isBundledModelId(cachedModelId))) {
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
                    } else if (enabled && pendingModelId != null
                        && (pendingBaseUrl?.isNotBlank() == true || isBundledModelId(pendingModelId!!))) {
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
            val bundledDirectory = bundledModelDirectory(modelId)
            val modelDirectory: File
            if (bundledDirectory != null) {
                publishState("loading", false, modelId)
                ensureBundledModelFromAssets(modelId)
                check(isBundledModelReady(bundledDirectory)) {
                    "offline APK 内置 MNN-LLM 模型校验失败: $modelId"
                }
                modelDirectory = bundledDirectory
            } else {
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
                modelDirectory = install!!.directory
            }
            if (!isEnabled()) {
                install?.takeIf { it.changed }?.let(::restoreInstall)
                install = null
                return
            }
            val loadGeneration = synchronized(stateLock) { cpuPolicyGeneration }
            candidate = MnnLlmEngine(cpuPolicyProvider)
            check(candidate.load(modelDirectory)) { "MNN-LLM 模型加载失败" }
            if (!isEnabled()) {
                candidate.release()
                candidate = null
                install?.takeIf { it.changed }?.let(::restoreInstall)
                install = null
                return
            }
            val oldEngine: MnnLlmEngine?
            synchronized(stateLock) {
                oldEngine = currentEngine
                currentEngine = candidate
                currentModelDirectory = modelDirectory
                loadedCpuPolicyGeneration = loadGeneration
                selectedModelId = modelId
                selectedRevision = install?.model?.revision?.ifBlank { install?.model?.id }
                    ?: bundledModelRevision?.takeIf { it.isNotBlank() }
                    ?: modelId
                loadedModelId = modelId
                loadedRevision = selectedRevision
                lastError = null
                writeSavedStateLocked()
                publishStatusLocked()
            }
            oldEngine?.release()
            install?.let(remoteModelManager::finalizeInstall)
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

    private fun isBundledModelId(modelId: String): Boolean = bundledModelId == modelId

    private fun bundledModelDirectory(modelId: String): File? {
        return if (isBundledModelId(modelId)) {
            File(bundledModelRoot, modelId)
        } else {
            null
        }
    }

    /** 更新 APK 前计算尚未落盘的 bundled 模型体积，用于预留模型和安装器空间。 */
    fun estimateBundledModelMaterializationBytes(modelId: String): Long {
        require(isBundledModelId(modelId)) { "offline APK 未配置 bundled 模型: $modelId" }
        val destination = bundledModelDirectory(modelId)
            ?: throw IllegalStateException("offline bundled 模型目录无效")
        if (isBundledModelReady(destination)) return 0L
        val files = readBundledModelDefinition(modelId).optJSONArray("files")
            ?: throw IllegalStateException("offline 模型元数据缺少 files")
        var total = 0L
        for (index in 0 until files.length()) {
            val item = files.optJSONObject(index)
                ?: throw IllegalStateException("offline 模型文件元数据无效")
            val size = item.optLong("size", -1L)
            require(size >= 0L && Long.MAX_VALUE - total >= size) {
                "offline 模型文件大小无效或总大小溢出"
            }
            total += size
        }
        return total
    }

    /** 在完整 APK 的模型 assets 仍可读时，将未缓存模型安全物化到显示端私有模型目录。 */
    fun ensureBundledModelMaterialized(modelId: String): File {
        require(isBundledModelId(modelId)) { "offline APK 未配置 bundled 模型: $modelId" }
        val destination = bundledModelDirectory(modelId)
            ?: throw IllegalStateException("offline bundled 模型目录无效")
        ensureBundledModelFromAssets(modelId)
        check(isBundledModelReady(destination)) { "offline APK 内置模型校验失败: $modelId" }
        return destination
    }

    /**
     * 从 APK 的独立 display-models asset 懒加载内置模型。这里的复制是显示端自己的
     * MNN 文件缓存，不进入 aasc-server，也不走在线 active 下载目录；写入完成前不会
     * 替换现有 bundled 目录，避免进程重启或模型切换留下半套权重。
     */
    private fun ensureBundledModelFromAssets(modelId: String): File {
        require(File(modelId).name == modelId) { "offline 模型 ID 无效: $modelId" }
        val destination = File(bundledModelRoot, modelId)
        if (isBundledModelReady(destination)) return destination
        val model = readBundledModelDefinition(modelId)

        val parent = bundledModelRoot.parentFile
            ?: throw IllegalStateException("offline 模型缓存父目录不存在")
        check(parent.isDirectory || parent.mkdirs()) { "无法创建 offline 模型缓存目录" }
        // staging 位于 modelRoot，而最终目录位于 bundled；先创建最终父目录，保证原子 rename 可用。
        check(bundledModelRoot.isDirectory || bundledModelRoot.mkdirs()) {
            "无法创建 offline 模型 bundled 目录"
        }
        val staging = File(parent, ".bundled-$modelId.staging-${System.currentTimeMillis()}")
        val backup = File(parent, ".bundled-$modelId.backup-${System.currentTimeMillis()}")
        staging.deleteRecursively()
        backup.deleteRecursively()
        check(staging.mkdirs()) { "无法创建 offline 模型临时目录" }
        try {
            val files = model.optJSONArray("files")
                ?: throw IllegalStateException("offline 模型元数据缺少 files")
            val markerFiles = JSONArray()
            for (index in 0 until files.length()) {
                val item = files.optJSONObject(index)
                    ?: throw IllegalStateException("offline 模型文件元数据无效")
                val name = item.optString("name").trim()
                val size = item.optLong("size", -1L)
                val sha256 = item.optString("sha256").trim()
                require(name.isNotEmpty() && File(name).name == name) {
                    "offline 模型文件名无效: $name"
                }
                require(size >= 0L && Regex("[0-9a-fA-F]{64}").matches(sha256)) {
                    "offline 模型文件校验信息无效: $name"
                }
                val assetPath = item.optString("assetPath").trim()
                    .ifEmpty { "$displayModelAssetPrefix/$modelId/$name" }
                require(assetPath.startsWith("$displayModelAssetPrefix/$modelId/")) {
                    "offline 模型 asset 路径无效: $assetPath"
                }
                val output = File(staging, name)
                assetManager.open(assetPath).use { input ->
                    FileOutputStream(output).use { outputStream -> input.copyTo(outputStream) }
                }
                check(output.isFile && output.length() == size && ModelHash.matches(output, sha256)) {
                    "offline 模型文件校验失败: $name"
                }
                markerFiles.put(JSONObject()
                    .put("name", name)
                    .put("size", size)
                    .put("sha256", sha256.lowercase()))
            }
            check(markerFiles.length() > 0) { "offline 模型没有可加载文件" }
            File(staging, ".manifest.json").writeText(JSONObject()
                .put("modelId", modelId)
                .put("revision", model.optString("revision").trim())
                .put("files", markerFiles)
                .toString())

            if (destination.exists()) check(destination.renameTo(backup)) {
                "无法暂存旧 offline 模型缓存"
            }
            check(staging.renameTo(destination)) { "无法切换 offline 模型缓存" }
            backup.deleteRecursively()
            return destination
        } catch (error: Exception) {
            staging.deleteRecursively()
            if (backup.isDirectory && !destination.exists()) backup.renameTo(destination)
            throw IllegalStateException("从 APK 物化 MNN-LLM 模型失败: ${error.message}", error)
        }
    }

    private fun readBundledModelDefinition(modelId: String): JSONObject {
        return try {
            val metadata = assetManager.open(offlineModelMetadataAsset).bufferedReader().use { reader ->
                JSONObject(reader.readText())
            }
            val models = metadata.optJSONArray("models")
                ?: throw IllegalStateException("offline 模型元数据缺少 models")
            for (index in 0 until models.length()) {
                val model = models.optJSONObject(index) ?: continue
                if (model.optString("modelId").trim() == modelId) return model
            }
            throw IllegalStateException("offline APK 未内置模型: $modelId")
        } catch (error: Exception) {
            throw IllegalStateException("读取 offline 模型元数据失败: ${error.message}", error)
        }
    }

    /**
     * 校验 APK 安装目录中的 marker、文件大小和 SHA-256；校验过程分块读取，避免一次性占用模型大小的内存。
     * marker 是构建时从服务器模型清单生成的固定文件，不能只依赖文件是否存在就报告 ready。
     */
    private fun isBundledModelReady(directory: File): Boolean {
        return try {
            val canonicalDirectory = directory.canonicalFile
            if (!canonicalDirectory.isDirectory) return false
            val marker = JSONObject(File(canonicalDirectory, ".manifest.json").readText())
            if (marker.optString("modelId") != bundledModelId) return false
            if (bundledModelRevision?.isNotBlank() == true
                && marker.optString("revision") != bundledModelRevision) return false
            val files = marker.optJSONArray("files") ?: return false
            if (files.length() == 0) return false
            val requiredNames = setOf(
                "config.json", "configuration.json", "llm.mnn", "llm.mnn.json",
                "llm.mnn.weight", "llm_config.json", "tokenizer.txt", "visual.mnn",
                "visual.mnn.weight"
            )
            val foundNames = mutableSetOf<String>()
            val rootPath = canonicalDirectory.toPath()
            for (index in 0 until files.length()) {
                val item = files.optJSONObject(index) ?: return false
                val name = item.optString("name").trim()
                val expectedSize = item.optLong("size", -1L)
                val expectedHash = item.optString("sha256").trim()
                if (name.isEmpty() || File(name).name != name || expectedSize <= 0L
                    || !Regex("[0-9a-fA-F]{64}").matches(expectedHash)) {
                    return false
                }
                foundNames += name
                val file = File(canonicalDirectory, name).canonicalFile
                if (!file.toPath().startsWith(rootPath)
                    || !file.isFile
                    || file.length() != expectedSize
                    || !ModelHash.matches(file, expectedHash)) {
                    return false
                }
            }
            requiredNames.all(foundNames::contains)
        } catch (_: Exception) {
            false
        }
    }

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
            modelDirectory = currentModelDirectory ?: activeDirectory
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
            currentModelDirectory = null
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
