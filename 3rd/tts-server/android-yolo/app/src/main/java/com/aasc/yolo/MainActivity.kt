package com.aasc.yolo

import android.os.Bundle
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

/** YOLO11 测试 APK 控制页：准备五个模型、选择 CPU 模式并启动 HTTP 服务。 */
class MainActivity : AppCompatActivity() {
    @Volatile private var selectedCpuMode = CpuMode.AUTO
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private var detector: YoloDetector? = null
    private var httpServer: YoloHttpServer? = null
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
        prepareModelsInBackground()
    }

    /** 初始化 CPU 模式并保存用户选择；affinity 只在推理执行器线程应用。 */
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
        cpuModeSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                selectedCpuMode = modes.getOrElse(position) { CpuMode.AUTO }
                preferences.edit().putInt(CPU_MODE_KEY, selectedCpuMode.persistedValue).apply()
                updateCpuStatus()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
    }

    private fun updateCpuStatus() {
        cpuStatus.text = getString(R.string.cpu_mode_selected, selectedCpuMode.displayName)
    }

    private fun prepareModelsInBackground() {
        worker.execute {
            try {
                val modelDir = File(filesDir, YoloModelFiles.ASSET_DIRECTORY)
                YoloModelFiles.ensureCopied(assets, modelDir)
                val newDetector = YoloDetector(modelDir)
                detector = newDetector
                if (destroyed) {
                    newDetector.close()
                    return@execute
                }
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
        val currentServer = httpServer
        if (currentServer == null && (requestedPort == null || requestedPort !in 1024..65535)) {
            httpStatus.text = "HTTP 端口必须是 1024 到 65535"
            return
        }
        httpToggleButton.isEnabled = false
        worker.execute {
            if (currentServer?.isRunning() == true) {
                currentServer.stop()
                httpServer = null
                postUi {
                    httpToggleButton.text = getString(R.string.http_start)
                    httpStatus.setText(R.string.http_stopped)
                    httpToggleButton.isEnabled = true
                }
                return@execute
            }

            val currentDetector = detector
            if (currentDetector == null || requestedPort == null) {
                postUi {
                    httpStatus.text = "YOLO11 模型尚未准备完成"
                    httpToggleButton.isEnabled = true
                }
                return@execute
            }
            val newServer = YoloHttpServer(currentDetector) { selectedCpuMode }
            val result = newServer.start(requestedPort)
            if (result.isSuccess) {
                httpServer = newServer
                postUi {
                    httpToggleButton.text = getString(R.string.http_stop)
                    httpStatus.text = "HTTP 已启动：${newServer.addressText()}"
                    httpToggleButton.isEnabled = true
                }
            } else {
                postUi {
                    httpStatus.text = result.exceptionOrNull()?.message ?: "HTTP 启动失败"
                    httpToggleButton.isEnabled = true
                }
            }
        }
    }

    override fun onDestroy() {
        destroyed = true
        val server = httpServer
        val currentDetector = detector
        worker.execute {
            server?.stop()
            currentDetector?.close()
            worker.shutdown()
        }
        super.onDestroy()
    }

    private fun postUi(action: () -> Unit) {
        if (!destroyed) runOnUiThread { if (!destroyed) action() }
    }

    private companion object {
        const val PREFERENCES_NAME = "yolo_preferences"
        const val CPU_MODE_KEY = "cpuMode"
    }
}
