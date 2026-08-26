package com.aasc.display

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TtsEngineAudioOutputTest {

    @Test
    fun ttsEngine生成阶段必须关闭默认扬声器输出() {
        val source = locateSource("TtsEngine.kt").readText() + "\n" + locateSource("TtsEnginePool.kt").readText()

        assertTrue(
            "TtsEngine/TtsEnginePool 必须使用带 AudioConfig 的构造函数并显式传入 null",
            source.contains("SpeechSynthesizer(config, null)")
        )
        assertFalse(
            "TtsEngine/TtsEnginePool 不得使用会默认连接扬声器的单参数构造函数",
            source.contains("SpeechSynthesizer(config)")
        )
    }

    @Test
    fun probeVoice必须关闭声线结果对象和探测合成器() {
        val source = locateSource("TtsEngine.kt").readText()

        assertTrue(
            "probeVoice 必须关闭 SynthesisVoicesResult，避免 SDK 结果对象泄漏",
            source.contains("result.close()")
        )
        assertTrue(
            "probeVoice 必须继续关闭探测用 SpeechSynthesizer",
            source.contains("probe.close()")
        )
    }

    private fun locateSource(fileName: String): File {
        val candidates = listOf(
            File("src/main/java/com/aasc/display/$fileName"),
            File("app/src/main/java/com/aasc/display/$fileName"),
            File("../../src/apps/android-display/app/src/main/java/com/aasc/display/$fileName")
        )
        return candidates.firstOrNull { it.isFile }
            ?: throw IllegalStateException("找不到 $fileName 源文件")
    }
}
