package com.aasc.rapidocr

import org.junit.Assert.assertEquals
import org.junit.Test

class OcrImagePolicyTest {
    @Test
    fun contentTypeParametersAreAccepted() {
        assertEquals(
            "image/jpeg",
            OcrImagePolicy.normalizeContentType("IMAGE/JPEG; charset=binary")
        )
        OcrImagePolicy.validateContentType("image/png; charset=binary")
        OcrImagePolicy.validateContentType("image/webp")
    }

    @Test(expected = IllegalArgumentException::class)
    fun audioContentTypeIsRejected() {
        OcrImagePolicy.validateContentType("audio/wav")
    }

    @Test(expected = IllegalArgumentException::class)
    fun missingContentTypeIsRejected() {
        OcrImagePolicy.validateContentType(null)
    }
}
