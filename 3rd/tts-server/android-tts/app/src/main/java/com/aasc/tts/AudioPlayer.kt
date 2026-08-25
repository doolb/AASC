package com.aasc.tts

import android.content.Context
import android.media.MediaPlayer
import java.io.File

// 将 SDK 返回的 WAV 字节写入缓存文件后交给系统播放器，避免让 SDK 同时负责音频输出。
class AudioPlayer(private val context: Context) {
    private var mediaPlayer: MediaPlayer? = null
    private var outputFile: File? = null

    // 同一时间只保留一个播放实例；新音频开始前停止并释放旧播放器。
    fun play(audioData: ByteArray, onComplete: () -> Unit, onError: (Exception) -> Unit) {
        stop()
        try {
            val file = File(context.cacheDir, "offline-tts.wav")
            file.outputStream().use { output -> output.write(audioData) }
            outputFile = file

            val player = MediaPlayer()
            mediaPlayer = player
            player.setDataSource(file.absolutePath)
            player.setOnPreparedListener { prepared -> prepared.start() }
            player.setOnCompletionListener {
                releasePlayer()
                onComplete()
            }
            player.setOnErrorListener { _, what, extra ->
                releasePlayer()
                onError(IllegalStateException("音频播放失败: what=$what extra=$extra"))
                true
            }
            player.prepareAsync()
        } catch (error: Exception) {
            releasePlayer()
            onError(error)
        }
    }

    fun stop() {
        releasePlayer()
    }

    fun release() {
        releasePlayer()
    }

    private fun releasePlayer() {
        mediaPlayer?.let { player ->
            try {
                player.stop()
            } catch (_: IllegalStateException) {
                // 播放器尚未 prepare 或已经结束时 stop 会抛异常，释放流程仍需继续。
            }
            player.reset()
            player.release()
        }
        mediaPlayer = null
        outputFile?.delete()
        outputFile = null
    }
}
