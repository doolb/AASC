# 同一注册声纹跨显示端 ASR 去重实现伪代码

## 去重器接口

```text
SameSpeakerVoiceInputDeduplicator:
    windowMs = 2000
    timingGapMs = 500
    textSimilarityThreshold = 0.65
    maxAgeMs = 10000
    recentInputs = []

    check(input, receivedAt):
        清理 receivedAt - item.receivedAt > maxAgeMs 的缓存项
        若 input.isFinal != true: 返回 { isDuplicate: false }
        若 input.speaker 为空: 返回 { isDuplicate: false }
        normalizedText = 规范化 input.text
        若 normalizedText 为空: 返回 { isDuplicate: false }

        candidate = recentInputs 中满足以下条件的最近项:
            item.speaker == input.speaker
            item.displayId != input.displayId
            若 item 和 input 都有有效语音时间:
                两个语音区间重叠或间隔 <= timingGapMs
                且字符编辑相似度(item.normalizedText, normalizedText) >= textSimilarityThreshold
            否则:
                item.normalizedText == normalizedText
                且 abs(receivedAt - item.receivedAt) <= windowMs

        若 candidate 存在:
            返回 {
                isDuplicate: true,
                duplicateOfDisplayId: candidate.displayId,
                speaker: input.speaker,
                textSimilarity: 字符编辑相似度(candidate.normalizedText, normalizedText)
            }

        recentInputs.push({
            speaker: input.speaker,
            displayId: input.displayId,
            normalizedText,
            speechStartAt: input.speechStartAt,
            speechEndAt: input.speechEndAt,
            receivedAt
        })
        返回 { isDuplicate: false }
```

## 服务端消息流程

```text
服务端收到显示端 voiceInput(displayId, data):
    voiceprintEnabledNow = 读取声纹开关
    dedupResult = sameSpeakerDeduplicator.check({
        displayId,
        speaker: data.speaker,
        text: data.text,
        isFinal: data.isFinal,
        speechStartAt: data.speechStartAt,
        speechEndAt: data.speechEndAt
    }, 当前服务端时间)

    若 dedupResult.isDuplicate:
        记录“同一注册声纹跨显示端重复 ASR 已抑制”日志
        直接结束本次消息

    若不是修复模式密码输入:
        broadcastToControls({
            type: 'voiceInput',
            displayId,
            text: data.text,
            isFinal: data.isFinal,
            fullText: data.fullText,
            speaker: data.speaker（声纹开启且字段存在时）
        })

    按原有流程处理未匹配声纹、TTS 回声、修复模式、会话门控和语音命令
```

## 测试伪代码

```text
同一 speaker + 不同 displayId + 相同文本 + 2 秒内:
    第一条不抑制
    第二条抑制

同一 speaker + 不同 displayId + 文本略有差异 + 语音区间重叠:
    文本相似度达到 0.65 时抑制第二条

同一 speaker + 文本相似但语音区间不重叠:
    不抑制

speaker 缺失或为 null:
    不抑制

不同 speaker、同一 displayId、超过时间窗口或文本不同:
    不抑制
```
