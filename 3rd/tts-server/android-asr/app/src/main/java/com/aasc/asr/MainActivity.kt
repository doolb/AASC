package com.aasc.asr

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.net.ssl.SSLContext

// 独立 ASR 主界面：模型、文件和识别操作放后台线程，所有视图更新回到主线程。
class MainActivity : AppCompatActivity() {
    private val engine = AsrEngine()
    private val voiceprintEngine = SherpaVoiceprintEngine()
    private val denoiseEngine = SherpaDenoiseEngine()
    private val streamingEngine = StreamingAsrEngine()
    private val audioPlayer = PcmAudioPlayer()
    private lateinit var coordinator: AsrCoordinator
    private lateinit var voiceprintCoordinator: VoiceprintTestCoordinator
    private lateinit var recorder: AudioRecorder
    private lateinit var modelStatus: TextView
    private lateinit var audioStatus: TextView
    private lateinit var resultText: TextView
    private lateinit var recordButton: Button
    private lateinit var recognizeButton: Button
    private lateinit var playAudioButton: Button
    private lateinit var saveAudioButton: Button
    private lateinit var cpuModeSpinner: Spinner
    private lateinit var httpStatus: TextView
    private lateinit var httpPortInput: EditText
    private lateinit var httpToggleButton: Button
    private val background: ExecutorService = Executors.newCachedThreadPool()
    private var selectedSamples: FloatArray? = null
    @Volatile
    private var selectedCpuMode = CpuMode.AUTO
    private var modelReady = false
    private var httpServer: AsrHttpServer? = null
    private var tlsContext: SSLContext? = null

