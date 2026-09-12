package com.aasc.asr

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.Switch
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
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
    private lateinit var asrDenoiseCheck: Switch
    private lateinit var voiceprintStatus: TextView
    private lateinit var voiceprintModelSpinner: Spinner
    private lateinit var voiceprintPrecisionSpinner: Spinner
    private lateinit var speakerName: EditText
    private lateinit var voiceprintDenoiseCheck: Switch
    private lateinit var registerSpeakerButton: Button
    private lateinit var voiceprintSpeakerCountSpinner: Spinner
    private lateinit var testSingleButton: Button
    private lateinit var testMultiButton: Button
    private lateinit var testMultiFastButton: Button
    private lateinit var voiceprintResult: TextView
    private val background: ExecutorService = Executors.newCachedThreadPool()
    private var selectedSamples: FloatArray? = null
    @Volatile
    private var selectedCpuMode = CpuMode.AUTO
    private var modelReady = false
    private var httpServer: AsrHttpServer? = null
    private var tlsContext: SSLContext? = null
    private var voiceprintActionBusy = false
    @Volatile
    private var selectedVoiceprintModel = VoiceprintModel.ERES2NET_BASE
    @Volatile
    private var selectedVoiceprintPrecision = VoiceprintPrecision.FP32

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
        coordinator = AsrCoordinator(engine, denoiseEngine)
        voiceprintCoordinator = VoiceprintTestCoordinator(engine, voiceprintEngine, denoiseEngine)
        setupVoiceprintModel()
        refreshVoiceprintStatus()
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
        asrDenoiseCheck = findViewById(R.id.asrDenoise)
        voiceprintStatus = findViewById(R.id.voiceprintStatus)
        voiceprintModelSpinner = findViewById(R.id.voiceprintModelSpinner)
        voiceprintPrecisionSpinner = findViewById(R.id.voiceprintPrecisionSpinner)
        speakerName = findViewById(R.id.speakerName)
        voiceprintDenoiseCheck = findViewById(R.id.voiceprintDenoise)
        registerSpeakerButton = findViewById(R.id.registerSpeaker)
        voiceprintSpeakerCountSpinner = findViewById(R.id.speakerCount)
        testSingleButton = findViewById(R.id.testSingle)
        testMultiButton = findViewById(R.id.testMulti)
        testMultiFastButton = findViewById(R.id.testMultiFast)
        voiceprintResult = findViewById(R.id.voiceprintResult)
        recordButton.setOnClickListener { toggleRecording() }
        findViewById<Button>(R.id.selectAudioButton).setOnClickListener { selectAudio.launch(arrayOf("audio/*")) }
        playAudioButton.setOnClickListener { toggleAudioPlayback() }
        saveAudioButton.setOnClickListener { saveCurrentWav() }
        recognizeButton.setOnClickListener { recognizeSelectedAudio() }
        registerSpeakerButton.setOnClickListener { registerSelectedVoiceprint() }
        testSingleButton.setOnClickListener { testVoiceprint(VoiceprintMode.SHERPA_SINGLE) }
        testMultiButton.setOnClickListener { testVoiceprint(VoiceprintMode.SHERPA_MULTI) }
        testMultiFastButton.setOnClickListener { testVoiceprint(VoiceprintMode.SHERPA_MULTI_FAST) }
        httpToggleButton.setOnClickListener { toggleHttpServer() }
        setupVoiceprintSpeakerCount()
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

    private fun setupVoiceprintSpeakerCount() {
        val labels = buildList {
            add(getString(R.string.voiceprint_count_auto))
            (VoiceprintSpeakerCount.MIN..VoiceprintSpeakerCount.MAX).forEach { count ->
                add(getString(R.string.voiceprint_count_format, count))
            }
        }
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, labels)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        voiceprintSpeakerCountSpinner.adapter = adapter
        voiceprintSpeakerCountSpinner.setSelection(0)
    }

    private fun setupVoiceprintModel() {
        val models = VoiceprintModel.values()
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, models.map { it.displayName })
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        voiceprintModelSpinner.adapter = adapter
        voiceprintModelSpinner.setSelection(selectedVoiceprintModel.ordinal)
        voiceprintModelSpinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                val model = models.getOrNull(position) ?: return
                if (model == selectedVoiceprintModel || !voiceprintCoordinator.isReady()) return
                reloadVoiceprintVariant(model.variant(selectedVoiceprintPrecision))
            }

            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
        }

        val precisions = VoiceprintPrecision.values()
        val precisionAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, precisions.map { it.displayName })
        precisionAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        voiceprintPrecisionSpinner.adapter = precisionAdapter
        voiceprintPrecisionSpinner.setSelection(selectedVoiceprintPrecision.ordinal)
        voiceprintPrecisionSpinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                val precision = precisions.getOrNull(position) ?: return
                if (precision == selectedVoiceprintPrecision || !voiceprintCoordinator.isReady()) return
                reloadVoiceprintVariant(selectedVoiceprintModel.variant(precision))
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
                val voiceprintLoaded = loadVoiceprintModel(selectedVoiceprintModel.variant(selectedVoiceprintPrecision), voiceprintDir)
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
                    refreshVoiceprintStatus()
                }
            } catch (error: Exception) {
                modelReady = false
                voiceprintEngine.release()
                denoiseEngine.release()
                streamingEngine.release()
                tlsContext = null
                runOnUiThread {
                    modelStatus.text = getString(R.string.model_load_failed, error.message ?: "未知错误")
                    refreshVoiceprintStatus()
                }
            }
        }
    }

    private fun loadVoiceprintModel(variant: VoiceprintModelVariant, modelDir: File = File(filesDir, "models/voiceprint")): Boolean {
        VoiceprintModelFiles.ensureCopied(assets, modelDir)
        val paths = VoiceprintModelFiles.paths(modelDir, variant)
        return voiceprintCoordinator.loadVariant(variant, paths.embedding, paths.segmentation)
            .get(60, TimeUnit.SECONDS)
    }

    private fun reloadVoiceprintVariant(variant: VoiceprintModelVariant) {
        if (voiceprintActionBusy) return
        voiceprintActionBusy = true
        updateVoiceprintActionState()
        voiceprintStatus.text = "正在加载 ${variant.displayName}…"
        background.execute {
            try {
                val loaded = loadVoiceprintModel(variant)
                if (loaded) {
                    selectedVoiceprintModel = variant.model
                    selectedVoiceprintPrecision = variant.precision
                }
                runOnUiThread {
                    if (loaded) {
                        voiceprintStatus.text = "${variant.displayName} 已加载，注册库已清空，请重新注册"
                        voiceprintResult.text = "已切换声纹模型：${variant.displayName}"
                    } else {
                        voiceprintStatus.text = "${variant.displayName} 加载失败"
                    }
                    syncVoiceprintSelection()
                    refreshVoiceprintStatus()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    voiceprintStatus.text = "${variant.displayName} 加载失败：${error.cause?.message ?: error.message ?: "未知错误"}"
                    syncVoiceprintSelection()
                    refreshVoiceprintStatus()
                }
            } finally {
                runOnUiThread {
                    voiceprintActionBusy = false
                    updateVoiceprintActionState()
                }
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
        val samples = selectedSamples?.copyOf()
        if (samples == null) { resultText.text = "请先录音或选择音频"; return }
        val validation = UiStatus.validate(samples)
        if (validation.isNotEmpty()) { resultText.text = validation; return }
        val denoise = asrDenoiseCheck.isChecked
        recognizeButton.isEnabled = false
        resultText.text = getString(R.string.recognizing)
        background.execute {
            try {
                val result = coordinator.submit(samples, selectedCpuMode, AsrLanguageMode.ZH, denoise).get()
                runOnUiThread { resultText.text = UiStatus.result(result.text, result.elapsedMs) }
            } catch (error: Exception) {
                runOnUiThread { resultText.text = "识别失败：${error.cause?.message ?: error.message ?: "未知错误"}" }
            } finally {
                runOnUiThread { recognizeButton.isEnabled = true }
            }
        }
    }

    private fun refreshVoiceprintStatus() {
        if (!voiceprintCoordinator.isReady()) {
            voiceprintStatus.setText(R.string.voiceprint_not_ready)
            updateVoiceprintActionState()
            return
        }
        val speakers = voiceprintCoordinator.registeredSpeakers()
        val speakerText = if (speakers.isEmpty()) "无" else speakers.joinToString("、")
        voiceprintStatus.text = buildString {
            appendLine("Sherpa 声纹模型已就绪：${voiceprintCoordinator.variant().displayName}")
            appendLine("embedding 维度：${voiceprintCoordinator.embeddingDim()}")
            appendLine("匹配阈值：${voiceprintCoordinator.matchThreshold()}")
            appendLine("已注册声纹：$speakerText")
        }
        updateVoiceprintActionState()
    }

    private fun updateVoiceprintActionState() {
        val voiceprintReady = voiceprintCoordinator.isReady()
        val canRegister = voiceprintReady && !voiceprintActionBusy
        val canTest = modelReady && voiceprintReady && !voiceprintActionBusy
        registerSpeakerButton.isEnabled = canRegister
        testSingleButton.isEnabled = canTest
        testMultiButton.isEnabled = canTest
        testMultiFastButton.isEnabled = canTest
        voiceprintSpeakerCountSpinner.isEnabled = canTest
        voiceprintModelSpinner.isEnabled = voiceprintReady && !voiceprintActionBusy
        voiceprintPrecisionSpinner.isEnabled = voiceprintReady && !voiceprintActionBusy
    }

    private fun syncVoiceprintSelection() {
        val variant = voiceprintCoordinator.variant()
        selectedVoiceprintModel = variant.model
        selectedVoiceprintPrecision = variant.precision
        voiceprintModelSpinner.setSelection(variant.model.ordinal, false)
        voiceprintPrecisionSpinner.setSelection(variant.precision.ordinal, false)
    }

    private fun selectedVoiceprintSpeakerCount(): Int {
        val position = voiceprintSpeakerCountSpinner.selectedItemPosition
        val rawValue = if (position == 0) "AUTO" else position.toString()
        return VoiceprintSpeakerCount.parse(rawValue) ?: VoiceprintSpeakerCount.AUTO
    }

    private fun registerSelectedVoiceprint() {
        if (voiceprintActionBusy) return
        if (!voiceprintCoordinator.isReady()) {
            voiceprintResult.text = getString(R.string.voiceprint_not_ready)
            return
        }
        val name = speakerName.text.toString().trim()
        if (name.isEmpty()) {
            voiceprintResult.text = "请输入注册名称"
            return
        }
        val samples = selectedSamples?.copyOf()
        if (samples == null) {
            voiceprintResult.text = "请先录音或选择音频"
            return
        }
        val validation = UiStatus.validate(samples)
        if (validation.isNotEmpty()) {
            voiceprintResult.text = validation
            return
        }
        val voiceprintDenoise = voiceprintDenoiseCheck.isChecked
        voiceprintActionBusy = true
        updateVoiceprintActionState()
        voiceprintResult.text = "正在注册声纹…"
        background.execute {
            try {
                val result = voiceprintCoordinator.register(
                    name,
                    samples,
                    selectedCpuMode,
                    voiceprintDenoise
                ).get()
                runOnUiThread {
                    voiceprintResult.text = UiStatus.voiceprintRegistration(result)
                    refreshVoiceprintStatus()
                }
            } catch (error: Exception) {
                runOnUiThread {
                    voiceprintResult.text = "声纹注册失败：${error.cause?.message ?: error.message ?: "未知错误"}"
                }
            } finally {
                runOnUiThread {
                    voiceprintActionBusy = false
                    updateVoiceprintActionState()
                }
            }
        }
    }

    private fun testVoiceprint(mode: VoiceprintMode) {
        if (voiceprintActionBusy) return
        if (!modelReady || !voiceprintCoordinator.isReady()) {
            voiceprintResult.text = "ASR 或声纹模型尚未就绪"
            return
        }
        val samples = selectedSamples?.copyOf()
        if (samples == null) {
            voiceprintResult.text = "请先录音或选择音频"
            return
        }
        val validation = UiStatus.validate(samples)
        if (validation.isNotEmpty()) {
            voiceprintResult.text = validation
            return
        }
        val request = VoiceprintUiRequest.create(
            mode,
            selectedVoiceprintSpeakerCount(),
            asrDenoiseCheck.isChecked,
            voiceprintDenoiseCheck.isChecked
        )
        voiceprintActionBusy = true
        updateVoiceprintActionState()
        voiceprintResult.text = "正在执行 ${mode.name}…"
        background.execute {
            try {
                val result = voiceprintCoordinator.test(
                    request.mode,
                    samples,
                    selectedCpuMode,
                    request.speakerCount,
                    request.asrDenoise,
                    request.voiceprintDenoise,
                    AsrLanguageMode.ZH
                ).get()
                runOnUiThread { voiceprintResult.text = UiStatus.voiceprintResult(result) }
            } catch (error: Exception) {
                runOnUiThread {
                    voiceprintResult.text = "声纹测试失败：${error.cause?.message ?: error.message ?: "未知错误"}"
                }
            } finally {
                runOnUiThread {
                    voiceprintActionBusy = false
                    updateVoiceprintActionState()
                }
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
            val server = AsrHttpServer(
                engine,
                coordinator,
                voiceprintCoordinator,
                streamingEngine,
                tlsContext,
                voiceprintModelLoader = ::switchVoiceprintVariantFromHttp,
                cpuModeProvider = { selectedCpuMode }
            )
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

    private fun switchVoiceprintVariantFromHttp(variant: VoiceprintModelVariant): Boolean {
        if (voiceprintCoordinator.isBusy()) throw AsrBusyException()
        val loaded = loadVoiceprintModel(variant)
        if (loaded) {
            selectedVoiceprintModel = variant.model
            selectedVoiceprintPrecision = variant.precision
            runOnUiThread {
                syncVoiceprintSelection()
                refreshVoiceprintStatus()
            }
        }
        return loaded
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
