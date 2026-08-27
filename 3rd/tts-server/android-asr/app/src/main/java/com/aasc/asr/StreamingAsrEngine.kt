package com.aasc.asr

import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import java.io.Closeable
import java.io.File

// Sherpa OnlineRecognizer 流式 ASR 封装：一个引擎可以创建多个独立会话。
class StreamingAsrEngine {
    private var recognizer: OnlineRecognizer? = null

    @Volatile
    var isLoaded: Boolean = false
        private set

    @Synchronized
    fun load(encoder: File, decoder: File, joiner: File, tokens: File): Boolean {
        release()
        require(listOf(encoder, decoder, joiner, tokens).all { it.isFile }) { "流式 ASR 模型文件不完整" }
        return try {
            val config = OnlineRecognizerConfig(
                featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
                modelConfig = OnlineModelConfig(
                    transducer = OnlineTransducerModelConfig(
                        encoder = encoder.absolutePath,
                        decoder = decoder.absolutePath,
                        joiner = joiner.absolutePath
                    ),
                    tokens = tokens.absolutePath,
                    numThreads = 1,
                    debug = false,
                    provider = "cpu",
                    modelType = "zipformer"
                ),
                enableEndpoint = true
            )
            recognizer = OnlineRecognizer(null, config)
            isLoaded = true
            true
        } catch (error: Exception) {
            recognizer = null
            isLoaded = false
            false
        }
    }

    @Synchronized
    fun createSession(): StreamingAsrSession {
        val current = recognizer ?: throw IllegalStateException("流式 ASR 模型尚未就绪")
        return StreamingAsrSession(this, current.createStream(""))
    }

    @Synchronized
    internal fun accept(session: StreamingAsrSession, samples: FloatArray): String {
        check(isSessionAvailable(session)) { "流式 ASR 会话已关闭" }
        require(samples.isNotEmpty()) { "音频分片不能为空" }
        val current = recognizer ?: throw IllegalStateException("流式 ASR 模型尚未就绪")
        session.stream.acceptWaveform(samples, SAMPLE_RATE)
        decodeReady(current, session.stream)
        return current.getResult(session.stream).text.trim()
    }

    @Synchronized
    internal fun finish(session: StreamingAsrSession): String {
        check(isSessionAvailable(session)) { "流式 ASR 会话已关闭" }
        val current = recognizer ?: throw IllegalStateException("流式 ASR 模型尚未就绪")
        // 追加约 400 ms 尾部静音，帮助 OnlineRecognizer 输出最后一个不完整块的结果。
        session.stream.acceptWaveform(FloatArray(SAMPLE_RATE * TAIL_PADDING_MS / 1000), SAMPLE_RATE)
        session.stream.inputFinished()
        decodeReady(current, session.stream)
        return current.getResult(session.stream).text.trim()
    }

    @Synchronized
    internal fun closeSession(session: StreamingAsrSession) {
        session.stream.release()
    }

    @Synchronized
    fun release() {
        recognizer?.release()
        recognizer = null
        isLoaded = false
    }

    private fun decodeReady(current: OnlineRecognizer, stream: OnlineStream) {
        while (current.isReady(stream)) current.decode(stream)
    }

    private fun isSessionAvailable(session: StreamingAsrSession): Boolean = !session.isClosed && isLoaded

    companion object {
        const val SAMPLE_RATE = 16_000
        private const val TAIL_PADDING_MS = 400
    }
}

class StreamingAsrSession internal constructor(
    private val engine: StreamingAsrEngine,
    internal val stream: OnlineStream
) : Closeable {
    @Volatile
    internal var isClosed: Boolean = false
        private set

    fun accept(samples: FloatArray): String = engine.accept(this, samples)

    fun finish(): String = engine.finish(this)

    override fun close() {
        if (isClosed) return
        isClosed = true
        engine.closeSession(this)
    }
}
