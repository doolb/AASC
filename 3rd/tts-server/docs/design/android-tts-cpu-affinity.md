# Android TTS CPU 核心模式设计

## 需求

为独立 `android-tts` APK 增加 TTS 合成 CPU 模式选择：自动、大核、小核。默认自动，用户选择持久化到应用配置；每次 TTS 工作线程开始模型加载或合成前应用当前模式。

## 范围与边界

- “大核/小核”按设备运行时暴露的 CPU capacity 优先、最大频率其次动态识别，不写死 CPU 编号。
- 通过 JNI 调用 `sched_setaffinity` 绑定当前 TTS 工作线程；不改变 UI 线程。
- SDK 可能创建独立 native worker，APK 不宣称能控制 SDK 的全部内部线程；模型加载和合成都在同一单线程执行器中触发，使新建 native 线程尽可能继承该 affinity。
- 自动模式清除当前工作线程的限制，让系统调度器决定核心。
- 设备无法读取核心能力、没有可用目标核心或 affinity 设置失败时，回退到自动并显示“自动模式/系统调度”。

## 界面

文本框上方增加“CPU 模式”下拉框：

```text
CPU 模式: [自动 ▼]
             自动
             大核
             小核
```

模型就绪和生成状态显示当前模式及实际结果，例如“模型已就绪（大核，核心 4-7）”。切换选项只影响后续任务，不中断正在进行的合成。

## 运行流程

```text
用户选择 mode
    ↓
SharedPreferences 保存 mode
    ↓
TTS 单线程任务开始
    ↓
CpuAffinity.apply(mode)
    ├─ 成功：返回实际核心集合
    └─ 失败/无法识别：恢复全核心，返回自动回退原因
    ↓
TtsEngine.load 或 TtsEngine.synthesize
```

## 性能与风险

- 大核通常降低合成延迟，但增加功耗和热量；小核降低功耗但可能增加耗时。
- CPU capacity、频率 sysfs 节点和权限在不同厂商设备上不完全一致，必须保留自动回退。
- 需要增加很小的 NDK/JNI 库，不改变 TTS SDK AAR 和模型资源。
