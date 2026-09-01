package com.aasc.rapidocr

import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** RapidOCR 测试 APK 的控制页：加载模型、启动 HTTP 服务并显示局域网访问地址。 */
class MainActivity : AppCompatActivity() {
    private val engine = RapidOcrEngine()
    @Volatile private var selectedCpuMode = CpuMode.AUTO
    private val httpServer = OcrHttpServer(
        engine = engine,
        cpuModeProvider = { selectedCpuMode }
    )
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    @Volatile private var destroyed = false

    private lateinit var modelStatus: TextView
    private lateinit var cpuStatus: TextView
    private lateinit var cpuModeSpinner: Spinner
    private lateinit var httpPortInput: EditText
    private lateinit var httpToggleButton: Button
    private lateinit var httpStatus: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        modelStatus = findViewById(R.id.modelStatus)
        cpuStatus = findViewById(R.id.cpuStatus)
        cpuModeSpinner = findViewById(R.id.cpuModeSpinner)
        httpPortInput = findViewById(R.id.httpPortInput)
        httpToggleButton = findViewById(R.id.httpToggleButton)
        httpStatus = findViewById(R.id.httpStatus)
        setupCpuMode()
        httpToggleButton.setOnClickListener { toggleHttpServer() }
        loadModelsInBackground()
    }

    /** 初始化 CPU 模式下拉框；真正的 affinity 在 HTTP 推理线程中执行。 */
    private fun setupCpuMode() {
        val preferences = getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
        selectedCpuMode = CpuMode.fromPersistedValue(
            preferences.getInt(CPU_MODE_KEY, CpuMode.AUTO.persistedValue)
        )
        val modes = CpuMode.entries.toList()
        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, modes.map { it.displayName })
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        cpuModeSpinner.adapter = adapter
        cpuModeSpinner.setSelection(selectedCpuMode.ordinal, false)
        updateCpuStatus()
        cpuModeSpinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: android.widget.AdapterView<*>?,
                view: android.view.View?,
                position: Int,
                id: Long
            ) {
                selectedCpuMode = modes.getOrElse(position) { CpuMode.AUTO }
                preferences.edit().putInt(CPU_MODE_KEY, selectedCpuMode.persistedValue).apply()
                updateCpuStatus()
            }

            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
        }
    }

    private fun updateCpuStatus() {
        cpuStatus.text = getString(R.string.cpu_mode_selected, selectedCpuMode.displayName)
    }

    private fun loadModelsInBackground() {
        worker.execute {
            try {
                val modelDir = File(filesDir, "rapidocr")
                RapidOcrModelFiles.ensureCopied(assets, modelDir)
                engine.load(modelDir)
                postUi {
                    modelStatus.setText(R.string.model_ready)
                    httpToggleButton.isEnabled = true
                }
            } catch (error: Exception) {
                postUi { modelStatus.text = getString(R.string.model_load_failed, error.message ?: "未知错误") }
            }
        }
    }

    private fun toggleHttpServer() {
        val requestedPort = httpPortInput.text.toString().trim().toIntOrNull()
        if (!httpServer.isRunning() && (requestedPort == null || requestedPort !in 1024..65535)) {
            httpStatus.text = "HTTP 端口必须是 1024 到 65535"
            return
        }

        httpToggleButton.isEnabled = false
        worker.execute {
            if (httpServer.isRunning()) {
                httpServer.stop()
                postUi {
                    httpToggleButton.setText(R.string.http_start)
                    httpStatus.setText(R.string.http_stopped)
                    httpToggleButton.isEnabled = engine.isReady
                }
                return@execute
            }

            val result = httpServer.start(requestedPort ?: OcrHttpServer.DEFAULT_PORT)
            postUi {
                result.fold(
                    onSuccess = { actualPort ->
                        httpToggleButton.setText(R.string.http_stop)
                        httpStatus.text = "服务已启动：${httpServer.addressText()}（端口 $actualPort）\n浏览器打开上面的地址上传图片"
                    },
                    onFailure = { error ->
                        httpStatus.text = error.message ?: "HTTP 服务启动失败"
                    }
                )
                httpToggleButton.isEnabled = true
            }
        }
    }

    private fun postUi(action: () -> Unit) {
        runOnUiThread {
            if (!destroyed) action()
        }
    }

    override fun onDestroy() {
        destroyed = true
        worker.execute {
            try {
                httpServer.stop()
                engine.release()
            } finally {
                worker.shutdown()
            }
        }
        super.onDestroy()
    }

    private companion object {
        const val PREFERENCES_NAME = "rapidocr_preferences"
        const val CPU_MODE_KEY = "cpuMode"
    }
}
