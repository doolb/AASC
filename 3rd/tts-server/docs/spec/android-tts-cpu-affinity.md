# Android TTS CPU 核心模式实现文档

本文档使用伪代码描述实现，必须与 `android-tts` 实际代码同步。

## CPU 模式

```text
CpuMode:
    AUTO = 0
    BIG = 1
    LITTLE = 2

    persistedValue():
        return SharedPreferences.cpuMode or AUTO
```

## 核心识别与绑定

```text
CpuAffinity.apply(mode):
    cpuCount = read online/configured CPU count
    if mode == AUTO:
        sched_setaffinity(currentThread, all cpuCount)
        return "自动，系统调度"

    capacityByCpu = read /sys/devices/system/cpu/cpuN/cpu_capacity
    if capacityByCpu incomplete:
        capacityByCpu = read /sys/devices/system/cpu/cpuN/cpufreq/cpuinfo_max_freq
    if capacityByCpu cannot classify at least two groups:
        sched_setaffinity(currentThread, all cpuCount)
        return "自动回退，无法识别大小核"

    threshold = midpoint(min capacity, max capacity)
    targetCpus = mode == BIG ? capacity >= threshold : capacity < threshold
    if targetCpus is empty:
        sched_setaffinity(currentThread, all cpuCount)
        return "自动回退，没有目标核心"
    if sched_setaffinity(currentThread, targetCpus) fails:
        sched_setaffinity(currentThread, all cpuCount)
        return "自动回退，核心绑定失败"
    return mode label + targetCpus
```

## Kotlin/JNI 边界

```text
CpuAffinity.apply(mode):
    try:
        return nativeApply(mode.nativeValue)
    catch UnsatisfiedLinkError:
        return "自动回退，JNI 不可用"

MainActivity.loadBundledModel:
    mode = selectedCpuMode()
    affinityStatus = CpuAffinity.apply(mode)
    TtsModelFiles.ensureCopied(...)
    TtsEngine.load(...)
    show "模型已就绪（" + affinityStatus + ")"

MainActivity.generateSpeech:
    mode = selectedCpuMode()
    worker:
        affinityStatus = CpuAffinity.apply(mode)
        result = TtsEngine.synthesize(text)
    show "生成完成，用时 X.XX 秒（" + affinityStatus + ")"
```

## 自测

```text
CpuModeTest:
    AUTO/BIG/LITTLE 的持久化值互不相同
    非法持久化值回退 AUTO

CpuAffinityTest:
    native 库可加载时返回可读模式状态
    native 库不可用时返回自动回退状态，不抛出到 UI

BuildTest:
    debug APK 包含 lib/arm64-v8a/libcpu-affinity.so
    Android JVM 测试和 assembleDebug 通过
```
