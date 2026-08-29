package com.aasc.display

// 快速多段只对每个 cluster 的最长区间提取一次 embedding，ASR 仍保留所有有效时间段。
object VoiceprintFastPath {
    fun representatives(segments: List<VoiceprintSegmentMerger.MergedSegment>): List<VoiceprintSegmentMerger.MergedSegment> =
        segments.groupBy { it.speakerIndex }
            .values
            .mapNotNull { cluster -> cluster.maxByOrNull { it.end - it.start } }
            .sortedBy { it.start }
}
