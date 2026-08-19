package com.aasc.display

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ModelHashTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun sha256_小文件返回标准摘要() {
        val file = tmp.newFile("model.tmp")
        file.writeText("abc")

        assertTrue(
            ModelHash.sha256(file) ==
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
    }

    @Test
    fun matches_支持sha256sum带文件名格式() {
        val file = tmp.newFile("model.tmp")
        file.writeText("abc")
        val expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  model.int8.onnx"

        assertTrue(ModelHash.matches(file, expected))
        assertFalse(ModelHash.matches(file, "0000000000000000000000000000000000000000000000000000000000000000"))
    }
}
