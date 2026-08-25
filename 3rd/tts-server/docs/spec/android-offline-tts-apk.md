# Android 独立离线 TTS APK 实现文档

本文档使用伪代码描述实现，必须与 `android-tts` 实际代码同步。

## 构建与资源

```text
AndroidTtsProject:
    namespace = "com.aasc.tts"
    applicationId = "com.aasc.tts"
    minSdk = 26
    targetSdk = 34
    abi = "arm64-v8a"
    dependency = existing EmbeddedSpeech SDK 1.51.2 AAR

    buildBundledModelAssets():
        requiredFiles = TtsModelFiles.FILE_NAMES
        copy requiredFiles from ../models/extracted to build/generated/assets/tts
        make generated assets part of main source set
```

## 文本策略

```text
TtsTextPolicy:
    MAX_LENGTH = 2000

    normalize(rawText):
        text = trim(rawText)
        if text is empty:
            throw "请输入要生成的文本"
        if length(text) > MAX_LENGTH:
            throw "文本不能超过 2000 个字符"
        return text
```

## 模型文件

```text
TtsModelFiles:
    FILE_NAMES = [
        2052.INI, MSTTSLocEnUS.dat, MSTTSLocZhCN.dat,
        MSTTSLocZhCN.ini, Tokens.xml, ZhCN.address.dat,
        ZhCN.message.dat, ZhCN.mixlingual.dat, ZhCN.name.dat,
        am_v5_decoder.bin, am_v5_encoder.bin,
        device_vocoder_v6_streaming.bin, phones.txt, punc.txt
    ]

    isComplete(modelDir):
        return modelDir is directory and every FILE_NAMES item is a regular file

    ensureCopied(assetManager, modelDir):
        if isComplete(modelDir):
            return
        create modelDir
        for name in FILE_NAMES:
            input = assetManager.open("tts/" + name)
            temp = modelDir/(name + ".tmp")
            stream input to temp
            atomically rename temp to modelDir/name
        if not isComplete(modelDir):
            throw "内置模型文件不完整"
```

## TTS 引擎

```text
TtsEngine.load(modelDir):
    config = EmbeddedSpeechConfig.fromPath(modelDir.absolutePath)
    config.outputFormat = Riff24Khz16BitMonoPcm
    voice = query voices from config
    selectedVoice = first voice containing "Xiaoxiao" or first available voice
    config.setVoice(selectedVoice, embeddedLicense)
    synthesizer = SpeechSynthesizer(config, null)  # 禁用 SDK 默认扬声器输出，只保留结果音频数据
    ready = true

TtsEngine.synthesize(text):
    require ready
    synchronize synthesizer
    startedAt = monotonicClock()
    result = synthesizer.SpeakText(text)  # 音频只从 result.audioData 取出
    if result.reason != SynthesizingAudioCompleted:
        throw cancellation details
    elapsedMs = monotonicClock() - startedAt
    return { audioData: result.audioData, elapsedMs: elapsedMs }

TtsEngine.release():
    close synthesizer
    ready = false
```

## 界面与流程

```text
MainActivity.onCreate:
    show multiline text editor
    show disabled generate button
    show "正在加载内置语音模型"
    background executor:
        TtsModelFiles.ensureCopied(application.assets, filesDir/models/tts)
        TtsEngine.load(filesDir/models/tts)
        main thread: enable button and show "已就绪"

generateButton.onClick:
        text = TtsTextPolicy.normalize(editor.text)
    disable button
    show "正在生成"
    background executor:
        wav = TtsEngine.synthesize(text)
        main thread:
            AudioPlayer.play(wav.audioData)
            enable button
            show "生成完成，用时 " + formatSeconds(wav.elapsedMs)

MainActivity.onDestroy:
    AudioPlayer.release()
    TtsEngine.release()
    executor.shutdownNow()
```

## 自测

```text
TtsTextPolicyTest:
    normalize("  你好  ") == "你好"
    normalize("   ") throws blank error
    normalize(text with 2000 chars) succeeds
    normalize(text with 2001 chars) throws length error

BuildTest:
    npm run build:android-tts exits with code 0
    APK manifest does not contain android.permission.INTERNET
    generated APK contains assets/tts/2052.INI and MSTTSLocZhCN.dat
```
