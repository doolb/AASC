package com.aasc.tts

import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// 独立离线 TTS 页面：只负责输入、任务状态和把合成结果交给播放器。
class MainActivity : AppCompatActivity() {
    companion object {
        private const val PREFERENCES_NAME = "offline-tts"
        private const val CPU_MODE_KEY = "cpu-mode"
    }

    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private val engine = TtsEngine()
    private val preferences by lazy { getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE) }
    private lateinit var audioPlayer: AudioPlayer
    private lateinit var textInput: EditText
    private lateinit var generateButton: Button
    private lateinit var statusText: TextView
    private lateinit var cpuModeSpinner: Spinner

    @Volatile
    private var selectedCpuMode: CpuMode = CpuMode.AUTO

    @Volatile
    private var destroyed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        textInput = findViewById(R.id.textInput)
        generateButton = findViewById(R.id.generateButton)
        statusText = findViewById(R.id.statusText)
        cpuModeSpinner = findViewById(R.id.cpuModeSpinner)
        audioPlayer = AudioPlayer(this)
        setupCpuModeSpinner()
        generateButton.isEnabled = false
        generateButton.setOnClickListener { generateSpeech() }
        loadBundledModel()
    }

    private fun loadBundledModel() {
        statusText.setText(R.string.loading_model)
        worker.execute {
            try {
                val mode = selectedCpuMode
                val affinityStatus = CpuAffinity.apply(mode)
                val modelDir = File(filesDir, "models/tts")
                TtsModelFiles.ensureCopied(assets, modelDir)
                engine.load(modelDir)
                postUi {
                    generateButton.isEnabled = true
                    statusText.text = getString(R.string.model_ready) + "\n" +
                        CpuModeStatus.ready(affinityStatus)
                }
            } catch (error: Exception) {
                postUi {
                    generateButton.isEnabled = false
                    statusText.text = getString(
                        R.string.model_load_failed,
                        error.message ?: "内置模型加载失败"
                    )
                }
            }
        }
    }

    private fun generateSpeech() {
        val text = try {
            TtsTextPolicy.normalize(textInput.text.toString())
        } catch (error: IllegalArgumentException) {
            statusText.text = error.message ?: "文本输入无效"
            return
        }

        generateButton.isEnabled = false
        statusText.setText(R.string.generating)
        worker.execute {
            try {
                val mode = selectedCpuMode
                val affinityStatus = CpuAffinity.apply(mode)
                val result = engine.synthesize(text)
                postUi {
                    statusText.text = TtsStatusText.generationCompleted(result.elapsedMs) +
                        "\n" + CpuModeStatus.ready(affinityStatus)
                    audioPlayer.play(
                        result.audioData,
                        onComplete = { generateButton.isEnabled = true },
                        onError = { error ->
                            statusText.text = getString(
                                R.string.playback_failed,
                                error.message ?: "未知错误"
                            )
                            generateButton.isEnabled = true
                        }
                    )
                    // 合成已经完成，按钮不需要等待整段音频播放结束；再次生成会先停止旧播放。
                    generateButton.isEnabled = true
                }
            } catch (error: Exception) {
                postUi {
                    generateButton.isEnabled = true
                    statusText.text = getString(
                        R.string.generation_failed,
                        error.message ?: "未知错误"
                    )
                }
            }
        }
    }

    private fun setupCpuModeSpinner() {
        val entries = resources.getStringArray(R.array.cpu_mode_entries)
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, entries)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        cpuModeSpinner.adapter = adapter

        selectedCpuMode = CpuMode.fromPersistedValue(
            preferences.getInt(CPU_MODE_KEY, CpuMode.AUTO.persistedValue)
        )
        cpuModeSpinner.setSelection(selectedCpuMode.ordinal)
        cpuModeSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val mode = CpuMode.entries.getOrElse(position) { CpuMode.AUTO }
                selectedCpuMode = mode
                preferences.edit().putInt(CPU_MODE_KEY, mode.persistedValue).apply()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {
                selectedCpuMode = CpuMode.AUTO
            }
        }
    }

    // 后台任务完成后只在 Activity 仍存活时触碰界面，避免旋转/退出后的回调崩溃。
    private fun postUi(action: () -> Unit) {
        if (destroyed) return
        runOnUiThread {
            if (!destroyed) action()
        }
    }

    override fun onDestroy() {
        destroyed = true
        audioPlayer.release()
        engine.release()
        worker.shutdownNow()
        super.onDestroy()
    }
}
