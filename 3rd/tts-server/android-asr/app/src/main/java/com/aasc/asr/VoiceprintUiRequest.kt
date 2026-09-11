package com.aasc.asr

// 原生页面提交声纹测试前统一整理参数，便于测试并保证单段不会误用多人数量。
data class VoiceprintUiRequest(
    val mode: VoiceprintMode,
    val speakerCount: Int,
    val asrDenoise: Boolean,
    val voiceprintDenoise: Boolean
) {
    companion object {
        fun create(
            mode: VoiceprintMode,
            selectedSpeakerCount: Int,
            asrDenoise: Boolean,
            voiceprintDenoise: Boolean
        ): VoiceprintUiRequest {
            val speakerCount = when {
                mode == VoiceprintMode.SHERPA_SINGLE -> VoiceprintSpeakerCount.AUTO
                selectedSpeakerCount == VoiceprintSpeakerCount.AUTO -> VoiceprintSpeakerCount.AUTO
                else -> VoiceprintSpeakerCount.parse(selectedSpeakerCount.toString())
                    ?: VoiceprintSpeakerCount.AUTO
            }
            return VoiceprintUiRequest(mode, speakerCount, asrDenoise, voiceprintDenoise)
        }
    }
}
