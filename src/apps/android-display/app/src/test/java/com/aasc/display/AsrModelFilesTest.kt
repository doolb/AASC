package com.aasc.display

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class AsrModelFilesTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun writeFile(name: String, size: Long): File {
        val f = tmp.newFile(name)
        f.writeBytes(ByteArray(size.toInt()))
        return f
    }

    @Test
    fun needsDownload_模型和tokens都齐全且模型够大返回false() {
        val model = writeFile("model.int8.onnx", AsrModelFiles.MIN_MODEL_SIZE_BYTES + 1)
        val tokens = writeFile("tokens.txt", 100)
        assertFalse(AsrModelFiles.needsDownload(model, tokens))
    }

    @Test
    fun needsDownload_缺tokens返回true() {
        val model = writeFile("model.int8.onnx", AsrModelFiles.MIN_MODEL_SIZE_BYTES + 1)
        // 不创建 tokens.txt
        assertTrue(AsrModelFiles.needsDownload(model, File(tmp.root, "tokens.txt")))
    }

    @Test
    fun needsDownload_模型过小视为损坏需重下() {
        val model = writeFile("model.int8.onnx", 1024)  // 远小于 MIN_MODEL_SIZE
        val tokens = writeFile("tokens.txt", 100)
        assertTrue(AsrModelFiles.needsDownload(model, tokens))
    }
}
