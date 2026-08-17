package com.aasc.display

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceprintDbCodecTest {

    @Test
    fun speakersFromDb_解析多说话人() {
        val db = JSONObject("""
            {"version":2,"dim":512,"speakers":{"妲己":[0.5,0.25,-0.125],"控制端":[1.0,-1.0,0.0]}}
        """.trimIndent())
        val speakers = VoiceprintDbCodec.speakersFromDb(db)
        assertEquals(2, speakers.size)
        assertArrayEquals(floatArrayOf(0.5f, 0.25f, -0.125f), speakers.getValue("妲己"), 1e-5f)
        assertArrayEquals(floatArrayOf(1.0f, -1.0f, 0.0f), speakers.getValue("控制端"), 1e-5f)
    }

    @Test
    fun speakersFromDb_空库返回空map() {
        val db = JSONObject("""{"version":1,"dim":512,"speakers":{}}""")
        assertTrue(VoiceprintDbCodec.speakersFromDb(db).isEmpty())
    }

    @Test
    fun toJson_与speakersFromDb往返一致() {
        val speakers = linkedMapOf("A" to floatArrayOf(0.1f, 0.2f), "B" to floatArrayOf(-0.3f, 0.4f))
        val json = VoiceprintDbCodec.toJson(speakers)
        val roundTrip = VoiceprintDbCodec.speakersFromDb(json)
        assertEquals(2, roundTrip.size)
        assertArrayEquals(floatArrayOf(0.1f, 0.2f), roundTrip.getValue("A"), 1e-6f)
        assertArrayEquals(floatArrayOf(-0.3f, 0.4f), roundTrip.getValue("B"), 1e-6f)
    }
}
