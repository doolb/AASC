package com.aasc.asr

import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

data class VoiceprintSegmentResult(
    val start: Float,
    val end: Float,
    val clusterId: Int,
    val speaker: String?,
    val text: String,
    val error: String? = null
)

data class VoiceprintTestResult(
    val mode: VoiceprintMode,
    val denoise: Boolean,
    val denoiseMs: Long,
    val embeddingDim: Int,
    val matchedSpeaker: String?,
    val text: String,
    val segments: List<VoiceprintSegmentResult>,
    val elapsedMs: Long,
    val diarizationMs: Long,
    val embeddingMs: Long,
    val asrMs: Long
)

data class VoiceprintRegistrationResult(
    val name: String,
    val embeddingDim: Int,
    val denoise: Boolean,
    val denoiseMs: Long
)

// Sherpa 声纹测试协调器：注册、单段和多段请求共用一个线程，避免多个 native 推理同时占用内存。
class VoiceprintTestCoordinator(
    private val asrEngine: AsrEngine,
    private val voiceprintEngine: SherpaVoiceprintEngine,
    private val denoiseEngine: SherpaDenoiseEngine = SherpaDenoiseEngine()
) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val busy = AtomicBoolean(false)
    private val database = linkedMapOf<String, FloatArray>()

    fun isBusy(): Boolean = busy.get()

    fun isReady(): Boolean = voiceprintEngine.isLoaded

    fun denoiseReady(): Boolean = denoiseEngine.isLoaded

    fun embeddingDim(): Int = voiceprintEngine.embeddingDim

    fun registeredSpeakers(): List<String> = synchronized(database) { database.keys.toList() }

    fun register(
        name: String,
        samples: FloatArray,
        cpuMode: CpuMode,
        denoise: Boolean = false
    ): Future<VoiceprintRegistrationResult> =
        submit {
            val normalizedName = name.trim()
            require(normalizedName.isNotEmpty()) { "speaker 名称不能为空" }
            AsrCoordinator.validateSamples(samples)
            CpuAffinity.apply(cpuMode)
            val prepared = prepareAudio(samples, denoise)
            synchronized(database) {
                database[normalizedName] = voiceprintEngine.extract(prepared.samples)
                voiceprintEngine.setDatabase(database)
            }
            VoiceprintRegistrationResult(
                name = normalizedName,
                embeddingDim = voiceprintEngine.embeddingDim,
                denoise = prepared.enabled,
                denoiseMs = prepared.elapsedMs
            )
        }

    fun test(
        mode: VoiceprintMode,
        samples: FloatArray,
        cpuMode: CpuMode,
        speakerCount: Int = VoiceprintSpeakerCount.AUTO,
        denoise: Boolean = false,
        languageMode: AsrLanguageMode = AsrLanguageMode.AUTO
    ): Future<VoiceprintTestResult> =
        submit {
            AsrCoordinator.validateSamples(samples)
            check(asrEngine.isLoaded) { "ASR 模型尚未就绪" }
            check(voiceprintEngine.isLoaded) { "声纹模型尚未就绪" }
            CpuAffinity.apply(cpuMode)
            val prepared = prepareAudio(samples, denoise)
            when (mode) {
                VoiceprintMode.SHERPA_SINGLE -> testSingle(prepared, languageMode)
                VoiceprintMode.SHERPA_MULTI -> testMulti(prepared, languageMode)
                VoiceprintMode.SHERPA_MULTI_FAST -> testFastMulti(prepared, speakerCount, languageMode)
            }
        }

    fun shutdown() {
        executor.shutdownNow()
        voiceprintEngine.release()
        denoiseEngine.release()
    }

    private fun testSingle(audio: PreparedDenoiseAudio, languageMode: AsrLanguageMode): VoiceprintTestResult {
        val started = System.nanoTime()
        val embeddingStarted = System.nanoTime()
        val embedding = voiceprintEngine.extract(audio.samples)
        val embeddingMs = elapsedMs(embeddingStarted)
        val asrStarted = System.nanoTime()
        val text = asrEngine.recognize(audio.samples, languageMode.engineLanguage)
        val asrMs = elapsedMs(asrStarted)
        return VoiceprintTestResult(
            mode = VoiceprintMode.SHERPA_SINGLE,
            denoise = audio.enabled,
            denoiseMs = audio.elapsedMs,
            embeddingDim = voiceprintEngine.embeddingDim,
            matchedSpeaker = voiceprintEngine.match(embedding),
            text = text,
            segments = emptyList(),
            elapsedMs = elapsedMs(started),
            diarizationMs = 0,
            embeddingMs = embeddingMs,
            asrMs = asrMs
        )
    }

    private fun testMulti(audio: PreparedDenoiseAudio, languageMode: AsrLanguageMode): VoiceprintTestResult {
        val started = System.nanoTime()
        val diarizationStarted = System.nanoTime()
        val diarized = voiceprintEngine.diarize(audio.samples)
        val diarizationMs = elapsedMs(diarizationStarted)
        val merged = VoiceprintSegmentMerger.merge(diarized)
        var embeddingMs = 0L
        var asrMs = 0L
        val results = merged.map { segment ->
            val segmentSamples = slice(audio.samples, segment.start, segment.end)
            try {
                val embeddingStarted = System.nanoTime()
                val embedding = voiceprintEngine.extract(segmentSamples)
                embeddingMs += elapsedMs(embeddingStarted)
                val asrStarted = System.nanoTime()
                val text = asrEngine.recognize(segmentSamples, languageMode.engineLanguage)
                asrMs += elapsedMs(asrStarted)
                VoiceprintSegmentResult(
                    start = segment.start,
                    end = segment.end,
                    clusterId = segment.speakerIndex,
                    speaker = voiceprintEngine.match(embedding),
                    text = text
                )
            } catch (error: Exception) {
                VoiceprintSegmentResult(
                    start = segment.start,
                    end = segment.end,
                    clusterId = segment.speakerIndex,
                    speaker = null,
                    text = "",
                    error = error.message ?: "分段处理失败"
                )
            }
        }
        return VoiceprintTestResult(
            mode = VoiceprintMode.SHERPA_MULTI,
            denoise = audio.enabled,
            denoiseMs = audio.elapsedMs,
            embeddingDim = voiceprintEngine.embeddingDim,
            matchedSpeaker = null,
            text = results.mapNotNull { it.text.takeIf(String::isNotEmpty) }.joinToString(" "),
            segments = results,
            elapsedMs = elapsedMs(started),
            diarizationMs = diarizationMs,
            embeddingMs = embeddingMs,
            asrMs = asrMs
        )
    }

    private fun testFastMulti(
        audio: PreparedDenoiseAudio,
        speakerCount: Int,
        languageMode: AsrLanguageMode
    ): VoiceprintTestResult {
        require(speakerCount in VoiceprintSpeakerCount.AUTO..VoiceprintSpeakerCount.MAX) {
            "speakerCount 必须是 AUTO 或 1-5"
        }
        val started = System.nanoTime()
        val diarizationStarted = System.nanoTime()
        val diarized = voiceprintEngine.diarize(audio.samples, speakerCount)
        val diarizationMs = elapsedMs(diarizationStarted)
        val merged = VoiceprintSegmentMerger.merge(diarized)
        var embeddingMs = 0L
        val speakerByCluster = mutableMapOf<Int, String?>()
        val embeddingErrorByCluster = mutableMapOf<Int, String>()

        merged.groupBy { it.speakerIndex }.values
            .mapNotNull { segments -> segments.maxByOrNull { it.end - it.start } }
            .forEach { representative ->
                val segmentSamples = slice(audio.samples, representative.start, representative.end)
                try {
                    val embeddingStarted = System.nanoTime()
                    val embedding = voiceprintEngine.extract(segmentSamples)
                    embeddingMs += elapsedMs(embeddingStarted)
                    speakerByCluster[representative.speakerIndex] = voiceprintEngine.match(embedding)
                } catch (error: Exception) {
                    speakerByCluster[representative.speakerIndex] = null
                    embeddingErrorByCluster[representative.speakerIndex] = error.message ?: "声纹提取失败"
                }
            }

        var asrMs = 0L
        val results = merged.map { segment ->
            val segmentSamples = slice(audio.samples, segment.start, segment.end)
            try {
                val asrStarted = System.nanoTime()
                val text = asrEngine.recognize(segmentSamples, languageMode.engineLanguage)
                asrMs += elapsedMs(asrStarted)
                VoiceprintSegmentResult(
                    start = segment.start,
                    end = segment.end,
                    clusterId = segment.speakerIndex,
                    speaker = speakerByCluster[segment.speakerIndex],
                    text = text,
                    error = embeddingErrorByCluster[segment.speakerIndex]
                )
            } catch (error: Exception) {
                VoiceprintSegmentResult(
                    start = segment.start,
                    end = segment.end,
                    clusterId = segment.speakerIndex,
                    speaker = speakerByCluster[segment.speakerIndex],
                    text = "",
                    error = error.message ?: "分段 ASR 失败"
                )
            }
        }
        return VoiceprintTestResult(
            mode = VoiceprintMode.SHERPA_MULTI_FAST,
            denoise = audio.enabled,
            denoiseMs = audio.elapsedMs,
            embeddingDim = voiceprintEngine.embeddingDim,
            matchedSpeaker = null,
            text = results.mapNotNull { it.text.takeIf(String::isNotEmpty) }.joinToString(" "),
            segments = results,
            elapsedMs = elapsedMs(started),
            diarizationMs = diarizationMs,
            embeddingMs = embeddingMs,
            asrMs = asrMs
        )
    }

    private fun <T> submit(operation: () -> T): Future<T> {
        check(busy.compareAndSet(false, true)) { "声纹服务忙，请稍后重试" }
        return executor.submit(Callable {
            try {
                operation()
            } finally {
                busy.set(false)
            }
        })
    }

    private fun prepareAudio(samples: FloatArray, denoise: Boolean): PreparedDenoiseAudio =
        DenoiseAudioPolicy.prepare(samples, denoise) { denoiseEngine.process(samples) }

    private fun slice(samples: FloatArray, start: Float, end: Float): FloatArray {
        val first = (start * SherpaVoiceprintEngine.SAMPLE_RATE).toInt().coerceIn(0, samples.size)
        val last = (end * SherpaVoiceprintEngine.SAMPLE_RATE).toInt().coerceIn(first + 1, samples.size)
        return samples.copyOfRange(first, last)
    }

    private fun elapsedMs(started: Long): Long =
        TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)
}
