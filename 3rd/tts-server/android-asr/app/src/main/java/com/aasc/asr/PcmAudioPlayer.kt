package com.aasc.asr

import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack

// 原生 APK 的临时 PCM 播放器：播放线程独立于 UI 和 ASR 线程，避免大 WAV 写入时阻塞界面。
class PcmAudioPlayer {
    private val lock = Any()
    private var audioTrack: AudioTrack? = null
    private var playbackThread: Thread? = null
    private var generation = 0L

    fun play(samples: FloatArray) {
        require(samples.isNotEmpty()) { "没有可播放的音频" }
        val pcm = toPcm16(samples)
        val minimumBuffer = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        require(minimumBuffer > 0) { "设备不支持音频播放" }

        val track = AudioTrack(
            AudioManager.STREAM_MUSIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minimumBuffer, SAMPLE_RATE / 2),
            AudioTrack.MODE_STREAM
        )
        if (track.state != AudioTrack.STATE_INITIALIZED) {
            track.release()
            throw IllegalStateException("无法初始化音频播放设备")
        }

        val currentGeneration: Long
        synchronized(lock) {
            stopLocked()
            currentGeneration = ++generation
            audioTrack = track
            playbackThread = Thread({ writeAudio(track, pcm, currentGeneration) }, "asr-audio-playback")
            playbackThread?.start()
        }
    }

    fun stop() {
        synchronized(lock) { stopLocked() }
    }

    fun isPlaying(): Boolean = synchronized(lock) { audioTrack != null }

    private fun writeAudio(track: AudioTrack, pcm: ShortArray, currentGeneration: Long) {
        try {
            track.play()
            var offset = 0
            while (offset < pcm.size && isCurrent(track, currentGeneration)) {
                val written = track.write(pcm, offset, pcm.size - offset)
                if (written <= 0) break
                offset += written
            }
        } catch (_: Exception) {
            // 播放设备在切换音频或页面销毁时可能主动失效，统一在 finally 释放。
        } finally {
            synchronized(lock) {
                if (audioTrack === track && generation == currentGeneration) {
                    audioTrack = null
                    playbackThread = null
                    releaseTrack(track)
                } else {
                    releaseTrack(track)
                }
            }
        }
    }

    private fun isCurrent(track: AudioTrack, currentGeneration: Long): Boolean =
        synchronized(lock) { audioTrack === track && generation == currentGeneration }

    private fun stopLocked() {
        generation += 1
        val current = audioTrack
        audioTrack = null
        playbackThread?.interrupt()
        playbackThread = null
        if (current != null) releaseTrack(current)
    }

    private fun releaseTrack(track: AudioTrack) {
        try { track.pause() } catch (_: Exception) { /* 释放阶段忽略设备状态异常 */ }
        try { track.flush() } catch (_: Exception) { /* 释放阶段忽略设备状态异常 */ }
        try { track.stop() } catch (_: Exception) { /* 释放阶段忽略设备状态异常 */ }
        try { track.release() } catch (_: Exception) { /* 释放阶段忽略设备状态异常 */ }
    }

    companion object {
        const val SAMPLE_RATE = 16000

        fun toPcm16(samples: FloatArray): ShortArray = ShortArray(samples.size) { index ->
            val clipped = samples[index].coerceIn(-1f, 1f)
            (if (clipped < 0f) clipped * 32768f else clipped * 32767f).toInt().toShort()
        }
    }
}
