package com.aasc.asr

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 负责把当前 ASR 样本保存为用户可获取的 WAV 文件，并隔离 Android 存储版本差异。
object WavFileSaver {
    fun save(context: Context, samples: FloatArray): String {
        require(samples.isNotEmpty()) { "没有可保存的音频" }
        val displayName = createDisplayName(System.currentTimeMillis())
        val wav = WavAudio.encode(samples, AudioRecorder.SAMPLE_RATE)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveToDownloads(context, displayName, wav)
        } else {
            saveToAppExternalAudio(context, displayName, wav)
        }
    }

    internal fun createDisplayName(timestamp: Long): String =
        "asr-${SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(timestamp))}.wav"

    private fun saveToDownloads(context: Context, displayName: String, wav: ByteArray): String {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, displayName)
            put(MediaStore.Downloads.MIME_TYPE, "audio/wav")
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: error("无法创建下载文件")
        try {
            resolver.openOutputStream(uri)?.use { it.write(wav) } ?: error("无法打开下载文件")
            val completed = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
            resolver.update(uri, completed, null, null)
            return "下载/$displayName"
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
    }

    private fun saveToAppExternalAudio(context: Context, displayName: String, wav: ByteArray): String {
        val directory = context.getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: context.filesDir
        val file = File(directory, displayName)
        try {
            file.outputStream().use { it.write(wav) }
            return file.absolutePath
        } catch (error: Exception) {
            file.delete()
            throw error
        }
    }
}
