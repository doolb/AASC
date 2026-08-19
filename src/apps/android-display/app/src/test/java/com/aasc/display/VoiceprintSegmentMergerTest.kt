package com.aasc.display

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceprintSegmentMergerTest {

    @Test
    fun 同一speakerIndex的相邻原始区间合并() {
        val merged = VoiceprintSegmentMerger.merge(listOf(
            VoiceprintSegmentMerger.DiarizedSegment(0.0f, 1.0f, 0),
            VoiceprintSegmentMerger.DiarizedSegment(1.0f, 2.5f, 0)
        ))

        assertEquals(
            listOf(VoiceprintSegmentMerger.MergedSegment(0.0f, 2.5f, 0)),
            merged
        )
    }

    @Test
    fun 不同speakerIndex不合并() {
        val merged = VoiceprintSegmentMerger.merge(listOf(
            VoiceprintSegmentMerger.DiarizedSegment(0.0f, 1.0f, 0),
            VoiceprintSegmentMerger.DiarizedSegment(1.0f, 2.0f, 1),
            VoiceprintSegmentMerger.DiarizedSegment(2.0f, 3.0f, 0)
        ))

        assertEquals(
            listOf(
                VoiceprintSegmentMerger.MergedSegment(0.0f, 1.0f, 0),
                VoiceprintSegmentMerger.MergedSegment(1.0f, 2.0f, 1),
                VoiceprintSegmentMerger.MergedSegment(2.0f, 3.0f, 0)
            ),
            merged
        )
    }

    @Test
    fun 不同说话人不合并() {
        val merged = VoiceprintSegmentMerger.merge(listOf(
            VoiceprintSegmentMerger.DiarizedSegment(0.0f, 1.0f, 0),
            VoiceprintSegmentMerger.DiarizedSegment(1.0f, 2.0f, 1)
        ))

        assertEquals(2, merged.size)
        assertEquals(0, merged[0].speakerIndex)
        assertEquals(1, merged[1].speakerIndex)
    }

    @Test
    fun 相同speaker名称的原始区间二次合并且未知说话人阻断() {
        val merged = VoiceprintSegmentMerger.mergeMatched(listOf(
            VoiceprintSegmentMerger.MatchedSegment(0.0f, 1.0f, "测试声纹"),
            VoiceprintSegmentMerger.MatchedSegment(1.0f, 2.0f, "测试声纹"),
            VoiceprintSegmentMerger.MatchedSegment(2.0f, 4.0f, null),
            VoiceprintSegmentMerger.MatchedSegment(4.0f, 5.0f, "测试声纹")
        ))

        assertEquals(
            listOf(
                VoiceprintSegmentMerger.MergedMatchedSegment(0.0f, 2.0f, "测试声纹"),
                VoiceprintSegmentMerger.MergedMatchedSegment(4.0f, 5.0f, "测试声纹")
            ),
            merged
        )
    }

    @Test
    fun 同一speaker跨短未匹配间隔合并原始区间() {
        val merged = VoiceprintSegmentMerger.mergeMatched(listOf(
            VoiceprintSegmentMerger.MatchedSegment(0.0f, 1.0f, "测试声纹"),
            VoiceprintSegmentMerger.MatchedSegment(1.0f, 1.8f, null),
            VoiceprintSegmentMerger.MatchedSegment(1.8f, 3.0f, "测试声纹")
        ))

        assertEquals(
            listOf(VoiceprintSegmentMerger.MergedMatchedSegment(0.0f, 3.0f, "测试声纹")),
            merged
        )
    }
}
