package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceprintFastPathTest {
    @Test
    fun 每个cluster只选择最长片段作为声纹代表() {
        val segments = listOf(
            VoiceprintSegmentMerger.MergedSegment(0f, 1f, 0),
            VoiceprintSegmentMerger.MergedSegment(1.5f, 4f, 0),
            VoiceprintSegmentMerger.MergedSegment(4f, 5f, 1)
        )
        val representatives = VoiceprintFastPath.representatives(segments)
        assertEquals(
            listOf(
                VoiceprintSegmentMerger.MergedSegment(1.5f, 4f, 0),
                VoiceprintSegmentMerger.MergedSegment(4f, 5f, 1)
            ),
            representatives
        )
    }
}
