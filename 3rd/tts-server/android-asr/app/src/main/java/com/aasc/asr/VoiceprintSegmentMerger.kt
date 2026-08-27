package com.aasc.asr

// 声纹分段合并器：先按 diarization 的聚类编号合并相邻音频区间，减少短片段声纹提取次数。
object VoiceprintSegmentMerger {
    private const val MAX_UNKNOWN_GAP_SECONDS = 1.0f

    data class DiarizedSegment(val start: Float, val end: Float, val speakerIndex: Int)
    data class MergedSegment(val start: Float, val end: Float, val speakerIndex: Int)
    data class MatchedSegment(val start: Float, val end: Float, val speaker: String?)
    data class MergedMatchedSegment(val start: Float, val end: Float, val speaker: String)

    fun merge(segments: List<DiarizedSegment>): List<MergedSegment> {
        val merged = mutableListOf<MergedSegment>()
        var previousSpeakerIndex: Int? = null
        for (segment in segments) {
            if (segment.end <= segment.start) {
                previousSpeakerIndex = null
                continue
            }
            val previous = merged.lastOrNull()
            if (previousSpeakerIndex == segment.speakerIndex && previous?.speakerIndex == segment.speakerIndex) {
                merged[merged.lastIndex] = previous.copy(end = segment.end)
            } else {
                merged += MergedSegment(segment.start, segment.end, segment.speakerIndex)
            }
            previousSpeakerIndex = segment.speakerIndex
        }
        return merged
    }

    // 过滤未知片段后，允许同一注册说话人跨越不超过 1 秒的未知空洞合并。
    fun mergeMatched(segments: List<MatchedSegment>): List<MergedMatchedSegment> {
        val merged = mutableListOf<MergedMatchedSegment>()
        var previousSpeaker: String? = null
        var previousMatchedEnd: Float? = null
        var crossedUnknown = false
        for (segment in segments) {
            val speaker = segment.speaker?.trim()?.takeIf { it.isNotEmpty() }
            if (speaker == null || segment.end <= segment.start) {
                if (previousSpeaker != null) crossedUnknown = true
                continue
            }
            val previous = merged.lastOrNull()
            val unknownGap = if (crossedUnknown && previousMatchedEnd != null) {
                segment.start - previousMatchedEnd
            } else {
                0.0f
            }
            val canCrossUnknown = !crossedUnknown || unknownGap <= MAX_UNKNOWN_GAP_SECONDS
            if (previousSpeaker == speaker && previous?.speaker == speaker && canCrossUnknown) {
                merged[merged.lastIndex] = previous.copy(end = segment.end)
            } else {
                merged += MergedMatchedSegment(segment.start, segment.end, speaker)
            }
            previousSpeaker = speaker
            previousMatchedEnd = segment.end
            crossedUnknown = false
        }
        return merged
    }
}