    private val requestRecordPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startRecording() else audioStatus.text = "麦克风权限被拒绝"
    }

    private val selectAudio = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@registerForActivityResult
        audioStatus.text = "正在读取音频…"
        background.execute {
            try {
                val samples = AudioFileDecoder.decode(this, uri)
                runOnUiThread {
                    audioPlayer.stop()
                    playAudioButton.isEnabled = true
                    selectedSamples = samples
                    saveAudioButton.isEnabled = samples.isNotEmpty()
                    audioStatus.text = "已选择音频：${samples.size / AudioRecorder.SAMPLE_RATE} 秒"
                }
            } catch (error: Exception) {
                runOnUiThread { audioStatus.text = "读取音频失败：${error.message ?: "格式不支持"}" }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        bindViews()
        setupCpuMode()
        recorder = AudioRecorder()
        coordinator = AsrCoordinator(engine)
        voiceprintCoordinator = VoiceprintTestCoordinator(engine, voiceprintEngine, denoiseEngine)
        loadModel()
    }

    private fun bindViews() {
        modelStatus = findViewById(R.id.modelStatus)
        audioStatus = findViewById(R.id.audioStatus)
        resultText = findViewById(R.id.resultText)
        recordButton = findViewById(R.id.recordButton)
        recognizeButton = findViewById(R.id.recognizeButton)
        playAudioButton = findViewById(R.id.playAudioButton)
        saveAudioButton = findViewById(R.id.saveAudioButton)
        cpuModeSpinner = findViewById(R.id.cpuModeSpinner)
        httpStatus = findViewById(R.id.httpStatus)
        httpPortInput = findViewById(R.id.httpPortInput)
        httpToggleButton = findViewById(R.id.httpToggleButton)
        recordButton.setOnClickListener { toggleRecording() }
        findViewById<Button>(R.id.selectAudioButton).setOnClickListener { selectAudio.launch(arrayOf("audio/*")) }
        playAudioButton.setOnClickListener { toggleAudioPlayback() }
        saveAudioButton.setOnClickListener { saveCurrentWav() }
        recognizeButton.setOnClickListener { recognizeSelectedAudio() }
        httpToggleButton.setOnClickListener { toggleHttpServer() }
    }

    private fun setupCpuMode() {
        val preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE)
        selectedCpuMode = CpuMode.fromPersistedValue(preferences.getInt(CPU_MODE_KEY, 0))
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, CpuMode.values().map { it.displayName })
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        cpuModeSpinner.adapter = adapter
        cpuModeSpinner.setSelection(selectedCpuMode.ordinal)
        cpuModeSpinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                selectedCpuMode = CpuMode.values()[position]
                preferences.edit().putInt(CPU_MODE_KEY, selectedCpuMode.persistedValue).apply()
                modelStatus.text = "CPU 模式：${CpuAffinity.apply(selectedCpuMode)}"
            }
            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
        }
    }

    private fun loadModel() {
        background.execute {
            try {
                val modelDir = File(filesDir, "models/sensevoice")
                AsrModelFiles.ensureCopied(assets, modelDir)
                val status = CpuAffinity.apply(selectedCpuMode)
                val loaded = engine.load(File(modelDir, "model.int8.onnx"), File(modelDir, "tokens.txt"))
                val voiceprintDir = File(filesDir, "models/voiceprint")
                VoiceprintModelFiles.ensureCopied(assets, voiceprintDir)
                val voiceprintLoaded = voiceprintEngine.load(
                    File(voiceprintDir, VoiceprintModelFiles.FILE_NAMES[0]),
                    File(voiceprintDir, VoiceprintModelFiles.FILE_NAMES[1])
                )
                val denoiseLoaded = try {
                    val denoiseDir = File(filesDir, "models/speech-enhancement")
                    DenoiseModelFiles.ensureCopied(assets, denoiseDir)
                    denoiseEngine.load(File(denoiseDir, DenoiseModelFiles.FILE_NAMES[0]))
                } catch (_: Exception) {
                    false
                }
                val streamingDir = File(filesDir, "models/streaming")
                StreamingAsrModelFiles.ensureCopied(assets, streamingDir)
                val streamingLoaded = streamingEngine.load(
                    File(streamingDir, StreamingAsrModelFiles.FILE_NAMES[0]),
                    File(streamingDir, StreamingAsrModelFiles.FILE_NAMES[1]),
                    File(streamingDir, StreamingAsrModelFiles.FILE_NAMES[2]),
                    File(streamingDir, StreamingAsrModelFiles.FILE_NAMES[3])
                )
                tlsContext = TlsMaterial.load(assets)
                modelReady = loaded
                runOnUiThread {
                    modelStatus.text = when {
                        loaded && voiceprintLoaded && streamingLoaded && denoiseLoaded -> getString(R.string.model_ready) + "\nSherpa 声纹模型已就绪\nSherpa GTCRN 降噪模型已就绪\n流式 ASR 模型已就绪\nHTTPS 证书已就绪\nCPU 模式：$status"
                        loaded && voiceprintLoaded && streamingLoaded -> getString(R.string.model_ready) + "\nSherpa 声纹模型已就绪\nSherpa GTCRN 降噪模型加载失败\n流式 ASR 模型已就绪\nHTTPS 证书已就绪\nCPU 模式：$status"
                        loaded && voiceprintLoaded -> getString(R.string.model_ready) + "\nSherpa 声纹模型已就绪\n流式 ASR 模型加载失败\nCPU 模式：$status"
                        loaded -> getString(R.string.model_ready) + "\nSherpa 声纹模型加载失败\nCPU 模式：$status"
                        else -> getString(R.string.model_load_failed, "请检查内置模型")
                    }
                }
            } catch (error: Exception) {
                modelReady = false
                voiceprintEngine.release()
                denoiseEngine.release()
                streamingEngine.release()
                tlsContext = null
                runOnUiThread { modelStatus.text = getString(R.string.model_load_failed, error.message ?: "未知错误") }
            }
        }
    }

    private fun toggleRecording() {
        if (recorder.isRecording()) {
            recordButton.isEnabled = false
            background.execute {
                val samples = recorder.stop()
                runOnUiThread {
                    audioPlayer.stop()
                    playAudioButton.isEnabled = true
                    saveAudioButton.isEnabled = samples.isNotEmpty()
                    recordButton.isEnabled = true
                    recordButton.setText(R.string.record_start)
                    selectedSamples = samples
                    audioStatus.text = "录音完成：${samples.size / AudioRecorder.SAMPLE_RATE} 秒"
                }
            }
        } else if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startRecording()
        } else requestRecordPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    private fun startRecording() {
        if (recorder.start()) {
            saveAudioButton.isEnabled = false
            recordButton.setText(R.string.record_stop)
            audioStatus.text = "录音中…"
        } else audioStatus.text = "无法启动录音"
    }

    private fun saveCurrentWav() {
        val samples = selectedSamples
        if (samples == null || samples.isEmpty()) {
            audioStatus.text = "请先录音或选择音频"
            return
        }
        saveAudioButton.isEnabled = false
        audioStatus.text = "保存 WAV 中…"
        background.execute {
            try {
                val location = WavFileSaver.save(this, samples)
                runOnUiThread {
                    audioStatus.text = "WAV 已保存：$location"
                    saveAudioButton.isEnabled = true
                }
            } catch (error: Exception) {
                runOnUiThread {
                    audioStatus.text = "保存 WAV 失败：${error.message ?: "存储不可用"}"
                    saveAudioButton.isEnabled = true
                }
            }
        }
    }

    private fun recognizeSelectedAudio() {
        if (!modelReady) { resultText.text = "模型尚未就绪"; return }
        val samples = selectedSamples
        if (samples == null) { resultText.text = "请先录音或选择音频"; return }
        val validation = UiStatus.validate(samples)
        if (validation.isNotEmpty()) { resultText.text = validation; return }
        recognizeButton.isEnabled = false
        resultText.text = getString(R.string.recognizing)
        background.execute {
            try {
                val result = coordinator.submit(samples, selectedCpuMode, AsrLanguageMode.ZH).get()
                runOnUiThread { resultText.text = UiStatus.result(result.text, result.elapsedMs) }
            } catch (error: Exception) {
                runOnUiThread { resultText.text = "识别失败：${error.cause?.message ?: error.message ?: "未知错误"}" }
            } finally {
                runOnUiThread { recognizeButton.isEnabled = true }
            }
        }
    }

    private fun toggleAudioPlayback() {
        val samples = selectedSamples
        if (samples == null) {
            audioStatus.text = "请先录音或选择音频"
            return
        }
        if (audioPlayer.isPlaying()) {
            audioPlayer.stop()
            playAudioButton.setText(R.string.play_audio)
            audioStatus.text = "已停止播放"
            return
        }
        playAudioButton.isEnabled = false
        audioStatus.text = "准备播放音频…"
        background.execute {
            try {
                audioPlayer.play(samples)
                runOnUiThread {
                    playAudioButton.isEnabled = true
                    playAudioButton.setText(R.string.stop_audio)
                    audioStatus.text = "正在播放音频"
                }
            } catch (error: Exception) {
                runOnUiThread {
                    playAudioButton.isEnabled = true
                    playAudioButton.setText(R.string.play_audio)
                    audioStatus.text = "播放失败：${error.message ?: "设备不支持"}"
                }
            }
        }
    }

    private fun toggleHttpServer() {
        val running = httpServer
        if (running != null) {
            running.stop()
            httpServer = null
            httpStatus.setText(R.string.http_stopped)
            httpToggleButton.setText(R.string.http_start)
            return
        }
        val port = httpPortInput.text.toString().toIntOrNull()
        if (port == null || port !in 1024..65535) { httpStatus.text = "HTTP 端口必须是 1024-65535"; return }
        background.execute {
            val server = AsrHttpServer(engine, coordinator, voiceprintCoordinator, streamingEngine, tlsContext) { selectedCpuMode }
            val started = server.start(port)
            runOnUiThread {
                if (started.isSuccess) {
                    httpServer = server
                    httpStatus.text = "HTTP 服务：${server.addressText()}"
                    httpToggleButton.setText(R.string.http_stop)
                } else httpStatus.text = "HTTP 启动失败：${started.exceptionOrNull()?.message ?: "端口不可用"}"
            }
        }
    }

    override fun onDestroy() {
        httpServer?.stop()
        audioPlayer.stop()
        coordinator.shutdown()
        voiceprintCoordinator.shutdown()
        streamingEngine.release()
        engine.release()
        background.shutdownNow()
        super.onDestroy()
    }

    companion object {
        private const val PREFERENCES = "asr-preferences"
        private const val CPU_MODE_KEY = "cpu-mode"
    }
}
