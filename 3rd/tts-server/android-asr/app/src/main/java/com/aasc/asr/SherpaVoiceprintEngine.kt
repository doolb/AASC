package com.aasc.asr

import com.k2fsa.sherpa.onnx.FastClusteringConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarization
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarizationConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationPyannoteModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingManager
import java.io.File

data class VoiceprintMatchResult(
    val speaker: String?,
    val similarityScore: Float?,
    val threshold: Float
)

// Sherpa 声纹引擎：负责 embedding 提取、内存声纹库匹配和多人分割。
// 所有 native 操作串行化，避免模型释放与推理并发造成 native 崩溃。
class SherpaVoiceprintEngine {
    private var extractor: SpeakerEmbeddingExtractor? = null
    private var manager: SpeakerEmbeddingManager? = null
    private var diarization: OfflineSpeakerDiarization? = null
    private var threshold = 0.5f
    private var registeredNames: List<String> = emptyList()
    private var registeredEmbeddings: Map<String, FloatArray> = emptyMap()

    @Volatile
    var isLoaded: Boolean = false
        private set

    @Volatile
    var embeddingDim: Int = 0
        private set

    val registeredSpeakers: List<String>
        get() = synchronized(this) { registeredNames.toList() }

    val matchThreshold: Float
        get() = synchronized(this) { threshold }

    @Synchronized
    fun load(embeddingFile: File, segmentationFile: File, threshold: Float = 0.5f): Boolean {
        return try {
            releaseNative()
            extractor = SpeakerEmbeddingExtractor(
                null,
                SpeakerEmbeddingExtractorConfig(
                    model = embeddingFile.absolutePath,
                    numThreads = 1,
                    debug = false,
                    provider = "cpu"
                )
            )
            embeddingDim = extractor!!.dim()
            manager = SpeakerEmbeddingManager(embeddingDim)
            diarization = OfflineSpeakerDiarization(
                null,
                OfflineSpeakerDiarizationConfig(
                    segmentation = OfflineSpeakerSegmentationModelConfig(
                        pyannote = OfflineSpeakerSegmentationPyannoteModelConfig(segmentationFile.absolutePath),
                        numThreads = 1,
                        debug = false,
                        provider = "cpu"
                    ),
                    embedding = SpeakerEmbeddingExtractorConfig(
                        model = embeddingFile.absolutePath,
                        numThreads = 1,
                        debug = false,
                        provider = "cpu"
                    ),
                    clustering = FastClusteringConfig(numClusters = 0, threshold = 0.5f),
                    minDurationOn = 0.3f,
                    minDurationOff = 0.5f
                )
            )
            this.threshold = threshold
            registeredNames = emptyList()
            registeredEmbeddings = emptyMap()
            isLoaded = true
            true
        } catch (_: Exception) {
            releaseNative()
            false
        }
    }

    @Synchronized
    fun setDatabase(database: Map<String, FloatArray>) {
        val currentManager = manager ?: throw IllegalStateException("声纹引擎未加载")
        registeredNames.forEach { currentManager.remove(it) }
        val snapshot = database.mapValues { (_, embedding) -> embedding.copyOf() }
        snapshot.forEach { (name, embedding) -> currentManager.add(name, embedding) }
        registeredNames = snapshot.keys.toList()
        registeredEmbeddings = snapshot
    }

    @Synchronized
    fun extract(samples: FloatArray): FloatArray {
        val currentExtractor = extractor ?: throw IllegalStateException("声纹引擎未加载")
        require(samples.isNotEmpty()) { "音频数据为空" }
        val stream = currentExtractor.createStream()
        return try {
            stream.acceptWaveform(samples, SAMPLE_RATE)
            stream.inputFinished()
            currentExtractor.compute(stream)
        } finally {
            stream.release()
        }
    }

    @Synchronized
    fun match(embedding: FloatArray): VoiceprintMatchResult {
        val currentManager = manager ?: throw IllegalStateException("声纹引擎未加载")
        val matchedSpeaker = currentManager.search(embedding, threshold).takeIf { it.isNotEmpty() }
        val bestMatch = registeredEmbeddings.asSequence()
            .mapNotNull { (name, registeredEmbedding) ->
                VoiceprintSimilarity.cosine(embedding, registeredEmbedding)?.let { score -> name to score }
            }
            .maxByOrNull { it.second }
        val matchedScore = matchedSpeaker?.let { name ->
            registeredEmbeddings[name]?.let { VoiceprintSimilarity.cosine(embedding, it) }
        }
        return VoiceprintMatchResult(
            speaker = matchedSpeaker,
            similarityScore = matchedScore ?: bestMatch?.second,
            threshold = threshold
        )
    }

    @Synchronized
    fun diarize(
        samples: FloatArray,
        speakerCount: Int = VoiceprintSpeakerCount.AUTO
    ): List<VoiceprintSegmentMerger.DiarizedSegment> {
        val currentDiarization = diarization ?: throw IllegalStateException("声纹分割模型未加载")
        require(speakerCount in VoiceprintSpeakerCount.AUTO..VoiceprintSpeakerCount.MAX) {
            "speakerCount 必须是 AUTO 或 1-5"
        }
        val currentConfig = currentDiarization.config
        currentDiarization.setConfig(
            currentConfig.copy(
                clustering = FastClusteringConfig(
                    numClusters = speakerCount,
                    threshold = currentConfig.clustering.threshold
                )
            )
        )
        return currentDiarization.process(samples).map {
            VoiceprintSegmentMerger.DiarizedSegment(it.start, it.end, it.speaker)
        }
    }

    @Synchronized
    fun release() {
        releaseNative()
    }

    private fun releaseNative() {
        diarization?.release()
        diarization = null
        manager?.release()
        manager = null
        extractor?.release()
        extractor = null
        registeredNames = emptyList()
        registeredEmbeddings = emptyMap()
        embeddingDim = 0
        isLoaded = false
    }

    companion object {
        const val SAMPLE_RATE = 16000
    }
}
