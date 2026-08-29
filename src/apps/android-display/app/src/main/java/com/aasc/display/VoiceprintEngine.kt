package com.aasc.display

import android.content.Context
import com.k2fsa.sherpa.onnx.FastClusteringConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarization
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarizationConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationPyannoteModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingManager

// 声纹引擎：特征提取 + 库匹配 + 多人分割（仿 AsrEngine 的 synchronized 防 use-after-free）
// 注意：与 AAR 真实 API 对齐的点（javap 实测，构造签名与计划一致，无需调整）：
//   1) SpeakerEmbeddingManager 构造参数是 dim，必须用 extractor.dim() 实测值（3dspeaker eres2net 输出 512），不能写死
//   2) SpeakerEmbeddingManager.search 未命中返回空串（非 null），Kotlin match() 映射 空串→null
//   3) 各 Config 具名参数（segmentation/embedding/clustering/minDurationOn/minDurationOff）与 AAR 一致
//   4) 外部私有目录模型必须传 null AssetManager，不能按 APK assets 读取
object VoiceprintEngine {
    private var extractor: SpeakerEmbeddingExtractor? = null
    private var manager: SpeakerEmbeddingManager? = null
    private var diarization: OfflineSpeakerDiarization? = null
    private var threshold: Float = 0.5f
    private var multiSpeaker: Boolean = false
    private var speakerCount: Int = VoiceprintSpeakerCount.AUTO

    @Volatile var ready: Boolean = false; private set
    @Volatile var dim: Int = 0; private set
    @Volatile var speakers: List<String> = emptyList(); private set

    data class Segment(val start: Float, val end: Float, val speakerIndex: Int)

    // 加载引擎；segmentationModel 为 null 或 multiSpeaker=false 时不建 diarization
    // synchronized 与 extract/match/diarize 互斥：避免并发时 release 原生引擎导致读已释放句柄
    @Suppress("UNUSED_PARAMETER")
    fun load(
        context: Context,
        embeddingModel: String,
        segmentationModel: String?,
        threshold: Float,
        multiSpeaker: Boolean,
        multiMode: String = "fast",
        speakerCount: Int = VoiceprintSpeakerCount.AUTO
    ): Boolean {
        synchronized(this) {
            return try {
                require(multiMode == "fast") { "正式 APK 只支持快速多段模式" }
                require(speakerCount in VoiceprintSpeakerCount.AUTO..VoiceprintSpeakerCount.MAX) {
                    "speakerCount 必须是 AUTO 或 1-5"
                }
                extractor?.release()
                // embeddingModel 是 APK 私有目录绝对路径，必须让 AAR 走文件系统加载分支。
                extractor = SpeakerEmbeddingExtractor(null, SpeakerEmbeddingExtractorConfig(
                    model = embeddingModel, numThreads = 1, debug = false, provider = "cpu"))
                // dim 以 extractor 实测为准（3dspeaker eres2net 输出 512），禁止写死
                dim = extractor!!.dim()
                manager?.release()
                manager = SpeakerEmbeddingManager(dim)
                if (multiSpeaker && segmentationModel != null) {
                    diarization?.release()
                    // segmentationModel 与 embeddingModel 同样是外部绝对路径，AssetManager 必须为 null。
                    diarization = OfflineSpeakerDiarization(null, OfflineSpeakerDiarizationConfig(
                        segmentation = OfflineSpeakerSegmentationModelConfig(
                            pyannote = OfflineSpeakerSegmentationPyannoteModelConfig(segmentationModel),
                            numThreads = 1, debug = false, provider = "cpu"),
                        embedding = SpeakerEmbeddingExtractorConfig(
                            model = embeddingModel, numThreads = 1, debug = false, provider = "cpu"),
                        clustering = FastClusteringConfig(numClusters = speakerCount, threshold = 0.5f),
                        minDurationOn = 0.3f, minDurationOff = 0.5f))
                } else {
                    diarization?.release()
                    diarization = null
                }
                this.threshold = threshold
                this.multiSpeaker = multiSpeaker
                this.speakerCount = speakerCount
                ready = true
                true
            } catch (e: Exception) {
                release()
                false
            }
        }
    }

    private fun release() {
        extractor?.release(); extractor = null
        manager?.release(); manager = null
        diarization?.release(); diarization = null
        ready = false
    }

    // 重建声纹库（服务器权威库同步后调用）；全量重建避免部分删除残留
    fun setDb(newSpeakers: Map<String, FloatArray>) {
        synchronized(this) {
            val mgr = manager ?: return
            for (name in speakers) mgr.remove(name)
            for ((name, emb) in newSpeakers) mgr.add(name, emb)
            speakers = newSpeakers.keys.toList()
        }
    }

    // 提取说话人特征（16k mono Float32 样本 → embedding）
    @Throws(Exception::class)
    fun extract(samples: FloatArray): FloatArray {
        synchronized(this) {
            val ex = extractor ?: throw IllegalStateException("声纹引擎未加载")
            if (samples.isEmpty()) throw IllegalArgumentException("音频数据为空")
            val stream = ex.createStream()
            try {
                stream.acceptWaveform(samples, 16000)
                stream.inputFinished()
                return ex.compute(stream)
            } finally {
                // OnlineStream 有原生内存，提取完显式 release
                stream.release()
            }
        }
    }

    // 匹配声纹库，返回人名；低于 threshold 或未命中（空串）返回 null
    @Throws(Exception::class)
    fun match(embedding: FloatArray): String? {
        synchronized(this) {
            val mgr = manager ?: throw IllegalStateException("声纹库未加载")
            val name = mgr.search(embedding, threshold)
            return if (name.isEmpty()) null else name
        }
    }

    // 多人分割：返回 [start, end] 秒的分段（speakerIndex 为聚类编号，非人名）
    @Throws(Exception::class)
    fun diarize(samples: FloatArray, requestedSpeakerCount: Int = speakerCount): List<Segment> {
        synchronized(this) {
            val dz = diarization ?: throw IllegalStateException("分割模型未加载")
            require(requestedSpeakerCount in VoiceprintSpeakerCount.AUTO..VoiceprintSpeakerCount.MAX) {
                "speakerCount 必须是 AUTO 或 1-5"
            }
            val segs = dz.process(samples)
            return segs.map { Segment(it.start, it.end, it.speaker) }
        }
    }
}
