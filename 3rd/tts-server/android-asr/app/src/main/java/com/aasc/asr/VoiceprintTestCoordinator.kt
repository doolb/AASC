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
    val similarityScore: Float? = null,
    val text: String,
    val error: String? = null
)

data class VoiceprintTestResult(
    val mode: VoiceprintMode,
    val denoise: Boolean,
    val denoiseMs: Long,
    val asrDenoise: Boolean = false,
    val asrDenoiseMs: Long = 0,
    val voiceprintDenoise: Boolean = false,
    val voiceprintDenoiseMs: Long = 0,
    val embeddingDim: Int,
    val matchedSpeaker: String?,
    val similarityScore: Float? = null,
    val threshold: Float = 0.5f,
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
    val denoiseMs: Long,
    val voiceprintDenoise: Boolean = false,
    val voiceprintDenoiseMs: Long = 0
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

    fun matchThreshold(): Float = voiceprintEngine.matchThreshold

    fun registeredSpeakers(): List<String> = synchronized(database) { database.keys.toList() }

    fun register(
        name: String,
        samples: FloatArray,
        cpuMode: CpuMode,
        voiceprintDenoise: Boolean = false
    ): Future<VoiceprintRegistrationResult> =
        submit {
            val normalizedName = name.trim()
            require(normalizedName.isNotEmpty()) { "speaker 名称不能为空" }
            AsrCoordinator.validateSamples(samples)
            CpuAffinity.apply(cpuMode)
            val prepared = prepareAudio(samples, voiceprintDenoise)
            synchronized(database) {
                database[normalizedName] = voiceprintEngine.extract(prepared.samples)
                voiceprintEngine.setDatabase(database)
            }
            VoiceprintRegistrationResult(
                name = normalizedName,
                embeddingDim = voiceprintEngine.embeddingDim,
                denoise = prepared.enabled,
                denoiseMs = prepared.elapsedMs,
                voiceprintDenoise = prepared.enabled,
                voiceprintDenoiseMs = prepared.elapsedMs
            )
        }

    fun test(
        mode: VoiceprintMode,
        samples: FloatArray,
        cpuMode: CpuMode,
        speakerCount: Int = VoiceprintSpeakerCount.AUTO,
        asrDenoise: Boolean = false,
        voiceprintDenoise: Boolean = false,
        languageMode: AsrLanguageMode = AsrLanguageMode.AUTO
    ): Future<VoiceprintTestResult> =
        submit {
            AsrCoordinator.validateSamples(samples)
            check(asrEngine.isLoaded) { "ASR 模型尚未就绪" }
            check(voiceprintEngine.isLoaded) { "声纹模型尚未就绪" }
            CpuAffinity.apply(cpuMode)
            val preparedPair = DenoiseAudioPolicy.preparePair(
                samples,
                asrDenoise,
                voiceprintDenoise
            ) { denoiseEngine.process(samples) }
            when (mode) {
                VoiceprintMode.SHERPA_SINGLE -> testSingle(preparedPair, languageMode)
                VoiceprintMode.SHERPA_MULTI -> testMulti(preparedPair, speakerCount, languageMode)
                VoiceprintMode.SHERPA_MULTI_FAST -> testFastMulti(preparedPair, speakerCount, languageMode)
            }
        }

    fun shutdown() {
        executor.shutdownNow()
        voiceprintEngine.release()
        denoiseEngine.release()
    }

    private fun testSingle(audio: PreparedDenoisePair, languageMode: AsrLanguageMode): VoiceprintTestResult {
        val started = System.nanoTime()
        val embeddingStarted = System.nanoTime()
        val embedding = voiceprintEngine.extract(audio.voiceprint.samples)
        val embeddingMs = elapsedMs(embeddingStarted)
        val match = voiceprintEngine.match(embedding)
        val asrStarted = System.nanoTime()
        val text = asrEngine.recognize(audio.asr.samples, languageMode.engineLanguage)
        val asrMs = elapsedMs(asrStarted)
        return VoiceprintTestResult(
            mode = VoiceprintMode.SHERPA_SINGLE,
            denoise = audio.voiceprint.enabled,
            denoiseMs = audio.voiceprint.elapsedMs,
            asrDenoise = audio.asr.enabled,
            asrDenoiseMs = audio.asr.elapsedMs,
            voiceprintDenoise = audio.voiceprint.enabled,
            voiceprintDenoiseMs = audio.voiceprint.elapsedMs,
            embeddingDim = voiceprintEngine.embeddingDim,
            matchedSpeaker = match.speaker,
            similarityScore = match.similarityScore,
            threshold = match.threshold,
            text = text,
            segments = emptyList(),
            elapsedMs = elapsedMs(started),
            diarizationMs = 0,
            embeddingMs = embeddingMs,
            asrMs = asrMs
        )
    }

    private fun testMulti(
        audio: PreparedDenoisePair,
        speakerCount: Int,
        languageMode: AsrLanguageMode
    ): VoiceprintTestResult {
        val started = System.nanoTime()
        val diarizationStarted = System.nanoTime()
        val diarized = voiceprintEngine.diarize(audio.voiceprint.samples, speakerCount)
        val diarizationMs = elapsedMs(diarizationStarted)
        val merged = VoiceprintSegmentMerger.merge(diarized)
        var embeddingMs = 0L
        val matched = merged.map { segment ->
            matchSegment(audio.voiceprint, segment) { embeddingMs += it }
        }
        val resolved = resolveSegments(audio.voiceprint, matched) { embeddingMs += it }
        var asrMs = 0L
        val results = recognizeSegments(audio.asr, resolved, languageMode) { asrMs += it }
        return VoiceprintTestResult(
            mode = VoiceprintMode.SHERPA_MULTI,
            denoise = audio.voiceprint.enabled,
            denoiseMs = audio.voiceprint.elapsedMs,
            asrDenoise = audio.asr.enabled,
            asrDenoiseMs = audio.asr.elapsedMs,
            voiceprintDenoise = audio.voiceprint.enabled,
            voiceprintDenoiseMs = audio.voiceprint.elapsedMs,
            embeddingDim = voiceprintEngine.embeddingDim,
            matchedSpeaker = null,
            similarityScore = null,
            threshold = voiceprintEngine.matchThreshold,
            text = results.mapNotNull { it.text.takeIf(String::isNotEmpty) }.joinToString(" "),
            segments = results,
            elapsedMs = elapsedMs(started),
            diarizationMs = diarizationMs,
            embeddingMs = embeddingMs,
            asrMs = asrMs
        )
    }

    private fun testFastMulti(
        audio: PreparedDenoisePair,
        speakerCount: Int,
        languageMode: AsrLanguageMode
    ): VoiceprintTestResult {
        require(speakerCount in VoiceprintSpeakerCount.AUTO..VoiceprintSpeakerCount.MAX) {
            "speakerCount 必须是 AUTO 或 1-5"
        }
        val started = System.nanoTime()
        val diarizationStarted = System.nanoTime()
        val diarized = voiceprintEngine.diarize(audio.voiceprint.samples, speakerCount)
        val diarizationMs = elapsedMs(diarizationStarted)
        val merged = VoiceprintSegmentMerger.merge(diarized)
        var embeddingMs = 0L
        val matchByCluster = mutableMapOf<Int, VoiceprintSegmentPostProcessor.MatchedSegment>()

        merged.groupBy { it.speakerIndex }.values
            .mapNotNull { segments -> segments.maxByOrNull { it.end - it.start } }
            .forEach { representative ->
                matchByCluster[representative.speakerIndex] = matchSegment(audio.voiceprint, representative) { embeddingMs += it }
            }

        val matched = merged.map { segment ->
            matchByCluster.getValue(segment.speakerIndex).copy(
                start = segment.start,
                end = segment.end,
                clusterId = segment.speakerIndex
            )
        }
        val resolved = resolveSegments(audio.voiceprint, matched) { embeddingMs += it }
        var asrMs = 0L
        val results = recognizeSegments(audio.asr, resolved, languageMode) { asrMs += it }
        return VoiceprintTestResult(
            mode = VoiceprintMode.SHERPA_MULTI_FAST,
            denoise = audio.voiceprint.enabled,
            denoiseMs = audio.voiceprint.elapsedMs,
            asrDenoise = audio.asr.enabled,
            asrDenoiseMs = audio.asr.elapsedMs,
            voiceprintDenoise = audio.voiceprint.enabled,
            voiceprintDenoiseMs = audio.voiceprint.elapsedMs,
            embeddingDim = voiceprintEngine.embeddingDim,
            matchedSpeaker = null,
            similarityScore = null,
            threshold = voiceprintEngine.matchThreshold,
            text = results.mapNotNull { it.text.takeIf(String::isNotEmpty) }.joinToString(" "),
            segments = results,
            elapsedMs = elapsedMs(started),
            diarizationMs = diarizationMs,
            embeddingMs = embeddingMs,
            asrMs = asrMs
        )
    }

    private fun matchSegment(
        audio: PreparedDenoiseAudio,
        segment: VoiceprintSegmentMerger.MergedSegment,
        onEmbeddingElapsed: (Long) -> Unit
    ): VoiceprintSegmentPostProcessor.MatchedSegment {
        return try {
            val segmentSamples = slice(audio.samples, segment.start, segment.end)
            val embeddingStarted = System.nanoTime()
            val embedding = voiceprintEngine.extract(segmentSamples)
            onEmbeddingElapsed(elapsedMs(embeddingStarted))
            VoiceprintSegmentPostProcessor.MatchedSegment(
                start = segment.start,
                end = segment.end,
                clusterId = segment.speakerIndex,
                match = voiceprintEngine.match(embedding)
            )
        } catch (error: Exception) {
            VoiceprintSegmentPostProcessor.MatchedSegment(
                start = segment.start,
                end = segment.end,
                clusterId = segment.speakerIndex,
                match = VoiceprintMatchResult(null, null, voiceprintEngine.matchThreshold),
                error = error.message ?: "声纹提取失败"
            )
        }
    }

    private fun resolveSegments(
        audio: PreparedDenoiseAudio,
        segments: List<VoiceprintSegmentPostProcessor.MatchedSegment>,
        onEmbeddingElapsed: (Long) -> Unit
    ): List<VoiceprintSegmentPostProcessor.MatchedSegment> =
        VoiceprintSegmentPostProcessor.resolve(segments) { start, end, clusterId ->
            matchSegment(
                audio,
                VoiceprintSegmentMerger.MergedSegment(start, end, clusterId),
                onEmbeddingElapsed
            )
        }

    private fun recognizeSegments(
        audio: PreparedDenoiseAudio,
        segments: List<VoiceprintSegmentPostProcessor.MatchedSegment>,
        languageMode: AsrLanguageMode,
        onAsrElapsed: (Long) -> Unit
    ): List<VoiceprintSegmentResult> = segments.map { segment ->
        if (segment.error != null) {
            VoiceprintSegmentResult(
                start = segment.start,
                end = segment.end,
                clusterId = segment.clusterId,
                speaker = segment.match.speaker,
                similarityScore = segment.match.similarityScore,
                text = "",
                error = segment.error
            )
        } else {
            try {
                val asrStarted = System.nanoTime()
                val text = asrEngine.recognize(
                    slice(audio.samples, segment.start, segment.end),
                    languageMode.engineLanguage
                )
                onAsrElapsed(elapsedMs(asrStarted))
                VoiceprintSegmentResult(
                    start = segment.start,
                    end = segment.end,
                    clusterId = segment.clusterId,
                    speaker = segment.match.speaker,
                    similarityScore = segment.match.similarityScore,
                    text = text
                )
            } catch (error: Exception) {
                VoiceprintSegmentResult(
                    start = segment.start,
                    end = segment.end,
                    clusterId = segment.clusterId,
                    speaker = segment.match.speaker,
                    similarityScore = segment.match.similarityScore,
                    text = "",
                    error = error.message ?: "分段 ASR 失败"
                )
            }
        }
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
